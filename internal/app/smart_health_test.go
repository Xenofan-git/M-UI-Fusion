package app

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
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
	for _, c := range []SmartHealthSettings{{true, 180, 60, 10, nil}, {true, 180, 60, 10, []string{"unknown"}}, {true, 180, 60, 10, []string{"vk", "vk"}}, {true, 30, 60, 10, []string{"vk"}}} {
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
	for mode, want := range map[string]time.Duration{"normal": 180 * time.Second, "degraded": 60 * time.Second, "offline": 10 * time.Second, "core_unavailable": 10 * time.Second, "unknown": 60 * time.Second} {
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
	if r < 0 || s <= r || strings.Count(html, "data-mihomo-pane=\"smart-health\"") != 1 || !strings.Contains(html, "static/smart-health.js?v=1") {
		t.Fatal("wrong tab placement")
	}
}
