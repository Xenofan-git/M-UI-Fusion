package app

import (
	"strings"
	"testing"
)

func TestRussianSourceMarkupAndFourPrimaryLanguageChoices(t *testing.T) {
	for _, filename := range []string{"web/index.html", "web/login.html"} {
		content, err := webFS.ReadFile(filename)
		if err != nil {
			t.Fatal(err)
		}
		s := string(content)
		if !strings.Contains(s, `<html lang="ru" data-default-language="ru"`) {
			t.Errorf("%s: Russian must be the first rendered HTML language", filename)
		}
		if !strings.Contains(s, `data-l10n-pending="1"`) ||
			!strings.Contains(s, `html[data-l10n-pending="1"] body {visibility:hidden}`) ||
			!strings.Contains(s, `removeAttribute('data-l10n-pending')`) {
			t.Errorf("%s: missing safe anti-flash localization gate", filename)
		}
		labels := []string{`value="ru"`, `value="en"`, `value="zh-CN"`, `value="fa"`}
		prior := -1
		for _, label := range labels {
			at := strings.Index(s, label)
			if at < 0 || at <= prior {
				t.Errorf("%s: locale option missing or not in preferred order %s", filename, label)
			}
			prior = at
		}
	}
	source, err := webFS.ReadFile("web/i18n.js")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(source), `document.documentElement.removeAttribute('data-l10n-pending')`) {
		t.Fatal("translation bootstrap must reveal the document after applying a locale")
	}
	index, err := webFS.ReadFile("web/index.html")
	if err != nil {
		t.Fatal(err)
	}
	js := string(index)
	for _, needle := range []string{
		`api('/api/language'`,
		`pendingLanguage=target`,
		`languageSaveQueue=languageSaveQueue.catch`,
		`if(pendingLanguage)return`,
		`changePanelLanguage(event.target.value)`,
	} {
		if !strings.Contains(js, needle) {
			t.Errorf("instant persisted language switch missing %q", needle)
		}
	}
}
