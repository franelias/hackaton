package tools

import (
	"context"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/franelias/hackaton/fceia"
)

const (
	snippetRunes  = 1500
	snippetBefore = 300
)

type searchMaterialsIn struct {
	SubjectID int    `json:"subject_id" jsonschema:"subject_id from search_subject"`
	Topic     string `json:"topic" jsonschema:"text to look for inside the materials"`
	Limit     int    `json:"limit,omitempty" jsonschema:"how many materials to return (default 3, max 10)"`
}

type materialOut struct {
	MaterialID int    `json:"material_id"`
	Title      string `json:"title"`
	Kind       string `json:"kind"`
	Snippet    string `json:"snippet"`
	URL        string `json:"url"`
}

type searchMaterialsOut struct {
	Materials []materialOut `json:"materials"`
}

// spellings returns the variants worth sending to the accent- and
// case-sensitive text filter.
func spellings(topic string) []string {
	lower := strings.ToLower(topic)
	r, size := utf8.DecodeRuneInString(lower)
	capitalized := string(unicode.ToUpper(r)) + lower[size:]
	var out []string
	seen := map[string]bool{}
	for _, v := range []string{topic, lower, capitalized} {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}

func snippetAround(text []rune, at int) string {
	start := 0
	if at > snippetBefore {
		start = at - snippetBefore
	}
	end := start + snippetRunes
	if end > len(text) {
		end = len(text)
	}
	s := string(text[start:end])
	if start > 0 {
		s = "…" + s
	}
	if end < len(text) {
		s += "…"
	}
	return s
}

func (t *Tools) searchMaterials(ctx context.Context, in searchMaterialsIn) (searchMaterialsOut, error) {
	if in.SubjectID <= 0 {
		return searchMaterialsOut{}, invalidArgument("subject_id must be positive")
	}
	if strings.TrimSpace(in.Topic) == "" {
		return searchMaterialsOut{}, invalidArgument("topic must not be empty")
	}
	limit, err := limitOrDefault(in.Limit)
	if err != nil {
		return searchMaterialsOut{}, err
	}

	var found []fceia.Material
	seen := map[int]bool{}
	for _, v := range spellings(in.Topic) {
		ms, err := t.api.Materials(ctx, in.SubjectID, v)
		if err != nil {
			return searchMaterialsOut{}, err
		}
		for _, m := range ms {
			if !seen[m.ID] {
				seen[m.ID] = true
				found = append(found, m)
			}
		}
	}
	if len(found) > limit {
		found = found[:limit]
	}

	out := searchMaterialsOut{Materials: []materialOut{}}
	for _, m := range found {
		mo := materialOut{MaterialID: m.ID, Title: m.Title, Kind: m.Kind, URL: t.api.AbsURL(m.URL)}
		if m.HasText {
			txt, err := t.api.MaterialText(ctx, m.ID)
			if err != nil && !errors.Is(err, fceia.ErrNotFound) {
				return searchMaterialsOut{}, err
			}
			runes := []rune(txt.Text)
			at := indexFolded(foldRunes(txt.Text), in.Topic)
			if at < 0 {
				at = 0
			}
			mo.Snippet = snippetAround(runes, at)
		}
		out.Materials = append(out.Materials, mo)
	}
	return out, nil
}
