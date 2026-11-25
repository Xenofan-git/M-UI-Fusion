package app

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os/exec"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSmartHealthDefaultsAndValidation(t *testing.T) {
	cfg := defaultSmartHealth()
	if cfg.Enabled || cfg.NormalSeconds != 180 || cfg.DegradedSeconds != 60 || cfg.OfflineSeconds != 10 || len(smartServices) != 11 {
		t.Fatal(cfg)
	}
	if err := validateSmartHealth(cfg); err != nil {
		t.Fatal(err)
	}
	for _, c := range []SmartHealthSettings{{true, 180, 60, 10, nil, nil}, {true, 180, 60, 10, []string{"unknown"}, nil}, {true, 180, 60, 10, []string{"vk", "vk"}, nil}, {true, 30, 60, 10, []string{"vk"}, nil}} {
		if validateSmartHealth(c) == nil {
			t.Fatalf("accepted invalid settings: %#v", c)
		}
	}
}
func TestSmartHealthSchedulePreservesNativeAndRestores(t *testing.T) {
	p := []map[string]any{{"name": "A", "type": "http"}, {"name": "D", "type": "direct"}}
	g := []map[string]any{
		{"name": "Group", "type": "url-test", "proxies": []string{"A", "D"}, "interval": 60, "url": "https://example.invalid/health", "timeout": 8000, "lazy": false},
		{"name": "Direct", "type": "url-test", "proxies": []string{"D"}, "interval": 60},
		{"name": "Provider", "type": "url-test", "proxies": []string{"A"}, "use": []string{"P"}, "interval": 60},
		{"name": "Expected", "type": "url-test", "proxies": []string{"A"}, "expected-status": 204, "interval": 60},
	}
	next := applySmartHealthSchedule(p, g)
	if g[0]["interval"] != 60 || next[0]["interval"] != 0 || next[0]["lazy"] != false {
		t.Fatal("mutated native group or failed to disable interval")
	}
	if !reflect.DeepEqual(g[1:], next[1:]) {
		t.Fatal("unsupported groups changed")
	}
	state := defaultState()
	before, err := renderStateConfig(state)
	if err != nil {
		t.Fatal(err)
	}
	cfg := defaultSmartHealth()
	state.SmartHealth = &cfg
	after, err := renderStateConfig(state)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("disabled feature changed YAML")
	}
	cfg.Enabled = true
	enabled, err := renderStateConfig(state)
	if err != nil {
		t.Fatal(err)
	}
	if smartPlanFromConfig(enabled) == nil {
		t.Fatal("missing applied schedule marker")
	}
	cfg.Enabled = false
	restored, err := renderStateConfig(state)
	if err != nil || !bytes.Equal(before, restored) {
		t.Fatal("native config was not restored")
	}
}
func TestSmartHealthGroupAPI(t *testing.T) {
	for _, tc := range []struct {
		code  int
		body  string
		known bool
		count int
	}{
		{200, `{"A":25,"DIRECT":10,"B":0,"unknown":2}`, true, 1},
		{504, "", true, 0},
		{401, "", false, 0},
		{500, "", false, 0},
		{200, "bad JSON", false, 0},
	} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/group/Group/delay" || r.URL.Query().Get("timeout") != "8000" || r.URL.Query().Get("url") != "https://example.invalid/health" || r.Header.Get("Authorization") != "Bearer fixture" {
				t.Error("incorrect API call")
			}
			w.WriteHeader(tc.code)
			fmt.Fprint(w, tc.body)
		}))
		got, known := smartProbeGroup(context.Background(), srv.Listener.Addr().String(), "fixture", smartGroup{"Group", "https://example.invalid/health", 8000, map[string]bool{"A": true, "B": true}})
		srv.Close()
		if known != tc.known || len(got) != tc.count {
			t.Fatalf("status %d got %v %v", tc.code, got, known)
		}
	}
}
func TestSmartHealthAdaptiveCycle(t *testing.T) {
	cfg := defaultSmartHealth()
	for _, tc := range []struct {
		name, mode, want                 string
		running, known, apiOK, controlOK bool
		healthy, scans, checks           int
		firstSuccess                     bool
	}{
		{"normal skips controls", "normal", "normal", true, true, true, true, 1, 1, 0, false},
		{"startup groups not ready", "starting", "starting", true, false, true, false, 0, 1, 0, false},
		{"startup API not ready", "starting", "starting", true, true, false, false, 0, 1, 0, false},
		{"startup healthy immediately", "starting", "normal", true, true, true, true, 1, 1, 0, false},
		{"startup real outage", "starting", "offline", true, true, true, false, 0, 1, 1, false},
		{"startup real degraded", "starting", "degraded", true, true, true, true, 0, 1, 1, false},
		{"startup expired", "unknown", "unknown", true, false, true, false, 0, 1, 1, false},

		{"all failed but service responds", "normal", "degraded", true, true, true, true, 0, 1, 1, false},
		{"all failed and controls unavailable", "degraded", "offline", true, true, true, false, 0, 1, 1, false},
		{"offline never scans", "offline", "offline", true, true, true, false, 0, 0, 1, true},
		{"first control response resumes", "offline", "normal", true, true, true, true, 1, 1, 1, true},
		{"recovered control but nodes fail", "offline", "degraded", true, true, true, true, 0, 1, 1, true},
		{"API unavailable not LTE outage", "normal", "unknown", true, true, false, false, 0, 1, 1, false},
		{"untrusted scan not LTE outage", "normal", "unknown", true, false, true, false, 0, 1, 1, false},
		{"core stopped", "normal", "core_unavailable", false, true, true, true, 0, 0, 1, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			scans, checks := 0, 0
			healthy := map[string]bool{}
			if tc.healthy > 0 {
				healthy["A"] = true
			}
			r := smartRunCycle(context.Background(), cfg, tc.mode, tc.running,
				func(context.Context) smartScanResult { scans++; return smartScanResult{healthy, tc.known} },
				func(_ context.Context, ids []string, first bool) []smartServiceResult {
					checks++
					if first != tc.firstSuccess || !reflect.DeepEqual(ids, cfg.Services) {
						t.Fatal("wrong control selection")
					}
					return []smartServiceResult{{"vk", tc.controlOK, 1}}
				},
				func(context.Context) bool { return tc.apiOK },
			)
			if r.Mode != tc.want || scans != tc.scans || checks != tc.checks || r.Healthy != tc.healthy {
				t.Fatalf("got %#v, scans %d checks %d", r, scans, checks)
			}
		})
	}
	for mode, want := range map[string]time.Duration{"starting": 3 * time.Second, "normal": 180 * time.Second, "degraded": 60 * time.Second, "offline": 10 * time.Second, "core_unavailable": 10 * time.Second, "unknown": 60 * time.Second} {
		if smartInterval(cfg, mode) != want {
			t.Fatal(mode)
		}
	}
}
func TestSmartHealthDNSWireAnswer(t *testing.T) {
	q, err := smartDNSQuestion()
	if err != nil {
		t.Fatal(err)
	}
	ans := append([]byte(nil), q...)
	binary.BigEndian.PutUint16(ans[2:4], 0x8180)
	binary.BigEndian.PutUint16(ans[6:8], 1)
	ans = append(ans, 0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 192, 0, 2, 1)
	if !smartDNSAnswer(q, ans) {
		t.Fatal("valid response rejected")
	}
	for _, bad := range [][]byte{ans[:len(ans)-1], q, append([]byte{0, 0}, ans[2:]...)} {
		if bytes.Equal(bad, ans) {
			continue
		}
		if smartDNSAnswer(q, bad) {
			t.Fatal("invalid response accepted")
		}
	}
}
func TestSmartHealthTabPlacement(t *testing.T) {
	data, err := webFS.ReadFile("web/index.html")
	if err != nil {
		t.Fatal(err)
	}
	html := string(data)
	r, s := strings.Index(html, "data-mihomo-tab=\"routing\""), strings.Index(html, "data-mihomo-tab=\"smart-health\"")
	if r < 0 || s <= r || strings.Count(html, "data-mihomo-pane=\"smart-health\"") != 1 || !strings.Contains(html, "static/smart-health.js?v=7") {
		t.Fatal("wrong tab placement")
	}
}

