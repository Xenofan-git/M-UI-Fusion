package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const smartHealthMarker = "# m-ui: smart-health-schedule-v1"

type SmartHealthSettings struct {
	Enabled         bool           `json:"enabled"`
	NormalSeconds   int            `json:"normalSeconds"`
	DegradedSeconds int            `json:"degradedSeconds"`
	OfflineSeconds  int            `json:"offlineSeconds"`
	Services        []string       `json:"services"`
	Catalog         []smartService `json:"catalog,omitempty"`
}
type smartService struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Protocol string `json:"protocol"`
	Host     string `json:"host"`
}

var smartServices = []smartService{
	{"yandex-doh", "Яндекс DNS", "DoH", "common.dot.dns.yandex.net"},
	{"yandex-dot", "Яндекс DNS", "DoT", "common.dot.dns.yandex.net"},
	{"yandex", "Яндекс", "HTTPS", "ya.ru"},
	{"vk", "ВКонтакте", "HTTPS", "vk.com"},
	{"mail", "Mail.ru", "HTTPS", "mail.ru"},
	{"ozon", "Ozon", "HTTPS", "ozon.ru"},
	{"wildberries", "Wildberries", "HTTPS", "wildberries.ru"},
	{"avito", "Авито", "HTTPS", "avito.ru"},
	{"gosuslugi", "Госуслуги", "HTTPS", "gosuslugi.ru"},
	{"mts", "МТС", "HTTPS", "mts.ru"},
	{"beeline", "Билайн", "HTTPS", "beeline.ru"},
}

func defaultSmartHealth() SmartHealthSettings {
	return SmartHealthSettings{Enabled: false, NormalSeconds: 180, DegradedSeconds: 60, OfflineSeconds: 10, Services: []string{"yandex-doh", "yandex-dot", "yandex", "vk", "mail", "ozon"}}
}
func effectiveSmartHealth(s State) SmartHealthSettings {
	if s.SmartHealth == nil {
		return defaultSmartHealth()
	}
	result := *s.SmartHealth
	result.Services = slices.Clone(result.Services)
	result.Catalog = slices.Clone(result.Catalog)
	return result
}
func (s SmartHealthSettings) catalog() []smartService {
	if s.Catalog == nil {
		return slices.Clone(smartServices)
	}
	return slices.Clone(s.Catalog)
}

var smartServiceID = regexp.MustCompile("^[a-zA-Z0-9_-]{1,64}$")
var smartHostLabel = regexp.MustCompile("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")

func smartValidHost(host string) bool {
	if len(host) > 253 || net.ParseIP(host) != nil || strings.ToLower(host) != host {
		return false
	}
	labels := strings.Split(host, ".")
	if len(labels) < 2 {
		return false
	}
	for _, label := range labels {
		if !smartHostLabel.MatchString(label) {
			return false
		}
	}
	last := labels[len(labels)-1]
	if len(last) < 2 || !strings.ContainsAny(last, "abcdefghijklmnopqrstuvwxyz") {
		return false
	}
	for _, suffix := range []string{"local", "localhost", "internal", "lan", "home", "test", "invalid", "example", "onion"} {
		if last == suffix {
			return false
		}
	}
	return true
}
func validateSmartHealth(s SmartHealthSettings) error {
	if s.NormalSeconds < 30 || s.NormalSeconds > 3600 || s.DegradedSeconds < 10 || s.DegradedSeconds > s.NormalSeconds || s.OfflineSeconds < 5 || s.OfflineSeconds > s.DegradedSeconds {
		return fmt.Errorf("Интервалы: штатный 30–3600 сек., ускоренный 10–штатный, аварийный 5–ускоренный")
	}
	if len(s.Services) == 0 {
		return fmt.Errorf("Выберите хотя бы один контрольный сервис")
	}
	catalog := s.catalog()
	if len(catalog) < 1 || len(catalog) > 32 {
		return fmt.Errorf("Каталог должен содержать от 1 до 32 сервисов")
	}
	ids := map[string]bool{}
	endpoints := map[string]bool{}
	for _, service := range catalog {
		key := service.Protocol + " " + service.Host
		if !smartServiceID.MatchString(service.ID) || ids[service.ID] || endpoints[key] || strings.TrimSpace(service.Name) == "" || len([]rune(service.Name)) > 80 || strings.ContainsAny(service.Name, "\r\n\t") || !slices.Contains([]string{"HTTPS", "DoH", "DoT"}, service.Protocol) || !smartValidHost(service.Host) {
			return fmt.Errorf("Некорректный или повторный контрольный сервис")
		}
		ids[service.ID] = true
		endpoints[key] = true
	}
	seen := map[string]bool{}
	for _, id := range s.Services {
		if seen[id] || !ids[id] {
			return fmt.Errorf("Неизвестный или повторный контрольный сервис")
		}
		seen[id] = true
	}
	return nil
}

