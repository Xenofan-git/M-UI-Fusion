package app

// Outbound URL subscriptions are different from the panel's public subscription
// links for clients: they ingest remote proxies into the managed Outbounds list.
import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"gopkg.in/yaml.v3"
)

const (
	maxSubscriptionBytes = 2 << 20
	maxSubscriptionNodes = 2000
)

type OutboundSubscription struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	URL              string   `json:"url"`
	Enabled          bool     `json:"enabled"`
	IntervalMinutes  int      `json:"intervalMinutes"`
	Group            string   `json:"group,omitempty"` // optional existing proxy-group
	FilterKeep       string   `json:"filterKeep,omitempty"`
	FilterExclude    string   `json:"filterExclude,omitempty"`
	ExcludedNodeKeys []string `json:"excludedNodeKeys,omitempty"`
	LastAttempt      string   `json:"lastAttempt,omitempty"`
	LastUpdated      string   `json:"lastUpdated,omitempty"`
	LastError        string   `json:"lastError,omitempty"`
	NodeCount        int      `json:"nodeCount"`
}

func normalizeOutboundSubscription(s OutboundSubscription) (OutboundSubscription, error) {
	s.Name = strings.TrimSpace(s.Name)
	s.URL = strings.TrimSpace(s.URL)
	s.Group = strings.TrimSpace(s.Group)
	if len(s.Name) < 1 || len([]rune(s.Name)) > 64 || strings.ContainsAny(s.Name, "\r\n") {
		return s, fmt.Errorf("имя подписки должно содержать от 1 до 64 символов")
	}
	parsed, err := url.Parse(s.URL)
	if err != nil || parsed == nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Hostname() == "" || parsed.User != nil || parsed.Fragment != "" {
		return s, fmt.Errorf("подписка должна содержать URL http(s) без логина и пароля в адресе")
	}
	if len(s.URL) > 2048 {
		return s, fmt.Errorf("адрес подписки слишком длинный")
	}
	if parsed.Port() != "" {
		port, err := strconv.Atoi(parsed.Port())
		if err != nil || port < 1 || port > 65535 {
			return s, fmt.Errorf("некорректный порт URL")
		}
	}
	if s.IntervalMinutes == 0 {
		s.IntervalMinutes = 1440
	}
	if s.IntervalMinutes < 5 || s.IntervalMinutes > 10080 {
		return s, fmt.Errorf("интервал обновления: 5–10080 минут")
	}
	if len(s.Group) > 128 || strings.ContainsAny(s.Group, "\r\n") {
		return s, fmt.Errorf("некорректная группа")
	}
	if len(s.FilterKeep) > 4096 || len(s.FilterExclude) > 4096 {
		return s, fmt.Errorf("фильтр должен быть не длиннее 4096 байт")
	}
	if len(s.ExcludedNodeKeys) > maxSubscriptionNodes {
		return s, fmt.Errorf("слишком много исключённых узлов")
	}
	for _, key := range s.ExcludedNodeKeys {
		if len(key) > 64 || len(key) < 5 || strings.ContainsAny(key, " \t\r\n") {
			return s, fmt.Errorf("некорректный ключ исключённого узла")
		}
	}
	return s, nil
}

func subscriptionPublicIP(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	if addr, ok := netip.AddrFromSlice(ip); ok {
		addr = addr.Unmap()
		if addr.Is4() && (netip.MustParsePrefix("100.64.0.0/10").Contains(addr) || netip.MustParsePrefix("198.18.0.0/15").Contains(addr)) {
			return false
		}
		if addr.Is6() && (netip.MustParsePrefix("fc00::/7").Contains(addr) || netip.MustParsePrefix("fe80::/10").Contains(addr)) {
			return false
		}
	}
	return true
}

