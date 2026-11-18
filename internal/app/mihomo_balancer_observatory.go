package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type balancerRuntimeProxy struct {
	Name    string `json:"name"`
	Now     string `json:"now"`
	Alive   *bool  `json:"alive"`
	History []struct {
		Delay int    `json:"delay"`
		Time  string `json:"time"`
	} `json:"history"`
}
type balancerStatusNode struct {
	Name        string `json:"name"`
	Protocol    string `json:"protocol"`
	SourceID    string `json:"sourceId"`
	Flag        string `json:"flag,omitempty"`
	CountryCode string `json:"countryCode,omitempty"`
	Member      bool   `json:"member"`
	Alive       *bool  `json:"alive,omitempty"`
	Delay       int    `json:"delay,omitempty"`
	CheckedAt   string `json:"checkedAt,omitempty"`
}
type balancerStatusResponse struct {
	Group     string               `json:"group"`
	Candidate string               `json:"candidate,omitempty"`
	Available bool                 `json:"available"`
	Nodes     []balancerStatusNode `json:"nodes"`
	Sources   []string             `json:"sources"`
	Message   string               `json:"message,omitempty"`
}

func balancerSubscriptionSnapshot(state State, name string) (MihomoOutbound, []OutboundSubscription, []MihomoOutbound, bool) {
	var group MihomoOutbound
	ok := false
	for _, x := range state.Outbounds {
		if x.Kind == "group" && x.Name == name {
			group = x
			ok = true
			break
		}
	}
	if !ok {
		return group, nil, nil, false
	}
	linked := make(map[string]bool)
	subs := []OutboundSubscription{}
	for _, sub := range state.OutboundSubscriptions {
		if sub.Group == name || containsString(group.SubscriptionIDs, sub.ID) {
			linked[sub.ID] = true
			subs = append(subs, sub)
		}
	}
	if len(subs) == 0 {
		return group, nil, nil, false
	}
	nodes := []MihomoOutbound{}
	for _, x := range state.Outbounds {
		if x.Kind == "proxy" && linked[x.SourceSubscriptionID] {
			nodes = append(nodes, x)
		}
	}
	return group, subs, nodes, true
}
func fetchBalancerRuntime(ctx context.Context, endpoint, secret string) (map[string]balancerRuntimeProxy, error) {
	if endpoint == "" {
		return nil, fmt.Errorf("Mihomo API не настроен")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+endpoint+"/proxies", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+secret)
	client := &http.Client{Timeout: 6 * time.Second}
	response, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil, fmt.Errorf("Mihomo API HTTP %d", response.StatusCode)
	}
	var data struct {
		Proxies map[string]balancerRuntimeProxy `json:"proxies"`
	}
	err = json.NewDecoder(io.LimitReader(response.Body, 5<<20)).Decode(&data)
	return data.Proxies, err
}
func buildBalancerStatus(group MihomoOutbound, sources []OutboundSubscription, nodes []MihomoOutbound, runtime map[string]balancerRuntimeProxy, available bool) balancerStatusResponse {
	members := make(map[string]bool, len(group.Proxies))
	for _, name := range group.Proxies {
		members[name] = true
	}
	result := balancerStatusResponse{Group: group.Name, Available: available, Nodes: make([]balancerStatusNode, 0, len(nodes)), Sources: make([]string, 0, len(sources))}
	if runtimeGroup, ok := runtime[group.Name]; ok {
		result.Candidate = runtimeGroup.Now
	}
	for _, src := range sources {
		result.Sources = append(result.Sources, src.Name)
	}
	for _, node := range nodes {
		cc := subscriptionCountryCode(node.Name)
		item := balancerStatusNode{Name: node.Name, Protocol: node.Type, SourceID: node.SourceSubscriptionID,
			Flag: subscriptionCountryFlag(cc), CountryCode: cc, Member: members[node.Name]}
		if live, ok := runtime[node.Name]; ok {
			item.Alive = live.Alive
			if len(live.History) > 0 {
				recent := live.History[len(live.History)-1]
				item.Delay = recent.Delay
				item.CheckedAt = recent.Time
			}
		}
		result.Nodes = append(result.Nodes, item)
	}
	return result
}
func (a *App) handleMihomoBalancerStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		writeJSON(w, 405, apiResponse{Message: "method not allowed"})
		return
	}
	name := r.URL.Query().Get("group")
	if name == "" || len(name) > 128 {
		writeJSON(w, 400, apiResponse{Message: "имя балансировщика некорректно"})
		return
	}
	a.manager.mu.Lock()
	state := a.manager.state
	group, sources, nodes, ok := balancerSubscriptionSnapshot(state, name)
	running := a.manager.runningLocked()
	a.manager.mu.Unlock()
	if !ok {
		writeJSON(w, 404, apiResponse{Message: "подписочный балансировщик не найден"})
		return
	}
	result := buildBalancerStatus(group, sources, nodes, nil, false)
	if !running {
		result.Message = "Mihomo остановлен — данные сохранённой подписки доступны"
	}
	if running {
		ctx, cancel := context.WithTimeout(r.Context(), 7*time.Second)
		defer cancel()
		runtime, err := fetchBalancerRuntime(ctx, state.Settings.APIAddress, state.Settings.APISecret)
		if err == nil {
			result = buildBalancerStatus(group, sources, nodes, runtime, true)
		} else {
			result.Message = "Состояние Mihomo временно недоступно"
		}
	}
	writeJSON(w, 200, apiResponse{OK: true, Data: result})
}