type smartGroup struct {
	Name, URL string
	Timeout   int
	Members   map[string]bool
}
type smartPlan struct{ Groups []smartGroup }

func smartGroupMembers(g map[string]any) []string {
	switch values := g["proxies"].(type) {
	case []string:
		return values
	case []any:
		result := []string{}
		for _, v := range values {
			if name, ok := v.(string); ok {
				result = append(result, name)
			}
		}
		return result
	}
	return nil
}
func smartGroupPlan(proxies, groups []map[string]any) ([]smartGroup, []int) {
	actual := map[string]bool{}
	for _, p := range proxies {
		name, _ := p["name"].(string)
		kind, _ := p["type"].(string)
		if name != "" && kind != "" && !slices.Contains([]string{"direct", "reject", "reject-drop", "pass", "dns", "compatible"}, strings.ToLower(kind)) {
			actual[name] = true
		}
	}
	plan := []smartGroup{}
	indexes := []int{}
	for i, g := range groups {
		kind, _ := g["type"].(string)
		if !slices.Contains([]string{"url-test", "fallback", "load-balance", "select"}, kind) {
			continue
		}
		testURL, _ := g["url"].(string)
		if kind == "select" && testURL == "" {
			continue
		}
		// Complex provider or nested-group-only configurations stay native.
		if _, exists := g["use"]; exists {
			continue
		}
		if g["include-all"] == true || g["include-all-proxies"] == true || g["include-all-providers"] == true {
			continue
		}
		// The group API does not expose all native expected-status options.
		// Do not take over nondefault expected-status rules.
		if v, ok := g["expected-status"]; ok && fmt.Sprint(v) != "*" && fmt.Sprint(v) != "" {
			continue
		}
		name, _ := g["name"].(string)
		members := map[string]bool{}
		for _, n := range smartGroupMembers(g) {
			if actual[n] {
				members[n] = true
			}
		}
		if name == "" || len(members) == 0 {
			continue
		}
		timeout := 8000
		if v, err := strconv.Atoi(fmt.Sprint(g["timeout"])); err == nil && v > 0 && v <= 30000 {
			timeout = v
		}
		plan = append(plan, smartGroup{name, valueOr(testURL, defaultMihomoTestURL), timeout, members})
		indexes = append(indexes, i)
	}
	return plan, indexes
}

// Change only generated group maps, never the persisted Native maps or intervals.
func applySmartHealthSchedule(proxies, groups []map[string]any) []map[string]any {
	_, indexes := smartGroupPlan(proxies, groups)
	result := slices.Clone(groups)
	for _, i := range indexes {
		g := maps.Clone(result[i])
		g["interval"] = 0
		result[i] = g
	}
	return result
}
func smartPlanFromConfig(config []byte) *smartPlan {
	if !strings.Contains(string(config), "\n"+smartHealthMarker+"\n") {
		return nil
	}
	var cfg struct {
		Proxies []map[string]any `yaml:"proxies"`
		Groups  []map[string]any `yaml:"proxy-groups"`
	}
	if yaml.Unmarshal(config, &cfg) != nil {
		return nil
	}
	groups, indexes := smartGroupPlan(cfg.Proxies, cfg.Groups)
	for _, i := range indexes {
		if fmt.Sprint(cfg.Groups[i]["interval"]) != "0" {
			return nil
		}
	}
	return &smartPlan{Groups: groups}
}

