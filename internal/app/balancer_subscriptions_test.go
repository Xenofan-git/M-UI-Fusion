package app

import (
	"os"
	"reflect"
	"strings"
	"testing"
)

func testBalancerState() State {
	state := defaultState()
	state.OutboundSubscriptions = []OutboundSubscription{
		{ID: "sub-ru", Name: "Russia", URL: "https://example.org/russia", Enabled: true, IntervalMinutes: 60, NodeCount: 2},
		{ID: "sub-int", Name: "Foreign", URL: "https://example.org/foreign", Enabled: true, IntervalMinutes: 60, NodeCount: 2},
	}
	manual := subscriptionSS("Manual", "manual.example")
	ru := subscriptionSS("RU - Moscow", "ru.example")
	ru.SourceSubscriptionID = "sub-ru"
	de := subscriptionSS("INT - Germany", "de.example")
	de.SourceSubscriptionID = "sub-int"
	fr := subscriptionSS("INT - France", "fr.example")
	fr.SourceSubscriptionID = "sub-int"
	group := MihomoOutbound{
		ID: "group-eu", Name: "FOREIGN", Kind: "group", Type: "url-test", Interval: 300,
		Proxies: []string{"Manual"}, TestURL: "https://www.gstatic.com/generate_204",
		Native: map[string]any{"name": "FOREIGN", "type": "url-test", "interval": 300, "url": "https://www.gstatic.com/generate_204", "lazy": false, "proxies": []any{"Manual"}},
	}
	russian := MihomoOutbound{ID: "group-ru", Name: "Russia", Kind: "group", Type: "url-test", Interval: 300, Proxies: []string{"RU - Moscow"}, TestURL: "https://www.gstatic.com/generate_204"}
	state.Outbounds = []MihomoOutbound{manual, ru, de, fr, group, russian}
	state.RoutingRules = []MihomoRoutingRule{{ID: "last", Type: "MATCH", Target: "FOREIGN"}}
	return state
}

func TestBalancerGroupAddsMultipleSubscriptionsAndPersistsNative(t *testing.T) {
	state := testBalancerState()
	edit := append([]MihomoOutbound(nil), state.Outbounds...)
	edit[4].SubscriptionIDs = []string{"sub-ru", "sub-int", "sub-ru"}
	changed, err := materializeGroupSubscriptions(state, edit)
	if err != nil {
		t.Fatal(err)
	}
	got := changed[4]
	want := []string{"Manual", "RU - Moscow", "INT - Germany", "INT - France"}
	if !reflect.DeepEqual(got.Proxies, want) {
		t.Fatalf("wrong members: %q", got.Proxies)
	}
	if len(got.SubscriptionIDs) != 2 {
		t.Fatalf("duplicate IDs were retained: %v", got.SubscriptionIDs)
	}
	if got.Native["lazy"] != false {
		t.Fatalf("native options lost: %+v", got.Native)
	}
	normalized, err := normalizeMihomoOutbounds(changed)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(normalized[4].SubscriptionIDs, []string{"sub-ru", "sub-int"}) {
		t.Fatalf("subscription IDs lost in Native parse: %q", normalized[4].SubscriptionIDs)
	}
	state.Outbounds = normalized
	text, err := renderStateConfig(state)
	if err != nil {
		t.Fatal(err)
	}
	for _, member := range []string{"RU - Moscow", "INT - Germany", "INT - France"} {
		if !strings.Contains(string(text), member) {
			t.Errorf("node %q missing from YAML", member)
		}
	}
	if strings.Contains(string(text), "subscriptionIds") {
		t.Fatal("panel metadata leaked into Mihomo YAML")
	}
}

func TestBalancerGroupUnlinksSubscriptionWithoutDeletingNodes(t *testing.T) {
	state := testBalancerState()
	first := append([]MihomoOutbound(nil), state.Outbounds...)
	first[4].SubscriptionIDs = []string{"sub-ru", "sub-int"}
	first, err := materializeGroupSubscriptions(state, first)
	if err != nil {
		t.Fatal(err)
	}
	state.Outbounds = first
	next := append([]MihomoOutbound(nil), first...)
	next[4].SubscriptionIDs = []string{"sub-int"}
	after, err := materializeGroupSubscriptions(state, next)
	if err != nil {
		t.Fatal(err)
	}
	if containsString(after[4].Proxies, "RU - Moscow") {
		t.Fatal("unlinked RU node still in balancer")
	}
	if !containsString(after[4].Proxies, "INT - France") || !containsString(after[4].Proxies, "Manual") {
		t.Fatalf("other sources or manual members lost: %v", after[4].Proxies)
	}
	if len(state.Outbounds) != 6 || state.Outbounds[1].SourceSubscriptionID != "sub-ru" {
		t.Fatal("unlinked nodes were deleted from Outbounds")
	}
}

