package app

import (
	"strings"
	"testing"
)

func TestMihomoTabIconsAreDistinctAndConsistent(t *testing.T) {
	doc, err := webFS.ReadFile("web/index.html")
	if err != nil {
		t.Fatal(err)
	}
	s := string(doc)
	beginning := strings.Index(s, `<div class="mihomo-tabs">`)
	if beginning < 0 {
		t.Fatal("Mihomo Settings tab bar missing")
	}
	ending := strings.Index(s[beginning:], `<span class="ink-bar" data-ink-for="mihomo">`)
	if ending < 0 {
		t.Fatal("Mihomo Settings tab bar ending missing")
	}
	bar := s[beginning : beginning+ending]
	tabs := []string{"basics", "outbounds", "balancers", "subscriptions", "routing"}
	if strings.Count(bar, `<svg class="mihomo-tab-glyph"`) != len(tabs) {
		t.Fatal("every tab must use a matching, independent SVG glyph")
	}
	if strings.Count(bar, `class="mihomo-tab-icon" aria-hidden="true"`) != len(tabs) {
		t.Fatal("every icon must be decorative, leaving the button label accessible")
	}
	for _, name := range tabs {
		marker := `data-mihomo-tab="` + name + `"`
		if strings.Count(bar, marker) != 1 {
			t.Errorf("missing or duplicate tab %s", name)
		}
	}
	if strings.Contains(bar, `#sf-cloud-upload`) || strings.Contains(bar, `#sf-sync`) {
		t.Fatal("legacy shared cloud/sync glyphs should not replace custom subscription circle")
	}
	begin := strings.Index(bar, `data-mihomo-tab="subscriptions"`)
	end := strings.Index(bar[begin:], `</button>`)
	subscribed := bar[begin : begin+end]
	if !strings.Contains(subscribed, `<circle cx="12" cy="12" r="8.7"`) ||
		!strings.Contains(subscribed, `M12 6.2v9.1`) {
		t.Fatal("subscription icon must be a ring with a downward arrow")
	}
	begin = strings.Index(bar, `data-mihomo-tab="balancers"`)
	end = strings.Index(bar[begin:], `</button>`)
	balanced := bar[begin : begin+end]
	if !strings.Contains(balanced, `M20 9a8.4`) || !strings.Contains(balanced, `M4 15a8.4`) {
		t.Fatal("balancer glyph must have two circulating arrows")
	}
	stylesheet, err := webFS.ReadFile("web/mihomo-settings.css")
	if err != nil {
		t.Fatal(err)
	}
	css := string(stylesheet)
	for _, rule := range []string{
		".mihomo-tabs .mihomo-tab-icon{",
		".mihomo-tabs .mihomo-tab-icon .mihomo-tab-glyph{",
		".mihomo-tabs .mihomo-tab:hover .mihomo-tab-icon{",
		".mihomo-tabs .mihomo-tab.active .mihomo-tab-icon{",
		"@media (prefers-reduced-motion:reduce)",
	} {
		if !strings.Contains(css, rule) {
			t.Errorf("missing icon style: %s", rule)
		}
	}
}