type smartServiceResult struct {
	ID           string `json:"id"`
	OK           bool   `json:"ok"`
	Milliseconds int64  `json:"milliseconds"`
}
type smartEvent struct {
	At   time.Time `json:"at"`
	Mode string    `json:"mode"`
}
type smartStatus struct {
	Mode     string               `json:"mode"`
	Applied  bool                 `json:"applied"`
	Pending  bool                 `json:"pending"`
	Running  bool                 `json:"running"`
	Healthy  int                  `json:"healthy"`
	Groups   int                  `json:"groups"`
	Last     time.Time            `json:"last"`
	Next     time.Time            `json:"next"`
	Controls []smartServiceResult `json:"controls"`
	Events   []smartEvent         `json:"events"`
}
type smartRuntime struct {
	applied         *smartPlan
	settings        SmartHealthSettings
	lastPlan        *smartPlan
	lastCoreRunning bool
	status          smartStatus
}

func smartSettingsEqual(a, b SmartHealthSettings) bool {
	return a.Enabled == b.Enabled && a.NormalSeconds == b.NormalSeconds && a.DegradedSeconds == b.DegradedSeconds && a.OfflineSeconds == b.OfflineSeconds && slices.Equal(a.Services, b.Services) && slices.Equal(a.catalog(), b.catalog())
}
func (m *CoreManager) smartModeLocked(mode string) {
	s := &m.smartHealth.status
	if s.Mode == mode {
		return
	}
	s.Mode = mode
	s.Events = append(s.Events, smartEvent{time.Now(), mode})
	if len(s.Events) > 100 {
		s.Events = s.Events[len(s.Events)-100:]
	}
	m.addLogLocked("Smart Health Monitor: " + mode)
}
func (m *CoreManager) smartStatusLocked() smartStatus {
	s := m.smartHealth.status
	cfg := effectiveSmartHealth(m.state)
	s.Applied = m.smartHealth.applied != nil && m.runningLocked()
	s.Pending = m.runningLocked() && (cfg.Enabled != s.Applied)
	if s.Pending {
		s.Mode = "pending"
	} else if !cfg.Enabled {
		s.Mode = "disabled"
	} else if !m.runningLocked() {
		s.Mode = "core_unavailable"
	} else if s.Mode == "" {
		s.Mode = "starting"
	}
	if !cfg.Enabled || s.Pending {
		s.Running = false
	}
	s.Controls = slices.Clone(s.Controls)
	s.Events = slices.Clone(s.Events)
	return s
}
func (a *App) handleSmartHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	m := a.manager
	if r.Method == http.MethodPut {
		var input SmartHealthSettings
		if decodeJSON(r, &input) != nil {
			writeJSON(w, 400, apiResponse{Message: "Некорректные настройки"})
			return
		}
		m.mu.Lock()
		if input.Catalog == nil {
			input.Catalog = slices.Clone(effectiveSmartHealth(m.state).Catalog)
		}
		if err := validateSmartHealth(input); err != nil {
			m.mu.Unlock()
			writeJSON(w, 400, apiResponse{Message: err.Error()})
			return
		}
		old := m.state.SmartHealth
		m.state.SmartHealth = &input
		err := m.saveLocked()
		if err != nil {
			m.state.SmartHealth = old
		}
		m.mu.Unlock()
		if err != nil {
			writeJSON(w, 500, apiResponse{Message: "Не удалось сохранить настройки"})
			return
		}
	} else if r.Method != http.MethodGet {
		writeJSON(w, 405, apiResponse{Message: "method not allowed"})
		return
	}
	m.mu.Lock()
	settings, status := effectiveSmartHealth(m.state), m.smartStatusLocked()
	m.mu.Unlock()
	writeJSON(w, 200, apiResponse{OK: true, Data: map[string]any{"settings": settings, "status": status, "catalog": settings.catalog()}})
}
func smartLocalController(address string) (string, error) {
	host, port := hostPortFromAddress(address)
	if port == 0 {
		return "", fmt.Errorf("invalid port")
	}
	switch host {
	case "", "0.0.0.0", "localhost":
		host = "127.0.0.1"
	case "::":
		host = "::1"
	}
	if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
		return "", fmt.Errorf("not local")
	}
	return net.JoinHostPort(host, strconv.Itoa(port)), nil
}

