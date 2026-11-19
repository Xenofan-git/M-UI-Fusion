package app

import (
	"strings"
	"testing"
)

func TestSubscriptionCardsUseCompactFramedInformation(t *testing.T) {
	index, err := webFS.ReadFile("web/index.html")
	if err != nil {
		t.Fatal(err)
	}
	html := string(index)
	start := strings.Index(html, `<div class="outsub-page" id="outsub-root">`)
	if start < 0 {
		t.Fatal("subscription list root missing")
	}
	end := strings.Index(html[start:], `<div class="mihomo-pane" data-mihomo-pane="routing"`)
	if end < 0 {
		t.Fatal("subscription list tab ends unexpectedly")
	}
	section := html[start : start+end]
	if strings.Contains(section, "Подписки балансировщиков") {
		t.Fatal("redundant subscriptions heading still present")
	}
	if !strings.Contains(section, `class="outsub-summary"`) ||
		!strings.Contains(section, "Все узлы автоматически добавляются в Outbounds") ||
		!strings.Contains(section, `class="outsub-status" id="outsub-status"`) ||
		!strings.Contains(section, `id="outsub-reload"`) ||
		!strings.Contains(section, `id="outsub-list"`) {
		t.Fatal("compact introduction, count, reload and list must remain")
	}
	body, err := webFS.ReadFile("web/outbound-subscriptions.js")
	if err != nil {
		t.Fatal(err)
	}
	script := string(body)
	for _, marker := range []string{
		`const info=make('div','outsub-info-frame')`,
		`info.appendChild(title)`,
		`info.appendChild(stats)`,
		`card.appendChild(info)`,
		`card.appendChild(actions)`,
		`['Обновить','refresh']`,
		`['Фильтры и настройки','edit']`,
		`['Удалить','delete']`,
	} {
		if !strings.Contains(script, marker) {
			t.Errorf("missing card data/actions marker: %s", marker)
		}
	}
	start = strings.Index(script, `function renderList(){`)
	end = strings.Index(script[start:], `async function load(){`)
	if end < 0 {
		t.Fatal("missing renderList boundary")
	}
	renderer := script[start : start+end]
	if strings.Index(renderer, `card.appendChild(actions)`) < strings.Index(renderer, `card.appendChild(info)`) {
		t.Fatal("actions must follow, not appear inside, information frame")
	}
	sheet, err := webFS.ReadFile("web/outbound-subscriptions.css")
	if err != nil {
		t.Fatal(err)
	}
	css := string(sheet)
	for _, marker := range []string{
		".outsub-summary{", ".outsub-info-frame{", ".outsub-card{",
		".outsub-actions{", "@media(max-width:700px)",
	} {
		if !strings.Contains(css, marker) {
			t.Errorf("missing compact card layout style: %s", marker)
		}
	}
}
