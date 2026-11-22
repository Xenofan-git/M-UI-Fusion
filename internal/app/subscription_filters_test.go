package app

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestSubscriptionFilterHydraRouteSemantics(t *testing.T) {
	nodes := []MihomoOutbound{
		subscriptionSS("🇩🇪 Germany LTE", "de.example"),
		subscriptionSS("🇷🇺 Россия MTS", "ru.example"),
		subscriptionSS("🇩🇪 Germany Beeline", "de2.example"),
		subscriptionSS("🇫🇷 France LTE", "fr.example"),
	}
	sub := OutboundSubscription{FilterKeep: "Germany\nLTE\n#comment", FilterExclude: "Beeline\nРоссия"}
	selected, preview, err := filterSubscriptionNodes(sub, nodes)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Total != 4 || preview.Selected != 2 || preview.Filtered != 2 {
		t.Fatalf("counts mismatch %+v", preview)
	}
	if selected[0].Name != "🇩🇪 Germany LTE" || selected[1].Name != "🇫🇷 France LTE" {
		t.Fatalf("incorrect include/exclude OR behavior: %+v", selected)
	}
	sub.ExcludedNodeKeys = []string{preview.Nodes[0].Key}
	selected, preview, err = filterSubscriptionNodes(sub, nodes)
	if err != nil {
		t.Fatal(err)
	}
	if len(selected) != 1 || selected[0].Name != "🇫🇷 France LTE" || preview.Selected != 1 {
		t.Fatalf("manual selection not respected")
	}
	sub.FilterKeep = "nonexistent"
	_, _, err = filterSubscriptionNodes(sub, nodes)
	if err == nil {
		t.Fatal("filter excluding all nodes must reject update")
	}
}
func TestSubscriptionStableNodeKeysAndUnicodeNameLimits(t *testing.T) {
	nodes := []MihomoOutbound{
		subscriptionSS("Name", "de.example"),
		subscriptionSS("Name", "de.example"),
		subscriptionSS("Name", "de2.example"),
	}
	a := subscriptionNodeKeys(nodes)
	b := subscriptionNodeKeys(nodes)
	if !reflect.DeepEqual(a, b) || a[0] == a[1] || a[1] == a[2] {
		t.Fatalf("duplicate keys not stable or distinct: %v", a)
	}
	big := strings.Repeat("🇩🇪 Москва Китай,", 100) + "\nVery long"
	sub := OutboundSubscription{ID: "sub-1", Name: strings.Repeat("Москва🇷🇺", 10)}
	raw := subscriptionSS(big, "big.example")
	result, err := applySubscriptionNodes(defaultState(), sub, []MihomoOutbound{raw, raw})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Outbounds) != 2 {
		t.Fatal("expected two nodes")
	}
	for _, node := range result.Outbounds {
		if len(node.Name) > 128 || strings.ContainsAny(node.Name, ",\r\n") || node.Name == "" {
			t.Fatalf("bad sanitized name: %q (%d bytes)", node.Name, len(node.Name))
		}
	}
	if result.Outbounds[0].Name == result.Outbounds[1].Name {
		t.Fatalf("duplicate not resolved")
	}
}
func TestCreateSubscribedBalancerAtomic(t *testing.T) {
	m := &CoreManager{dataDir: t.TempDir(), state: defaultState()}
	sub := OutboundSubscription{
		ID: "sub-1", Name: "Europe", URL: "https://example.org/sub",
		Group: "EU-Pool", Enabled: true, IntervalMinutes: 60,
		FilterKeep: "Germany", FilterExclude: "Beeline",
	}
	nodes := []MihomoOutbound{
		subscriptionSS("Germany MTS", "de1.example"),
		subscriptionSS("Germany Beeline", "de2.example"),
		subscriptionSS("France", "fr.example"),
	}
	if err := m.commitOutboundSubscriptionWithGroup(sub, nodes, true, true, "fallback"); err != nil {
		t.Fatal(err)
	}
	if len(m.state.OutboundSubscriptions) != 1 || m.state.OutboundSubscriptions[0].NodeCount != 1 {
		t.Fatalf("subscription/filters not saved: %+v", m.state.OutboundSubscriptions)
	}
	if len(m.state.Outbounds) != 2 {
		t.Fatalf("group and filtered node missing: %+v", m.state.Outbounds)
	}
	group := m.state.Outbounds[0]
	if group.Kind != "group" || group.Name != "EU-Pool" || group.Type != "fallback" || len(group.Proxies) != 1 {
		t.Fatalf("wrong group: %+v", group)
	}
	if group.Interval != 300 || group.Timeout != 8000 || group.Tolerance != 0 {
		t.Fatalf("fallback defaults are wrong: interval=%d timeout=%d tolerance=%d", group.Interval, group.Timeout, group.Tolerance)
	}
	if !reflect.DeepEqual(m.state.OutboundSubscriptions[0].ExcludedNodeKeys, sub.ExcludedNodeKeys) {
		t.Fatal("filter metadata lost")
	}
	loaded := &CoreManager{dataDir: m.dataDir}
	if err := loaded.load(); err != nil {
		t.Fatal(err)
	}
	if len(loaded.state.OutboundSubscriptions) != 1 || len(loaded.state.Outbounds) != 2 {
		t.Fatal("restart lost subscribed group")
	}
	if loaded.state.Outbounds[0].Kind != "group" {
		t.Fatal("group missing after reload")
	}
	if err := m.commitOutboundSubscriptionWithGroup(sub, nodes, true, true, "url-test"); err == nil {
		t.Fatal("duplicate group creation permitted")
	}
	if len(m.state.Outbounds) != 2 {
		t.Fatal("failed duplicate creation touched state")
	}
}
func TestCreateSubscribedURLTestDefaultsAndEditableSettings(t *testing.T) {
	m := &CoreManager{dataDir: t.TempDir(), state: defaultState()}
	sub := OutboundSubscription{ID: "sub-new", Name: "Provider", URL: "https://example.org/sub",
		Group: "New-URLTest", Enabled: true, IntervalMinutes: 60}
	if err := m.commitOutboundSubscriptionWithGroup(sub, []MihomoOutbound{
		subscriptionSS("Germany", "de.example")}, true, true, "url-test"); err != nil {
		t.Fatal(err)
	}
	group := m.state.Outbounds[0]
	if group.Interval != 300 || group.Timeout != 8000 || group.Tolerance != 100 {
		t.Fatalf("wrong new URL-test defaults: %+v", group)
	}
	loaded := &CoreManager{dataDir: m.dataDir}
	if err := loaded.load(); err != nil {
		t.Fatal(err)
	}
	fromDisk := loaded.state.Outbounds[0]
	if fromDisk.Timeout != 8000 || fromDisk.Tolerance != 100 {
		t.Fatalf("timeout/tolerance lost after reload: %+v", fromDisk)
	}
	// Existing user-customized values must survive subscription updates.
	m.state.Outbounds[0].Timeout = 5000
	m.state.Outbounds[0].Tolerance = 220
	if err := m.commitOutboundSubscription(sub, []MihomoOutbound{
		subscriptionSS("Germany", "de.example")}, false); err != nil {
		t.Fatal(err)
	}
	updated := m.state.Outbounds[0]
	if updated.Timeout != 5000 || updated.Tolerance != 220 {
		t.Fatalf("existing editable values overwritten on refresh: %+v", updated)
	}
}

