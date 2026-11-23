package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMihomoFilterPreviewDiagnosticsAggregateOnly(t *testing.T) {
	a := &App{}
	valid := "{\"phase\":\"after\",\"event\":\"input\",\"usa\":true,\"hasSource\":true,\"sourceMatches\":true,\"draft\":true,\"touched\":true,\"rows\":133,\"usRows\":17,\"crossed\":31,\"crossedUs\":17,\"cssCrossedUs\":17,\"inputs\":1,\"error\":false}"
	tests := []struct {
		name, method, body string
		want               int
	}{
		{"valid", http.MethodPost, valid, http.StatusOK},
		{"getRejected", http.MethodGet, valid, http.StatusMethodNotAllowed},
		{"rawNameRejected", http.MethodPost, "{\"phase\":\"after\",\"event\":\"input\",\"rows\":1,\"usRows\":1,\"name\":\"secret-node\"}", http.StatusBadRequest},
		{"tooManyRows", http.MethodPost, "{\"phase\":\"after\",\"event\":\"input\",\"rows\":10001}", http.StatusBadRequest},
		{"unknownPhase", http.MethodPost, "{\"phase\":\"custom\",\"event\":\"input\"}", http.StatusBadRequest},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "/api/mihomo/diagnostics/filter-preview", strings.NewReader(tc.body))
			resp := httptest.NewRecorder()
			a.handleMihomoFilterPreviewDiagnostic(resp, req)
			if resp.Code != tc.want {
				t.Fatalf("status %d want %d: %s", resp.Code, tc.want, resp.Body.String())
			}
		})
	}
}
