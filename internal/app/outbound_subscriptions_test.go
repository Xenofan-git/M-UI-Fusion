package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func subscriptionSS(name, server string) MihomoOutbound {
	return MihomoOutbound{Kind: "proxy", Name: name, Type: "ss", Server: server, Port: 443, Password: "secret", Cipher: "aes-256-gcm"}
}
func TestParseOutboundSubscriptionClashAndShareLinks(t *testing.T) {
	yamlText := "mixed-port: 7890\nproxies:\n  - {name: Berlin, type: ss, server: de.example, port: 443, cipher: aes-256-gcm, password: abc}\n  - {name: Moscow, type: ss, server: ru.example, port: 443, cipher: aes-256-gcm, password: def}\nproxy-groups:\n  - {name: leaked, type: select, proxies: [Berlin]}\nrules:\n  - MATCH,DIRECT\n"
	nodes, err := parseOutboundSubscription([]byte(yamlText))
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 2 || nodes[0].Name != "Berlin" || nodes[1].Name != "Moscow" {
		t.Fatalf("unexpected parsed nodes: %+v", nodes)
	}
	share := "trojan://secret@example.com:443?sni=example.com#Italy"
	for _, data := range []string{share, base64.StdEncoding.EncodeToString([]byte(share + "\n" + share))} {
		out, err := parseOutboundSubscription([]byte(data))
		if err != nil {
			t.Fatalf("parse link collection: %v", err)
		}
		if len(out) < 1 || out[0].Type != "trojan" {
			t.Fatalf("bad share links: %+v", out)
		}
	}
	if _, err := parseOutboundSubscription([]byte("garbage")); err == nil {
		t.Fatal("bad data accepted")
	}
	if _, err := parseOutboundSubscription([]byte("proxies: []")); err == nil {
		t.Fatal("empty provider would delete nodes")
	}
}

func TestOutboundSubscriptionReconcilesGroupsAndPreservesManual(t *testing.T) {
	state := defaultState()
	manual := subscriptionSS("manual", "manual.example")
	group := MihomoOutbound{Kind: "group", Name: "FOREIGN", Type: "url-test", Interval: 300, Proxies: []string{"manual"}, Native: map[string]any{
		"name": "FOREIGN", "type": "url-test", "url": "https://www.gstatic.com/generate_204", "interval": 300, "lazy": false, "proxies": []any{"manual"},
	}}
	state.Outbounds = []MihomoOutbound{manual, group}
	state.RoutingRules = []MihomoRoutingRule{{ID: "default-match", Type: "MATCH", Target: "FOREIGN"}}
	sub := OutboundSubscription{ID: "sub-test", Name: "Foreign", URL: "https://provider.example/sub", Group: "FOREIGN", Enabled: true, IntervalMinutes: 60}
	first, err := applySubscriptionNodes(state, sub, []MihomoOutbound{subscriptionSS("Sweden", "se.example"), subscriptionSS("Finland", "fi.example")})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Outbounds) != 4 {
		t.Fatalf("want manual+group+2 nodes, got %d", len(first.Outbounds))
	}
	firstIDs := map[string]string{}
	for _, node := range first.Outbounds {
		if node.SourceSubscriptionID == sub.ID {
			firstIDs[node.Name] = node.ID
			if node.ID == "" {
				t.Fatal("managed node missing stable ID")
			}
		}
	}
	if len(firstIDs) != 2 {
		t.Fatalf("owned nodes lost metadata: %+v", first.Outbounds)
	}
	for _, out := range first.Outbounds {
		if out.Name == "FOREIGN" {
			if !containsString(out.Proxies, "Foreign | Sweden") || !containsString(out.Proxies, "Foreign | Finland") || !containsString(out.Proxies, "manual") {
				t.Fatalf("group members mismatch: %v", out.Proxies)
			}
			if out.Native["lazy"] != false {
				t.Fatalf("native group field removed: %+v", out.Native)
			}
		}
	}
	if len(state.Outbounds) != 2 || len(state.Outbounds[1].Proxies) != 1 {
		t.Fatal("source state mutated")
	}
	second, err := applySubscriptionNodes(first, sub, []MihomoOutbound{subscriptionSS("Sweden", "new.example"), subscriptionSS("Denmark", "dk.example")})
	if err != nil {
		t.Fatal(err)
	}
	for _, out := range second.Outbounds {
		if out.Name == "Foreign | Sweden" && (out.ID != firstIDs[out.Name] || out.Server != "new.example") {
			t.Fatalf("node not updated in-place: %+v", out)
		}
		if out.Name == "FOREIGN" {
			if containsString(out.Proxies, "Foreign | Finland") {
				t.Fatal("removed node retained in proxy group")
			}
			if !containsString(out.Proxies, "Foreign | Denmark") {
				t.Fatal("new node not in group")
			}
		}
	}
	if _, err = applySubscriptionNodes(second, sub, nil); err == nil {
		t.Fatal("empty subscription removed good state")
	}
	if first.Outbounds[0].Server != "manual.example" {
		t.Fatal("manual outbound changed")
	}
}

