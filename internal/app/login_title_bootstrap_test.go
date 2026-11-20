package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLoginPageTitleIsLocalizedBeforeClientJavascript(t *testing.T) {
	page, err := webFS.ReadFile("web/login.html")
	if err != nil {
		t.Fatal(err)
	}
	source := string(page)
	if !strings.Contains(source, "<title>M-UI Fusion | Вход</title>") {
		t.Fatal("login source HTML must use the Russian title, never Chinese")
	}
	titleAt := strings.Index(source, "<title>")
	bootstrapAt := strings.Index(source, "const titles = {")
	stylesheetAt := strings.Index(source, "static/liquid-glass.css")
	if titleAt < 0 || bootstrapAt <= titleAt || stylesheetAt <= bootstrapAt {
		t.Fatal("title localization must execute directly after title, before CSS and UI scripts")
	}
	if !strings.Contains(source, "localStorage.getItem('mui-language')") ||
		!strings.Contains(source, "document.documentElement.dataset.defaultLanguage") {
		t.Fatal("the early title bootstrap must honor the user's saved browser and server locale")
	}

	manager := &CoreManager{dataDir: t.TempDir(), state: defaultState()}
	app := &App{manager: manager}
	locales := map[string]string{
		"ru": "Вход", "en": "Log In", "zh-CN": "登录", "zh-TW": "登入",
		"fa": "ورود", "ja": "ログイン", "vi": "Đăng nhập",
		"es": "Iniciar sesión", "tr": "Giriş", "uk": "Вхід", "pt-BR": "Entrar",
	}
	for lang, title := range locales {
		manager.state.Settings.Language = lang
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/login", nil)
		app.handleLoginPage(recorder, request)
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s: login code %d", lang, recorder.Code)
		}
		rendered := recorder.Body.String()
		expected := "<title>M-UI Fusion | " + title + "</title>"
		if !strings.Contains(rendered, expected) {
			t.Errorf("%s: server must pre-render first browser tab title %q", lang, expected)
		}
		if !strings.Contains(rendered, `<html lang="`+lang+`"`) {
			t.Errorf("%s: html language and title must match", lang)
		}
		if strings.Count(rendered, "<title>") != 1 {
			t.Errorf("%s: login should have only one title", lang)
		}
	}
}

// The welcome heading is a single localized element, not a timed carousel.
// Its logo should remain clearly visible under all UI theme overrides.
func TestLoginPageStableWelcomeAndScaledCat(t *testing.T) {
 page, err := webFS.ReadFile("web/login.html")
 if err != nil { t.Fatal(err) }
 html := string(page)
 for _, expected := range []string{
  "<h1 class=\"headline\" data-word=\"title\">Добро пожаловать</h1>",
  "document.querySelector('.headline').textContent = text.title;",
  "width: 77px;",
  "height: 77px;",
  "<img src=\"media/m-ui_logo.png?v=16\" alt=\"M-UI Fusion\" width=\"77\" height=\"77\">",
  "ru: { pageTitle:'M-UI Fusion | Вход', title:'Добро пожаловать'",
  "en: { pageTitle:'M-UI Fusion | Log In', title:'Welcome'",
 } {
  if !strings.Contains(html,expected) { t.Errorf("login UI missing expected fragment %q",expected) }
 }
 for _, obsolete := range []string{
  "rotateHeadline(",
  "data-word=\"hello\"",
  "words-wrapper",
  "setTimeout(() => rotateHeadline",
 } {
  if strings.Contains(html,obsolete) { t.Errorf("login still rotates welcome headline: %q",obsolete) }
 }
 if strings.Count(html,"<h1 class=\"headline\"") != 1 {
  t.Fatal("login page needs exactly one welcome heading")
 }
 for _, filename := range []string{"web/theme-shadcn.css","web/theme-md3.css"} {
  data,err:=webFS.ReadFile(filename)
  if err!=nil {t.Fatal(err)}
  if !strings.Contains(string(data), "body .brand-icon { filter: none !important; width: 77px !important; height: 77px !important; }") {
   t.Errorf("%s: theme forces a small cat logo",filename)
  }
 }
}

func TestSidebarHeaderThemeMenuAndInboundCaption(t *testing.T) {
 data,err:=webFS.ReadFile("web/index.html")
 if err!=nil {t.Fatal(err)}
 ui:=string(data)
 for _,want:=range []string{
  "class=\"sidebar-logo-img\" src=\"media/m-ui_logo.png?v=16\" alt=\"M-UI Fusion\" width=\"48\" height=\"48\"",
  "id=\"top-theme-menu\"","data-theme-choice=\"dark\"",
  "data-i18n=\"nav.light\">Светлая",
  "data-theme-choice=\"light\"",
  "data-i18n=\"nav.dark\">Тёмная",
  "data-i18n=\"nav.inbounds\">Входящие",
  "localStorage.setItem('mui-is-ultra-dark'",
 } {
  if !strings.Contains(ui,want){t.Errorf("sidebar/header theme UI missing %q",want)}
 }
 for _,old:=range []string{"id=\"sidebar-theme-control\"","id=\"sidebar-theme\"","sidebar-dark-toggle","sidebar-ultra-toggle","data-theme-choice=\"ultra\"","data-skin-choice=\"midnight\""} {
  if strings.Contains(ui,old) {t.Errorf("obsolete sidebar theme element remains %q",old)}
 }
 translations,err:=webFS.ReadFile("web/i18n.js")
 if err!=nil {t.Fatal(err)}
 if !strings.Contains(string(translations),"'nav.inbounds':'Входящие'") {
   t.Fatal("Russian inbounds menu label has not been renamed")
 }
 liquid,err:=webFS.ReadFile("web/liquid-optics.css")
 if err!=nil {t.Fatal(err)}
 if !strings.Contains(string(liquid),".sidebar-logo { width: 48px; height: 48px;") {
   t.Fatal("Liquid theme overrides the enlarged logo")
 }
}