func TestSmartHealthEditableCatalogPersistence(t *testing.T) {
	state := defaultState()
	cfg := defaultSmartHealth()
	cfg.Enabled = true
	state.SmartHealth = &cfg
	m := &CoreManager{state: state, dataDir: t.TempDir()}
	a := &App{manager: m}
	before, err := renderStateConfig(state)
	if err != nil {
		t.Fatal(err)
	}
	catalog := cfg.catalog()
	// Remove a default service, edit another and add a new one.
	catalog = catalog[:len(catalog)-1]
	catalog[3].Name = "VK Новости"
	catalog = append(catalog, smartService{"custom-rbc", "РБК", "HTTPS", "rbc.ru", ""})
	cfg.Catalog = catalog
	cfg.Services = []string{"vk", "custom-rbc"}
	body, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	a.handleSmartHealth(w, httptest.NewRequest(http.MethodPut, "/api/mihomo/smart-health", bytes.NewReader(body)))
	if w.Code != 200 {
		t.Fatalf("PUT failed %d %s", w.Code, w.Body.String())
	}
	if !reflect.DeepEqual(effectiveSmartHealth(m.state).catalog(), catalog) {
		t.Fatal("catalog not applied")
	}
	after, err := renderStateConfig(m.state)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("catalog edit changed YAML")
	}
	loaded := &CoreManager{dataDir: m.dataDir}
	if err = loaded.load(); err != nil {
		t.Fatal(err)
	}
	saved := effectiveSmartHealth(loaded.state)
	if !smartSettingsEqual(cfg, saved) {
		t.Fatalf("catalog not persisted: %#v", saved)
	}
	// Older UI which omits catalog should not restore the default list.
	cfg.Catalog = nil
	body, _ = json.Marshal(cfg)
	w = httptest.NewRecorder()
	a.handleSmartHealth(w, httptest.NewRequest(http.MethodPut, "/api/mihomo/smart-health", bytes.NewReader(body)))
	if w.Code != 200 || !reflect.DeepEqual(effectiveSmartHealth(m.state).catalog(), catalog) {
		t.Fatal("legacy save lost custom catalog")
	}
	// Removing a selected service without updating selection must be rejected.
	cfg.Catalog = []smartService{{"other", "РБК", "HTTPS", "rbc.ru", ""}}
	body, _ = json.Marshal(cfg)
	w = httptest.NewRecorder()
	a.handleSmartHealth(w, httptest.NewRequest(http.MethodPut, "/api/mihomo/smart-health", bytes.NewReader(body)))
	if w.Code != 400 || !reflect.DeepEqual(effectiveSmartHealth(m.state).catalog(), catalog) {
		t.Fatal("invalid edit applied")
	}
}