func TestNativeSubscriptionMetadataSurvivesNormalizationAndSave(t *testing.T) {
	node := subscriptionSS("Unit", "example.com")
	node.Native = map[string]any{"name": "Unit", "type": "ss", "server": "example.com", "port": 443, "cipher": "aes-256-gcm", "password": "secret"}
	node.SourceSubscriptionID = "sub-foo"
	normalized, err := normalizeMihomoOutbounds([]MihomoOutbound{node})
	if err != nil {
		t.Fatal(err)
	}
	if normalized[0].SourceSubscriptionID != node.SourceSubscriptionID {
		t.Fatal("source was lost in native normalization")
	}
	state := defaultState()
	state.Outbounds = normalized
	state.OutboundSubscriptions = []OutboundSubscription{{ID: "sub-foo", Name: "Example", URL: "https://example.com/s", Enabled: true, IntervalMinutes: 60}}
	m := &CoreManager{dataDir: t.TempDir(), state: state}
	if err = m.saveLocked(); err != nil {
		t.Fatal(err)
	}
	restored := &CoreManager{dataDir: m.dataDir}
	if err = restored.load(); err != nil {
		t.Fatal(err)
	}
	if len(restored.state.Outbounds) != 1 || restored.state.Outbounds[0].SourceSubscriptionID != "sub-foo" {
		t.Fatalf("lost source id: %+v", restored.state.Outbounds)
	}
	b, err := json.Marshal(restored.state.OutboundSubscriptions)
	if err != nil || !strings.Contains(string(b), "example.com/s") {
		t.Fatal("subscription lost during save")
	}
}

func TestOutboundSubscriptionRejectsUnsafeURLs(t *testing.T) {
	for _, address := range []string{"file:///etc/passwd", "http://127.0.0.1/a", "http://192.168.1.1/a", "http://169.254.169.254/latest/meta-data/", "http://[::1]/s"} {
		if _, err := downloadOutboundSubscription(context.Background(), address); err == nil {
			t.Fatalf("private address accepted: %q", address)
		}
	}
	for _, address := range []string{"ftp://example.com/s", "https://user:pass@example.com/s", "https://example.com/s#part"} {
		if _, err := normalizeOutboundSubscription(OutboundSubscription{Name: "sample", URL: address}); err == nil {
			t.Errorf("bad URL accepted: %s", address)
		}
	}
	for _, ip := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.1.1", "192.168.4.1", "::1", "fc00::1", "fe80::1"} {
		if subscriptionPublicIP(net.ParseIP(ip)) {
			t.Errorf("internal address marked public %s", ip)
		}
	}
	normalized, err := normalizeOutboundSubscription(OutboundSubscription{Name: "A", URL: "https://example.com/s", Enabled: true})
	if err != nil || normalized.IntervalMinutes != 1440 {
		t.Fatal("default interval invalid", err)
	}
}
func TestSubscriptionStateAvoidsPrematureLastAttempt(t *testing.T) {
	// The existing source must remain available when refresh fails before commit.
	state := defaultState()
	state.Outbounds = []MihomoOutbound{subscriptionSS("Manual", "server.example")}
	sub := OutboundSubscription{ID: "sub-test", Name: "Remote", URL: "https://example.com/s", Enabled: true, IntervalMinutes: 60}
	now := time.Now().UTC().Format(time.RFC3339)
	sub.LastUpdated = now
	state.OutboundSubscriptions = []OutboundSubscription{sub}
	after, err := applySubscriptionNodes(state, sub, nil)
	if err == nil {
		t.Fatal("invalid refresh was accepted")
	}
	if len(after.Outbounds) != len(state.Outbounds) || state.OutboundSubscriptions[0].LastUpdated != now {
		t.Fatal("failed refresh changed existing state")
	}
}