// Resolve on every connection and dial the validated IP itself, protecting
// against DNS rebinding. No proxies or redirects are used for credential URLs.
func downloadOutboundSubscription(ctx context.Context, rawURL string) ([]byte, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, errors.New("некорректный URL")
	}
	host := parsed.Hostname()
	if host == "" {
		return nil, errors.New("некорректный хост")
	}
	if ip := net.ParseIP(host); ip != nil && !subscriptionPublicIP(ip) {
		return nil, errors.New("локальные и служебные IP запрещены")
	}
	transport := &http.Transport{Proxy: nil, DisableKeepAlives: true, DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
		h, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		list, err := net.DefaultResolver.LookupIPAddr(ctx, h)
		if err != nil {
			return nil, fmt.Errorf("DNS подписки: %w", err)
		}
		dialer := &net.Dialer{Timeout: 8 * time.Second}
		for _, item := range list {
			if !subscriptionPublicIP(item.IP) {
				continue
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(item.IP.String(), port))
		}
		return nil, errors.New("адрес подписки резолвится только в локальную/запрещённую сеть")
	}}
	defer transport.CloseIdleConnections()
	// Providers can redirect to CDN endpoints. Every redirect's resolved IP
	// is still filtered by the transport's safe DialContext.
	client := &http.Client{Transport: transport, Timeout: 24 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 3 {
			return errors.New("слишком много редиректов подписки")
		}
		if req.URL.Scheme != "https" || req.URL.User != nil {
			return errors.New("редирект должен использовать HTTPS")
		}
		req.Header.Del("Referer")
		return nil
	}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "M-UI-Fusion/1.0")
	req.Header.Set("Accept", "application/yaml, text/yaml, text/plain, */*")
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("не удалось загрузить подписку")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("источник подписки: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxSubscriptionBytes+1))
	if err != nil {
		return nil, errors.New("ошибка чтения подписки")
	}
	if len(data) > maxSubscriptionBytes {
		return nil, errors.New("подписка превышает 2 МБ")
	}
	return data, nil
}

// Supports Mihomo/Clash YAML proxy lists, plain multi-line share links and
// base64-encoded share-link collections. Non-proxy rules in a YAML subscription
// are ignored: only nodes can be imported into panel Outbounds.
func parseOutboundSubscription(data []byte) ([]MihomoOutbound, error) {
	source := strings.TrimSpace(string(data))
	if source == "" {
		return nil, errors.New("подписка пуста")
	}
	if len(data) > maxSubscriptionBytes {
		return nil, errors.New("подписка слишком большая")
	}
	var doc struct {
		Proxies []map[string]any `yaml:"proxies"`
	}
	if err := yaml.Unmarshal(data, &doc); err == nil && len(doc.Proxies) > 0 {
		if len(doc.Proxies) > maxSubscriptionNodes {
			return nil, fmt.Errorf("слишком много узлов")
		}
		items := make([]MihomoOutbound, 0, len(doc.Proxies))
		for i, proxy := range doc.Proxies {
			b, err := json.Marshal(proxy)
			if err != nil {
				return nil, err
			}
			var obj map[string]any
			if err = json.Unmarshal(b, &obj); err != nil {
				return nil, err
			}
			node, err := nativeOutbound(obj)
			if err != nil {
				return nil, fmt.Errorf("узел %d: %w", i+1, err)
			}
			if node.Kind != "proxy" {
				return nil, fmt.Errorf("элемент %d не является прокси", i+1)
			}
			items = append(items, node)
		}
		return items, nil
	}
	text := source
	// Decode only if content is not already a collection of share links.
	if !strings.Contains(text, "://") {
		compact := strings.Join(strings.Fields(text), "")
		encodings := []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding}
		for _, enc := range encodings {
			decoded, err := enc.DecodeString(compact)
			if err == nil && len(decoded) > 0 && len(decoded) <= maxSubscriptionBytes {
				text = strings.TrimSpace(string(decoded))
				break
			}
		}
	}
	var items []MihomoOutbound
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r", ""), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if len(items) >= maxSubscriptionNodes {
			return nil, errors.New("слишком много узлов")
		}
		if !strings.Contains(line, "://") {
			return nil, fmt.Errorf("неподдерживаемый формат подписки или строка %d", len(items)+1)
		}
		nodes, err := parseMihomoShareLink(line)
		if err != nil {
			return nil, fmt.Errorf("узел %d: %w", len(items)+1, err)
		}
		items = append(items, nodes...)
	}
	if len(items) == 0 {
		return nil, errors.New("нет поддерживаемых прокси-узлов")
	}
	if len(items) > maxSubscriptionNodes {
		return nil, errors.New("слишком много узлов")
	}
	return items, nil
}

