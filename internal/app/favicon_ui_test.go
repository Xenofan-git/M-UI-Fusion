package app

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOriginalPanelCatIsFaviconForEveryPanelPage(t *testing.T) {
	const favicon = `rel="icon" type="image/png" sizes="1024x1024" href="media/m-ui_logo.png?v=12"`
	const touchIcon = `rel="apple-touch-icon" href="media/m-ui_logo.png?v=12"`
	for _, filename := range []string{"web/index.html", "web/login.html", "web/subscription.html"} {
		contents, err := webFS.ReadFile(filename)
		if err != nil {
			t.Fatal(err)
		}
		html := string(contents)
		if strings.Count(html, favicon) != 1 || strings.Count(html, touchIcon) != 1 {
			t.Errorf("%s: missing or duplicate original cat logo favicon/touch icon", filename)
		}
		if strings.Index(html, favicon) > strings.Index(html, "</head>") {
			t.Errorf("%s: favicon outside head", filename)
		}
	}
	original, err := webFS.ReadFile("web/media/m-ui_logo.png")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(original, []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}) {
		t.Fatal("embedded original cat logo is not a PNG")
	}
	manager := &CoreManager{state: State{Settings: Settings{PanelPath: "/panel/"}}}
	handler := (&App{manager: manager, session: "admin-session"}).panelRoutes(false)
	req := httptest.NewRequest(http.MethodGet, "/panel/media/m-ui_logo.png?v=12", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" ||
		!bytes.Equal(rec.Body.Bytes(), original) {
		t.Fatalf("favicon content differs from panel's original cat image: status=%d content-type=%s", rec.Code, rec.Header().Get("Content-Type"))
	}
}
