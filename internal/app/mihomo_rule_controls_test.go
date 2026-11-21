package app

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func boolRulePtr(value bool) *bool { return &value }

func TestMihomoDisabledRulesPersistButDoNotRender(t *testing.T) {
	input := []MihomoRoutingRule{
		{ID: "one", Type: "DOMAIN-SUFFIX", Payload: "example.com", Target: "DIRECT"},
		{ID: "two", Type: "GEOIP", Payload: "RU", Target: "REJECT", NoResolve: true, Enabled: boolRulePtr(false)},
		{ID: "three", Type: "DOMAIN", Payload: "example.org", Target: "DIRECT", Enabled: boolRulePtr(true)},
		{ID: "match", Type: "MATCH", Target: "DIRECT"},
	}
	output, err := normalizeMihomoRoutingRules(input, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(input, output) {
		t.Fatalf("disabled state or ordering changed: %#v vs %#v", input, output)
	}
	lines := mihomoRoutingConfig(output)
	expected := []string{"DOMAIN-SUFFIX,example.com,DIRECT", "DOMAIN,example.org,DIRECT", "MATCH,DIRECT"}
	if !reflect.DeepEqual(lines, expected) {
		t.Fatalf("disabled rule leaked into live routing: %#v", lines)
	}
	raw, err := json.Marshal(output)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "\"enabled\":false") {
		t.Fatalf("disabled flag missing from state JSON: %s", raw)
	}
	var restored []MihomoRoutingRule
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(restored, output) {
		t.Fatalf("disabled state not persisted: %#v", restored)
	}
	restored[1].Enabled = boolRulePtr(true)
	if !strings.Contains(strings.Join(mihomoRoutingConfig(restored), "\n"), "GEOIP,RU,REJECT,no-resolve") {
		t.Fatal("re-enabling rule did not restore all original parameters")
	}
}

func TestMihomoLegacyRulesDefaultEnabledAndDefaultMatch(t *testing.T) {
	var legacy []MihomoRoutingRule
	if err := json.Unmarshal([]byte("[{\"id\":\"r1\",\"type\":\"DOMAIN\",\"payload\":\"old.example\",\"target\":\"DIRECT\"}]"), &legacy); err != nil {
		t.Fatal(err)
	}
	if legacy[0].Enabled != nil || !mihomoRuleIsEnabled(legacy[0]) {
		t.Fatal("old rules must default to enabled")
	}
	rules, err := normalizeMihomoRoutingRules(legacy, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(rules) != 2 || rules[1].Type != "MATCH" || rules[1].Target != "DIRECT" {
		t.Fatalf("default MATCH missing: %#v", rules)
	}
	if !reflect.DeepEqual(mihomoRoutingConfig(rules), []string{"DOMAIN,old.example,DIRECT", "MATCH,DIRECT"}) {
		t.Fatal("legacy active routing changed")
	}
}

func TestMihomoPermanentMatchCannotBeDisabledOrMoved(t *testing.T) {
	for _, rules := range [][]MihomoRoutingRule{
		{{Type: "MATCH", Target: "DIRECT", Enabled: boolRulePtr(false)}},
		{{Type: "MATCH", Target: "DIRECT"}, {Type: "DOMAIN", Payload: "x.example", Target: "DIRECT"}},
		{{Type: "MATCH", Target: "DIRECT"}, {Type: "MATCH", Target: "DIRECT"}},
	} {
		if _, err := normalizeMihomoRoutingRules(rules, nil); err == nil {
			t.Fatalf("unsafe MATCH accepted: %#v", rules)
		}
	}
}

func TestMihomoAllOptionalRulesDisabledStillRoutesWithMatch(t *testing.T) {
	rules, err := normalizeMihomoRoutingRules([]MihomoRoutingRule{
		{Type: "DOMAIN", Payload: "site.example", Target: "DIRECT", Enabled: boolRulePtr(false)},
		{Type: "MATCH", Target: "REJECT"},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := mihomoRoutingConfig(rules); !reflect.DeepEqual(got, []string{"MATCH,REJECT"}) {
		t.Fatalf("MATCH fallback lost: %v", got)
	}
}
