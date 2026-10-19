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
	Term *int `json:"term"`
	// Elective turns a subject into an optional one (its hours are elective).
	Elective *bool `json:"elective"`
	// FinalGoal marks the subject the whole career leads to (the Tesina): it
	// stays out of the correlativa graph.
	FinalGoal bool   `json:"final_goal"`
	Note      string `json:"note"`
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
