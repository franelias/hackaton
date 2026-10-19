package tree

import (
	"encoding/json"
	"sort"
	"strings"
)

// MasteredAfter is how many correct exercises of a topic make it mastered.
const MasteredAfter = 3

type TopicStat struct {
	Topic    string `json:"topic"`
	Correct  int    `json:"correct"`
	Attempts int    `json:"attempts"`
	Mastered bool   `json:"mastered"`
}

var foldAccents = strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u")

// Topics groups the exercises of each subject by topic (ignoring case and
// accents; the first spelling seen is shown), most practiced first.
func Topics(acts []Activity) map[int][]TopicStat {
	stats := map[int]map[string]*TopicStat{}
	for _, a := range acts {
		name := strings.TrimSpace(a.Topic)
		if a.Type != "exercise" || a.SubjectID == nil || name == "" {
			continue
		}
		key := foldAccents.Replace(strings.ToLower(name))
		if stats[*a.SubjectID] == nil {
			stats[*a.SubjectID] = map[string]*TopicStat{}
		}
		s := stats[*a.SubjectID][key]
		if s == nil {
			s = &TopicStat{Topic: name}
			stats[*a.SubjectID][key] = s
		}
		s.Attempts++
		var r struct{ Correct bool }
		if json.Unmarshal(a.Result, &r) == nil && r.Correct {
			s.Correct++
		}
		s.Mastered = s.Correct >= MasteredAfter
	}
	out := map[int][]TopicStat{}
	for id, m := range stats {
		for _, s := range m {
			out[id] = append(out[id], *s)
		}
		sort.Slice(out[id], func(i, j int) bool {
			a, b := out[id][i], out[id][j]
			return a.Attempts > b.Attempts || (a.Attempts == b.Attempts && a.Topic < b.Topic)
		})
	}
	return out
}
