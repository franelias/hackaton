// Package plan turns a career's correlativas into the plan tree of
// docs/contratos.md §2.1: what each subject unlocks, which ones are
// bottlenecks and how much the career slips if a subject is held back.
//
// Model: each subject takes one cuatrimestre, there is no limit of subjects
// per cuatrimestre and a subject can start the cuatrimestre after all its
// prerequisites. That is a lower bound for how long the career takes.
// Subjects are offered once a year, so "leaving" one means postponing it
// PostponeTerms cuatrimestres.
package plan

import (
	"fmt"
	"sort"
)

const (
	// BottleneckThreshold is the destraba_total from which a subject is a
	// cuello de botella.
	BottleneckThreshold = 8
	// PostponeTerms is how long a missed subject is held back: it is offered
	// once a year.
	PostponeTerms = 2
)

type Requirement struct {
	SubjectID int    `json:"subject_id"`
	Condition string `json:"condition"`
}

// PlanSubject is one subject of the plan tree.
type PlanSubject struct {
	SubjectID    int           `json:"subject_id"`
	Code         string        `json:"code"`
	Name         string        `json:"name"`
	Year         *int          `json:"year"`
	Term         *int          `json:"term"` // 1 or 2 within the year
	Optional     bool          `json:"optional"`
	Requires     []Requirement `json:"requires"`
	Unlocks      []int         `json:"unlocks"`
	UnlocksTotal int           `json:"unlocks_total"`
	Bottleneck   bool          `json:"bottleneck"`
	// Slack: cuatrimestres the subject can be held back without delaying the
	// career. It is 0 on the critical path. Only computed for the base plan.
	Slack int `json:"slack"`
	// PostponeYearDelay: cuatrimestres the career slips if the subject is
	// postponed a year.
	PostponeYearDelay int `json:"postpone_year_delay"`
}