type smartScanResult struct {
	Healthy map[string]bool
	Known   bool
}

func smartProbeGroup(ctx context.Context, address, secret string, g smartGroup) (map[string]bool, bool) {
	local, err := smartLocalController(address)
	if err != nil {
		return nil, false
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(g.Timeout)*time.Millisecond+3*time.Second)
	defer cancel()
	params := url.Values{"url": {g.URL}, "timeout": {strconv.Itoa(g.Timeout)}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+local+"/group/"+url.PathEscape(g.Name)+"/delay?"+params.Encode(), nil)
	if err != nil {
		return nil, false
	}
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	transport := &http.Transport{Proxy: nil, DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusGatewayTimeout {
		return nil, true
	}
	if resp.StatusCode != http.StatusOK {
		return nil, false
	}
	delays := map[string]int{}
	if json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&delays) != nil {
		return nil, false
	}
	result := map[string]bool{}
	for n, d := range delays {
		if d > 0 && g.Members[n] {
			result[n] = true
		}
	}
	return result, true
}
func smartScanGroups(ctx context.Context, plan *smartPlan, address, secret string) smartScanResult {
	result := smartScanResult{Healthy: map[string]bool{}, Known: true}
	if plan == nil || len(plan.Groups) == 0 {
		result.Known = false
		return result
	}
	// One group at a time avoids bursts across overlapping group membership.
	for _, group := range plan.Groups {
		if ctx.Err() != nil {
			result.Known = false
			break
		}
		healthy, known := smartProbeGroup(ctx, address, secret, group)
		for n := range healthy {
			result.Healthy[n] = true
		}
		result.Known = result.Known && known
	}
	return result
}
func smartNextMode(healthy int, known, controlOK bool) string {
	if healthy > 0 {
		return "normal"
	}
	if !known {
		return "unknown"
	}
	if controlOK {
		return "degraded"
	}
	return "offline"
}
func smartInterval(cfg SmartHealthSettings, mode string) time.Duration {
	seconds := cfg.DegradedSeconds
	if mode == "normal" {
		seconds = cfg.NormalSeconds
	}
	if mode == "offline" || mode == "core_unavailable" {
		seconds = cfg.OfflineSeconds
	}
	return time.Duration(seconds) * time.Second
}
func smartCheckControls(ctx context.Context, catalog []smartService, ids []string, firstSuccess bool) []smartServiceResult {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	queue := make(chan smartServiceResult, len(ids))
	count := 0
	for _, id := range ids {
		for _, service := range catalog {
			if service.ID != id {
				continue
			}
			count++
			go func(s smartService) {
				started := time.Now()
				child, release := context.WithTimeout(ctx, 4*time.Second)
				defer release()
				queue <- smartServiceResult{s.ID, smartProbeControl(child, s), time.Since(started).Milliseconds()}
			}(service)
			break
		}
	}
	results := make([]smartServiceResult, 0, count)
	for i := 0; i < count; i++ {
		select {
		case r := <-queue:
			results = append(results, r)
			if firstSuccess && r.OK {
				return results
			}
		case <-ctx.Done():
			return results
		}
	}
	return results
}
func smartAnyControl(results []smartServiceResult) bool {
	return slices.ContainsFunc(results, func(r smartServiceResult) bool { return r.OK })
}
func (m *CoreManager) monitorSmartHealth() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for range ticker.C {
		m.smartHealthTick()
	}
}
func (m *CoreManager) smartHealthTick() {
	m.mu.Lock()
	cfg := effectiveSmartHealth(m.state)
	r := &m.smartHealth
	plan := r.applied
	cmd := m.cmd
	if !cfg.Enabled || validateSmartHealth(cfg) != nil || (cmd != nil && plan == nil) {
		r.status.Running = false
		r.status.Next = time.Time{}
		r.settings = cfg
		if cmd != nil && cfg.Enabled != (plan != nil) {
			m.smartModeLocked("pending")
		} else if !cfg.Enabled {
			m.smartModeLocked("disabled")
		}
		m.mu.Unlock()
		return
	}
	if !smartSettingsEqual(r.settings, cfg) || r.lastPlan != plan || r.lastCoreRunning != (cmd != nil) {
		r.settings = cfg
		r.lastPlan = plan
		r.lastCoreRunning = cmd != nil
		r.status.Next = time.Time{}
		r.status.Controls = nil
		r.status.Healthy = 0
		m.smartModeLocked("starting")
	}
	if !r.status.Next.IsZero() && time.Now().Before(r.status.Next) {
		m.mu.Unlock()
		return
	}
	mode := r.status.Mode
	address, secret := m.watchdog.controller, m.watchdog.secret
	r.status.Running = true
	m.mu.Unlock()
	started := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	groups := 0
	if plan != nil {
		groups = len(plan.Groups)
	}
	result := smartRunCycle(ctx, cfg, mode, cmd != nil,
		func(ctx context.Context) smartScanResult { return smartScanGroups(ctx, plan, address, secret) },
		func(ctx context.Context, ids []string, first bool) []smartServiceResult {
			return smartCheckControls(ctx, cfg.catalog(), ids, first)
		},
		func(ctx context.Context) bool { return watchdogProbe(ctx, address, secret) == "healthy" },
	)
	m.mu.Lock()
	defer m.mu.Unlock()
	r.status.Running = false
	if m.cmd != cmd || r.applied != plan || !smartSettingsEqual(cfg, effectiveSmartHealth(m.state)) {
		r.status.Next = time.Time{}
		return
	}
	r.status.Healthy = result.Healthy
	r.status.Groups = groups
	r.status.Controls = result.Controls
	r.status.Last = time.Now()
	m.smartModeLocked(result.Mode)
	// Intervals are measured from the start of a completed steady-state cycle.
	// On a state change start the new interval at completion.
	base := started
	if result.Mode != mode {
		base = time.Now()
	}
	r.status.Next = base.Add(smartInterval(cfg, result.Mode))
	if r.status.Next.Before(time.Now()) {
		r.status.Next = time.Now().Add(time.Second)
	}
}

type smartCycleResult struct {
	Mode     string
	Healthy  int
	Controls []smartServiceResult
}

func smartRunCycle(ctx context.Context, cfg SmartHealthSettings, mode string, running bool,
	scan func(context.Context) smartScanResult,
	controls func(context.Context, []string, bool) []smartServiceResult,
	apiHealthy func(context.Context) bool,
) smartCycleResult {
	if !running {
		return smartCycleResult{Mode: "core_unavailable", Controls: controls(ctx, cfg.Services, false)}
	}
	result := smartCycleResult{}
	if mode == "offline" {
		result.Controls = controls(ctx, cfg.Services, true)
		if !smartAnyControl(result.Controls) {
			result.Mode = "offline"
			return result
		}
		// First valid reply resumes scanning immediately; outstanding controls
		// are cancelled and not falsely marked failed.
	}
	measured := scan(ctx)
	result.Healthy = len(measured.Healthy)
	if result.Healthy > 0 {
		result.Mode = "normal"
		result.Controls = nil
		return result
	}
	known := measured.Known && apiHealthy(ctx)
	if result.Controls == nil {
		result.Controls = controls(ctx, cfg.Services, false)
	}
	result.Mode = smartNextMode(0, known, smartAnyControl(result.Controls))
	return result
}