func TestSmartHealthCustomControlValidation(t *testing.T) {
	for _, host := range []string{"localhost", "localhost.local", "127.0.0.1", "100.64.0.1", "https://vk.com", "vk.com:443", "vk.com/path", "a@vk.com", "a..ru", "foo.internal", "-a.ru", "a-.ru", "1.2.3.4", "a.ru."} {
		if smartValidHost(host) {
			t.Fatalf("invalid endpoint accepted: %s", host)
		}
	}
	for _, host := range []string{"rbc.ru", "vk.com", "common.dot.dns.yandex.net", "xn--e1afmkfd.xn--p1ai"} {
		if !smartValidHost(host) {
			t.Fatalf("valid domain rejected: %s", host)
		}
	}
	for _, ip := range []string{"127.0.0.1", "10.0.0.1", "192.168.4.1", "100.70.0.1", "169.254.169.254", "172.16.0.1", "198.18.0.1", "224.0.0.1", "240.0.0.1", "192.0.2.1", "::1"} {
		if smartPublicV4(netip.MustParseAddr(ip)) {
			t.Fatalf("nonpublic address accepted: %s", ip)
		}
	}
	if !smartPublicV4(netip.MustParseAddr("77.88.8.8")) {
		t.Fatal("public DNS rejected")
	}
	cfg := defaultSmartHealth()
	cfg.Catalog = []smartService{{"a", "Сервис", "HTTPS", "rbc.ru", ""}, {"b", "Дубликат", "HTTPS", "rbc.ru", ""}}
	cfg.Services = []string{"a"}
	if validateSmartHealth(cfg) == nil {
		t.Fatal("duplicate endpoint accepted")
	}
	cfg.Catalog = []smartService{{"a", "Сервис", "HTTP", "rbc.ru", ""}}
	if validateSmartHealth(cfg) == nil {
		t.Fatal("unsupported protocol accepted")
	}
	cfg.Catalog = []smartService{{"a", "Сервис", "HTTPS", "rbc.ru", ""}, {"b", "DNS", "DoH", "rbc.ru", ""}}
	if err := validateSmartHealth(cfg); err != nil {
		t.Fatal(err)
	}
	if _, err := smartPublicDial(context.Background(), "127.0.0.1:443"); err == nil {
		t.Fatal("loopback dial allowed")
	}
	if _, err := smartPublicDial(context.Background(), "rbc.ru:80"); err == nil {
		t.Fatal("unexpected port allowed")
	}
}

