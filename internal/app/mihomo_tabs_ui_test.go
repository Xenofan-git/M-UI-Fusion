package app

import (
	"strings"
	"testing"
)

func TestMihomoManualAndSubscribedBalancerTabsRemainSeparated(t *testing.T) {
	doc, err := webFS.ReadFile("web/index.html")
	if err != nil {
		t.Fatal(err)
	}
	html := string(doc)
	const manualTab = `data-mihomo-tab="balancers"`
	const subscriptionsTab = `data-mihomo-tab="subscriptions"`
	const routingTab = `data-mihomo-tab="routing"`
	if strings.Count(html, manualTab) != 1 || strings.Count(html, subscriptionsTab) != 1 {
		t.Fatal("manual and subscribed balancer tabs must each appear once")
	}
	if !(strings.Index(html, manualTab) < strings.Index(html, subscriptionsTab) && strings.Index(html, subscriptionsTab) < strings.Index(html, routingTab)) {
		t.Fatal("Subscriptions tab must be adjacent to Balancers inside Mihomo Settings")
	}
	pieces := strings.Split(html, `data-mihomo-pane="balancers"`)
	if len(pieces) != 2 {
		t.Fatal("expected one manual balancers pane")
	}
	subPanes := strings.Split(pieces[1], `data-mihomo-pane="subscriptions"`)
	if len(subPanes) != 2 {
		t.Fatal("expected one separate subscriptions pane")
	}
	manual := subPanes[0]
	subscribed := strings.Split(subPanes[1], `data-mihomo-pane="routing"`)[0]
	for _, marker := range []string{`id="mihomo-add-balancer"`, `id="mihomo-balancer-table"`} {
		if !strings.Contains(manual, marker) {
			t.Errorf("manual pane missing %s", marker)
		}
		if strings.Contains(subscribed, marker) {
			t.Errorf("manual control leaked into subscriptions pane %s", marker)
		}
	}
	for _, marker := range []string{`id="mihomo-add-sub-balancer"`, `id="mihomo-subscription-balancer-table"`, `id="outsub-root"`, `id="outsub-reload"`} {
		if !strings.Contains(subscribed, marker) {
			t.Errorf("subscriptions pane missing %s", marker)
		}
		if strings.Contains(manual, marker) {
			t.Errorf("subscription control leaked into manual pane %s", marker)
		}
	}
	// Labels are localized text only: the tab identifiers remain stable.
	for _, expected := range []string{
		`data-i18n="mihomo.tabOutbounds">Исходящие</span>`,
		`data-i18n="mihomo.tabManualBalancers">Балансировщики из Исходящих</span>`,
		`data-i18n="mihomo.tabSubscriptionBalancers">Балансировщики из Подписок</span>`,
	} {
		if !strings.Contains(html, expected) {
			t.Errorf("missing descriptive Russian balancer tab label: %s", expected)
		}
	}
	i18n, err := webFS.ReadFile("web/i18n.js")
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"mihomo.tabManualBalancers", "mihomo.tabSubscriptionBalancers"} {
		if !strings.Contains(string(i18n), key) {
			t.Errorf("tab label missing translation key %s", key)
		}
	}
	if strings.Contains(manual, "Подписки балансировщиков") {
		t.Error("provider subscription cards must not appear in manual balancers pane")
	}
}

func TestSubscriptionBalancerFilteringAccountsForProviderGroupField(t *testing.T) {
	content, err := webFS.ReadFile("web/mihomo-settings.js")
	if err != nil {
		t.Fatal(err)
	}
	js := string(content)
	for _, part := range []string{
		"function subscriptionGroupNames()",
		"function isSubscriptionGroup(item)",
		"app.state?.state?.outboundSubscriptions",
		"subscriptionGroupNames().has(item.name)",
		"item.subscriptionIds||[]",
		"currentTab==='subscriptions'",
		"#mihomo-subscription-balancer-table",
		"entry.kind!=='group'||isSubscriptionGroup(entry)===isSubscriptionGroup(item)",
	} {
		if !strings.Contains(js, part) {
			t.Errorf("balancer classifier missing %q", part)
		}
	}
	source, err := webFS.ReadFile("web/outbound-subscriptions.js")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(source), "mui-balancer-subscriptions-loaded") {
		t.Error("asynchronously loaded subscriptions must refresh Mihomo's group classifier")
	}
}
