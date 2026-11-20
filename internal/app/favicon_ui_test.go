package app

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSeparateTransparentCatAndFaviconAcrossPanel(t *testing.T) {
	const favicon = "rel=\"icon\" type=\"image/png\" sizes=\"64x64\" href=\"media/m-ui_favicon.png?v=16\""
	const touchIcon = "rel=\"apple-touch-icon\" href=\"media/m-ui_logo.png?v=16\""
	for _, filename := range []string{"web/index.html", "web/login.html", "web/subscription.html"} {
		data, err := webFS.ReadFile(filename)
		if err != nil {
			t.Fatal(err)
		}
		html := string(data)
		if strings.Count(html, favicon) != 1 || strings.Count(html, touchIcon) != 1 {
			t.Fatalf("%s: the favicon and the main Apple touch icon must be separate", filename)
		}
		if strings.Index(html, favicon) > strings.Index(html, "</head>") {
			t.Fatalf("%s: favicon must be in the head", filename)
		}
	}
	logo, err := webFS.ReadFile("web/media/m-ui_logo.png")
	if err != nil {
		t.Fatal(err)
	}
	square, err := webFS.ReadFile("web/media/m-ui_logo_square.png")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(logo, square) {
		t.Fatal("legacy square mascot must contain the new approved cat")
	}
	faviconData, err := webFS.ReadFile("web/media/m-ui_favicon.png")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(logo, faviconData) {
		t.Fatal("favicon must be separately optimized for its size, not reuse full-size logo bytes")
	}
	type asset struct {
		name string
		body []byte
		hash string
		size int
	}
	assets := []asset{
		{"m-ui_logo.png", logo, "c17360f82d2fe649a2ef3719019567b0961da58800ba6ca71332639eb175c6ff", 192},
		{"m-ui_favicon.png", faviconData, "47204047e1193d2edd22ba2d7944438e40f53793a9ca14566dc62ee644de62f1", 64},
	}
	manager := &CoreManager{state: State{Settings: Settings{PanelPath: "/panel/"}}}
	handler := (&App{manager: manager, session: "admin-session"}).panelRoutes(false)
	for _, asset := range assets {
		t.Run(asset.name, func(t *testing.T) {
			if got := fmt.Sprintf("%x", sha256.Sum256(asset.body)); got != asset.hash {
				t.Fatalf("unexpected mascot image hash: %s", got)
			}
			im, err := png.Decode(bytes.NewReader(asset.body))
			if err != nil {
				t.Fatal(err)
			}
			bounds := im.Bounds()
			if bounds.Dx() != asset.size || bounds.Dy() != asset.size {
				t.Fatalf("incorrect mascot dimensions: %v", bounds)
			}
			corners := []image.Point{{0, 0}, {asset.size - 1, 0}, {0, asset.size - 1}, {asset.size - 1, asset.size - 1}}
			for _, pt := range corners {
				_, _, _, alpha := im.At(pt.X, pt.Y).RGBA()
				if alpha != 0 {
					t.Fatalf("%s: background found at %v", asset.name, pt)
				}
			}
			_, _, _, centerAlpha := im.At(asset.size/2, asset.size/2).RGBA()
			if centerAlpha == 0 {
				t.Fatal("center of mascot should not be transparent")
			}
			req := httptest.NewRequest(http.MethodGet, "/panel/media/"+asset.name+"?v=16", nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" || !bytes.Equal(rec.Body.Bytes(), asset.body) {
				t.Fatalf("web server returned wrong asset: status=%d content-type=%s", rec.Code, rec.Header().Get("Content-Type"))
			}
		})
	}
}
