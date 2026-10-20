package plan

import (
	"context"
	"fmt"
	"sort"
	"sync"

	"github.com/franelias/hackaton/backend/internal/fceia"
	"github.com/franelias/hackaton/corrections"
)

const fetchWorkers = 8

// Generate loads a career from the FCEIA API, applies the manual-review
// corrections and builds its plan.
func Generate(ctx context.Context, api *fceia.Client, careerID int, ov corrections.Overrides) (*Result, error) {
	career, err := api.Career(ctx, careerID)
	if err != nil {
		return nil, err
	}
	curriculum, err := api.Curriculum(ctx, careerID)
	if err != nil {
		return nil, err
	}

	var subjects []fceia.Subject
	for _, list := range curriculum.SubjectsByYear {
		subjects = append(subjects, list...)
	}
	sort.Slice(subjects, func(i, j int) bool { return subjects[i].ID < subjects[j].ID })

	relations := make([]fceia.Relations, len(subjects))
	errs := make([]error, len(subjects))
	var wg sync.WaitGroup
	sem := make(chan struct{}, fetchWorkers)
	for i, s := range subjects {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			relations[i], errs[i] = api.Relations(ctx, s.ID)
		}()
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			return nil, fmt.Errorf("subject %d: %w", subjects[i].ID, err)
		}
	}

	known := map[int]bool{}
	for _, s := range subjects {
		known[s.ID] = true
	}
	fromAPI := map[int][]corrections.Requirement{}
	for i, s := range subjects {
		for _, p := range relations[i].Prerequisites {
			if !known[p.RelatedSubjectID] {
				continue // belongs to another career
			}
			cond := corrections.Approved // null in the API means plain approval (confirmed for LCC, issue #6)
			if p.Requirement == "regular" {
				cond = corrections.Regular
			}
			fromAPI[s.ID] = append(fromAPI[s.ID], corrections.Requirement{SubjectID: p.RelatedSubjectID, Condition: cond})
		}
	}
	if err := ov.Validate(known, fromAPI); err != nil {
		return nil, err
	}

	in := Input{CareerID: careerID, Name: career.Name, Prerequisites: map[int][]Prerequisite{}}
	for _, s := range subjects {
		sub := Subject{ID: s.ID, Code: s.Code, Name: s.Name, Year: s.Year, Term: s.Term, Elective: s.Kind == "electiva"}
		if o, ok := ov.Subjects[s.ID]; ok {
			if o.Year != nil {
				sub.Year = o.Year
			}
			if o.Term != nil {
				sub.Term = o.Term
			}
			if o.Elective != nil {
				sub.Elective = *o.Elective
			}
		}
		in.Subjects = append(in.Subjects, sub)
	}
	// Corrected and reduced to the direct correlativas, the same graph the tools use.
	for id, reqs := range ov.Graph(fromAPI) {
		for _, r := range reqs {
			in.Prerequisites[id] = append(in.Prerequisites[id], Prerequisite{r.SubjectID, r.Condition})
		}
	}
	return Build(in)
}
