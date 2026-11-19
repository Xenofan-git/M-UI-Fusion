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


func TestGeoCategoryPickerUsesStackedFullWidthSearch(t *testing.T) {
 js,err:=webFS.ReadFile("web/mihomo-settings.js")
 if err!=nil {t.Fatal(err)}
 source:=string(js)
 start:=strings.Index(source, "mihomo-geo-picker-filter")
 if start<0 {t.Fatal("geo picker toolbar missing")}
 end:=strings.Index(source[start:], "</div>")
 if end<0 {t.Fatal("geo picker toolbar not closed")}
 toolbar:=source[start:start+end]
 selectPos:=strings.Index(toolbar, "mihomo-geo-picker-source")
 searchPos:=strings.Index(toolbar, "mihomo-geo-picker-search")
 if selectPos<0||searchPos<0||selectPos>=searchPos {
   t.Fatalf("the GeoSite/GeoIP filter must be above the category search, select=%d search=%d",selectPos,searchPos)
 }
 if !strings.Contains(toolbar, "mihomo-geo-picker-search-label") {
   t.Fatal("category search needs its own full-width label, not a tiny adjacent input")
 }
 cssData,err:=webFS.ReadFile("web/mihomo-settings.css")
 if err!=nil {t.Fatal(err)}
 css:=string(cssData)
 for _,expected:=range []string{
   ".mihomo-geo-picker-filter{display:flex;flex-direction:column;align-items:stretch;",
   ".mihomo-geo-picker-filter select,.mihomo-geo-picker-filter input{",
   "display:block;width:100%;min-width:0;box-sizing:border-box;",
 } {
   if !strings.Contains(css,expected) {t.Errorf("missing stacked search style %q",expected)}
 }
}