func TestEditedSubscriptionFiltersPersistAfterRestartAndRebuildGroup(t *testing.T) {
	m := &CoreManager{dataDir: t.TempDir(), state: defaultState()}
	sub := OutboundSubscription{ID: "sub-refresh", Name: "Provider", URL: "https://example.org/sub",
		Group: "Foreign-Pool", Enabled: true, IntervalMinutes: 1440}
	nodes := []MihomoOutbound{
		subscriptionSS("🇷🇺 Россия LTE", "ru.example"),
		subscriptionSS("🇵🇱 Польша LTE", "pl.example"),
	}
	if err := m.commitOutboundSubscriptionWithGroup(sub, nodes, true, true, "url-test"); err != nil {
		t.Fatal(err)
	}
	if len(m.state.Outbounds) != 3 || len(m.state.Outbounds[0].Proxies) != 2 {
		t.Fatal("initial subscription group must include both nodes")
	}
	sub.FilterKeep = "🇵🇱"
	sub.FilterExclude = "🇷🇺"
	if err := m.commitOutboundSubscription(sub, nodes, false); err != nil {
		t.Fatal(err)
	}
	if len(m.state.Outbounds) != 2 || len(m.state.Outbounds[0].Proxies) != 1 {
		t.Fatalf("filter did not narrow the live group: %#v", m.state.Outbounds)
	}
	reloaded := &CoreManager{dataDir: m.dataDir}
	if err := reloaded.load(); err != nil {
		t.Fatal(err)
	}
	if len(reloaded.state.OutboundSubscriptions) != 1 {
		t.Fatal("subscription metadata lost")
	}
	got := reloaded.state.OutboundSubscriptions[0]
	if got.FilterKeep != "🇵🇱" || got.FilterExclude != "🇷🇺" || got.IntervalMinutes != 1440 {
		t.Fatalf("filters disappeared after state reload: %+v", got)
	}
	if len(reloaded.state.Outbounds) != 2 || len(reloaded.state.Outbounds[0].Proxies) != 1 {
		t.Fatal("group membership changed after state reload")
	}
	if reloaded.state.Outbounds[0].Timeout != 8000 || reloaded.state.Outbounds[0].Tolerance != 100 {
		t.Fatal("balancer settings lost when filters were saved")
	}
	if _, err := os.Stat(filepath.Join(m.dataDir, "config.yaml")); err != nil {
		t.Fatal("compiled Mihomo configuration not saved", err)
	}
}

