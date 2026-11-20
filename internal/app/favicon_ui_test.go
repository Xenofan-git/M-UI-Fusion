package app

import (
 "image"
 "image/png"
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTransparentCatIsFaviconForEveryPanelPage(t *testing.T) {
	const favicon = `rel="icon" type="image/png" sizes="192x192" href="media/m-ui_logo.png?v=13"`
	const touchIcon = `rel="apple-touch-icon" href="media/m-ui_logo.png?v=13"`
	for _, filename := range []string{"web/index.html", "web/login.html", "web/subscription.html"} {
		contents, err := webFS.ReadFile(filename)
		if err != nil {
			t.Fatal(err)
		}
		html := string(contents)
		if strings.Count(html, favicon) != 1 || strings.Count(html, touchIcon) != 1 {
			t.Errorf("%s: missing or duplicate transparent cat logo favicon/touch icon", filename)
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
		t.Fatal("embedded transparent cat logo is not a PNG")
	}
    // Both asset URLs must point to one tightly cropped transparent mascot.
    square, err := webFS.ReadFile("web/media/m-ui_logo_square.png")
    if err != nil { t.Fatal(err) }
    if !bytes.Equal(original, square) { t.Fatal("square asset differs from transparent cat") }
    catImg, err := png.Decode(bytes.NewReader(original))
    if err != nil { t.Fatal(err) }
    bounds := catImg.Bounds()
    if bounds.Dx()!=192 || bounds.Dy()!=192 { t.Fatalf("unexpected icon dimensions: %v",bounds) }
    for _,pt := range []image.Point{{0,0},{191,0},{0,191},{191,191}} {
      _,_,_,a := catImg.At(pt.X,pt.Y).RGBA()
      if a!=0 { t.Fatalf("corner %v contains a background (alpha=%d)",pt,a) }
    }
    if _,_,_,a := catImg.At(96,96).RGBA();a==0 {t.Fatal("transparent center instead of mascot")}
    minX,minY,maxX,maxY := 192,192,0,0
    for y:=0;y<192;y++ { for x:=0;x<192;x++ {
      _,_,_,a:=catImg.At(x,y).RGBA()
      if a>0 {
        if x<minX {minX=x}
        if x>maxX {maxX=x}
        if y<minY {minY=y}
        if y>maxY {maxY=y}
      }
    }}
    if minX>12 || minY>12 || maxX<179 || maxY<179 {
      t.Fatalf("too much surrounding space: %d,%d..%d,%d",minX,minY,maxX,maxY)
    }
	manager := &CoreManager{state: State{Settings: Settings{PanelPath: "/panel/"}}}
	handler := (&App{manager: manager, session: "admin-session"}).panelRoutes(false)
	req := httptest.NewRequest(http.MethodGet, "/panel/media/m-ui_logo.png?v=13", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" ||
		!bytes.Equal(rec.Body.Bytes(), original) {
		t.Fatalf("favicon content differs from panel's original cat image: status=%d content-type=%s", rec.Code, rec.Header().Get("Content-Type"))
	}
}
