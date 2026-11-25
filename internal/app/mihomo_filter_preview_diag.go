package app

import (
	"encoding/json"
	"log"
	"net/http"
)

// Only aggregate UI measurements are accepted. No proxy names, filters,
// subscription links, IP addresses or browser URL are recorded.
type mihomoFilterPreviewDiagnostic struct {
	Phase         string `json:"phase"`
	Event         string `json:"event"`
	USA           bool   `json:"usa"`
	HasSource     bool   `json:"hasSource"`
	SourceMatches bool   `json:"sourceMatches"`
	Draft         bool   `json:"draft"`
	Touched       bool   `json:"touched"`
	Rows          int    `json:"rows"`
	USRows        int    `json:"usRows"`
	Crossed       int    `json:"crossed"`
	CrossedUS     int    `json:"crossedUs"`
	CSSCrossedUS  int    `json:"cssCrossedUs"`
	Inputs        int    `json:"inputs"`
	Error         bool   `json:"error"`
}

func (a *App) handleMihomoFilterPreviewDiagnostic(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Message: "method not allowed"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2048)
	defer r.Body.Close()
	var d mihomoFilterPreviewDiagnostic
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&d); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Message: "invalid diagnostic"})
		return
	}
	validPhase := map[string]bool{"noticed": true, "before": true, "after": true, "later": true, "error": true}
	validEvent := map[string]bool{"watch": true, "input": true, "change": true, "keyup": true, "none": true}
	if !validPhase[d.Phase] || !validEvent[d.Event] ||
		d.Rows < 0 || d.Rows > 10000 || d.USRows < 0 || d.USRows > d.Rows ||
		d.Crossed < 0 || d.Crossed > d.Rows || d.CrossedUS < 0 ||
		d.CrossedUS > d.USRows || d.CSSCrossedUS < 0 || d.CSSCrossedUS > d.USRows ||
		d.Inputs < 0 || d.Inputs > 20 {
		writeJSON(w, http.StatusBadRequest, apiResponse{Message: "invalid diagnostic"})
		return
	}
	log.Printf("MUI_FILTER_PREVIEW_DIAG phase=%s event=%s usa=%t source=%t sourceMatches=%t draft=%t touched=%t rows=%d usRows=%d crossed=%d crossedUs=%d cssCrossedUs=%d inputs=%d error=%t",
		d.Phase, d.Event, d.USA, d.HasSource, d.SourceMatches, d.Draft, d.Touched, d.Rows, d.USRows, d.Crossed, d.CrossedUS, d.CSSCrossedUS, d.Inputs, d.Error)
	writeJSON(w, http.StatusOK, apiResponse{OK: true})
}
