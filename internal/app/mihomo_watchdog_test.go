package app

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestWatchdogProbeLocalOnly(t *testing.T) {
	for _, tc := range []struct {
		code       int
		body, want string
	}{
		{200, `{"version":"v1.19.33"}`, "healthy"},
		{401, "", "api_error"},
		{500, "", "api_error"},
		{200, "invalid", "api_error"},
	} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/version" || r.Header.Get("Authorization") != "Bearer local-test" {
				t.Error("incorrect local request")
			}
			w.WriteHeader(tc.code)
			fmt.Fprint(w, tc.body)
		}))
		got := watchdogProbe(context.Background(), srv.Listener.Addr().String(), "local-test")
		srv.Close()
		if got != tc.want {
			t.Fatalf("got %s want %s", got, tc.want)
		}
	}
	if got := watchdogProbe(context.Background(), "example.com:443", ""); got != "api_error" {
		t.Fatalf("nonlocal address accepted: %s", got)
	}
}
func TestWatchdogBudget(t *testing.T) {
	now := time.Now()
	w := coreWatchdogRuntime{}
	for i := 0; i < 3; i++ {
		at := now.Add(time.Duration(i) * watchdogMinRestartGap)
		if !w.permit(at) {
			t.Fatal("attempt wrongly blocked")
		}
		w.attempts = append(w.attempts, at)
		if w.permit(at.Add(time.Second)) {
			t.Fatal("minimum gap ignored")
		}
	}
	if w.permit(now.Add(5 * time.Minute)) {
		t.Fatal("rate limit ignored")
	}
	if !w.permit(now.Add(11 * time.Minute)) {
		t.Fatal("limit never expires")
	}
}
func watchdogFixture(t *testing.T) *CoreManager {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("Unix fixture")
	}
	dir := t.TempDir()
	core := filepath.Join(dir, "fake-core")
	if err := os.WriteFile(core, []byte("#!/bin/sh\nfor a in \"$@\"; do\n case \"$a\" in -t) exit 0;; -v) echo 'Mihomo v1.19.33'; exit 0;; esac\ndone\nexec sleep 600\n"), 0700); err != nil {
		t.Fatal(err)
	}
	state := defaultState()
	state.Settings.CorePath = core
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	state.Settings.APIAddress = ln.Addr().String()
	ln.Close()
	basics := effectiveMihomoBasics(state)
	basics.WatchdogEnabled = true
	state.MihomoBasics = &basics
	m := &CoreManager{dataDir: dir, state: state}
	if err := m.startCore(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := m.stopCore(); err != nil {
			t.Error(err)
		}
	})
	return m
}
func TestWatchdogCrashAndManualStop(t *testing.T) {
	m := watchdogFixture(t)
	m.mu.Lock()
	cmd, done := m.cmd, m.coreDone
	m.mu.Unlock()
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("fixture did not exit")
	}
	m.coreWatchdogTick(time.Now().Add(20 * time.Second))
	m.mu.Lock()
	recovered := m.cmd != nil && m.cmd != cmd
	attempts := len(m.watchdog.attempts)
	m.mu.Unlock()
	if !recovered || attempts != 1 {
		t.Fatalf("recovered=%v attempts=%d", recovered, attempts)
	}
	if err := m.stopCore(); err != nil {
		t.Fatal(err)
	}
	m.coreWatchdogTick(time.Now().Add(time.Minute))
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cmd != nil || m.watchdog.wanted {
		t.Fatal("manual stop was undone")
	}
}
func TestWatchdogHangThresholdAndConfigGuard(t *testing.T) {
	m := watchdogFixture(t)
	m.mu.Lock()
	cmd := m.cmd
	now := m.started.Add(20 * time.Second)
	m.mu.Unlock()
	for i := 0; i < 2; i++ {
		m.coreWatchdogTick(now.Add(time.Duration(i) * watchdogInterval))
	}
	m.mu.Lock()
	same := m.cmd == cmd
	failures := m.watchdog.failures
	m.mu.Unlock()
	if !same || failures != 2 {
		t.Fatalf("premature restart, failures=%d", failures)
	}
	path := filepath.Join(m.dataDir, "config.yaml")
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.WriteString("\n# pending changes\n"); err != nil {
		t.Fatal(err)
	}
	f.Close()
	m.coreWatchdogTick(now.Add(2 * watchdogInterval))
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cmd != cmd || m.watchdog.status != "config_changed" || len(m.watchdog.attempts) != 0 {
		t.Fatal("pending config was not protected")
	}
}
func TestWatchdogHangRecovers(t *testing.T) {
	m := watchdogFixture(t)
	m.mu.Lock()
	cmd := m.cmd
	now := m.started.Add(20 * time.Second)
	m.mu.Unlock()
	for i := 0; i < 3; i++ {
		m.coreWatchdogTick(now.Add(time.Duration(i) * watchdogInterval))
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cmd == nil || m.cmd == cmd || len(m.watchdog.attempts) != 1 {
		t.Fatal("confirmed hang did not recover")
	}
}
func TestWatchdogSettingsPersistAndDoNotChangeYAML(t *testing.T) {
	state := defaultState()
	m := &CoreManager{dataDir: t.TempDir(), state: state}
	before, err := renderStateConfig(state)
	if err != nil {
		t.Fatal(err)
	}
	b := effectiveMihomoBasics(state)
	b.WatchdogEnabled = true
	if err = m.updateMihomoSettings(mihomoSettingsPayload{Basics: &b}); err != nil {
		t.Fatal(err)
	}
	after, err := renderStateConfig(m.state)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("watchdog setting changed core YAML")
	}
	loaded := &CoreManager{dataDir: m.dataDir}
	if err = loaded.load(); err != nil {
		t.Fatal(err)
	}
	if !effectiveMihomoBasics(loaded.state).WatchdogEnabled {
		t.Fatal("watchdog setting not persisted")
	}
}
