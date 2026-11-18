package app

import (
	"fmt"
	"reflect"
	"strings"
)

// Groups own links to any number of remote subscription sources.
func withoutSubscriptionID(ids []string, excluded string) []string {
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != excluded {
			result = append(result, id)
		}
	}
	return result
}

func groupSubscriptionsMatch(expected, actual []MihomoOutbound) bool {
	if len(expected) != len(actual) {
		return false
	}
	for i := range expected {
		if expected[i].Kind == "group" && !reflect.DeepEqual(expected[i].Proxies, actual[i].Proxies) {
			return false
		}
	}
	return true
}

func materializeGroupSubscriptions(state State, outbounds []MihomoOutbound) ([]MihomoOutbound, error) {
	sources := make(map[string]OutboundSubscription, len(state.OutboundSubscriptions))
	for _, source := range state.OutboundSubscriptions {
		sources[source.ID] = source
	}
	managedNodeSource := make(map[string]string)
	sourceNodes := make(map[string][]string)
	for _, node := range state.Outbounds {
		if node.Kind != "proxy" || node.SourceSubscriptionID == "" {
			continue
		}
		sourceNodes[node.SourceSubscriptionID] = append(sourceNodes[node.SourceSubscriptionID], node.Name)
		managedNodeSource[node.Name] = node.SourceSubscriptionID
	}
	result := make([]MihomoOutbound, len(outbounds))
	copy(result, outbounds)
	for i := range result {
		group := &result[i]
		if group.Kind != "group" {
			if len(group.SubscriptionIDs) > 0 {
				return nil, fmt.Errorf("только балансировщики могут содержать ссылки на подписки")
			}
			continue
		}
		selected := make([]string, 0, len(group.SubscriptionIDs))
		known := map[string]bool{}
		for _, sourceID := range group.SubscriptionIDs {
			sourceID = strings.TrimSpace(sourceID)
			if sourceID == "" {
				continue
			}
			if _, exists := sources[sourceID]; !exists {
				return nil, fmt.Errorf("подписка для балансировщика %q больше не существует", group.Name)
			}
			if !known[sourceID] {
				selected = append(selected, sourceID)
				known[sourceID] = true
			}
		}
		group.SubscriptionIDs = selected
		for _, source := range state.OutboundSubscriptions {
			if source.Group == group.Name && !known[source.ID] {
				selected = append(selected, source.ID)
				known[source.ID] = true
			}
		}
		// A managed proxy can also be selected as an ordinary manual
		// member. Remove it automatically only when its source was linked
		// to this group before the edit and was now explicitly deselected.
		previouslyLinked := map[string]bool{}
		for _, existing := range state.Outbounds {
			if existing.Kind == "group" && existing.Name == group.Name {
				for _, sourceID := range existing.SubscriptionIDs {
					previouslyLinked[sourceID] = true
				}
				break
			}
		}
		members := make([]string, 0, len(group.Proxies))
		excluded := make(map[string]bool, len(group.ExcludedSubscriptionMembers))
		for _, name := range group.ExcludedSubscriptionMembers {
			excluded[name] = true
		}
		memberSet := map[string]bool{}
		for _, member := range group.Proxies {
			if excluded[member] && managedNodeSource[member] != "" {
				continue
			}
			if sourceID := managedNodeSource[member]; sourceID != "" && !known[sourceID] && previouslyLinked[sourceID] {
				continue
			}
			if !memberSet[member] {
				members = append(members, member)
				memberSet[member] = true
			}
		}
		for _, sourceID := range selected {
			for _, member := range sourceNodes[sourceID] {
				if excluded[member] {
					continue
				}
				if !memberSet[member] {
					members = append(members, member)
					memberSet[member] = true
				}
			}
		}
		group.Proxies = members
		if group.Native != nil {
			native := make(map[string]any, len(group.Native))
			for key, value := range group.Native {
				native[key] = value
			}
			native["proxies"] = append([]string(nil), members...)
			group.Native = native
		}
		if group.DefaultSelected != "" && !memberSet[group.DefaultSelected] {
			group.DefaultSelected = ""
		}
	}
	return result, nil
}