func TestBalancerRefreshOneSourceUpdatesEveryLinkedGroup(t *testing.T) {
	state := testBalancerState()
	group := state.Outbounds[4]
	group.SubscriptionIDs = []string{"sub-int"}
	state.Outbounds[4] = group
	ruGroup := state.Outbounds[5]
	ruGroup.SubscriptionIDs = []string{"sub-int"}
	state.Outbounds[5] = ruGroup
	next, err := applySubscriptionNodes(state, state.OutboundSubscriptions[1],
		[]MihomoOutbound{subscriptionSS("Germany", "de.example"), subscriptionSS("Sweden", "se.example")})
	if err != nil {
		t.Fatal(err)
	}
	linked := map[string]MihomoOutbound{}
	for _, item := range next.Outbounds {
		if item.Kind == "group" {
			linked[item.Name] = item
		}
	}
	for _, name := range []string{"FOREIGN", "Russia"} {
		g := linked[name]
		if !containsString(g.Proxies, "Foreign | Germany") || !containsString(g.Proxies, "Foreign | Sweden") {
			t.Errorf("balancer %s lacks new source nodes: %+v", name, g.Proxies)
		}
		if containsString(g.Proxies, "INT - Germany") {
			t.Errorf("stale node retained in %s", name)
		}
		if !containsString(g.Proxies, "Manual") && name == "FOREIGN" {
			t.Errorf("manual source lost")
		}
	}
	if !containsString(linked["Russia"].Proxies, "RU - Moscow") {
		t.Fatal("other source nodes removed")
	}
}

func TestBalancerSubscriptionValidation(t *testing.T) {
	state := testBalancerState()
	modified := append([]MihomoOutbound(nil), state.Outbounds...)
	modified[4].SubscriptionIDs = []string{"does-not-exist"}
	if _, err := materializeGroupSubscriptions(state, modified); err == nil {
		t.Fatal("nonexistent source accepted")
	}
	modified = append([]MihomoOutbound(nil), state.Outbounds...)
	modified[0].SubscriptionIDs = []string{"sub-ru"}
	if _, err := materializeGroupSubscriptions(state, modified); err == nil {
		t.Fatal("proxy accepted subscription IDs")
	}
}

func TestBalancerStandaloneUIWiring(t *testing.T) {
	files := map[string][]string{
		"web/index.html":         {"data-mihomo-tab=\"balancers\"", "id=\"mihomo-balancer-table\""},
		"web/mihomo-settings.js": {"openTab:setTab", "subscriptionIds", "syncBalancerSubscriptionMembers", "onlyGroups=currentTab==='balancers'"},
	}
	// Balancers live inside Mihomo Settings, not the sidebar.
	indexHTML, err := os.ReadFile("web/index.html")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(indexHTML), "data-view=\"mihomo-balancers\"") {
		t.Fatal("duplicate Balancers sidebar item still present")
	}
	if !strings.Contains(string(indexHTML), "data-view=\"mihomo\"") {
		t.Fatal("Mihomo Settings sidebar entry missing")
	}
	for file, parts := range files {
		b, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		for _, part := range parts {
			if !strings.Contains(string(b), part) {
				t.Errorf("%s missing %s", file, part)
			}
		}
	}
}

func TestBalancerSettingsSaveAndReloadWithTwoSubscriptions(t *testing.T) {
	state := testBalancerState()
	// Existing panel-managed Outbounds always have stable IDs.
	normalized, err := normalizeMihomoOutbounds(state.Outbounds)
	if err != nil {
		t.Fatal(err)
	}
	state.Outbounds = normalized
	m := &CoreManager{dataDir: t.TempDir(), state: state}
	draft := append([]MihomoOutbound(nil), state.Outbounds...)
	draft[4].SubscriptionIDs = []string{"sub-ru", "sub-int"}
	basics := effectiveMihomoBasics(state)
	err = m.updateMihomoSettings(mihomoSettingsPayload{Basics: &basics, Outbounds: draft, RoutingRules: state.RoutingRules})
	if err != nil {
		t.Fatal(err)
	}
	restored := &CoreManager{dataDir: m.dataDir}
	if err := restored.load(); err != nil {
		t.Fatal(err)
	}
	var group MihomoOutbound
	for _, item := range restored.state.Outbounds {
		if item.Name == "FOREIGN" {
			group = item
			break
		}
	}
	if !reflect.DeepEqual(group.SubscriptionIDs, []string{"sub-ru", "sub-int"}) {
		t.Fatalf("group did not persist multiple subscription sources: %v", group.SubscriptionIDs)
	}
	if len(group.Proxies) != 4 || group.Proxies[0] != "Manual" {
		t.Fatalf("group nodes not materialized: %+v", group.Proxies)
	}
	if len(restored.state.OutboundSubscriptions) != 2 {
		t.Fatal("subscriptions lost during settings save")
	}
	if !reflect.DeepEqual(restored.state.RoutingRules, state.RoutingRules) {
		t.Fatal("routing rules changed")
	}
}

func TestBalancerManualSubscriptionMemberIsPreserved(t *testing.T) {
	state := testBalancerState()
	// This proxy belongs to a subscription but was explicitly selected as
	// a manual member before its source was linked to the balancer.
	next, err := materializeGroupSubscriptions(state, state.Outbounds)
	if err != nil {
		t.Fatal(err)
	}
	if !containsString(next[5].Proxies, "RU - Moscow") {
		t.Fatal("manual group member was erased")
	}
	_, err = normalizeMihomoOutbounds(next)
	if err != nil {
		t.Fatalf("legacy groups broke after migration: %v", err)
	}
}