func TestSubscriptionCommitPersistsNodesAndMetadata(t *testing.T) {
	state := defaultState()
	state.Outbounds = []MihomoOutbound{
		subscriptionSS("Manual", "manual.example"),
		{Kind: "group", Name: "Russia", Type: "url-test", Interval: 300, Proxies: []string{"Manual"}},
	}
	state.RoutingRules = []MihomoRoutingRule{{ID: "match", Type: "MATCH", Target: "Russia"}}
	m := &CoreManager{state: state, dataDir: t.TempDir()}
	sub := OutboundSubscription{ID: "sub-test", Name: "Remote", URL: "https://example.com/s", Group: "Russia", Enabled: true, IntervalMinutes: 60}
	if err := m.commitOutboundSubscription(sub, []MihomoOutbound{subscriptionSS("Node 1", "s1.example"), subscriptionSS("Node 2", "s2.example")}, true); err != nil {
		t.Fatal(err)
	}
	if len(m.state.Outbounds) != 4 || len(m.state.OutboundSubscriptions) != 1 {
		t.Fatal("nodes not saved", m.state.Outbounds)
	}
	if m.state.OutboundSubscriptions[0].NodeCount != 2 || m.state.OutboundSubscriptions[0].LastUpdated == "" {
		t.Fatal("metadata missing")
	}
	reloaded := &CoreManager{dataDir: m.dataDir}
	if err := reloaded.load(); err != nil {
		t.Fatal(err)
	}
	if len(reloaded.state.Outbounds) != 4 || len(reloaded.state.OutboundSubscriptions) != 1 {
		t.Fatal("reload lost nodes")
	}
	if _, err := os.Stat(filepath.Join(m.dataDir, "config.yaml")); err != nil {
		t.Fatal(err)
	}
	for _, item := range reloaded.state.Outbounds {
		if item.SourceSubscriptionID == sub.ID && item.ID == "" {
			t.Fatal("subscription id was not saved")
		}
	}
	beforeCount := len(m.state.Outbounds)
	if err := m.commitOutboundSubscription(sub, nil, false); err == nil {
		t.Fatal("empty sync committed")
	}
	if len(m.state.Outbounds) != beforeCount {
		t.Fatal("failed sync mutated live state")
	}
	if err := m.removeOutboundSubscription(sub, false); err == nil {
		t.Fatal("removed referenced group nodes")
	}
	if err := m.removeOutboundSubscription(sub, true); err != nil {
		t.Fatal("detach nodes failed:", err)
	}
	if len(m.state.OutboundSubscriptions) != 0 || len(m.state.Outbounds) != 4 {
		t.Fatal("detach did not preserve nodes")
	}
	for _, item := range m.state.Outbounds {
		if item.SourceSubscriptionID != "" {
			t.Fatal("node is still managed after detach")
		}
	}
}

func TestSubscriptionsRejectStaleMihomoSettingsDraft(t *testing.T) {
	old := subscriptionSS("Manual", "manual.example")
	subNode := subscriptionSS("Remote | New", "new.example")
	subNode.ID = "managed-node"
	subNode.SourceSubscriptionID = "sub-test"
	good := []MihomoOutbound{old, subNode}
	if err := validateManagedOutboundSnapshot(good, good); err != nil {
		t.Fatal(err)
	}
	if err := validateManagedOutboundSnapshot(good, good[:1]); err == nil {
		t.Fatal("old settings could erase subscription nodes")
	}
	changed := append([]MihomoOutbound(nil), good...)
	changed[1].Password = "tampered"
	if err := validateManagedOutboundSnapshot(good, changed); err == nil {
		t.Fatal("managed subscription node could be modified")
	}
}

func TestSubscriptionMihomoCorePreflightRejectsInvalid(t *testing.T) {
	state := defaultState()
	state.Settings.CorePath = "/bin/false"
	m := &CoreManager{dataDir: t.TempDir(), state: state}
	sub := OutboundSubscription{ID: "sub-failing", Name: "Fail", URL: "https://example.com/x", Enabled: true, IntervalMinutes: 60}
	err := m.commitOutboundSubscription(sub, []MihomoOutbound{subscriptionSS("A", "example.com")}, true)
	if err == nil {
		t.Fatal("binary that rejects config was accepted")
	}
	if len(m.state.Outbounds) != 0 || len(m.state.OutboundSubscriptions) != 0 {
		t.Fatal("failed core validation altered state")
	}
}