func TestCreateSubscribedBalancerEmptyFilterDoesNotMutate(t *testing.T) {
	state := defaultState()
	state.Outbounds = []MihomoOutbound{subscriptionSS("Manual", "manual.example")}
	m := &CoreManager{dataDir: t.TempDir(), state: state}
	sub := OutboundSubscription{ID: "new", Name: "Bad", Group: "New-Pool", URL: "https://example.org/a", FilterKeep: "nonexistent"}
	err := m.commitOutboundSubscriptionWithGroup(sub, []MihomoOutbound{subscriptionSS("Germany", "de.example")}, true, true, "url-test")
	if err == nil {
		t.Fatal("empty filtered source accepted")
	}
	if len(m.state.Outbounds) != 1 || len(m.state.OutboundSubscriptions) != 0 {
		t.Fatal("failed creation mutated state")
	}
}
func TestUnifiedBalancerSubscriptionUIWiring(t *testing.T) {
	b, err := os.ReadFile("web/index.html")
	if err != nil {
		t.Fatal(err)
	}
	html := string(b)
	for _, want := range []string{
		`id="mihomo-add-balancer"`, `id="mihomo-add-sub-balancer"`,
		`data-mihomo-tab="balancers"`, `data-mihomo-tab="subscriptions"`, `id="outsub-root"`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("missing unified balancer component %s", want)
		}
	}
	for _, forbidden := range []string{`data-view="outbound-subscriptions"`, `id="view-outbound-subscriptions"`} {
		if strings.Contains(html, forbidden) {
			t.Errorf("obsolete separate subscriptions nav: %s", forbidden)
		}
	}
	js, err := os.ReadFile("web/outbound-subscriptions.js")
	if err != nil {
		t.Fatal(err)
	}
	for _, wanted := range []string{
		"filterKeep", "filterExclude", "excludedNodeKeys", "/api/mihomo/subscriptions/preview",
		"Создать балансировщик из подписки", "Загрузить серверы",
	} {
		if !strings.Contains(string(js), wanted) {
			t.Errorf("wizard missing %s", wanted)
		}
	}
}

