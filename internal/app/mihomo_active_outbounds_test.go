package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"
)

func TestCurrentOutboundsUsesRuntimeNowWithoutDelayTests(t *testing.T) {
	state := testBalancerState()
	state.Outbounds[4].Proxies = []string{"Manual", "INT - Germany"}
	state.Outbounds[5].Proxies = []string{"RU - Moscow"}
	state.Outbounds = append(state.Outbounds, MihomoOutbound{Name: "Load-balanced", Kind: "group", Type: "load-balance", Proxies: []string{"Manual", "INT - Germany"}})
	live := map[string]balancerRuntimeProxy{
		"Russia":        {Now: "RU - Moscow"},
		"FOREIGN":       {Now: "INT - Germany"},
		"Load-balanced": {},
	}
	data := currentOutboundsFromRuntime(state, live, true)
	if len(data.Groups) != 3 || !data.Running {
		t.Fatalf("bad group list: %+v", data)
	}
	if data.Groups["Russia"].Current != "RU - Moscow" || data.Groups["FOREIGN"].Current != "INT - Germany" {
		t.Fatalf("live runtime choice not shown: %+v", data.Groups)
	}
	if !data.Groups["Load-balanced"].PerConnection || data.Groups["Load-balanced"].Current != "" {
		t.Fatalf("per-connection load balancing cannot claim a fixed outbound: %+v", data.Groups["Load-balanced"])
	}
	if _, exists := data.Groups["INT - France"]; exists {
		t.Fatal("non-group leaked into active groups")
	}
	// Runtime config may not yet match saved config; never display a stale/
	// unrelated choice as though it were the active member of this group.
	live["Russia"] = balancerRuntimeProxy{Now: "INT - Germany"}
	data = currentOutboundsFromRuntime(state, live, true)
	if data.Groups["Russia"].Current != "" {
		t.Fatal("alien member reported as Russia current")
	}
	data = currentOutboundsFromRuntime(state, nil, false)
	if data.Running || data.Groups["Russia"].Current != "" || data.Groups["Russia"].Applied {
		t.Fatal("stopped Mihomo must not report a current outbound")
	}
}

func TestCurrentOutboundsEndpointAuthAndLiveCandidateSwitch(t *testing.T) {
	state := testBalancerState()
	state.Outbounds[4].Proxies = []string{"Manual", "INT - Germany"}
	var selected atomic.Int32
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/proxies" {
			t.Errorf("unexpected controller path: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer controller-secret" {
			t.Errorf("controller token missing")
		}
		w.Header().Set("Content-Type", "application/json")
		choice := "Manual"
		if selected.Load() > 0 {
			choice = "INT - Germany"
		}
		json.NewEncoder(w).Encode(map[string]any{"proxies": map[string]any{
			"FOREIGN": map[string]any{"name": "FOREIGN", "now": choice},
			"Russia":  map[string]any{"name": "Russia", "now": "RU - Moscow"},
			"Manual":  map[string]any{"name": "Manual", "alive": true},
		}})
	}))
	defer controller.Close()
	state.Settings.APIAddress = strings.TrimPrefix(controller.URL, "http://")
	state.Settings.APISecret = "controller-secret"
	a := &App{manager: &CoreManager{state: state, cmd: &exec.Cmd{}}}
	for i, want := range []string{"Manual", "INT - Germany"} {
		selected.Store(int32(i))
		w := httptest.NewRecorder()
		a.handleMihomoCurrentOutbounds(w, httptest.NewRequest(http.MethodGet, "/api/mihomo/balancers/current", nil))
		if w.Code != http.StatusOK {
			t.Fatalf("HTTP=%d body=%s", w.Code, w.Body.String())
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("live candidate must not be cached")
		}
		var result struct {
			OK   bool                   `json:"ok"`
			Data mihomoCurrentOutbounds `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if !result.OK || !result.Data.Running || result.Data.Groups["FOREIGN"].Current != want {
			t.Fatalf("active outbound not refreshed: want=%s got=%+v", want, result.Data)
		}
	}
	w := httptest.NewRecorder()
	a.handleMihomoCurrentOutbounds(w, httptest.NewRequest(http.MethodPost, "/api/mihomo/balancers/current", nil))
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST unexpectedly allowed: %d", w.Code)
	}
}
