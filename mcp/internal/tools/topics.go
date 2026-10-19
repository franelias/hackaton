package tools

import (
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
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

// keywordCount is a word or word pair that shows up in the topics of several exams.
type keywordCount struct {
	Keyword  string `json:"keyword"`
	Exams    int    `json:"exams"`
	LastYear int    `json:"last_year,omitempty"`
}

const (
	maxKeywords       = 15
	minKeywordExams   = 2
	minKeywordLetters = 4
)

// stopwords are Spanish function words that carry no topic.
var stopwords = map[string]bool{}

func init() {
	for _, w := range strings.Fields("de del la las el los lo y e o u en con sin por para al a un una uno su sus sobre entre como que se no ni mas son es ser este esta estos estas") {
		stopwords[w] = true
	}
}

type keywordTally struct {
	exams    map[string]int
	variants map[string]map[string]int
	last     map[string]int
}

func newKeywordTally() *keywordTally {
	return &keywordTally{exams: map[string]int{}, variants: map[string]map[string]int{}, last: map[string]int{}}
}

// words splits a topic into lowercase words (letters only).
func words(topic string) []string {
	return strings.FieldsFunc(strings.ToLower(topic), func(r rune) bool { return !unicode.IsLetter(r) })
}

func significant(w string) bool {
	f := fold(w)
	return !stopwords[f] && utf8.RuneCountInString(f) >= minKeywordLetters
}

// add counts each word and each pair of neighbouring words once per exam.
func (k *keywordTally) add(topics []string, year int) {
	seen := map[string]bool{}
	note := func(key, shown string) {
		seen[key] = true
		if k.variants[key] == nil {
			k.variants[key] = map[string]int{}
		}
		k.variants[key][shown]++
	}
	for _, topic := range topics {
		ws := words(topic)
		for i, w := range ws {
			if !significant(w) {
				continue
			}
			note(fold(w), w)
			if i+1 < len(ws) && significant(ws[i+1]) {
				note(fold(w)+" "+fold(ws[i+1]), w+" "+ws[i+1])
			}
		}
	}
	for key := range seen {
		k.exams[key]++
		if year > k.last[key] {
			k.last[key] = year
		}
	}
}

// ranked returns the keywords found in at least two exams. A single word is
// dropped when it only ever appears inside a pair that is as frequent.
func (k *keywordTally) ranked() []keywordCount {
	pairs := map[string]int{}
	for key, n := range k.exams {
		if strings.Contains(key, " ") && n >= minKeywordExams {
			pairs[key] = n
		}
	}
	var out []keywordCount
	for key, n := range k.exams {
		if n < minKeywordExams {
			continue
		}
		if !strings.Contains(key, " ") && coveredByPair(key, n, pairs) {
			continue
		}
		out = append(out, keywordCount{Keyword: mostCommon(k.variants[key]), Exams: n, LastYear: k.last[key]})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Exams != out[j].Exams {
			return out[i].Exams > out[j].Exams
		}
		if out[i].LastYear != out[j].LastYear {
			return out[i].LastYear > out[j].LastYear
		}
		return out[i].Keyword < out[j].Keyword
	})
	if len(out) > maxKeywords {
		out = out[:maxKeywords]
	}
	return out
}

func coveredByPair(word string, n int, pairs map[string]int) bool {
	for pair, pn := range pairs {
		if pn != n {
			continue
		}
		for _, w := range strings.Fields(pair) {
			if w == word {
				return true
			}
		}
	}
	return false
}

func mostCommon(counts map[string]int) string {
	best, bestN := "", 0
	for v, n := range counts {
		if n > bestN || (n == bestN && v < best) {
			best, bestN = v, n
		}
	}
	return best
}