func TestSmartHealthIPAndDo53Settings(t *testing.T) {
	cfg := defaultSmartHealth()
	for _, tc := range []struct {
		protocol, host, tls string
		ok                  bool
	}{
		{"Do53", "77.88.8.8", "", true},
		{"Do53", "dns.example.ru", "", true},
		{"Do53", "77.88.8.8", "dns.example.ru", false},
		{"DoH", "77.88.8.8", "common.dot.dns.yandex.net", true},
		{"DoT", "77.88.8.8", "common.dot.dns.yandex.net", true},
		{"HTTPS", "77.88.8.8", "common.dot.dns.yandex.net", true},
		{"DoH", "77.88.8.8", "", false},
		{"DoT", "77.88.8.8", "127.0.0.1", false},
		{"Do53", "192.168.4.1", "", false},
		{"Do53", "::1", "", false},
		{"Do53", "127.0.0.1", "", false},
	} {
		cfg.Catalog = []smartService{{"test", "Test", tc.protocol, tc.host, tc.tls}}
		cfg.Services = []string{"test"}
		if (validateSmartHealth(cfg) == nil) != tc.ok {
			t.Fatalf("validation mismatch: %#v", tc)
		}
	}
}
func TestSmartHealthDo53Transport(t *testing.T) {
	for _, mode := range []string{"udp", "truncated", "bad", "unavailable"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			calls := []string{}
			dial := func(_ context.Context, network string) (net.Conn, error) {
				calls = append(calls, network)
				if mode == "unavailable" {
					return nil, fmt.Errorf("fixture unavailable")
				}
				client, server := net.Pipe()
				go func() {
					defer server.Close()
					_ = server.SetDeadline(time.Now().Add(time.Second))
					q := make([]byte, 512)
					var n int
					if network == "tcp4" {
						size := make([]byte, 2)
						if _, e := io.ReadFull(server, size); e != nil {
							return
						}
						n = int(binary.BigEndian.Uint16(size))
						if n > len(q) {
							return
						}
						if _, e := io.ReadFull(server, q[:n]); e != nil {
							return
						}
					} else {
						var e error
						n, e = server.Read(q)
						if e != nil {
							return
						}
					}
					response := append([]byte(nil), q[:n]...)
					binary.BigEndian.PutUint16(response[2:4], 0x8180)
					binary.BigEndian.PutUint16(response[6:8], 1)
					response = append(response, 0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 77, 88, 8, 8)
					if mode == "truncated" && network == "udp4" {
						response[2] |= 2
					}
					if mode == "bad" {
						response[0] ^= 1
					}
					if network == "tcp4" {
						response = append(binary.BigEndian.AppendUint16(nil, uint16(len(response))), response...)
					}
					_, _ = server.Write(response)
				}()
				return client, nil
			}
			got := smartDo53(ctx, dial)
			want := mode == "udp" || mode == "truncated"
			if got != want {
				t.Fatalf("got %v want %v", got, want)
			}
			if len(calls) == 0 || calls[0] != "udp4" || (mode == "udp" && len(calls) != 1) || (mode != "udp" && (len(calls) != 2 || calls[1] != "tcp4")) {
				t.Fatalf("unexpected transport calls %v", calls)
			}
		})
	}
}

func TestSmartHealthInitializationRetry(t *testing.T) {
	var ready atomic.Bool
	var scans atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/version":
			fmt.Fprint(w, `{"version":"fixture"}`)
		case "/group/lab/delay":
			scans.Add(1)
			if !ready.Load() {
				http.Error(w, "group initializing", http.StatusNotFound)
				return
			}
			fmt.Fprint(w, `{"A":12}`)
		default:
			t.Error("unexpected request")
			w.WriteHeader(500)
		}
	}))
	defer srv.Close()
	cfg := defaultSmartHealth()
	cfg.Enabled = true
	state := defaultState()
	state.SmartHealth = &cfg
	plan := &smartPlan{Groups: []smartGroup{{"lab", "http://192.0.2.1/health", 1000, map[string]bool{"A": true}}}}
	m := &CoreManager{state: state, started: time.Now(), cmd: &exec.Cmd{}}
	m.smartHealth.applied = plan
	m.watchdog.controller = srv.Listener.Addr().String()
	m.smartHealthTick()
	status := m.smartHealth.status
	if status.Mode != "starting" || len(status.Events) != 1 || len(status.Controls) != 0 || scans.Load() != 1 {
		t.Fatalf("initial status: %+v", status)
	}
	if remaining := time.Until(status.Next); remaining < 2*time.Second || remaining > smartStartupRetry {
		t.Fatalf("wrong retry %s", remaining)
	}
	deadline := m.smartHealth.startupDeadline
	if !deadline.Equal(m.started.Add(smartStartupGrace)) {
		t.Fatal("wrong deadline")
	}
	m.smartHealthTick()
	if scans.Load() != 1 {
		t.Fatal("early retry")
	}
	m.smartHealth.status.Next = time.Now()
	m.smartHealthTick()
	if m.smartHealth.status.Mode != "starting" || len(m.smartHealth.status.Events) != 1 || !m.smartHealth.startupDeadline.Equal(deadline) {
		t.Fatal("grace reset or duplicate event")
	}
	ready.Store(true)
	m.smartHealth.status.Next = time.Now()
	m.smartHealthTick()
	status = m.smartHealth.status
	if status.Mode != "normal" || status.Healthy != 1 || len(status.Events) != 2 || status.Events[1].Mode != "normal" || len(status.Controls) != 0 {
		t.Fatalf("recovery: %+v", status)
	}
	if remaining := time.Until(status.Next); remaining < 179*time.Second || remaining > 180*time.Second {
		t.Fatalf("normal interval %s", remaining)
	}
}
