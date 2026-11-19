package app

import (
 "strings"
 "testing"
)

func TestGeoRoutingRuleEditorPreservesAdvancedRules(t *testing.T) {
 js,err:=webFS.ReadFile("web/mihomo-settings.js")
 if err!=nil {t.Fatal(err)}
 text:=string(js)
 for _,v:=range []string{
  "mihomo-rule-lists","name=\"geoCategories\"","name=\"domainIPs\"",
  "Выбрать из списка","mihomo-geo-picker-list","loadGeoCategories()",
  "window.MUIRuleLists.compile(", "const decoded=window.MUIRuleLists?.decode(item)",
  "name=\"payload\"","value=\"LIST\"","data-i18n=\"mh.colRuleType\"",
  "data-i18n=\"mh.colOutbound\"",
 } { if !strings.Contains(text,v) {t.Errorf("missing routing UI component: %s",v)} }
 html,err:=webFS.ReadFile("web/index.html")
 if err!=nil {t.Fatal(err)}
 if !strings.Contains(string(html), "static/mihomo-rule-lists.js") {t.Fatal("missing routing editor compiler script")}
 if !strings.Contains(string(html),"data-mihomo-pane=\"routing\"") {t.Fatal("existing routing tab removed")}
}
