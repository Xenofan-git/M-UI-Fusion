package app

import (
	"strings"
	"testing"
)

func TestSubscriptionCardsShowThreePerRowOnWideScreens(t *testing.T) {
	cssRaw, err := webFS.ReadFile("web/outbound-subscriptions.css")
	if err != nil {
		t.Fatal(err)
	}
	css := string(cssRaw)
	for _, part := range []string{
		".outsub-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));max-width:1254px;",
		".outsub-card{display:flex;flex-direction:column;gap:10px;width:100%;max-width:410px;",
		"width:100%;max-width:410px;",
		"@media(max-width:1060px){.outsub-list{grid-template-columns:repeat(2,minmax(0,1fr));max-width:832px}}",
		"@media(max-width:700px){.outsub-list{grid-template-columns:minmax(0,1fr);max-width:410px}}",
	} {
		if !strings.Contains(css, part) {
			t.Errorf("missing compact subscription frame layout: %s", part)
		}
	}
	if strings.Contains(css, "max-width:600px") || strings.Contains(css, "flex:0 1 600px") {
		t.Fatal("the former 600px single-card layout must not remain")
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
