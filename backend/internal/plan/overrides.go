package plan

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
)

// Overrides is the manual-review layer applied on top of what the API says.
// The API itself is never modified.
type Overrides struct {
	// Subjects fixes year/term, keyed by subject_id.
	Subjects map[int]SubjectOverride `json:"subjects"`
	// AddPrerequisites adds a missing correlativa. Condition defaults to "approved".
	AddPrerequisites []PrerequisiteEdit `json:"add_prerequisites"`
	// RemovePrerequisites drops a wrong correlativa.
	RemovePrerequisites []PrerequisiteEdit `json:"remove_prerequisites"`
}

type SubjectOverride struct {
	Year *int `json:"year"`
	Term *int `json:"term"`
}

type PrerequisiteEdit struct {
	SubjectID int    `json:"subject_id"`
	Requires  int    `json:"requires"`
	Condition string `json:"condition"`
}

// LoadOverrides reads an overrides file. An empty path means no overrides.
func LoadOverrides(path string) (Overrides, error) {
	if path == "" {
		return Overrides{}, nil
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return Overrides{}, err
	}
	var ov Overrides
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&ov); err != nil {
		return Overrides{}, fmt.Errorf("%s: %w", path, err)
	}
	return ov, nil
}