// FinalGoal is the subject the career leads to (the Tesina). It is not a node
// of the correlativa graph: it needs every other subject approved.
type FinalGoal struct {
	SubjectID   int    `json:"subject_id"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	Year        *int   `json:"year"`
	Term        *int   `json:"term"`
	RequiresAll bool   `json:"requires_all"`
}

type Plan struct {
	CareerID     int           `json:"career_id"`
	Name         string        `json:"name"`
	MinTerms     int           `json:"min_terms"`
	CriticalPath []int         `json:"critical_path"`
	Subjects     []PlanSubject `json:"subjects"`
	FinalGoal    *FinalGoal    `json:"final_goal"`
}

// Analysis is the critical path of the obligatory subjects plus the electives
// a student chose.
type Analysis struct {
	MinTerms     int
	CriticalPath []int
}

// Result is a built plan that can also be analysed with chosen electives.
type Result struct {
	Plan Plan
	g    *graph
}

// Build validates the correlativas and computes the base plan, which covers
// the obligatory subjects. Electives appear as optional subjects with no
// time metrics: use Analyze to see them in the critical path.
func Build(in Input) (*Result, error) {
	in, goal, err := splitFinalGoal(in)
	if err != nil {
		return nil, err
	}
	g, err := newGraph(in)
	if err != nil {
		return nil, err
	}
	base := map[int]bool{}
	for _, id := range g.ids {
		if !g.subjects[id].Elective {
			base[id] = true
		}
	}
	sched := g.schedule(base, nil)

	p := Plan{
		CareerID:     in.CareerID,
		Name:         in.Name,
		MinTerms:     sched.terms,
		CriticalPath: g.criticalPath(sched),
		Subjects:     []PlanSubject{},
	}
	for _, id := range g.ids {
		s := g.subjects[id]
		m := PlanSubject{
			SubjectID: id, Code: s.Code, Name: s.Name, Year: s.Year,
			Term: termOfYear(s.Term), Optional: s.Elective,
			Requires: []Requirement{}, Unlocks: g.unlocks[id],
			UnlocksTotal: g.descendants(id),
		}
		if m.Unlocks == nil {
			m.Unlocks = []int{}
		}
		for _, r := range g.requires[id] {
			m.Requires = append(m.Requires, Requirement{r.SubjectID, r.Condition})
		}
		m.Bottleneck = m.UnlocksTotal >= BottleneckThreshold
		if base[id] {
			m.Slack = g.slack(sched, id)
			m.PostponeYearDelay = g.postponeDelay(base, sched, id, PostponeTerms)
		}
		p.Subjects = append(p.Subjects, m)
	}
	p.FinalGoal = goal
	sort.SliceStable(p.Subjects, func(i, j int) bool {
		a, b := p.Subjects[i], p.Subjects[j]
		if a.Optional != b.Optional {
			return !a.Optional
		}
		if ay, by := yearKey(a.Year), yearKey(b.Year); ay != by {
			return ay < by
		}
		if at, bt := termKey(a.Term), termKey(b.Term); at != bt {
			return at < bt
		}
		return a.SubjectID < b.SubjectID
	})
	return &Result{Plan: p, g: g}, nil
}

func (g *graph) postponeDelay(active map[int]bool, base schedule, id, terms int) int {
	held := g.schedule(active, map[int]int{id: base.start[id] + terms})
	return held.terms - base.terms
}

// Analyze recomputes the critical path with the chosen electives added to the
// obligatory subjects.
func (r *Result) Analyze(chosenElectives []int) (Analysis, error) {
	active := map[int]bool{}
	for _, id := range r.g.ids {
		if !r.g.subjects[id].Elective {
			active[id] = true
		}
	}
	for _, id := range chosenElectives {
		s, ok := r.g.subjects[id]
		if !ok {
			return Analysis{}, fmt.Errorf("unknown subject %d", id)
		}
		if !s.Elective {
			return Analysis{}, fmt.Errorf("subject %d is not an elective", id)
		}
		active[id] = true
	}
	for id := range active {
		for _, p := range r.g.requires[id] {
			if !active[p.SubjectID] {
				return Analysis{}, fmt.Errorf("elective %d requires elective %d, which was not chosen", id, p.SubjectID)
			}
		}
	}
	sched := r.g.schedule(active, nil)
	return Analysis{MinTerms: sched.terms, CriticalPath: r.g.criticalPath(sched)}, nil
}

// termOfYear turns the API's absolute term (1..10) into 1 or 2 within the year.
func termOfYear(term *int) *int {
	if term == nil || *term <= 0 {
		return nil
	}
	t := (*term-1)%2 + 1
	return &t
}

func yearKey(y *int) int {
	if y == nil {
		return 99
	}
	return *y
}

func termKey(t *int) int {
	if t == nil {
		return 99
	}
	return *t
}

// splitFinalGoal takes the final-goal subject out of the graph.
func splitFinalGoal(in Input) (Input, *FinalGoal, error) {
	var goal *FinalGoal
	rest := in
	rest.Subjects = nil
	rest.Prerequisites = map[int][]Prerequisite{}
	finals := map[int]bool{}
	for _, s := range in.Subjects {
		if !s.FinalGoal {
			continue
		}
		if goal != nil {
			return Input{}, nil, fmt.Errorf("more than one final goal: %d and %d", goal.SubjectID, s.ID)
		}
		goal = &FinalGoal{SubjectID: s.ID, Code: s.Code, Name: s.Name, Year: s.Year, Term: termOfYear(s.Term), RequiresAll: true}
		finals[s.ID] = true
	}
	for _, s := range in.Subjects {
		if !finals[s.ID] {
			rest.Subjects = append(rest.Subjects, s)
		}
	}
	for id, list := range in.Prerequisites {
		if finals[id] {
			continue
		}
		for _, p := range list {
			if finals[p.SubjectID] {
				return Input{}, nil, fmt.Errorf("subject %d requires the final goal %d", id, p.SubjectID)
			}
		}
		rest.Prerequisites[id] = list
	}
	return rest, goal, nil
}