type balancerProbeRequest struct {
	Group string   `json:"group"`
	Names []string `json:"names"`
}
type balancerProbeResult struct {
	Ping   int    `json:"ping,omitempty"`
	Name   string `json:"name,omitempty"`
	Delay  int    `json:"delay,omitempty"`
	Alive  bool   `json:"alive"`
	Error  string `json:"error,omitempty"`
	Done   bool   `json:"done,omitempty"`
	Tested int    `json:"tested,omitempty"`
	Total  int    `json:"total,omitempty"`
}

// ICMP echo to the proxy host is informational only. VPN health is
// determined exclusively by the Mihomo HTTP delay probe.
var balancerPingPattern = regexp.MustCompile(`time[=<]([0-9]+(?:[.][0-9]+)?) *ms`)

func balancerICMPPing(ctx context.Context, host string) int {
	host = strings.TrimSpace(host)
	if host == "" || len(host) > 253 || strings.HasPrefix(host, "-") {
		return 0
	}
	if net.ParseIP(host) == nil {
		for _, ch := range host {
			if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch == '-' || ch == '.') {
				return 0
			}
		}
	}
	pingCtx, cancel := context.WithTimeout(ctx, 1800*time.Millisecond)
	defer cancel()
	output, err := exec.CommandContext(pingCtx, "ping", "-n", "-c", "1", "-W", "1", host).Output()
	if err != nil {
		return 0
	}
	match := balancerPingPattern.FindStringSubmatch(string(output))
	if len(match) != 2 {
		return 0
	}
	latency, err := strconv.ParseFloat(match[1], 64)
	if err != nil || latency < 0 || latency > 3000 {
		return 0
	}
	return int(latency + 0.5)
}
func probeBalancerNode(ctx context.Context, apiAddress, secret, nodeName, testURL, host string) balancerProbeResult {
	result := balancerProbeResult{Name: nodeName}
	params := url.Values{"url": {testURL}, "timeout": {"5000"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+apiAddress+"/proxies/"+url.PathEscape(nodeName)+"/delay?"+params.Encode(), nil)
	if err != nil {
		result.Error = "некорректный запрос"
		return result
	}
	req.Header.Set("Authorization", "Bearer "+secret)
	client := &http.Client{Timeout: 7 * time.Second}
	response, err := client.Do(req)
	if err != nil {
		result.Error = "нет ответа"
		return result
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		result.Error = "offline"
		return result
	}
	var data struct {
		Delay int `json:"delay"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 2048)).Decode(&data); err != nil || data.Delay <= 0 {
		result.Error = "offline"
		return result
	}
	result.Delay = data.Delay
	result.Alive = true
	result.Ping = balancerICMPPing(ctx, host)
	return result
}
func (a *App) handleMihomoBalancerProbe(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost {
		writeJSON(w, 405, apiResponse{Message: "method not allowed"})
		return
	}
	var input balancerProbeRequest
	if err := decodeJSON(r, &input); err != nil {
		writeJSON(w, 400, apiResponse{Message: "некорректный запрос"})
		return
	}
	if input.Group == "" || len(input.Names) < 1 || len(input.Names) > 200 {
		writeJSON(w, 400, apiResponse{Message: "укажите от 1 до 200 узлов"})
		return
	}
	a.manager.mu.Lock()
	state := a.manager.state
	group, _, nodes, ok := balancerSubscriptionSnapshot(state, input.Group)
	running := a.manager.runningLocked()
	a.manager.mu.Unlock()
	if !ok {
		writeJSON(w, 404, apiResponse{Message: "подписочный балансировщик не найден"})
		return
	}
	if !running {
		writeJSON(w, 409, apiResponse{Message: "Mihomo не запущен"})
		return
	}
	members := make(map[string]bool, len(group.Proxies))
	for _, name := range group.Proxies {
		members[name] = true
	}
	allowed := make(map[string]string, len(nodes))
	for _, node := range nodes {
		if members[node.Name] {
			allowed[node.Name] = node.Server
		}
	}
	used := make(map[string]bool)
	for _, name := range input.Names {
		_, valid := allowed[name]
		if !valid || used[name] {
			writeJSON(w, 400, apiResponse{Message: "нельзя опросить узел, отсутствующий в активной группе"})
			return
		}
		used[name] = true
	}
	testURL := group.TestURL
	if testURL == "" {
		testURL = effectiveMihomoBasics(state).OutboundTestURL
	}
	if testURL == "" {
		testURL = defaultMihomoTestURL
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, 500, apiResponse{Message: "SSE недоступен"})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	jobQueue := make(chan string)
	results := make(chan balancerProbeResult, len(input.Names))
	var workers sync.WaitGroup
	count := 6
	if len(input.Names) < count {
		count = len(input.Names)
	}
	for i := 0; i < count; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for name := range jobQueue {
				child, release := context.WithTimeout(ctx, 8*time.Second)
				result := probeBalancerNode(child, state.Settings.APIAddress, state.Settings.APISecret, name, testURL, allowed[name])
				release()
				select {
				case results <- result:
				case <-ctx.Done():
					return
				}
			}
		}()
	}
	go func() {
		defer close(jobQueue)
		for _, name := range input.Names {
			select {
			case jobQueue <- name:
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() { workers.Wait(); close(results) }()
	sent := 0
	for result := range results {
		sent++
		data, _ := json.Marshal(result)
		if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
			cancel()
			return
		}
		flusher.Flush()
	}
	data, _ := json.Marshal(balancerProbeResult{Done: true, Tested: sent, Total: len(input.Names)})
	fmt.Fprintf(w, "data: %s\n\n", data)
	flusher.Flush()
}

// Filter a single subscription-owned group without consulting unrelated
// outbounds. This also controls the authorization boundary for node probing.
func validBalancerGroup(name string, group MihomoOutbound, sources []OutboundSubscription) bool {
	if strings.TrimSpace(name) == "" || group.Name != name {
		return false
	}
	return len(sources) > 0
}