// Mihomo's Outbound name limit is 128 BYTES, not Unicode code points.
// Provider names can include commas, newlines and multi-byte characters.
// Sanitize at the subscription boundary, not in the shared manual editor.
func safeSubscriptionNamePart(raw string) string {
	var builder strings.Builder
	lastSpace := false
	for _, char := range strings.TrimSpace(raw) {
		switch {
		case char == ',':
			char = '·'
		case char == '\r' || char == '\n' || char == '\t':
			char = ' '
		case char < 32 || char == 127:
			continue
		}
		if char == ' ' {
			if lastSpace {
				continue
			}
			lastSpace = true
		} else {
			lastSpace = false
		}
		builder.WriteRune(char)
	}
	return strings.TrimSpace(builder.String())
}

func truncateSubscriptionName(raw string, maxBytes int) string {
	if maxBytes <= 0 {
		return ""
	}
	length := 0
	var builder strings.Builder
	for _, char := range raw {
		charBytes := utf8.RuneLen(char)
		if charBytes < 0 {
			charBytes = 3
		}
		if length+charBytes > maxBytes {
			break
		}
		builder.WriteRune(char)
		length += charBytes
	}
	return strings.TrimSpace(builder.String())
}

// Reserve at most 45 bytes for the subscription label. This keeps node
// names readable while respecting the exact normalization limit.
func subscriptionOutboundName(source OutboundSubscription, nodeName string, ordinal int) string {
	label := truncateSubscriptionName(safeSubscriptionNamePart(source.Name), 45)
	if label == "" {
		label = "Subscription"
	}
	name := safeSubscriptionNamePart(nodeName)
	if name == "" {
		name = fmt.Sprintf("Node %d", ordinal)
	}
	prefix := label + " | "
	available := 128 - len(prefix)
	return prefix + truncateSubscriptionName(name, available)
}

func uniqueSubscriptionName(base string, used map[string]bool) string {
	if !used[base] {
		used[base] = true
		return base
	}
	for suffixIndex := 2; ; suffixIndex++ {
		suffix := fmt.Sprintf(" [%d]", suffixIndex)
		candidate := truncateSubscriptionName(base, 128-len(suffix)) + suffix
		if !used[candidate] {
			used[candidate] = true
			return candidate
		}
	}
}