func TestSubscriptionImportMoreThan206MixedUnicodeNames(t *testing.T) {
	state := defaultState()
	// Real installations can have hundreds of manual Outbounds before import.
	for i := 0; i < 95; i++ {
		state.Outbounds = append(state.Outbounds, subscriptionSS(fmt.Sprintf("Manual-%03d", i), "manual.example"))
	}
	sub := OutboundSubscription{ID: "sub-many", Name: "Русские, иностранные 🇩🇪", Group: "Foreign", URL: "https://example.org/sub", Enabled: true, IntervalMinutes: 60}
	nodes := make([]MihomoOutbound, 220)
	for i := range nodes {
		name := strings.Repeat("🇷🇺 Россия,Длинное имя ", 15)
		if i%3 == 0 {
			name = "Germany\nLTE"
		}
		nodes[i] = subscriptionSS(name, fmt.Sprintf("server%d.example", i))
	}
	next, err := applySubscriptionNodes(state, sub, nodes)
	if err != nil {
		t.Fatalf("Import >206 nodes failed: %v", err)
	}
	if len(next.Outbounds) != 315 {
		t.Fatalf("want 95 manual + 220 subscription outbounds, got %d", len(next.Outbounds))
	}
	named := map[string]bool{}
	for i, item := range next.Outbounds {
		if i < 95 && item.Name != state.Outbounds[i].Name {
			t.Fatal("manual name changed")
		}
		if item.SourceSubscriptionID != "" {
			if len(item.Name) > 128 || strings.ContainsAny(item.Name, ",\n\r") || named[item.Name] {
				t.Fatalf("bad imported name at %d: %q", i, item.Name)
			}
			named[item.Name] = true
		}
	}
}

func TestSubscriptionCountryFlagRecognition(t *testing.T) {
	for _, c := range []struct{ name, code string }{
		{"сн⚡★0.1x - LTE №136 - Швейцария", "CH"},
		{"LTE №137 - Germany", "DE"},
		{"🇩🇪 ⭐ Special LTE", "DE"},
		{"RU - Russia 🇷🇺", "RU"},
		{"США - LTE", "US"},
		{"NL - Amsterdam", "NL"},
		{"Франция - Paris", "FR"},
		{"JP Tokyo LTE", "JP"},
	} {
		got := subscriptionCountryCode(c.name)
		if got != c.code {
			t.Errorf("country for %q=%q, want %q", c.name, got, c.code)
		}
		if got == c.code && subscriptionCountryFlag(got) == "" {
			t.Errorf("missing flag for %s", got)
		}
	}
	if got := subscriptionCountryCode("No country identifiable"); got != "" {
		t.Errorf("unknown should not get a flag: %s", got)
	}
}
func TestSubscriptionCountryFlagFiltersMatchNamesWithoutEmoji(t *testing.T) {
	nodes := []MihomoOutbound{
		subscriptionSS("LTE №136 - Швейцария", "ch.example"),
		subscriptionSS("LTE №137 - Germany", "de.example"),
		subscriptionSS("LTE №138 - Россия", "ru.example"),
	}
	sub := OutboundSubscription{FilterKeep: "🇨🇭\n🇩🇪", FilterExclude: "🇷🇺"}
	selected, preview, err := filterSubscriptionNodes(sub, nodes)
	if err != nil {
		t.Fatal(err)
	}
	if len(selected) != 2 || preview.Selected != 2 {
		t.Fatalf("flag filters selected %d: %+v", len(selected), preview)
	}
	if preview.Nodes[0].Flag != "🇨🇭" || preview.Nodes[0].CountryCode != "CH" {
		t.Fatalf("Swiss flag missing: %+v", preview.Nodes[0])
	}
	if preview.Nodes[1].Flag != "🇩🇪" || preview.Nodes[1].CountryCode != "DE" {
		t.Fatalf("German flag missing: %+v", preview.Nodes[1])
	}
	sub.FilterKeep = "🇷🇺"
	sub.FilterExclude = ""
	selected, _, err = filterSubscriptionNodes(sub, nodes)
	if err != nil || len(selected) != 1 || selected[0].Name != "LTE №138 - Россия" {
		t.Fatalf("Russia filter failed: %+v %v", selected, err)
	}
	sub.FilterKeep = "🇨🇭"
	selected, _, err = filterSubscriptionNodes(sub, nodes)
	if err != nil || len(selected) != 1 || selected[0].Name != "LTE №136 - Швейцария" {
		t.Fatalf("Swiss filter failed: %+v %v", selected, err)
	}
}
func TestFlagPickerAndButtonWiring(t *testing.T) {
	html, err := os.ReadFile("web/index.html")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(html), "static/country-flags.js") {
		t.Fatal("country flag script missing")
	}
	js, err := os.ReadFile("web/outbound-subscriptions.js")
	if err != nil {
		t.Fatal(err)
	}
	for _, term := range []string{"Создать балансировщик из подписки", "1440", "outsub-node-name", "outsub-node-flag", "attachFlagPicker", "Добавить флаг"} {
		if !strings.Contains(string(js), term) {
			t.Errorf("subscription UI missing %s", term)
		}
	}
	css, err := os.ReadFile("web/outbound-subscriptions.css")
	if err != nil {
		t.Fatal(err)
	}
	for _, term := range []string{"grid-template-columns:20px 32px minmax(0,1fr) 86px", "white-space:nowrap", "#outsub-submit:is(:hover,:focus-visible):not(:disabled)"} {
		if !strings.Contains(string(css), term) {
			t.Errorf("subscription UI CSS missing %s", term)
		}
	}
}

