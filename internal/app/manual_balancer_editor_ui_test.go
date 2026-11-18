package app

import (
	"strings"
	"testing"
)

func TestManualBalancerEditorUsesSharedServerTable(t *testing.T) {
	js, err := webFS.ReadFile("web/mihomo-balancer-servers.js")
	if err != nil {
		t.Fatal(err)
	}
	ui := string(js)
	for _, required := range []string{
		"context.subscribed?'Серверы подписки':'Серверы балансировщика'",
		"if(!context.subscribed)return context.available",
		"const selectedNames=Array.from(nativeSelect.selectedOptions",
		"function selectedSources",
		"if(ctx.subscribed)",
		"const remote=new Map((data.nodes||[]).map",
		"Добавить Outbound",
		"fbs-add-search",
		"fbs-add-result",
		"fbs-candidate",
		"fbs-probe",
		"fbs-native-members",
		"context?.subscribed&&panel?Array.from(excluded):null",
	} {
		if !strings.Contains(ui, required) {
			t.Errorf("missing shared/manual editor behavior %q", required)
		}
	}
	doc, err := webFS.ReadFile("web/index.html")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(doc), "static/mihomo-balancer-servers.js") {
		t.Error("shared server manager script not loaded by Mihomo Settings")
	}
	parent, err := webFS.ReadFile("web/mihomo-settings.js")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(parent), "persistedName:editingOriginal?.id?editingOriginal.name:''") {
		t.Error("unsaved manual balancers must not query persisted runtime groups")
	}
}
