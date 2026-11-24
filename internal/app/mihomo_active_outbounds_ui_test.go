package app

import (
	"strings"
	"testing"
)

func TestActiveOutboundColumnKeepsCurrentWhileDelayTestMayFail(t *testing.T) {
	js, err := webFS.ReadFile("web/mihomo-settings.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(js)
	for _, required := range []string{
		"/api/mihomo/balancers/current",
		"outboundTableMarkup.get(box)!==markup",
		"paintOutboundTransientState(box,rows,showTraffic)",
		"paintActiveGroupResults()",
		"data-active-group=",
		"currentNodeMeta(name,group.current)",
		"displayedCurrentNode(groupName,current)",
		"paintCurrentGroupNode(node,name)",
		"MUICountryFlags?.createIcon?.(meta.code)",
		"Текущий исходящий",
		"Выбор для каждого соединения",
		"Тест задержки не прошёл",
		"if(['outbounds','balancers','subscriptions'].includes(currentTab))renderOutbounds()",
	} {
		if !strings.Contains(source, required) {
			t.Errorf("active outbound UI incomplete: %s", required)
		}
	}
	routes, err := webFS.ReadFile("web/index.html")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(routes), "mihomo-settings.js?v=136") {
		t.Fatal("outbounds view is not using the latest flag-stable UI")
	}
	css, err := webFS.ReadFile("web/mihomo-settings.css")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(css), "width:16px;height:11px") {
		t.Fatal("current outbound flag size did not change to 16x11")
	}
}