// Bundled SVGs must be served from the executable itself: Windows 8.1 and
// other platforms without flag-emoji fonts render regional Unicode symbols
// as pairs of letters instead of flag pictures.
func TestBundledSVGCountryFlagsAndStaticRoute(t *testing.T) {
	codes := []string{"de", "ch", "ru", "us", "gb", "jp", "fr", "nl"}
	for _, code := range codes {
		filename := "web/flags/" + code + ".svg"
		data, err := webFS.ReadFile(filename)
		if err != nil {
			t.Fatalf("bundled flag %s missing: %v", filename, err)
		}
		if !strings.Contains(string(data), "<svg") {
			t.Fatalf("invalid bundled SVG %s", filename)
		}
	}
	entries, err := webFS.ReadDir("web/flags")
	if err != nil {
		t.Fatal(err)
	}
	actual := 0
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".svg") {
			actual++
		}
	}
	if actual != len(subscriptionCountryNames) {
		t.Fatalf("expected %d SVG flags, found %d", len(subscriptionCountryNames), actual)
	}
	p := &App{}
	request := httptest.NewRequest(http.MethodGet, "/static/flags/ch.svg", nil)
	recorder := httptest.NewRecorder()
	p.handleStatic(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("CH asset HTTP=%d", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); got != "image/svg+xml" {
		t.Fatalf("wrong SVG content type: %q", got)
	}
	if !strings.Contains(recorder.Body.String(), "<svg") {
		t.Fatal("empty or corrupt Swiss flag")
	}
}
func TestCountryFlagUIUsesSVGNotEmojiFont(t *testing.T) {
	js, err := os.ReadFile("web/country-flags.js")
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range []string{"createIcon", "flagAssetRoot", "flags/", "fromFilterLine"} {
		if !strings.Contains(string(js), part) {
			t.Errorf("country flag JS missing %s", part)
		}
	}
	ui, err := os.ReadFile("web/outbound-subscriptions.js")
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range []string{"outsub-selected-country-flags", "createIcon", "showSelectedCountries",
		"country.english", "outsub-node-flag"} {
		if !strings.Contains(string(ui), part) {
			t.Errorf("flag chooser UI missing %s", part)
		}
	}
}
