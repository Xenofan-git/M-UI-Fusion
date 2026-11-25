package app

import (
	"context"
	"net/http"
	"strings"
	"time"
)

// The active member of a group is Mihomo's runtime "now" value, not the
// result of an HTTP delay test. URLTest/Fallback/Select report one active
// choice. LoadBalance selects per connection and may not have one "now".
type mihomoCurrentOutbound struct {
	NoAvailable        bool   `json:"noAvailable,omitempty"`
	CurrentUnavailable bool   `json:"currentUnavailable,omitempty"`
	Current            string `json:"current,omitempty"`
	Applied            bool   `json:"applied"`
	PerConnection      bool   `json:"perConnection,omitempty"`
}

type mihomoCurrentOutbounds struct {
	Running bool                             `json:"running"`
	Groups  map[string]mihomoCurrentOutbound `json:"groups"`
}

func currentOutboundsFromRuntime(state State, runtime map[string]balancerRuntimeProxy, running bool) mihomoCurrentOutbounds {
	result := mihomoCurrentOutbounds{Running: running, Groups: make(map[string]mihomoCurrentOutbound)}
	for _, group := range state.Outbounds {
		if group.Kind != "group" {
			continue
		}
		entry := mihomoCurrentOutbound{}
		if running {
			if live, ok := runtime[group.Name]; ok {
				entry.Applied = true
				entry.NoAvailable = allBalancerMembersOffline(group, runtime)
				selected := strings.TrimSpace(live.Now)
				// Only members of the persisted group are valid: never show a
				// stale result from another live configuration.
				if selected != "" && containsString(group.Proxies, selected) {
					if !entry.NoAvailable {
						entry.Current = selected
						entry.CurrentUnavailable = runtimeProxyOffline(runtime, selected)
					}
				} else if strings.EqualFold(group.Type, "load-balance") {
					entry.PerConnection = true
				}
			}
		}
		result.Groups[group.Name] = entry
	}
	return result
}

func (a *App) handleMihomoCurrentOutbounds(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Message: "method not allowed"})
		return
	}
	a.manager.mu.Lock()
	state := a.manager.state
	running := a.manager.runningLocked()
	a.manager.mu.Unlock()
	result := currentOutboundsFromRuntime(state, nil, false)
	if running {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		runtime, err := fetchBalancerRuntime(ctx, state.Settings.APIAddress, state.Settings.APISecret)
		if err == nil {
			result = currentOutboundsFromRuntime(state, runtime, true)
		}
	}
	writeJSON(w, http.StatusOK, apiResponse{OK: true, Data: result})
}
