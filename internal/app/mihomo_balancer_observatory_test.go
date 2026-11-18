package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestSubscribedBalancerStatusOnlyOwnNodesAndCandidate(t *testing.T) {
	state := testBalancerState()
	state.Outbounds[4].Proxies = []string{"INT - Germany", "INT - France"}
	state.Outbounds[4].SubscriptionIDs = []string{"sub-int"}
	state.Outbounds = append(state.Outbounds, subscriptionSS("Unrelated", "none.example"))
	group, sources, nodes, ok := balancerSubscriptionSnapshot(state, "FOREIGN")
	if !ok || group.Name != "FOREIGN" {
		t.Fatal("FOREIGN group not found")
	}
	if len(sources) != 1 || sources[0].ID != "sub-int" || len(nodes) != 2 {
		t.Fatalf("leaked unrelated outbounds to status: sources=%d nodes=%d", len(sources), len(nodes))
	}
	alive := true
	delay := balancerRuntimeProxy{Now: ""}
	delay.Alive = &alive
	delay.History = append(delay.History, struct {
		Delay int    `json:"delay"`
		Time  string `json:"time"`
	}{Delay: 85, Time: "2026-11-18T22:20:00+03:00"})
	statuses := map[string]balancerRuntimeProxy{
		"FOREIGN":       {Now: "INT - Germany"},
		"INT - Germany": delay,
	}
	result := buildBalancerStatus(group, sources, nodes, statuses, true)
	if !result.Available || result.Candidate != "INT - Germany" {
		t.Fatalf("candidate missing: %+v", result)
	}
	if len(result.Nodes) != 2 || !result.Nodes[0].Member || !result.Nodes[1].Member {
		t.Fatalf("members mismatch: %+v", result.Nodes)
	}
	if result.Nodes[0].Delay != 85 || result.Nodes[0].Alive == nil || !*result.Nodes[0].Alive {
		t.Fatalf("real delay missing: %+v", result.Nodes[0])
	}
	for _, node := range result.Nodes {
		if node.Name == "Unrelated" {
			t.Fatal("unrelated proxy exposed")
		}
	}
	if _, _, _, ok = balancerSubscriptionSnapshot(state, "NotAGrp"); ok {
		t.Fatal("unknown group allowed")
	}
	if _, _, _, ok = balancerSubscriptionSnapshot(state, "Russia"); ok {
		t.Fatal("unlinked manual group was mistaken for a subscription group")
	}
}
func TestBalancerProxyHTTPDelayAndControllerCredentials(t *testing.T) {
	secret := "only-in-request-header"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+secret {
			t.Errorf("missing Mihomo controller auth")
		}
		if r.URL.Path != "/proxies/Proxy%20One/delay" && r.URL.EscapedPath() != "/proxies/Proxy%20One/delay" {
			t.Errorf("wrong proxy delay path: %q", r.URL.EscapedPath())
		}
		if r.URL.Query().Get("url") != "https://example.com/generate_204" {
			t.Error("custom URL ignored")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"delay":142}`))
	}))
	defer server.Close()
	address := strings.TrimPrefix(server.URL, "http://")
	result := probeBalancerNode(context.Background(), address, secret, "Proxy One", "https://example.com/generate_204", "")
	if !result.Alive || result.Delay != 142 || result.Error != "" {
		t.Fatalf("Mihomo delay result: %+v", result)
	}
}
func TestBalancerGroupedExclusionsSurviveRefresh(t *testing.T) {
	state := testBalancerState()
	state.Outbounds[4].SubscriptionIDs = []string{"sub-int"}
	state.Outbounds[4].ExcludedSubscriptionMembers = []string{"INT - Germany"}
	state.Outbounds[4].Proxies = []string{"INT - Germany", "INT - France"}
	materialized, err := materializeGroupSubscriptions(state, state.Outbounds)
	if err != nil {
		t.Fatal(err)
	}
	group := materialized[4]
	if !reflect.DeepEqual(group.Proxies, []string{"INT - France"}) {
		t.Fatalf("excluded subscription member incorrectly reattached: %q", group.Proxies)
	}
	normal, err := normalizeMihomoOutbounds(materialized)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(normal[4].ExcludedSubscriptionMembers, []string{"INT - Germany"}) {
		t.Fatalf("excluded member metadata was lost in YAML normalization: %q", normal[4].ExcludedSubscriptionMembers)
	}
	state.Outbounds = normal
	// Repeated materialization after a new source update must still respect exclusions.
	again, err := materializeGroupSubscriptions(state, state.Outbounds)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(again[4].Proxies, []string{"INT - France"}) {
		t.Fatalf("previously excluded member reappeared: %q", again[4].Proxies)
	}
}
func TestBalancerRuntimeProxyParsing(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/proxies" {
			t.Fatalf("bad path %s", r.URL.Path)
		}
		json.NewEncoder(w).Encode(map[string]any{"proxies": map[string]any{
			"FOREIGN":      map[string]any{"now": "INT - France", "type": "URLTest"},
			"INT - France": map[string]any{"alive": true, "history": []any{map[string]any{"delay": 103, "time": time.Now().Format(time.RFC3339)}}},
		}})
	}))
	defer api.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	proxies, err := fetchBalancerRuntime(ctx, strings.TrimPrefix(api.URL, "http://"), "test-token")
	if err != nil {
		t.Fatal(err)
	}
	if proxies["FOREIGN"].Now != "INT - France" || proxies["INT - France"].History[0].Delay != 103 {
		t.Fatalf("runtime parse incorrect: %+v", proxies)
	}
}

func TestExcludedSubscribedNodesDoNotReturnOnSourceRefresh(t *testing.T) {
	state := defaultState()
	sub := OutboundSubscription{ID: "sub-eu", Name: "quatro-vpn", URL: "https://example.org/source", Group: "Foreign-quatro-vpn", Enabled: true, IntervalMinutes: 1440}
	state.OutboundSubscriptions = []OutboundSubscription{sub}
	original := []MihomoOutbound{subscriptionSS("Germany LTE", "de.example"), subscriptionSS("Switzerland LTE", "ch.example")}
	imported, err := applySubscriptionNodes(state, sub, original)
	if err != nil {
		t.Fatal(err)
	}
	deName := subscriptionOutboundName(sub, original[0].Name, 1)
	chName := subscriptionOutboundName(sub, original[1].Name, 2)
	group := MihomoOutbound{Kind: "group", ID: "group-eu", Type: "url-test", Name: "Foreign-quatro-vpn",
		SubscriptionIDs: []string{sub.ID}, Proxies: []string{deName, chName}, ExcludedSubscriptionMembers: []string{deName},
		TestURL: defaultMihomoTestURL, Interval: 300}
	imported.Outbounds = append(imported.Outbounds, group)
	next, err := applySubscriptionNodes(imported, sub, original)
	if err != nil {
		t.Fatal(err)
	}
	var found *MihomoOutbound
	for idx := range next.Outbounds {
		if next.Outbounds[idx].Kind == "group" {
			found = &next.Outbounds[idx]
		}
	}
	if found == nil {
		t.Fatal("subscription group disappeared")
	}
	if !reflect.DeepEqual(found.Proxies, []string{chName}) {
		t.Fatalf("excluded member returned on refresh: %+v", found.Proxies)
	}
	if !reflect.DeepEqual(found.ExcludedSubscriptionMembers, []string{deName}) {
		t.Fatal("exclusions not persisted")
	}
	for _, item := range next.Outbounds {
		if item.Kind == "proxy" && item.Name == deName {
			goto foundProxy
		}
	}
	t.Fatal("source node was deleted instead of excluded from the group")
foundProxy:
	config, err := renderStateConfig(next)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(config), "excludedSubscriptionMembers") {
		t.Fatal("UI metadata leaked into Mihomo runtime config")
	}
}

func TestSubscribedBalancerSSEProbeStreamsOwnNodesOnly(t *testing.T) {
	state := testBalancerState()
	state.Outbounds[4].SubscriptionIDs = []string{"sub-int"}
	state.Outbounds[4].Proxies = []string{"INT - Germany", "INT - France"}
	for i := range state.Outbounds {
		if state.Outbounds[i].Kind == "proxy" {
			state.Outbounds[i].Server = ""
		}
	}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer internal-secret" {
			t.Errorf("missing authentication to Mihomo")
		}
		if !strings.HasSuffix(r.URL.Path, "/delay") {
			t.Errorf("wrong Mihomo endpoint %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"delay":84}`))
	}))
	defer api.Close()
	state.Settings.APIAddress = strings.TrimPrefix(api.URL, "http://")
	state.Settings.APISecret = "internal-secret"
	a := &App{manager: &CoreManager{state: state, cmd: &exec.Cmd{}}}
	input := []byte(`{"group":"FOREIGN","names":["INT - Germany","INT - France"]}`)
	rec := httptest.NewRecorder()
	a.handleMihomoBalancerProbe(rec, httptest.NewRequest("POST", "/api/mihomo/balancers/probe", bytes.NewReader(input)))
	if rec.Code != 200 {
		t.Fatalf("probe HTTP %d %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if strings.Count(body, "data: ") != 3 || !strings.Contains(body, `"done":true`) || !strings.Contains(body, `"delay":84`) {
		t.Fatalf("streaming updates not emitted: %s", body)
	}
	invalid := []byte(`{"group":"FOREIGN","names":["RU - Moscow"]}`)
	rec = httptest.NewRecorder()
	a.handleMihomoBalancerProbe(rec, httptest.NewRequest("POST", "/api/mihomo/balancers/probe", bytes.NewReader(invalid)))
	if rec.Code != 400 {
		t.Fatalf("unrelated server was permitted: HTTP %d", rec.Code)
	}
}

