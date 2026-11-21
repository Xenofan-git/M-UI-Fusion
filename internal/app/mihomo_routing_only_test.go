package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestMihomoRuleOnlySavePreservesSubscriptionNodesAfterRefresh(t *testing.T) {
	state := defaultState()
	manual := subscriptionSS("manual", "manual.example")
	old := subscriptionSS("FromSub | Latvia", "latvia.old.test")
	old.ID, old.SourceSubscriptionID = "old-node", "sub-1"
	group := MihomoOutbound{ID: "group-1", Name: "Foreign-quatro-vpn", Kind: "group", Type: "select", Proxies: []string{old.Name, "manual"}}
	state.Outbounds = []MihomoOutbound{manual, old, group}
	state.OutboundSubscriptions = []OutboundSubscription{{ID: "sub-1", Name: "quatro-vpn", Group: "Foreign-quatro-vpn", Enabled: true, IntervalMinutes: 1440}}
	state.RoutingRules = []MihomoRoutingRule{
		{ID: "remove-me", Type: "DOMAIN", Payload: "example.test", Target: "DIRECT"},
		{ID: "keep-match", Type: "MATCH", Target: "DIRECT"},
	}
	manager := &CoreManager{dataDir: t.TempDir(), state: state}
	fresh := subscriptionSS("FromSub | Estonia", "estonia.new.test")
	fresh.ID, fresh.SourceSubscriptionID = "new-node", "sub-1"
	manager.state.Outbounds = []MihomoOutbound{manual, fresh, group}
	before := manager.state
	if err := manager.updateMihomoRoutingRules([]MihomoRoutingRule{{ID: "keep-match", Type: "MATCH", Target: "DIRECT"}}); err != nil {
		t.Fatalf("rule-only save: %v", err)
	}
	if len(manager.state.RoutingRules) != 1 || manager.state.RoutingRules[0].ID != "keep-match" {
		t.Fatalf("rule not removed: %#v", manager.state.RoutingRules)
	}
	if !reflect.DeepEqual(manager.state.Outbounds, before.Outbounds) {
		t.Fatal("subscription nodes changed")
	}
	if !reflect.DeepEqual(manager.state.OutboundSubscriptions, before.OutboundSubscriptions) {
		t.Fatal("subscription metadata changed")
	}
	if !reflect.DeepEqual(manager.state.MihomoBasics, before.MihomoBasics) {
		t.Fatal("Basics changed")
	}
	loaded := &CoreManager{dataDir: manager.dataDir}
	if err := loaded.load(); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(loaded.state.Outbounds, before.Outbounds) {
		t.Fatal("refreshed subscription node not persisted")
	}
	if len(loaded.state.RoutingRules) != 1 {
		t.Fatal("deleted rule not persisted")
	}
}

func TestMihomoRuleOnlySaveRejectsInvalidTargetWithoutChangingAnyState(t *testing.T) {
	state := defaultState()
	state.RoutingRules = []MihomoRoutingRule{{ID: "match", Type: "MATCH", Target: "DIRECT"}}
	manager := &CoreManager{dataDir: t.TempDir(), state: state}
	before, _ := json.Marshal(manager.state)
	err := manager.updateMihomoRoutingRules([]MihomoRoutingRule{
		{ID: "bad", Type: "DOMAIN", Payload: "bad.example", Target: "missing-server"},
		{ID: "match", Type: "MATCH", Target: "DIRECT"},
	})
	if err == nil {
		t.Fatal("invalid target accepted")
	}
	after, _ := json.Marshal(manager.state)
	if !bytes.Equal(before, after) {
		t.Fatal("invalid rule mutated state")
	}
}

func TestMihomoRuleOnlyHTTPEndpointDoesNotOverwriteOutbounds(t *testing.T) {
	state := defaultState()
	node := subscriptionSS("subscription", "current.example")
	node.ID, node.SourceSubscriptionID = "managed", "sub-1"
	state.Outbounds = []MihomoOutbound{node}
	state.RoutingRules = []MihomoRoutingRule{{ID: "temporary", Type: "DOMAIN", Payload: "example.test", Target: "DIRECT"}, {ID: "match", Type: "MATCH", Target: "DIRECT"}}
	manager := &CoreManager{dataDir: t.TempDir(), state: state}
	app := &App{manager: manager}
	for _, tc := range []struct {
		method, body string
		status       int
	}{
		{http.MethodGet, "{}", http.StatusMethodNotAllowed},
		{http.MethodPut, "{}", http.StatusBadRequest},
		{http.MethodPut, "{\"routingRules\":null}", http.StatusBadRequest},
		{http.MethodPut, "{\"routingRules\":[{\"id\":\"match\",\"type\":\"MATCH\",\"target\":\"DIRECT\"}],\"outbounds\":[{\"id\":\"managed\",\"name\":\"MALICIOUS\"}]}", http.StatusBadRequest},
		{http.MethodPut, "{\"routingRules\":[{\"id\":\"match\",\"type\":\"MATCH\",\"target\":\"DIRECT\"}]}", http.StatusOK},
	} {
		rec := httptest.NewRecorder()
		app.handleMihomoRoutingRules(rec, httptest.NewRequest(tc.method, "/api/mihomo/rules", strings.NewReader(tc.body)))
		if rec.Code != tc.status {
			t.Fatalf("status %d != %d: %s", rec.Code, tc.status, rec.Body.String())
		}
	}
	if manager.state.Outbounds[0].Server != "current.example" || len(manager.state.RoutingRules) != 1 {
		t.Fatal("outbound altered or rule not removed")
	}
}
