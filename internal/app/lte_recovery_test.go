package app

import (
	"encoding/json"
	"testing"
	"time"
)

func TestLTERecoveryRetrySchedule(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	s := OutboundSubscription{Enabled: true, IntervalMinutes: 1440, LastAttempt: now.Format(time.RFC3339), LastError: "offline"}
	for i, min := range []int{1, 1, 2, 4, 5, 5} {
		s.RetryFailures = i
		if subscriptionRefreshDue(s, now.Add(time.Duration(min)*time.Minute-time.Second)) || !subscriptionRefreshDue(s, now.Add(time.Duration(min)*time.Minute)) {
			t.Fatalf("failure %d retry %d", i, min)
		}
	}
	s.LastError = ""
	s.RetryFailures = 0
	if subscriptionRefreshDue(s, now.Add(5*time.Minute)) || !subscriptionRefreshDue(s, now.Add(24*time.Hour)) {
		t.Fatal("normal cadence changed")
	}
	s.Enabled = false
	if subscriptionRefreshDue(s, now.Add(48*time.Hour)) {
		t.Fatal("disabled source scheduled")
	}
}
func TestLTERecoveryUnavailableRuntime(t *testing.T) {
	var runtime map[string]balancerRuntimeProxy
	if e := json.Unmarshal([]byte(`{"G":{"now":"A"},"A":{"alive":false,"history":[{"time":"2026-11-25T10:00:00Z","delay":0}]},"B":{"alive":false,"history":[{"time":"2026-11-25T10:00:00Z","delay":0}]}}`), &runtime); e != nil {
		t.Fatal(e)
	}
	g := MihomoOutbound{Name: "G", Kind: "group", Type: "url-test", Proxies: []string{"A", "B"}}
	s := State{Outbounds: []MihomoOutbound{g}}
	if r := currentOutboundsFromRuntime(s, runtime, true).Groups["G"]; !r.NoAvailable || r.Current != "" {
		t.Fatalf("%+v", r)
	}
	if r := buildBalancerStatus(g, nil, nil, runtime, true); !r.NoAvailable || r.Candidate != "" {
		t.Fatalf("%+v", r)
	}
	delete(runtime, "B")
	if r := currentOutboundsFromRuntime(s, runtime, true).Groups["G"]; r.NoAvailable || !r.CurrentUnavailable {
		t.Fatalf("%+v", r)
	}
	b := true
	runtime["A"] = balancerRuntimeProxy{Alive: &b}
	if r := currentOutboundsFromRuntime(s, runtime, true).Groups["G"]; r.NoAvailable || r.CurrentUnavailable || r.Current != "A" {
		t.Fatalf("%+v", r)
	}
	if r := mihomoProxyGroupConfig(g); r["lazy"] != false {
		t.Fatal(r)
	}
}
