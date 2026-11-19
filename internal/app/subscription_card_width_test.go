package app

import (
	"strings"
	"testing"
)

func TestSubscriptionCardsStayCompactOnWideScreens(t *testing.T) {
	cssRaw, err := webFS.ReadFile("web/outbound-subscriptions.css")
	if err != nil {
		t.Fatal(err)
	}
	css := string(cssRaw)
	for _, part := range []string{
		".outsub-list{display:flex;flex-wrap:wrap;align-items:flex-start;",
		".outsub-card{display:flex;flex:0 1 600px;",
		"width:min(100%,600px);max-width:600px;",
		"@media(max-width:640px){.outsub-card{flex-basis:100%;max-width:100%}}",
	} {
		if !strings.Contains(css, part) {
			t.Errorf("missing compact subscription frame layout: %s", part)
		}
	}
	if strings.Contains(css, ".outsub-list{display:grid;grid-template-columns:repeat(auto-fit") {
		t.Fatal("auto-fit subscription grid stretches a single card across the panel")
	}
	htmlRaw, err := webFS.ReadFile("web/index.html")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(htmlRaw), `id="outsub-list"`) {
		t.Fatal("Mihomo subscription UI needs the original list container")
	}
	jsRaw, err := webFS.ReadFile("web/outbound-subscriptions.js")
	if err != nil {
		t.Fatal(err)
	}
	js := string(jsRaw)
	if !strings.Contains(js, "const info=make('div','outsub-info-frame')") || !strings.Contains(js, "card.appendChild(info)") {
		t.Fatal("the framed information card must remain inside the width-constrained item")
	}
}