func TestOutboundSubscriptionControllerHotReload(t *testing.T) {
	dir := t.TempDir()
	var called bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if r.Method != http.MethodPut || r.URL.Path != "/configs" || r.URL.Query().Get("force") != "true" {
			t.Errorf("wrong Mihomo endpoint: %s %s", r.Method, r.URL.String())
		}
		if r.Header.Get("Authorization") != "Bearer test-secret" {
			t.Errorf("controller auth absent")
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body["path"] != filepath.Join(dir, "config.yaml") {
			t.Errorf("wrong reload path: %v", body)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	if err := reloadMihomoConfigController(server.Listener.Addr().String(), "test-secret", dir); err != nil {
		t.Fatal(err)
	}
	if !called {
		t.Fatal("reload endpoint was not called")
	}
}

func TestOutboundSubscriptionUIWiring(t *testing.T) {
	html, err := os.ReadFile("web/index.html")
	if err != nil {
		t.Fatal(err)
	}
	for _, disallowed := range []string{`data-view="outbound-subscriptions"`, `id="view-outbound-subscriptions"`} {
		if strings.Contains(string(html), disallowed) {
			t.Fatalf("redundant sidebar subscription entry: %s", disallowed)
		}
	}
	files := map[string][]string{
		"web/index.html":                {"data-view=\"mihomo\"", "data-mihomo-tab=\"balancers\"", "data-mihomo-pane=\"balancers\"", "outbound-subscriptions.js"},
		"web/outbound-subscriptions.js": {"/api/mihomo/subscriptions", "intervalMinutes", "enabled", "refresh", "group", "nodeCount"},
		"internal/app/main.go":          {"/api/mihomo/subscriptions", "monitorOutboundSubscriptions()"},
	}
	for filename, fragments := range files {
		content, err := os.ReadFile(filename)
		if err != nil {
			t.Fatal(err)
		}
		for _, fragment := range fragments {
			if !strings.Contains(string(content), fragment) {
				t.Errorf("missing subscription UI wiring %s: %s", filename, fragment)
			}
		}
	}
}

// Two independent balancers may use the SAME provider URL and the SAME source
// display name. They must not share source IDs, owned nodes, filters or groups.
// In particular, a refresh of either source must never remove the other's nodes.
func TestSameURLIndependentSubscribedBalancers(t *testing.T) {
	m := &CoreManager{dataDir: t.TempDir(), state: defaultState()}
	const url = "https://provider.example/shared-subscription"
	nodes := []MihomoOutbound{
		subscriptionSS("LTE - Швейцария", "ch.example"),
		subscriptionSS("LTE - Germany", "de.example"),
		subscriptionSS("LTE - Россия", "ru.example"),
	}
	first := OutboundSubscription{
		ID: "sub-foreign", Name: "quatro-vpn", URL: url, Group: "FOREIGN",
		FilterExclude: "🇷🇺", Enabled: true, IntervalMinutes: 1440,
	}
	second := OutboundSubscription{
		ID: "sub-swiss", Name: "quatro-vpn", URL: url, Group: "Swiss-Only",
		FilterKeep: "🇨🇭", Enabled: true, IntervalMinutes: 30,
	}
	if err := m.commitOutboundSubscriptionWithGroup(first, nodes, true, true, "url-test"); err != nil {
		t.Fatal("first source create:", err)
	}
	firstNodes := map[string]MihomoOutbound{}
	for _, node := range m.state.Outbounds {
		if node.SourceSubscriptionID == first.ID {
			firstNodes[node.Name] = node
		}
	}
	if len(firstNodes) != 2 {
		t.Fatalf("first source: want 2 non-RU nodes, got %d", len(firstNodes))
	}
	if err := m.commitOutboundSubscriptionWithGroup(second, nodes, true, true, "url-test"); err != nil {
		t.Fatal("second source must accept same URL/name with a new group:", err)
	}
	if len(m.state.OutboundSubscriptions) != 2 {
		t.Fatalf("two sources not persisted: %+v", m.state.OutboundSubscriptions)
	}
	firstGroup, secondGroup := []string(nil), []string(nil)
	secondNodes := map[string]MihomoOutbound{}
	for _, out := range m.state.Outbounds {
		switch {
		case out.SourceSubscriptionID == first.ID:
			original, ok := firstNodes[out.Name]
			if !ok || out.ID != original.ID || out.Server != original.Server {
				t.Fatalf("creating second subscription modified first source node: %+v", out)
			}
		case out.SourceSubscriptionID == second.ID:
			secondNodes[out.Name] = out
		case out.Kind == "group" && out.Name == first.Group:
			firstGroup = append([]string(nil), out.Proxies...)
		case out.Kind == "group" && out.Name == second.Group:
			secondGroup = append([]string(nil), out.Proxies...)
		}
	}
	if len(secondNodes) != 1 || len(secondGroup) != 1 || len(firstGroup) != 2 {
		t.Fatalf("group membership must be independent: first=%v second=%v nodes=%v", firstGroup, secondGroup, secondNodes)
	}
	for _, name := range secondGroup {
		if _, ownedByFirst := firstNodes[name]; ownedByFirst {
			t.Fatalf("second group contains first group's member: %s", name)
		}
	}
	// Same provider response; changing the second filter must not affect
	// first source metadata, IDs, nodes, or group members.
	second.FilterKeep = "🇩🇪"
	if err := m.commitOutboundSubscription(second, nodes, false); err != nil {
		t.Fatal("second source refresh:", err)
	}
	afterFirst := map[string]MihomoOutbound{}
	secondAfter := map[string]MihomoOutbound{}
	for _, out := range m.state.Outbounds {
		if out.SourceSubscriptionID == first.ID {
			afterFirst[out.Name] = out
		}
		if out.SourceSubscriptionID == second.ID {
			secondAfter[out.Name] = out
		}
	}
	if len(afterFirst) != len(firstNodes) || len(secondAfter) != 1 {
		t.Fatalf("refresh changed unrelated source counts: first=%d second=%d", len(afterFirst), len(secondAfter))
	}
	for name, original := range firstNodes {
		after, ok := afterFirst[name]
		if !ok || after.ID != original.ID || after.Server != original.Server {
			t.Fatalf("refresh of second changed first source node: %s: %+v", name, after)
		}
	}
	for _, node := range secondAfter {
		if !strings.Contains(node.Name, "Germany") {
			t.Fatalf("second source filter not updated: %s", node.Name)
		}
	}
	for _, group := range m.state.Outbounds {
		if group.Kind == "group" && group.Name == first.Group && !reflect.DeepEqual(group.Proxies, firstGroup) {
			t.Fatalf("refresh of second changed first group: %v -> %v", firstGroup, group.Proxies)
		}
	}
	// Both sources must survive saving and loading with independent filters.
	reloaded := &CoreManager{dataDir: m.dataDir}
	if err := reloaded.load(); err != nil {
		t.Fatal("restart:", err)
	}
	if len(reloaded.state.OutboundSubscriptions) != 2 {
		t.Fatalf("restart lost duplicate URL source: %+v", reloaded.state.OutboundSubscriptions)
	}
	for _, sub := range reloaded.state.OutboundSubscriptions {
		if sub.URL != url || sub.Name != "quatro-vpn" {
			t.Fatalf("source URL/name changed: %+v", sub)
		}
		if sub.ID == first.ID && sub.FilterExclude != "🇷🇺" {
			t.Fatalf("first source filter lost: %+v", sub)
		}
		if sub.ID == second.ID && sub.FilterKeep != "🇩🇪" {
			t.Fatalf("second source filter lost: %+v", sub)
		}
	}
	// The main safety invariant: distinct group names are mandatory.
	conflict := second
	conflict.ID = "sub-third"
	conflict.Group = first.Group
	if err := m.commitOutboundSubscriptionWithGroup(conflict, nodes, true, true, "url-test"); err == nil {
		t.Fatal("duplicate balancer name should be rejected")
	}
	conflict.Group = "Third-Group"
	conflict.ID = second.ID
	if err := m.commitOutboundSubscriptionWithGroup(conflict, nodes, true, true, "url-test"); err == nil {
		t.Fatal("duplicate subscription ID should be rejected")
	}
	if len(m.state.OutboundSubscriptions) != 2 {
		t.Fatal("failed duplicate creation modified saved subscriptions")
	}
}
