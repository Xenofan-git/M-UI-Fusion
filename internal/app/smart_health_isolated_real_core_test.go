package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Synthetic local-only integration. No subscriber endpoints, production files,
// firewall changes, or real WAN traffic. Run only with explicit lab core path.
func TestSmartHealthIsolatedRealCore(t *testing.T) {
	core := os.Getenv("MUI_LAB_CORE")
	if core == "" {
		t.Skip("set MUI_LAB_CORE to the isolated test core executable")
	}
	interfaces, err := net.Interfaces()
	if err != nil || len(interfaces) != 1 || interfaces[0].Name != "lo" {
		t.Fatal("lab must run in an isolated loopback-only network namespace")
	}
	var aUp, bUp, controlUp atomic.Bool
	var aCalls, bCalls, controlCalls atomic.Int64
	aUp.Store(true)
	bUp.Store(true)
	controlUp.Store(true)
	fixture := func(up *atomic.Bool, calls *atomic.Int64) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls.Add(1)
			if !up.Load() {
				c, _, err := w.(http.Hijacker).Hijack()
				if err == nil {
					c.Close()
				}
				return
			}
			if r.Method == http.MethodConnect {
				if r.Host != "192.0.2.1:80" {
					http.Error(w, "unexpected fixture destination", 400)
					return
				}
				c, rw, e := w.(http.Hijacker).Hijack()
				if e != nil {
					return
				}
				defer c.Close()
				_ = c.SetDeadline(time.Now().Add(2 * time.Second))
				_, _ = rw.WriteString("HTTP/1.1 200 Connection established\r\n\r\n")
				if rw.Flush() != nil {
					return
				}
				req, e := http.ReadRequest(rw.Reader)
				if e != nil {
					return
				}
				req.Body.Close()
				_, _ = rw.WriteString("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
				_ = rw.Flush()
				return
			}
			w.WriteHeader(http.StatusNoContent)
		}))
	}
	a := fixture(&aUp, &aCalls)
	defer a.Close()
	b := fixture(&bUp, &bCalls)
	defer b.Close()
	control := fixture(&controlUp, &controlCalls)
	defer control.Close()
	_, aport, _ := net.SplitHostPort(a.Listener.Addr().String())
	_, bport, _ := net.SplitHostPort(b.Listener.Addr().String())
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := ln.Addr().String()
	ln.Close()
	mixed, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	_, mixedPort, _ := net.SplitHostPort(mixed.Addr().String())
	mixed.Close()
	cfg := defaultSmartHealth()
	cfg.Enabled = true
	cfg.Services = []string{"vk"}
	state := defaultState()
	state.SmartHealth = &cfg
	basics := effectiveMihomoBasics(state)
	basics.WatchdogEnabled = true
	state.MihomoBasics = &basics
	state.Settings.APIAddress = address
	state.Settings.APISecret = "local-lab-only"
	config := []byte(fmt.Sprintf("mixed-port: %s\nallow-lan: false\nbind-address: 127.0.0.1\nmode: rule\nlog-level: warning\nexternal-controller: %s\nsecret: local-lab-only\nipv6: false\ndns:\n  enable: false\nproxies:\n  - {name: A, type: http, server: 127.0.0.1, port: %s}\n  - {name: B, type: http, server: 127.0.0.1, port: %s}\nproxy-groups:\n  - {name: lab, type: url-test, proxies: [A, B], url: 'http://192.0.2.1/health', interval: 0, lazy: false, timeout: 1000}\nrules:\n  - MATCH,lab\n%s\n", mixedPort, address, aport, bport, smartHealthMarker))
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err = os.WriteFile(path, config, 0600); err != nil {
		t.Fatal(err)
	}
	m := &CoreManager{dataDir: dir, state: state}
	m.setCoreWanted(true)
	if err = m.testCoreConfig(core, path); err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	err = m.launchCoreLocked(core, path, config, address, state.Settings.APISecret)
	m.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if e := m.stopCore(); e != nil {
			t.Error(e)
		}
	})
	waitReady := func() {
		t.Helper()
		deadline := time.Now().Add(12 * time.Second)
		for time.Now().Before(deadline) {
			if watchdogProbe(context.Background(), address, state.Settings.APISecret) == "healthy" {
				return
			}
			time.Sleep(100 * time.Millisecond)
		}
		t.Fatal("lab controller not ready")
	}
	waitReady()
	m.mu.Lock()
	plan := m.smartHealth.applied
	cmd := m.cmd
	pid := cmd.Process.Pid
	m.mu.Unlock()
	if plan == nil || len(plan.Groups) != 1 {
		t.Fatal("missing lab plan")
	}
	// Allow the native one-time startup check to finish.
	time.Sleep(1300 * time.Millisecond)
	stats := func(label string) {
		status, _ := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
		rss := "unknown"
		for _, line := range strings.Split(string(status), "\n") {
			if strings.HasPrefix(line, "VmRSS:") {
				rss = strings.TrimSpace(strings.TrimPrefix(line, "VmRSS:"))
			}
		}
		t.Logf("resource %s: lab-core PID %d RSS %s", label, pid, rss)
	}
	// Exercise the actual scheduler in normal mode, with no external controls.
	m.smartHealthTick()
	m.mu.Lock()
	st := m.smartHealth.status
	m.mu.Unlock()
	if st.Mode != "normal" || st.Healthy != 2 || len(st.Controls) != 0 || time.Until(st.Next) < 178*time.Second || time.Until(st.Next) > 180*time.Second {
		t.Fatalf("initial actual scheduler status: %+v", st)
	}
	initial := aCalls.Load() + bCalls.Load()
	m.smartHealthTick()
	if aCalls.Load()+bCalls.Load() != initial {
		t.Fatal("scheduler probed before due")
	}
	t.Logf("actual scheduler: normal, healthy=%d, next in %.2fs, early tick did not probe", st.Healthy, time.Until(st.Next).Seconds())
	stats("normal")
	mode := "normal"
	client := &http.Client{Transport: &http.Transport{Proxy: nil, DisableKeepAlives: true}, Timeout: time.Second}
	defer client.CloseIdleConnections()
	controls := func(ctx context.Context, ids []string, first bool) []smartServiceResult {
		if len(ids) != 1 || ids[0] != "vk" {
			t.Fatal("selected controls changed")
		}
		start := time.Now()
		req, e := http.NewRequestWithContext(ctx, http.MethodHead, control.URL, nil)
		if e != nil {
			t.Fatal(e)
		}
		resp, e := client.Do(req)
		ok := e == nil && resp.StatusCode == 204
		if resp != nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}
		return []smartServiceResult{{"vk", ok, time.Since(start).Milliseconds()}}
	}
	eventModes := []string{"starting", "normal"}
	type step struct {
		label         string
		a, b, c       bool
		want          string
		scan, control bool
		healthy       int
	}
	steps := []step{
		{"all proxies fail, control available", false, false, true, "degraded", true, true, 0},
		{"all paths fail", false, false, false, "offline", true, true, 0},
		{"offline stays offline", false, false, false, "offline", false, true, 0},
		{"control recovers first", false, false, true, "degraded", true, true, 0},
		{"one proxy recovers", true, false, true, "normal", true, false, 1},
		{"another outage", false, false, false, "offline", true, true, 0},
		{"second offline check", false, false, false, "offline", false, true, 0},
		{"first control reply and proxy recovery", false, true, true, "normal", true, true, 1},
		{"both recover", true, true, true, "normal", true, false, 2},
	}
	for _, s := range steps {
		aUp.Store(s.a)
		bUp.Store(s.b)
		controlUp.Store(s.c)
		start := time.Now()
		scans, checks := 0, 0
		before := aCalls.Load() + bCalls.Load()
		beforeC := controlCalls.Load()
		result := smartRunCycle(context.Background(), cfg, mode, true,
			func(ctx context.Context) smartScanResult {
				scans++
				return smartScanGroups(ctx, plan, address, state.Settings.APISecret)
			},
			func(ctx context.Context, ids []string, first bool) []smartServiceResult {
				checks++
				if first != (mode == "offline") {
					t.Fatal("first-response flag wrong")
				}
				return controls(ctx, ids, first)
			},
			func(ctx context.Context) bool {
				return watchdogProbe(ctx, address, state.Settings.APISecret) == "healthy"
			})
		if result.Mode != s.want || result.Healthy != s.healthy || (scans > 0) != s.scan || (checks > 0) != s.control {
			t.Fatalf("%s: result=%+v scans=%d controls=%d", s.label, result, scans, checks)
		}
		if !s.scan && aCalls.Load()+bCalls.Load() != before {
			t.Fatal("unexpected network probe while offline")
		}
		if !s.control && controlCalls.Load() != beforeC {
			t.Fatal("unexpected control request")
		}
		m.coreWatchdogTick(time.Now().Add(20 * time.Second))
		m.mu.Lock()
		if m.cmd != cmd || len(m.watchdog.attempts) != 0 || m.watchdog.status != "healthy" {
			m.mu.Unlock()
			t.Fatal("watchdog restarted healthy core on network fault")
		}
		if result.Mode != mode {
			eventModes = append(eventModes, result.Mode)
		}
		m.smartModeLocked(result.Mode)
		m.mu.Unlock()
		t.Logf("%s: %s healthy=%d scan=%d control=%d next=%s cycle=%s", s.label, result.Mode, result.Healthy, scans, checks, smartInterval(cfg, result.Mode), time.Since(start).Round(time.Millisecond))
		mode = result.Mode
	}
	m.mu.Lock()
	var got []string
	for _, e := range m.smartHealth.status.Events {
		got = append(got, e.Mode)
	}
	m.mu.Unlock()
	want, _ := json.Marshal(eventModes)
	actual, _ := json.Marshal(got)
	if string(want) != string(actual) {
		t.Fatalf("journal got %s want %s", actual, want)
	}
	t.Logf("journal transitions: %s", actual)
	stats("after repeated outage")
	// Kill only the actual lab child, never the production core.
	m.mu.Lock()
	done := m.coreDone
	m.mu.Unlock()
	if err = cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("lab child did not exit")
	}
	start := time.Now()
	m.coreWatchdogTick(time.Now().Add(40 * time.Second))
	waitReady()
	m.mu.Lock()
	newCmd := m.cmd
	attempts := len(m.watchdog.attempts)
	m.mu.Unlock()
	if newCmd == nil || newCmd == cmd || attempts != 1 {
		t.Fatal("watchdog did not restart crashed lab core once")
	}
	t.Logf("real lab core recovered: old PID=%d new PID=%d attempts=%d restart+ready=%s (forced watchdog tick)", pid, newCmd.Process.Pid, attempts, time.Since(start).Round(time.Millisecond))
	m.smartHealthTick()
	m.mu.Lock()
	last := m.smartHealth.status
	m.mu.Unlock()
	if last.Mode == "starting" {
		until := time.Until(last.Next)
		if until < 2*time.Second || until > 3*time.Second || len(last.Controls) != 0 {
			t.Fatalf("unexpected startup retry %+v", last)
		}
		t.Logf("startup race handled: initialization, no control probes, next retry %.2fs", until.Seconds())
		started := time.Now()
		// Wait for the actual scheduler deadline rather than advancing it.
		time.Sleep(time.Until(last.Next) + 100*time.Millisecond)
		m.smartHealthTick()
		m.mu.Lock()
		last = m.smartHealth.status
		m.mu.Unlock()
		t.Logf("actual startup retry after %s", time.Since(started).Round(time.Millisecond))
	}
	if last.Mode != "normal" || last.Healthy != 2 {
		t.Fatalf("after restart and retry: %+v", last)
	}
	for _, e := range last.Events {
		if e.Mode == "unknown" {
			t.Fatal("false unknown event during startup")
		}
	}
	t.Log("normal state recovered after core restart without spurious unknown event")
	pid = newCmd.Process.Pid
	stats("recovered")
	// Full actual scheduler path for total loss: the namespace has only lo,
	// so the real control checks cannot reach their configured Internet host.
	aUp.Store(false)
	bUp.Store(false)
	m.mu.Lock()
	m.smartHealth.status.Next = time.Now()
	m.mu.Unlock()
	m.smartHealthTick()
	m.mu.Lock()
	offline := m.smartHealth.status
	m.mu.Unlock()
	if offline.Mode != "offline" || offline.Healthy != 0 || len(offline.Controls) != 1 || offline.Controls[0].OK || time.Until(offline.Next) < 9*time.Second || time.Until(offline.Next) > 10*time.Second {
		t.Fatalf("real offline scheduler: %+v", offline)
	}
	before := aCalls.Load() + bCalls.Load()
	m.smartHealthTick()
	if aCalls.Load()+bCalls.Load() != before {
		t.Fatal("early offline scan")
	}
	t.Logf("actual scheduler: full loss => offline, real control failed, next %.2fs", time.Until(offline.Next).Seconds())
	started := time.Now()
	time.Sleep(time.Until(offline.Next) + 100*time.Millisecond)
	m.smartHealthTick()
	m.mu.Lock()
	still := m.smartHealth.status
	m.mu.Unlock()
	if still.Mode != "offline" || aCalls.Load()+bCalls.Load() != before || still.Last.Equal(offline.Last) {
		t.Fatalf("offline polling mismatch: %+v", still)
	}
	t.Logf("actual scheduler: waited %s; control-only poll, zero proxy probes", time.Since(started).Round(time.Millisecond))
	m.coreWatchdogTick(time.Now().Add(20 * time.Second))
	m.mu.Lock()
	same := m.cmd == newCmd && len(m.watchdog.attempts) == 1
	m.mu.Unlock()
	if !same {
		t.Fatal("watchdog restarted healthy core during actual offline interval")
	}
	stats("after real offline interval")
	// A controller that never exposes its group must leave initialization.
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/version" {
			fmt.Fprint(w, `{"version":"fixture"}`)
			return
		}
		http.Error(w, "missing group", 404)
	}))
	defer bad.Close()
	m.mu.Lock()
	m.watchdog.controller = bad.Listener.Addr().String()
	m.smartHealth.status.Mode = "starting"
	m.smartHealth.startupDeadline = time.Now().Add(-time.Second)
	m.smartHealth.status.Next = time.Now()
	m.mu.Unlock()
	m.smartHealthTick()
	m.mu.Lock()
	expired := m.smartHealth.status
	m.mu.Unlock()
	if expired.Mode != "unknown" || time.Until(expired.Next) < 58*time.Second || time.Until(expired.Next) > 60*time.Second {
		t.Fatalf("expired startup did not fail normally: %+v", expired)
	}
	t.Log("expired startup grace: unknown, standard 60s retry; no endless initialization")
}
