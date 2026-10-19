package tools

import (
	"regexp"
	"sort"
	"strings"
)

var trailingParens = regexp.MustCompile(`\s*\([^()]*\)\s*$`)

// examTopics extracts the "Temas: a; b; c" segment of an exam description.
func examTopics(description string) []string {
	_, rest, ok := strings.Cut(description, "Temas:")
	if !ok {
		return nil
	}
	segment, _, _ := strings.Cut(rest, " · ")
	var out []string
	for _, t := range strings.Split(segment, ";") {
		if t = strings.TrimSpace(t); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func topicKey(topic string) string {
	return strings.TrimSpace(fold(trailingParens.ReplaceAllString(topic, "")))
}

type topicCount struct {
	Topic    string `json:"topic"`
	Count    int    `json:"count"`
	LastYear int    `json:"last_year,omitempty"`

	variants map[string]int
	order    []string
}

type topicTally struct {
	byKey map[string]*topicCount
}

func newTopicTally() *topicTally { return &topicTally{byKey: map[string]*topicCount{}} }

// add counts each distinct topic once per exam.
func (t *topicTally) add(topics []string, year int) {
	seen := map[string]bool{}
	for _, topic := range topics {
		key := topicKey(topic)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		tc := t.byKey[key]
		if tc == nil {
			tc = &topicCount{variants: map[string]int{}}
			t.byKey[key] = tc
		}
		tc.Count++
		if year > tc.LastYear {
			tc.LastYear = year
		}
		if tc.variants[topic] == 0 {
			tc.order = append(tc.order, topic)
		}
		tc.variants[topic]++
	}
}

// ranked returns topics by count, then by most recent year, then name.
func (t *topicTally) ranked() []topicCount {
	out := make([]topicCount, 0, len(t.byKey))
	for _, tc := range t.byKey {
		best := tc.order[0]
		for _, v := range tc.order {
			if tc.variants[v] > tc.variants[best] {
				best = v
			}
		}
		out = append(out, topicCount{Topic: best, Count: tc.Count, LastYear: tc.LastYear})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		if out[i].LastYear != out[j].LastYear {
			return out[i].LastYear > out[j].LastYear
		}
		return out[i].Topic < out[j].Topic
	})
	return out
}
