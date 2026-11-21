package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func deltaSubscriptionFixture(t *testing.T) State {
	t.Helper()
	state := testBalancerState()
	// The subscription-owned balancer is not the unrelated manual FOREIGN group.
	state.OutboundSubscriptions[1].Group = "Foreign-quatro-vpn"
	state.Outbounds[4].Name = "Foreign-quatro-vpn"
	state.Outbounds[4].ID = "managed-group"
	state.Outbounds[4].SubscriptionIDs = []string{"sub-int"}
	state.Outbounds[4].Proxies = []string{"INT - Germany", "INT - France"}
	state.Outbounds[4].Native = nil
	state.Outbounds[5].Name = "Russia"
	state.Outbounds = append(state.Outbounds, MihomoOutbound{
		ID: "manual-foreign", Name: "FOREIGN", Kind: "group", Type: "url-test",
		Proxies: []string{"Manual"}, Interval: 300, TestURL: "https://www.gstatic.com/generate_204",
	})
	state.RoutingRules = []MihomoRoutingRule{
		{ID: "r1", Type: "DOMAIN", Payload: "vk.com", Target: "DIRECT"},
		{ID: "r2", Type: "MATCH", Target: "Foreign-quatro-vpn"},
	}
	normalized, err := normalizeMihomoOutbounds(state.Outbounds)
	if err != nil {
		t.Fatal(err)
	}
	state.Outbounds = normalized
	return state
}

func TestEditorDeltaDeletesForeignAfterSubscriptionRefresh(t *testing.T) {
	state := deltaSubscriptionFixture(t)
	manager := &CoreManager{dataDir: t.TempDir(), state: state}
	// Subscription refreshes after the browser loads (old "INT - Germany" and
	// "INT - France" are replaced in the real managed group).
	changed, err := applySubscriptionNodes(manager.state, manager.state.OutboundSubscriptions[1], []MihomoOutbound{
		subscriptionSS("Latvia LTE №1", "lv.example"),
		subscriptionSS("Latvia LTE №2", "lv2.example"),
	})
	if err != nil {
		t.Fatal("subscription refresh: ", err)
	}
	manager.state = changed
	before := manager.state
	originalManaged := map[string]MihomoOutbound{}
	for _, item := range before.Outbounds {
		if item.SourceSubscriptionID != "" {
			originalManaged[item.ID] = item
		}
	}
	manualOrder := make([]string, 0)
	for _, node := range manager.state.Outbounds {
		if node.SourceSubscriptionID == "" && node.ID != "manual-foreign" {
			manualOrder = append(manualOrder, node.ID)
		}
	}
	err = manager.updateMihomoEditorChanges(mihomoEditorDelta{DeleteIDs: []string{"manual-foreign"}, Order: manualOrder})
	if err != nil {
		t.Fatalf("unrelated FOREIGN deletion cannot require refreshing subscription: %v", err)
	}
	for _, item := range manager.state.Outbounds {
		if item.Name == "FOREIGN" {
			t.Fatal("manual FOREIGN still present")
		}
		if item.SourceSubscriptionID != "" && !reflect.DeepEqual(item, originalManaged[item.ID]) {
			t.Fatalf("managed node modified: %s", item.ID)
		}
	}
	for _, original := range before.Outbounds {
		if original.ID == "manual-foreign" {
			continue
		}
		for _, updated := range manager.state.Outbounds {
			if updated.ID == original.ID && !reflect.DeepEqual(original, updated) {
				t.Errorf("unrelated outbound changed: %s (%s)", original.ID, original.Name)
			}
		}
	}
	if !reflect.DeepEqual(manager.state.OutboundSubscriptions, before.OutboundSubscriptions) {
		t.Fatal("subscription metadata modified")
	}
	if !reflect.DeepEqual(manager.state.RoutingRules, before.RoutingRules) {
		t.Fatal("routing rules modified")
	}
	if _, _, _, err := compileMihomoBasics(effectiveMihomoBasics(manager.state), manager.state.Outbounds, manager.state.RoutingRules); err != nil {
		t.Fatal("broken compiled rules: ", err)
	}
	loaded := &CoreManager{dataDir: manager.dataDir}
	if err := loaded.load(); err != nil {
		t.Fatal(err)
	}
	if len(loaded.state.Outbounds) != len(before.Outbounds)-1 {
		t.Fatalf("wrong count: %d versus %d", len(loaded.state.Outbounds), len(before.Outbounds))
	}
	t.Log("unrelated manual FOREIGN removed; fresh subscription nodes and routing rules unchanged")
}