func applySubscriptionNodes(state State, sub OutboundSubscription, imported []MihomoOutbound) (State, error) {
	if len(imported) == 0 {
		return state, errors.New("пустая подписка не может удалить текущие узлы")
	}
	if len(imported) > maxSubscriptionNodes {
		return state, errors.New("слишком много узлов")
	}
	previous := map[string]MihomoOutbound{}
	existingNames := map[string]bool{}
	updated := make([]MihomoOutbound, 0, len(state.Outbounds)+len(imported))
	for _, item := range state.Outbounds {
		if item.SourceSubscriptionID == sub.ID {
			previous[item.Name] = item
			continue
		}
		updated = append(updated, item)
		existingNames[item.Name] = true
	}
	// Keep manual Outbounds untouched. Any collision is resolved by a
	// deterministic suffix on the newly imported name.
	used := make(map[string]bool, len(existingNames)+len(imported))
	for name := range existingNames {
		used[name] = true
	}
	addedNames := map[string]bool{}
	orderedNames := make([]string, 0, len(imported))
	for idx, node := range imported {
		if node.Kind != "proxy" {
			return state, errors.New("подписки могут содержать только узлы")
		}
		name := uniqueSubscriptionName(subscriptionOutboundName(sub, node.Name, idx+1), used)
		addedNames[name] = true
		orderedNames = append(orderedNames, name)
		node.Name = name
		node.SourceSubscriptionID = sub.ID
		if node.Native != nil {
			node.Native["name"] = name
		}
		if prev, ok := previous[name]; ok {
			node.ID = prev.ID
		}
		updated = append(updated, node)
	}
	// Groups are adjusted only when they are explicitly linked to the
	// subscription or already contain former members. Unrelated groups stay intact.
	for i := range updated {
		group := &updated[i]
		if group.Kind != "group" {
			continue
		}
		was := group.Proxies
		oldGroup := ""
		for _, entry := range state.OutboundSubscriptions {
			if entry.ID == sub.ID {
				oldGroup = entry.Group
				break
			}
		}
		members := make([]string, 0, len(was)+len(imported))
		excluded := make(map[string]bool, len(group.ExcludedSubscriptionMembers))
		for _, name := range group.ExcludedSubscriptionMembers {
			excluded[name] = true
		}
		changed := false
		for _, member := range was {
			if excluded[member] {
				if _, managed := previous[member]; managed {
					changed = true
					continue
				}
			}
			if _, owned := previous[member]; owned {
				changed = true
				// When the source moves to a different group, do not keep its
				// nodes linked to the previous group.
				if addedNames[member] && (oldGroup == sub.Group || group.Name != oldGroup) {
					members = append(members, member)
				}
				continue
			}
			members = append(members, member)
		}
		if group.Name == sub.Group || containsString(group.SubscriptionIDs, sub.ID) {
			changed = true
			for _, name := range orderedNames {
				if excluded[name] {
					continue
				}
				if !containsString(members, name) {
					members = append(members, name)
				}
			}
		}
		if changed {
			if len(members) == 0 {
				return state, fmt.Errorf("обновление сделает группу %q пустой; сохранены предыдущие узлы", group.Name)
			}
			group.Proxies = members
			if group.Native != nil {
				// Keep provider/transport options from any native group YAML.
				native := make(map[string]any, len(group.Native))
				for key, value := range group.Native {
					native[key] = value
				}
				memberValues := make([]any, 0, len(members))
				for _, value := range members {
					memberValues = append(memberValues, value)
				}
				native["proxies"] = memberValues
				group.Native = native
				if group.DefaultSelected != "" && !containsString(members, group.DefaultSelected) {
					delete(native, "default-selected")
				}
				group.Native = native
			}
			if group.DefaultSelected != "" && !containsString(members, group.DefaultSelected) {
				group.DefaultSelected = ""
			}
		}
	}
	for _, rule := range state.RoutingRules {
		if _, owned := previous[rule.Target]; owned && !addedNames[rule.Target] {
			return state, fmt.Errorf("удалённый узел %q используется в правиле маршрутизации", rule.Target)
		}
	}
	state.Outbounds = updated
	normalized, err := normalizeMihomoOutbounds(state.Outbounds)
	if err == nil {
		state.Outbounds = normalized
	}
	if err != nil {
		return state, err
	}
	if _, err = normalizeMihomoRoutingRules(state.RoutingRules, normalized); err != nil {
		return state, err
	}
	if _, err = renderStateConfig(state); err != nil {
		return state, err
	}
	return state, nil
}

