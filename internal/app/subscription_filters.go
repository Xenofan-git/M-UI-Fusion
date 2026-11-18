package app

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

type subscriptionPreviewNode struct {
	Key      string `json:"key"`
	Name     string `json:"name"`
	Protocol string `json:"protocol"`
	Included bool   `json:"included"`
}
type subscriptionPreviewResponse struct {
	Nodes    []subscriptionPreviewNode `json:"nodes"`
	Total    int                       `json:"total"`
	Selected int                       `json:"selected"`
	Filtered int                       `json:"filtered"`
}

// Match HydraRoute: case-insensitive substrings, OR across newline-delimited
// "Keep only" terms. Exclusion terms always take priority.
func subscriptionFilterWords(value string) []string {
	result := make([]string, 0)
	for _, line := range strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n") {
		line = strings.ToLower(strings.TrimSpace(line))
		if line != "" && !strings.HasPrefix(line, "#") {
			result = append(result, line)
		}
	}
	return result
}
func subscriptionFilterMatch(name string, keep, exclude []string) bool {
	lower := strings.ToLower(name)
	if len(keep) > 0 {
		found := false
		for _, word := range keep {
			if strings.Contains(lower, word) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	for _, word := range exclude {
		if strings.Contains(lower, word) {
			return false
		}
	}
	return true
}

// Stable non-sensitive key for explicit per-node exclusions, including
// duplicate labels and servers. Credentials are never returned in preview.
func subscriptionNodeKeys(nodes []MihomoOutbound) []string {
	seen := make(map[string]int)
	keys := make([]string, len(nodes))
	for i, node := range nodes {
		sum := sha256.Sum256([]byte(fmt.Sprintf("%s\x00%s\x00%s\x00%d", node.Name, node.Type, node.Server, node.Port)))
		prefix := hex.EncodeToString(sum[:12])
		seen[prefix]++
		keys[i] = fmt.Sprintf("%s:%d", prefix, seen[prefix])
	}
	return keys
}
func filterSubscriptionNodes(sub OutboundSubscription, nodes []MihomoOutbound) ([]MihomoOutbound, subscriptionPreviewResponse, error) {
	if len(nodes) == 0 {
		return nil, subscriptionPreviewResponse{}, errors.New("подписка не содержит узлов")
	}
	if len(nodes) > maxSubscriptionNodes {
		return nil, subscriptionPreviewResponse{}, errors.New("слишком много узлов")
	}
	keys := subscriptionNodeKeys(nodes)
	keep, exclude := subscriptionFilterWords(sub.FilterKeep), subscriptionFilterWords(sub.FilterExclude)
	blocked := make(map[string]bool, len(sub.ExcludedNodeKeys))
	for _, key := range sub.ExcludedNodeKeys {
		blocked[key] = true
	}
	preview := subscriptionPreviewResponse{Total: len(nodes), Nodes: make([]subscriptionPreviewNode, 0, len(nodes))}
	selected := make([]MihomoOutbound, 0, len(nodes))
	for i, node := range nodes {
		include := subscriptionFilterMatch(node.Name, keep, exclude) && !blocked[keys[i]]
		if include {
			selected = append(selected, node)
		} else {
			preview.Filtered++
		}
		label := strings.TrimSpace(node.Name)
		if label == "" {
			label = fmt.Sprintf("Узел %d", i+1)
		}
		preview.Nodes = append(preview.Nodes, subscriptionPreviewNode{Key: keys[i], Name: label, Protocol: node.Type, Included: include})
	}
	preview.Selected = len(selected)
	if len(selected) == 0 {
		return selected, preview, errors.New("фильтры исключили все узлы подписки; действующая конфигурация сохранена")
	}
	return selected, preview, nil
}