func TestSaveSubscribedBalancerExclusionsThroughMihomoSettings(t *testing.T) {
	state := testBalancerState()
	state.Outbounds[4].SubscriptionIDs = []string{"sub-int"}
	state.Outbounds[4].Proxies = []string{"INT - Germany", "INT - France"}
	// Production state always contains normalized outbound entries.
	normalized, err := normalizeMihomoOutbounds(state.Outbounds)
	if err != nil {
		t.Fatal(err)
	}
	state.Outbounds = normalized
	m := &CoreManager{dataDir: t.TempDir(), state: state}
	input := mihomoSettingsPayload{Outbounds: append([]MihomoOutbound(nil), state.Outbounds...), RoutingRules: state.RoutingRules}
	input.Outbounds[4].Proxies = []string{"INT - France"}
	input.Outbounds[4].ExcludedSubscriptionMembers = []string{"INT - Germany"}
	if err := m.updateMihomoSettings(input); err != nil {
		t.Fatalf("editor Save rejected: %v", err)
	}
	group := m.state.Outbounds[4]
	if !reflect.DeepEqual(group.Proxies, []string{"INT - France"}) {
		t.Fatalf("group selection ignored: %q", group.Proxies)
	}
	if !reflect.DeepEqual(group.ExcludedSubscriptionMembers, []string{"INT - Germany"}) {
		t.Fatalf("persistent group exclusions lost: %q", group.ExcludedSubscriptionMembers)
	}
	if len(m.state.Outbounds) != 6 {
		t.Fatal("other outbounds removed")
	}
	if m.state.Outbounds[5].Name != "Russia" {
		t.Fatal("unrelated Russia balancer changed")
	}
	loaded := &CoreManager{dataDir: m.dataDir}
	if err := loaded.load(); err != nil {
		t.Fatalf("cannot reload saved state: %v", err)
	}
	got := loaded.state.Outbounds[4]
	if !reflect.DeepEqual(got.Proxies, []string{"INT - France"}) || !reflect.DeepEqual(got.ExcludedSubscriptionMembers, []string{"INT - Germany"}) {
		t.Fatalf("saved subscribed group changed on restart: proxies=%q exclusions=%q", got.Proxies, got.ExcludedSubscriptionMembers)
	}
}
