// Package tree computes a student's tree (contract §2.2) from the career plan,
// the subject states the student loaded and their activity. It is pure: no
// database, no HTTP.
package tree

import (
	"encoding/json"
	"sort"
	"time"
)

const (
	Approved  = "approved"
	Regular   = "regular"
	Enrolled  = "enrolled"
	Available = "available"

	Lush     = "lush"
	Wilted   = "wilted"
	Withered = "withered"

	// MockExamPass is the minimum mock exam score (0-100) that puts a flower.
	MockExamPass = 60
)

type Prereq struct {
	RequiresID int
	Condition  string // approved | regular
}

type Activity struct {
	Type      string
	SubjectID *int
	Result    json.RawMessage
	Date      *time.Time // exam date (civil date at UTC midnight)
	CreatedAt time.Time
}

type SubjectInfo struct {
	Name         string
	Bottleneck   bool
	UnlocksTotal int
}

type Period struct {
	Kind     string    // recess | exams
	From, To time.Time // civil dates at UTC midnight, inclusive
}

type Input struct {
	// Plan maps every subject of the career to its prerequisites.
	Plan       map[int][]Prereq
	States     map[int]string // subject_id -> approved | regular | enrolled
	Info       map[int]SubjectInfo
	Activities []Activity
	Periods    []Period
	// Since is when the student joined; it counts as activity so a new tree is lush.
	Since time.Time
	Now   time.Time
}

type Health struct {
	State        string    `json:"state"`
	LastActivity time.Time `json:"last_activity"`
}

type Streak struct {
	Weeks     int `json:"weeks"`
	Best      int `json:"best"`
	Wildcards int `json:"wildcards"`
}

type Subject struct {
	SubjectID int    `json:"subject_id"`
	State     string `json:"state"`
	Leaves    int    `json:"leaves"`
	Flower    bool   `json:"flower"`
	Dry       bool   `json:"dry"`
}

type Tree struct {
	Health   Health    `json:"health"`
	Streak   Streak    `json:"streak"`
	Subjects []Subject `json:"subjects"`
	// Alerts are the conditions that hold now; the caller persists them and
	// marks branches dry with MarkDry.
	Alerts []Alert `json:"-"`
}

func Build(in Input) Tree {
	leaves := map[int]int{}
	flower := map[int]bool{}
	last := in.Since
	for _, a := range in.Activities {
		if a.CreatedAt.After(last) {
			last = a.CreatedAt
		}
		if a.SubjectID == nil {
			continue
		}
		switch a.Type {
		case "exercise", "mock_exam", "chat":
			leaves[*a.SubjectID]++
		}
		if a.Type == "mock_exam" {
			var r struct{ Score float64 }
			if json.Unmarshal(a.Result, &r) == nil && r.Score >= MockExamPass {
				flower[*a.SubjectID] = true
			}
		}
	}

	var subjects []Subject
	for id, reqs := range in.Plan {
		state := in.States[id]
		if state == "" {
			if !satisfied(reqs, in.States) {
				continue // locked: omitted, the app assumes it
			}
			state = Available
		}
		subjects = append(subjects, Subject{
			SubjectID: id,
			State:     state,
			Leaves:    leaves[id],
			Flower:    flower[id] && state != Approved,
		})
	}
	sort.Slice(subjects, func(i, j int) bool { return subjects[i].SubjectID < subjects[j].SubjectID })

	days, season := inactiveDays(last, in), examSeason(in)
	return Tree{
		Health:   Health{State: healthState(days, season), LastActivity: last},
		Streak:   streak(in),
		Subjects: subjects,
		Alerts:   alerts(in, days, season),
	}
}

// MarkDry dries the branches with an open alert, except approved ones.
func MarkDry(t *Tree, alerted map[int]bool) {
	for i, s := range t.Subjects {
		t.Subjects[i].Dry = alerted[s.SubjectID] && s.State != Approved
	}
}

func satisfied(reqs []Prereq, states map[int]string) bool {
	for _, r := range reqs {
		s := states[r.RequiresID]
		if s == Approved || (r.Condition == Regular && s == Regular) {
			continue
		}
		return false
	}
	return true
}