func TestEditorDeltaRejectsSubscriptionNodeTampering(t *testing.T) {
	state := deltaSubscriptionFixture(t)
	m := &CoreManager{dataDir: t.TempDir(), state: state}
	managed := state.Outbounds[2]
	if managed.SourceSubscriptionID == "" {
		t.Fatal("fixture missing managed node")
	}
	input := managed
	input.SourceSubscriptionID = ""
	input.Password = "tampered"
	before, _ := json.Marshal(m.state)
	if err := m.updateMihomoEditorChanges(mihomoEditorDelta{Upserts: []MihomoOutbound{input}}); err == nil {
		t.Fatal("managed node update was accepted")
	}
	if err := m.updateMihomoEditorChanges(mihomoEditorDelta{DeleteIDs: []string{managed.ID}}); err == nil {
		t.Fatal("managed node deletion was accepted")
	}
	if err := m.updateMihomoEditorChanges(mihomoEditorDelta{DeleteIDs: []string{"managed-group"}}); err == nil {
		t.Fatal("subscription-owned balancer deletion was accepted")
	}
	after, _ := json.Marshal(m.state)
	if string(before) != string(after) {
		t.Fatal("rejecting managed edits mutated state")
	}
}

func TestEditorDeltaRejectsDeletingReferencedGroup(t *testing.T) {
	state := deltaSubscriptionFixture(t)
	state.RoutingRules[1].Target = "FOREIGN"
	m := &CoreManager{dataDir: t.TempDir(), state: state}
	before, _ := json.Marshal(m.state)
	if err := m.updateMihomoEditorChanges(mihomoEditorDelta{DeleteIDs: []string{"manual-foreign"}}); err == nil {
		t.Fatal("referenced group should fail validation")
	}
	after, _ := json.Marshal(m.state)
	if string(before) != string(after) {
		t.Fatal("failed deletion changed live state")
	}
}

func TestEditorDeltaNoSubscriptionRoundtripForBasicsAndOrder(t *testing.T) {
	state := deltaSubscriptionFixture(t)
	m := &CoreManager{dataDir: t.TempDir(), state: state}
	previous := m.state.Outbounds
	order := []string{"manual-foreign"}
	for _, item := range previous {
		if item.SourceSubscriptionID == "" && item.ID != "manual-foreign" {
			order = append(order, item.ID)
		}
	}
	basics := effectiveMihomoBasics(m.state)
	if err := m.updateMihomoEditorChanges(mihomoEditorDelta{Order: order, Basics: &basics}); err != nil {
		t.Fatal(err)
	}
	for _, item := range m.state.Outbounds {
		if item.SourceSubscriptionID != "" {
			var old MihomoOutbound
			for _, prev := range previous {
				if prev.ID == item.ID {
					old = prev
					break
				}
			}
			if !reflect.DeepEqual(item, old) {
				t.Fatal("reordering modified managed node")
			}
		}
	}
}

// This follows the actual PUT handler and verifies config.yaml is generated
// without the deleted manual group. Unknown full-snapshot fields are rejected.
func TestMihomoEditorDeltaHTTPPreservesLiveSubscriptions(t *testing.T) {
	state := deltaSubscriptionFixture(t)
	m := &CoreManager{dataDir: t.TempDir(), state: state}
	app := &App{manager: m}
	request := mihomoEditorDelta{DeleteIDs: []string{"manual-foreign"}}
	body, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	app.handleMihomoEditorChanges(rec, httptest.NewRequest(http.MethodPut, "/api/mihomo/editor", bytes.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected %d: %s", rec.Code, rec.Body.String())
	}
	yaml, err := os.ReadFile(filepath.Join(m.dataDir, "config.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(yaml, []byte("name: FOREIGN")) {
		t.Fatal("FOREIGN remained in rendered config")
	}
	if !bytes.Contains(yaml, []byte("Foreign-quatro-vpn")) {
		t.Fatal("subscription balancer was removed")
	}
	if len(m.state.OutboundSubscriptions) != 2 {
		t.Fatal("subscription metadata lost")
	}
	rec = httptest.NewRecorder()
	app.handleMihomoEditorChanges(rec, httptest.NewRequest(http.MethodPut, "/api/mihomo/editor",
		bytes.NewBufferString("{\"outbounds\":[],\"deleteIds\":[]}")))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("full snapshot field accepted: %d", rec.Code)
	}
}