// GET/POST /api/mihomo/subscriptions and PUT/DELETE/POST .../{id}/refresh.
// All endpoints inherit the panel session check and its URI prefix.
func (a *App) handleOutboundSubscriptions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	switch r.Method {
	case http.MethodGet:
		a.manager.mu.Lock()
		items := append([]OutboundSubscription(nil), a.manager.state.OutboundSubscriptions...)
		a.manager.mu.Unlock()
		if items == nil {
			items = []OutboundSubscription{}
		}
		writeJSON(w, http.StatusOK, apiResponse{OK: true, Data: items})
	case http.MethodPost:
		var input struct {
			OutboundSubscription
			CreateGroup bool   `json:"createGroup"`
			GroupType   string `json:"groupType"`
		}
		if err := decodeJSON(r, &input); err != nil {
			writeJSON(w, 400, apiResponse{Message: "некорректная подписка"})
			return
		}
		input.ID = ""
		sub, err := normalizeOutboundSubscription(input.OutboundSubscription)
		if err != nil {
			writeJSON(w, 400, apiResponse{Message: err.Error()})
			return
		}
		if err = randomToken(&sub.ID); err != nil {
			writeJSON(w, 500, apiResponse{Message: "не удалось создать ID"})
			return
		}
		sub.ID = "sub-" + sub.ID[:12]
		a.manager.subscriptionSyncMu.Lock()
		defer a.manager.subscriptionSyncMu.Unlock()
		a.manager.mu.Lock()
		for _, other := range a.manager.state.OutboundSubscriptions {
			if other.Name == sub.Name || other.URL == sub.URL {
				a.manager.mu.Unlock()
				writeJSON(w, 409, apiResponse{Message: "подписка с таким именем или URL уже существует"})
				return
			}
		}
		a.manager.mu.Unlock()
		// Validate and import first. Errors do not add an empty/misconfigured
		// subscription to state, and never damage any existing proxy.
		data, err := downloadOutboundSubscription(r.Context(), sub.URL)
		if err == nil {
			var items []MihomoOutbound
			items, err = parseOutboundSubscription(data)
			if err == nil {
				err = a.manager.commitOutboundSubscriptionWithGroup(sub, items, true, input.CreateGroup, input.GroupType)
			}
		}
		if err != nil {
			writeJSON(w, 400, apiResponse{Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResponse{OK: true, Message: "Подписка добавлена и узлы импортированы", Data: sub})
	default:
		writeJSON(w, 405, apiResponse{Message: "method not allowed"})
	}
}

func (a *App) handleOutboundSubscriptionAction(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.Path == "/api/mihomo/subscriptions/preview" {
		a.previewOutboundSubscription(w, r)
		return
	}
	suffix := strings.TrimPrefix(r.URL.Path, "/api/mihomo/subscriptions/")
	parts := strings.Split(suffix, "/")
	if len(parts) < 1 || len(parts) > 2 || parts[0] == "" {
		writeJSON(w, 404, apiResponse{Message: "подписка не найдена"})
		return
	}
	id := parts[0]
	a.manager.subscriptionSyncMu.Lock()
	defer a.manager.subscriptionSyncMu.Unlock()
	a.manager.mu.Lock()
	var current OutboundSubscription
	found := false
	for _, sub := range a.manager.state.OutboundSubscriptions {
		if sub.ID == id {
			current = sub
			found = true
			break
		}
	}
	a.manager.mu.Unlock()
	if !found {
		writeJSON(w, 404, apiResponse{Message: "подписка не найдена"})
		return
	}
	var err error
	switch {
	case r.Method == http.MethodPost && len(parts) == 2 && parts[1] == "refresh":
		err = a.manager.refreshOutboundSubscription(r.Context(), current)
	case r.Method == http.MethodPut && len(parts) == 1:
		var changes OutboundSubscription
		if err = decodeJSON(r, &changes); err == nil {
			changes.ID = current.ID
			changes.LastAttempt = current.LastAttempt
			changes.LastUpdated = current.LastUpdated
			changes.LastError = current.LastError
			changes.NodeCount = current.NodeCount
			changes, err = normalizeOutboundSubscription(changes)
		}
		if err == nil {
			a.manager.mu.Lock()
			for _, other := range a.manager.state.OutboundSubscriptions {
				if other.ID != changes.ID && (other.Name == changes.Name || other.URL == changes.URL) {
					err = errors.New("подписка с таким именем или URL уже существует")
					break
				}
			}
			a.manager.mu.Unlock()
		}
		if err == nil {
			// Renaming the source is allowed; existing nodes change name in a
			// single validated transaction, with a conservative dependency check.
			if changes.URL != current.URL || changes.Name != current.Name || changes.Group != current.Group ||
				changes.FilterKeep != current.FilterKeep || changes.FilterExclude != current.FilterExclude ||
				!slices.Equal(changes.ExcludedNodeKeys, current.ExcludedNodeKeys) {
				var body []byte
				body, err = downloadOutboundSubscription(r.Context(), changes.URL)
				if err == nil {
					var nodes []MihomoOutbound
					nodes, err = parseOutboundSubscription(body)
					if err == nil {
						err = a.manager.commitOutboundSubscription(changes, nodes, false)
					}
				}
			} else {
				err = a.manager.updateOutboundSubscriptionMetadata(changes)
			}
		}
	case r.Method == http.MethodDelete && len(parts) == 1:
		err = a.manager.removeOutboundSubscription(current, r.URL.Query().Get("keepNodes") == "true")
	default:
		writeJSON(w, 405, apiResponse{Message: "method not allowed"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Message: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, apiResponse{OK: true, Message: "Изменения подписки сохранены"})
}

func (m *CoreManager) updateOutboundSubscriptionMetadata(sub OutboundSubscription) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	before := m.state
	copySubs := append([]OutboundSubscription(nil), before.OutboundSubscriptions...)
	for idx := range copySubs {
		if copySubs[idx].ID == sub.ID {
			copySubs[idx] = sub
		}
	}
	m.state.OutboundSubscriptions = copySubs
	if err := m.saveLocked(); err != nil {
		m.state = before
		return err
	}
	return nil
}

// commitOutboundSubscription performs a full, verified reconciliation before
// saving any state. The other subscription's and manual outbounds are unchanged.
func (m *CoreManager) commitOutboundSubscription(sub OutboundSubscription, nodes []MihomoOutbound, isNew bool) error {
	return m.commitOutboundSubscriptionWithGroup(sub, nodes, isNew, false, "")
}
func (m *CoreManager) commitOutboundSubscriptionWithGroup(sub OutboundSubscription, nodes []MihomoOutbound, isNew, createGroup bool, groupType string) error {
	if createGroup && !isNew {
		return errors.New("новую группу можно создавать только вместе с новой подпиской")
	}
	if createGroup {
		if sub.Group == "" {
			return errors.New("укажите имя нового балансировщика")
		}
		if groupType == "" {
			groupType = "url-test"
		}
		if !containsString([]string{"select", "url-test", "fallback", "load-balance"}, groupType) {
			return fmt.Errorf("неподдерживаемый тип балансировщика %q", groupType)
		}
	}
	selected, _, err := filterSubscriptionNodes(sub, nodes)
	if err != nil {
		return err
	}
	m.mu.Lock()
	before := m.state
	if isNew {
		for _, other := range before.OutboundSubscriptions {
			if other.Name == sub.Name || other.URL == sub.URL {
				m.mu.Unlock()
				return errors.New("подписка уже существует")
			}
		}
	}
	working := before
	if createGroup {
		for _, item := range before.Outbounds {
			if item.Name == sub.Group {
				m.mu.Unlock()
				return fmt.Errorf("Outbound или балансировщик %q уже существует", sub.Group)
			}
		}
		// Defaults apply only to a newly created subscription balancer.
		// Existing groups keep the user's own timeout/tolerance on refresh.
		group := MihomoOutbound{Kind: "group", Name: sub.Group, Type: groupType,
			TestURL: defaultMihomoTestURL, Interval: 300}
		if groupType != "select" {
			group.Timeout = 8000 // milliseconds: tolerate slow LTE/VPN handshakes.
		}
		if groupType == "url-test" {
			group.Tolerance = 100 // milliseconds: avoid switching for tiny latency differences.
		}
		working.Outbounds = append(append([]MihomoOutbound(nil), before.Outbounds...), group)
	}
	next, err := applySubscriptionNodes(working, sub, selected)
	if err != nil {
		m.mu.Unlock()
		return err
	}
	copySubs := append([]OutboundSubscription(nil), before.OutboundSubscriptions...)
	found := false
	sub.LastError = ""
	sub.LastAttempt = time.Now().UTC().Format(time.RFC3339)
	sub.LastUpdated = sub.LastAttempt
	sub.NodeCount = len(selected)
	for i := range copySubs {
		if copySubs[i].ID == sub.ID {
			copySubs[i] = sub
			found = true
			break
		}
	}
	if !found {
		copySubs = append(copySubs, sub)
	}
	next.OutboundSubscriptions = copySubs
	err = m.persistSubscriptionStateLocked(before, next)
	m.mu.Unlock()
	if err != nil {
		return err
	}
	return m.reloadAfterSubscription()
}

func (m *CoreManager) persistSubscriptionStateLocked(before, next State) error {
	config, err := renderStateConfig(next)
	if err != nil {
		return err
	}
	// Validate the generated YAML with the installed Mihomo core before
	// replacing live state. A bad upstream subscription must not break routing.
	if err = preflightOutboundSubscriptionConfig(m.dataDir, next.Settings.CorePath, config); err != nil {
		return err
	}
	// Config should never be published with broken state, and vice versa.
	m.state = next
	if err = m.saveLocked(); err != nil {
		m.state = before
		return err
	}
	if err = writeFileDurable(m.dataDir+"/config.yaml", config, 0600); err != nil {
		m.state = before
		_ = m.saveLocked()
		return err
	}
	return nil
}

func (m *CoreManager) reloadAfterSubscription() error {
	m.mu.Lock()
	running := m.runningLocked()
	controller := m.state.Settings.APIAddress
	secret := m.state.Settings.APISecret
	dataDir := m.dataDir
	m.mu.Unlock()
	if !running {
		return nil
	}
	// Mihomo supports a native config hot-reload. Prefer it to killing the
	// process, which would sever all user sessions on each subscription tick.
	if err := reloadMihomoConfigController(controller, secret, dataDir); err == nil {
		return nil
	}
	// The controller may be turned off/rebound; use the reliable normal path.
	if err := m.restartCore(); err != nil {
		return fmt.Errorf("конфигурация сохранена, но Mihomo не смог применить её: %w", err)
	}
	return nil
}

func reloadMihomoConfigController(controller, secret, dataDir string) error {
	_, port, err := net.SplitHostPort(controller)
	if err != nil {
		return err
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 1 || number > 65535 {
		return errors.New("неправильный порт контроллера")
	}
	payload, err := json.Marshal(map[string]string{"path": filepath.Join(dataDir, "config.yaml")})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	url := fmt.Sprintf("http://127.0.0.1:%d/configs?force=true", number)
	request, err := http.NewRequestWithContext(ctx, http.MethodPut, url, strings.NewReader(string(payload)))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	if secret != "" {
		request.Header.Set("Authorization", "Bearer "+secret)
	}
	client := &http.Client{
		Timeout:   8 * time.Second,
		Transport: &http.Transport{Proxy: nil, DisableKeepAlives: true},
	}
	response, err := client.Do(request)
	if err != nil {
		return errors.New("контроллер Mihomo недоступен")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusNoContent {
		return fmt.Errorf("контроллер Mihomo вернул HTTP %d", response.StatusCode)
	}
	return nil
}

func (m *CoreManager) refreshOutboundSubscription(ctx context.Context, sub OutboundSubscription) error {
	data, err := downloadOutboundSubscription(ctx, sub.URL)
	var nodes []MihomoOutbound
	if err == nil {
		nodes, err = parseOutboundSubscription(data)
	}
	if err == nil {
		err = m.commitOutboundSubscription(sub, nodes, false)
	}
	if err != nil {
		m.mu.Lock()
		for i := range m.state.OutboundSubscriptions {
			if m.state.OutboundSubscriptions[i].ID == sub.ID {
				m.state.OutboundSubscriptions[i].LastError = err.Error()
				m.state.OutboundSubscriptions[i].LastAttempt = time.Now().UTC().Format(time.RFC3339)
			}
		}
		if e := m.saveLocked(); e != nil {
			err = fmt.Errorf("%v; сохранение ошибки: %w", err, e)
		}
		m.mu.Unlock()
	}
	return err
}

func (m *CoreManager) removeOutboundSubscription(sub OutboundSubscription, keepNodes bool) error {
	m.mu.Lock()
	before := m.state
	next := before
	next.OutboundSubscriptions = make([]OutboundSubscription, 0, len(before.OutboundSubscriptions))
	for _, item := range before.OutboundSubscriptions {
		if item.ID != sub.ID {
			next.OutboundSubscriptions = append(next.OutboundSubscriptions, item)
		}
	}
	if keepNodes {
		next.Outbounds = append([]MihomoOutbound(nil), before.Outbounds...)
		for i := range next.Outbounds {
			group := &next.Outbounds[i]
			if group.Kind == "group" && containsString(group.SubscriptionIDs, sub.ID) {
				group.SubscriptionIDs = withoutSubscriptionID(group.SubscriptionIDs, sub.ID)
			}
		}
		for i := range next.Outbounds {
			if next.Outbounds[i].SourceSubscriptionID == sub.ID {
				next.Outbounds[i].SourceSubscriptionID = ""
			}
		}
	} else {
		// Removing a source must not silently break rules or proxy groups.
		removed := map[string]bool{}
		next.Outbounds = make([]MihomoOutbound, 0, len(before.Outbounds))
		for _, item := range before.Outbounds {
			if item.SourceSubscriptionID == sub.ID {
				removed[item.Name] = true
				continue
			}
			next.Outbounds = append(next.Outbounds, item)
		}
		for _, item := range next.Outbounds {
			if item.Kind == "group" {
				for _, name := range item.Proxies {
					if removed[name] {
						m.mu.Unlock()
						return fmt.Errorf("узел %q используется в группе %q; выберите удаление с сохранением узлов", name, item.Name)
					}
				}
			}
			if removed[item.DialerProxy] {
				m.mu.Unlock()
				return fmt.Errorf("узел используется как Dialer Proxy")
			}
		}
		for _, rule := range next.RoutingRules {
			if removed[rule.Target] {
				m.mu.Unlock()
				return fmt.Errorf("узел %q используется правилом; сохраните узлы при удалении", rule.Target)
			}
		}
	}
	err := m.persistSubscriptionStateLocked(before, next)
	m.mu.Unlock()
	if err != nil {
		return err
	}
	if !keepNodes {
		return m.reloadAfterSubscription()
	}
	return nil
}

func (m *CoreManager) monitorOutboundSubscriptions() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	// First check shortly after startup: respect persisted lastAttempt so a
	// reboot doesn't hammer the subscription endpoint.
	for {
		m.subscriptionSyncMu.Lock()
		m.mu.Lock()
		now := time.Now()
		due := make([]OutboundSubscription, 0)
		for _, sub := range m.state.OutboundSubscriptions {
			if !sub.Enabled {
				continue
			}
			last, _ := time.Parse(time.RFC3339, sub.LastAttempt)
			if last.IsZero() || now.Sub(last) >= time.Duration(sub.IntervalMinutes)*time.Minute {
				due = append(due, sub)
			}
		}
		m.mu.Unlock()
		m.subscriptionSyncMu.Unlock()
		for _, sub := range due {
			m.subscriptionSyncMu.Lock()
			m.mu.Lock()
			current := OutboundSubscription{}
			found := false
			for _, saved := range m.state.OutboundSubscriptions {
				if saved.ID == sub.ID {
					current = saved
					found = true
					break
				}
			}
			m.mu.Unlock()
			if !found || !current.Enabled || current.URL != sub.URL {
				m.subscriptionSyncMu.Unlock()
				continue
			}
			ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
			err := m.refreshOutboundSubscription(ctx, current)
			cancel()
			if err != nil {
				fmt.Printf("m-ui outbound subscription %s: refresh failed (details in panel)\\n", sub.Name)
			}
			m.subscriptionSyncMu.Unlock()
		}
		<-ticker.C
	}
}

// Test a candidate config in an isolated 0600 temporary file to ensure it can
// be accepted by the actual Mihomo executable, not merely rendered as YAML.
func preflightOutboundSubscriptionConfig(dataDir, corePath string, config []byte) error {
	if corePath == "" {
		return nil
	}
	if st, err := os.Stat(corePath); err != nil || st.IsDir() {
		return nil
	} // test fixture without core
	file, err := os.CreateTemp(dataDir, ".m-ui-sub-check-*.yaml")
	if err != nil {
		return err
	}
	path := file.Name()
	defer os.Remove(path)
	if err = file.Chmod(0600); err != nil {
		file.Close()
		return err
	}
	if _, err = file.Write(config); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, corePath, "-t", "-d", filepath.Clean(dataDir), "-f", path)
	result, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("тайм-аут проверки подписки ядром Mihomo")
		}
		// Do not echo the entire config / credentials into public error text.
		_ = result
		return fmt.Errorf("ядро Mihomo отклонило конфигурацию подписки; исходные узлы сохранены")
	}
	return nil
}

// A read-only preview fetches and parses the remote source, returning public
// node labels and opaque selection keys only, never credentials or raw YAML.
func (a *App) previewOutboundSubscription(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, 405, apiResponse{Message: "method not allowed"})
		return
	}
	var sub OutboundSubscription
	if err := decodeJSON(r, &sub); err != nil {
		writeJSON(w, 400, apiResponse{Message: "некорректные данные"})
		return
	}
	if sub.Name == "" {
		sub.Name = "Preview"
	}
	normalized, err := normalizeOutboundSubscription(sub)
	if err != nil {
		writeJSON(w, 400, apiResponse{Message: err.Error()})
		return
	}
	body, err := downloadOutboundSubscription(r.Context(), normalized.URL)
	if err != nil {
		writeJSON(w, 400, apiResponse{Message: err.Error()})
		return
	}
	nodes, err := parseOutboundSubscription(body)
	if err != nil {
		writeJSON(w, 400, apiResponse{Message: err.Error()})
		return
	}
	_, preview, _ := filterSubscriptionNodes(normalized, nodes)
	writeJSON(w, 200, apiResponse{OK: true, Data: preview})
}
