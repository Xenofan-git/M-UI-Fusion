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
	for _, disallowed := range []string{`data-view="outbound-subscriptions"`, `id="view-outbound-subscriptions"`, `data-mihomo-tab="subscriptions"`, `data-mihomo-pane="subscriptions"`} {
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
