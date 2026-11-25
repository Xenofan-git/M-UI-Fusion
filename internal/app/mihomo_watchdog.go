package app

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// The watchdog monitors only the locally managed core, not the Internet.
// Its settings are opt-in on upgrades. All runtime fields use CoreManager.mu.
type coreWatchdogRuntime struct {
	wanted                       bool
	status                       string
	failures                     int
	attempts                     []time.Time
	lastCheck                    time.Time
	appliedDigest                [sha256.Size]byte
	corePath, controller, secret string
}
type coreWatchdogStatus struct {
	Enabled   bool      `json:"enabled"`
	State     string    `json:"state"`
	Failures  int       `json:"failures"`
	Attempts  int       `json:"attempts"`
	LastCheck time.Time `json:"lastCheck"`
}

const (
	watchdogInterval      = 10 * time.Second
	watchdogFailureLimit  = 3
	watchdogAttemptLimit  = 3
	watchdogAttemptWindow = 10 * time.Minute
	watchdogMinRestartGap = 30 * time.Second
)

func (m *CoreManager) setCoreWanted(wanted bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.watchdog.wanted = wanted
	m.watchdog.failures = 0
	m.watchdog.attempts = nil
	m.watchdog.status = "starting"
	if !wanted {
		m.watchdog.status = "stopped"
	}
}
func (w *coreWatchdogRuntime) prune(now time.Time) {
	for len(w.attempts) > 0 && now.Sub(w.attempts[0]) >= watchdogAttemptWindow {
		w.attempts = w.attempts[1:]
	}
}
func (w *coreWatchdogRuntime) permit(now time.Time) bool {
	w.prune(now)
	if len(w.attempts) >= watchdogAttemptLimit {
		return false
	}
	return len(w.attempts) == 0 || now.Sub(w.attempts[len(w.attempts)-1]) >= watchdogMinRestartGap
}
func (m *CoreManager) watchdogStatusLocked(now time.Time) coreWatchdogStatus {
	w := &m.watchdog
	w.prune(now)
	enabled := effectiveMihomoBasics(m.state).WatchdogEnabled
	state := w.status
	if !enabled {
		state = "disabled"
	} else if !w.wanted {
		state = "stopped"
	} else if state == "" {
		state = "starting"
	}
	return coreWatchdogStatus{enabled, state, w.failures, len(w.attempts), w.lastCheck}
}
func (m *CoreManager) monitorCoreWatchdog() {
	ticker := time.NewTicker(watchdogInterval)
	defer ticker.Stop()
	for now := range ticker.C {
		m.coreWatchdogTick(now)
	}
}

// Only loopback or wildcard controller bindings are eligible. An HTTP error
// is evidence of a responsive API, not evidence of a frozen process.
func watchdogProbe(ctx context.Context, address, secret string) string {
	host, port := hostPortFromAddress(address)
	if port == 0 {
		return "api_error"
	}
	switch host {
	case "", "0.0.0.0", "localhost":
		host = "127.0.0.1"
	case "::":
		host = "::1"
	default:
		if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
			return "api_error"
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+net.JoinHostPort(host, strconv.Itoa(port))+"/version", nil)
	if err != nil {
		return "api_error"
	}
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	transport := &http.Transport{Proxy: nil, DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 2 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return "unresponsive"
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "api_error"
	}
	var result struct{ Version string }
	if json.NewDecoder(io.LimitReader(resp.Body, 65536)).Decode(&result) != nil || result.Version == "" {
		return "api_error"
	}
	return "healthy"
}
func (m *CoreManager) coreWatchdogTick(now time.Time) {
	if !m.coreLifecycle.TryLock() {
		return
	}
	defer m.coreLifecycle.Unlock()
	defer func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if m.diagnostic != nil {
			m.diagnosticLocked("watchdog_check", m.watchdogStatusLocked(time.Now()))
		}
	}()
	m.mu.Lock()
	w := &m.watchdog
	if !effectiveMihomoBasics(m.state).WatchdogEnabled || !w.wanted {
		w.failures = 0
		m.mu.Unlock()
		return
	}
	cmd := m.cmd
	controller, secret := w.controller, w.secret
	// Avoid probing during startup; the process may still be loading data.
	if cmd != nil && now.Sub(m.started) < watchdogInterval {
		m.mu.Unlock()
		return
	}
	m.mu.Unlock()
	status := "exited"
	if cmd != nil {
		status = watchdogProbe(context.Background(), controller, secret)
	}
	m.mu.Lock()
	if !effectiveMihomoBasics(m.state).WatchdogEnabled || !w.wanted || m.cmd != cmd {
		m.mu.Unlock()
		return
	}
	previous := w.status
	w.lastCheck = now
	w.status = status
	if status == "healthy" || status == "api_error" {
		w.failures = 0
		if previous != status && previous != "starting" {
			m.addLogLocked("Mihomo Watchdog: " + status)
		}
		m.mu.Unlock()
		return
	}
	w.failures++
	if status == "unresponsive" && w.failures < watchdogFailureLimit {
		m.mu.Unlock()
		return
	}
	if !w.permit(now) {
		w.status = "cooldown"
		if previous != w.status {
			m.addLogLocked("Mihomo Watchdog: restart limit or cooldown")
		}
		m.mu.Unlock()
		return
	}
	path := filepath.Join(m.dataDir, "config.yaml")
	config, err := os.ReadFile(path)
	// Never apply pending changes or an unknown config in an automatic restart.
	if err != nil || w.appliedDigest == ([sha256.Size]byte{}) || sha256.Sum256(config) != w.appliedDigest || w.corePath == "" {
		w.status = "config_changed"
		if previous != w.status {
			m.addLogLocked("Mihomo Watchdog: recovery blocked; active configuration not verified")
		}
		m.mu.Unlock()
		return
	}
	w.attempts = append(w.attempts, now)
	w.status = "recovering"
	m.addLogLocked("Mihomo Watchdog: automatic recovery (" + status + ")")
	m.diagnosticLocked("watchdog_recovery", map[string]any{"reason": status, "attempts": len(w.attempts)})
	corePath := w.corePath
	m.mu.Unlock()
	// Validate before terminating a running process. Do not disclose config or
	// secret values in watchdog logs. Manual start exposes the normal diagnostics.
	if err = m.testCoreConfig(corePath, path); err != nil {
		m.watchdogRecoveryFailed()
		return
	}
	m.mu.Lock()
	current, readErr := os.ReadFile(path)
	eligible := effectiveMihomoBasics(m.state).WatchdogEnabled && w.wanted && m.cmd == cmd && readErr == nil && sha256.Sum256(current) == w.appliedDigest
	m.mu.Unlock()
	if !eligible {
		m.watchdogRecoveryFailed()
		return
	}
	if err = m.stopCoreManaged(); err != nil {
		m.watchdogRecoveryFailed()
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	current, readErr = os.ReadFile(path)
	if readErr != nil || sha256.Sum256(current) != w.appliedDigest {
		w.status = "config_changed"
		m.addLogLocked("Mihomo Watchdog: recovery blocked; configuration changed")
		return
	}
	if err = m.launchCoreLocked(corePath, path, current, controller, secret); err != nil {
		w.status = "recovery_failed"
		m.addLogLocked("Mihomo Watchdog: automatic launch failed")
	}
}
func (m *CoreManager) watchdogRecoveryFailed() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.watchdog.status = "recovery_failed"
	m.addLogLocked(fmt.Sprintf("Mihomo Watchdog: recovery attempt failed (%d/%d)", len(m.watchdog.attempts), watchdogAttemptLimit))
}
