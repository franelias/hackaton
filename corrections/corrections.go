// Package corrections is the manual-review layer over the FCEIA API: year and
// term fixes, wrong correlativas, subjects that are not what the API says.
// The API itself is never modified; every consumer (backend plan, MCP tools)
// applies the same corrections so they never disagree in front of a student.
package corrections

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
)

// Condition values, as in docs/contratos.md §2.1.
const (
	Approved = "approved"
	Regular  = "regular"
)

//go:embed data/career_*.json
var data embed.FS

// Overrides is the review of one career. Every entry carries a note citing
// the official source it comes from.
type Overrides struct {
	// Subjects fixes fields of a subject, keyed by subject_id.
	Subjects map[int]Subject `json:"subjects"`
	// AddPrerequisites adds a missing correlativa. Condition defaults to "approved".
	AddPrerequisites []Edit `json:"add_prerequisites"`
	// RemovePrerequisites drops a wrong correlativa.
	RemovePrerequisites []Edit `json:"remove_prerequisites"`
}

type Subject struct {
	Year *int `json:"year"`
	Term *int `json:"term"` // absolute cuatrimestre in the career, 1..10
	// Elective turns a subject into an optional one (its hours are elective).
	Elective *bool  `json:"elective"`
	Note     string `json:"note"`
}

type Edit struct {
	SubjectID int    `json:"subject_id"`
	Requires  int    `json:"requires"`
	Condition string `json:"condition"`
	Note      string `json:"note"`
}

// Requirement is one correlativa of a subject.
type Requirement struct {
	SubjectID int
	Condition string // Approved or Regular
}

// For returns the embedded review of a career, or no overrides if it has none.
func For(careerID int) (Overrides, error) {
	b, err := data.ReadFile("data/career_" + strconv.Itoa(careerID) + ".json")
	if err != nil {
		if _, ok := err.(*fs.PathError); ok {
			return Overrides{}, nil
		}
		return Overrides{}, err
	}
	return Parse(b)
}

// Parse reads an overrides document; unknown fields are errors so typos do
// not silently drop a correction.
func Parse(b []byte) (Overrides, error) {
	var ov Overrides
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&ov); err != nil {
		return Overrides{}, err
	}
	for _, e := range append(append([]Edit(nil), ov.AddPrerequisites...), ov.RemovePrerequisites...) {
		if c := e.Condition; c != "" && c != Approved && c != Regular {
			return Overrides{}, fmt.Errorf("subject %d: condition must be %q or %q, got %q", e.SubjectID, Approved, Regular, c)
		}
	}
	return ov, nil
}

// Prerequisites returns a subject's correlativas after the corrections:
// removals first, then additions, without duplicates, sorted by subject_id.
func (o Overrides) Prerequisites(subjectID int, api []Requirement) []Requirement {
	removed := map[int]bool{}
	for _, e := range o.RemovePrerequisites {
		if e.SubjectID == subjectID {
			removed[e.Requires] = true
		}
	}
	seen := map[int]bool{}
	var out []Requirement
	for _, r := range api {
		if !removed[r.SubjectID] && !seen[r.SubjectID] {
			seen[r.SubjectID] = true
			out = append(out, r)
		}
	}
	for _, e := range o.AddPrerequisites {
		if e.SubjectID == subjectID && !seen[e.Requires] {
			seen[e.Requires] = true
			cond := e.Condition
			if cond == "" {
				cond = Approved
			}
			out = append(out, Requirement{e.Requires, cond})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].SubjectID < out[j].SubjectID })
	return out
}

// Unlocks returns the subjects that require subjectID after the corrections,
// sorted by subject_id. api holds the ones the API lists.
func (o Overrides) Unlocks(subjectID int, api []int) []int {
	removed := map[int]bool{}
	for _, e := range o.RemovePrerequisites {
		if e.Requires == subjectID {
			removed[e.SubjectID] = true
		}
	}
	seen := map[int]bool{}
	var out []int
	for _, id := range api {
		if !removed[id] && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	for _, e := range o.AddPrerequisites {
		if e.Requires == subjectID && !seen[e.SubjectID] {
			seen[e.SubjectID] = true
			out = append(out, e.SubjectID)
		}
	}
	sort.Ints(out)
	return out
}

// Graph applies the corrections to every subject's correlativas (api, keyed
// by subject_id) and keeps only the direct ones: a correlativa already implied
// by another one is dropped, since passing the other one requires it anyway.
func (o Overrides) Graph(api map[int][]Requirement) map[int][]Requirement {
	g := map[int][]Requirement{}
	for id, reqs := range api {
		g[id] = o.Prerequisites(id, reqs)
	}
	for _, e := range o.AddPrerequisites {
		if _, ok := g[e.SubjectID]; !ok {
			g[e.SubjectID] = o.Prerequisites(e.SubjectID, nil)
		}
	}
	return Reduce(g)
}

// Reduce drops the correlativas implied by others. C's correlativa A is
// implied when another correlativa B of C, which C needs approved, guarantees
// A at least as strongly: approving B already required A. Only approved links
// are followed further back, since a regular subject guarantees nothing about
// its own correlativas.
func Reduce(g map[int][]Requirement) map[int][]Requirement {
	out := map[int][]Requirement{}
	for id, reqs := range g {
		implied := map[int]string{} // subject -> strongest guaranteed condition
		for _, b := range reqs {
			if b.Condition == Approved {
				guaranteed(g, b.SubjectID, implied, map[int]bool{})
			}
		}
		kept := []Requirement{}
		for _, r := range reqs {
			if c, ok := implied[r.SubjectID]; ok && (c == Approved || r.Condition == Regular) {
				continue
			}
			kept = append(kept, r)
		}
		out[id] = kept
	}
	return out
}

// guaranteed records what an approved subject guarantees about the subjects
// before it.
func guaranteed(g map[int][]Requirement, approved int, implied map[int]string, seen map[int]bool) {
	if seen[approved] {
		return
	}
	seen[approved] = true
	for _, r := range g[approved] {
		if implied[r.SubjectID] != Approved {
			implied[r.SubjectID] = r.Condition
		}
		if r.Condition == Approved {
			guaranteed(g, r.SubjectID, implied, seen)
		}
	}
}

// TermOfYear turns the API's absolute cuatrimestre (1..10) into 1 or 2
// within the year.
func TermOfYear(term *int) *int {
	if term == nil || *term <= 0 {
		return nil
	}
	t := (*term-1)%2 + 1
	return &t
}

// Validate checks the review against what the API returned: every subject
// must exist and every removal must match a correlativa the API has.
func (o Overrides) Validate(known map[int]bool, api map[int][]Requirement) error {
	for id := range o.Subjects {
		if !known[id] {
			return fmt.Errorf("override for unknown subject %d", id)
		}
	}
	for _, e := range o.AddPrerequisites {
		if !known[e.SubjectID] {
			return fmt.Errorf("prerequisite added to unknown subject %d", e.SubjectID)
		}
		if !known[e.Requires] {
			return fmt.Errorf("subject %d: added prerequisite %d is unknown", e.SubjectID, e.Requires)
		}
	}
	for _, e := range o.RemovePrerequisites {
		found := false
		for _, r := range api[e.SubjectID] {
			if r.SubjectID == e.Requires {
				found = true
			}
		}
		if !found {
			return fmt.Errorf("cannot remove prerequisite: subject %d does not require %d", e.SubjectID, e.Requires)
		}
	}
	return nil
}
