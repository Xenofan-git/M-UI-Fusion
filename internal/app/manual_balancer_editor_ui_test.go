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

func TestManualBalancerDefaultsAndSubscriptionUISeparation(t *testing.T) {
    js, err := webFS.ReadFile("web/mihomo-settings.js")
    if err != nil { t.Fatal(err) }
    ui := string(js)
    for _, required := range []string{
        "const newManualBalancerDefaults=()=>({",
        "interval:180,timeout:8000,tolerance:100,disableUdp:false",
        "testUrl:defaultTestURL",
        "...newManualBalancerDefaults()",
        "editingSubscriptionGroup=(requestedItem?.kind||requestedKind)==='group'",
        "&&currentTab==='subscriptions'",
        "balancerSubscriptions=[];",
        "if(editingSubscriptionGroup){",
        "field.classList.contains('mihomo-subscription-field')&&!editingSubscriptionGroup",
        "subscriptionIds:editingSubscriptionGroup?selectedIDs:[]",
        "subscriptionIds:kind==='group'&&editingSubscriptionGroup?",
        "const groupSubscriptionIDs=editingSubscriptionGroup",
        "response.outbounds[0].subscriptionIds=groupSubscriptionIDs",
        "else item.excludedSubscriptionMembers=[];",
        "return String((item.proxies||[]).length)+' исходящих'",
    } {
        if !strings.Contains(ui,required) { t.Errorf("missing manual balancer behavior %q",required) }
    }
}
