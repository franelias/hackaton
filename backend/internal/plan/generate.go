package plan

import (
	"context"
	"fmt"
	"sort"
	"sync"

	"github.com/franelias/hackaton/backend/internal/fceia"
)

const fetchWorkers = 8

// Generate loads a career from the FCEIA API, applies the manual-review
// overrides and builds its plan.
func Generate(ctx context.Context, api *fceia.Client, careerID int, ov Overrides) (*Result, error) {
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

	in := Input{CareerID: careerID, Name: career.Name, Prerequisites: map[int][]Prerequisite{}}
	inCareer := map[int]bool{}
	for _, s := range subjects {
		inCareer[s.ID] = true
		in.Subjects = append(in.Subjects, Subject{
			ID: s.ID, Code: s.Code, Name: s.Name, Year: s.Year, Term: s.Term,
			Elective: s.Kind == "electiva",
		})
	}
	for i, s := range subjects {
		for _, p := range relations[i].Prerequisites {
			if !inCareer[p.RelatedSubjectID] {
				continue // belongs to another career
			}
			cond := Aprobada // the API leaves requirement null for plain approval (to confirm, issue #6)
			if p.Requirement == "regular" {
				cond = Regular
			}
			in.Prerequisites[s.ID] = append(in.Prerequisites[s.ID], Prerequisite{p.RelatedSubjectID, cond})
		}
	}
	if err := ov.apply(&in); err != nil {
		return nil, err
	}
	return Build(in)
}

func (ov Overrides) apply(in *Input) error {
	index := map[int]int{}
	for i, s := range in.Subjects {
		index[s.ID] = i
	}
	for id, o := range ov.Subjects {
		i, ok := index[id]
		if !ok {
			return fmt.Errorf("override for unknown subject %d", id)
		}
		if o.Year != nil {
			in.Subjects[i].Year = o.Year
		}
		if o.Term != nil {
			in.Subjects[i].Term = o.Term
		}
	}
	for _, e := range ov.RemovePrerequisites {
		list := in.Prerequisites[e.SubjectID]
		kept := list[:0:0]
		for _, p := range list {
			if p.SubjectID != e.Requires {
				kept = append(kept, p)
			}
		}
		if len(kept) == len(list) {
			return fmt.Errorf("cannot remove prerequisite: subject %d does not require %d", e.SubjectID, e.Requires)
		}
		in.Prerequisites[e.SubjectID] = kept
	}
	for _, e := range ov.AddPrerequisites {
		if _, ok := index[e.SubjectID]; !ok {
			return fmt.Errorf("prerequisite added to unknown subject %d", e.SubjectID)
		}
		cond := e.Condition
		if cond == "" {
			cond = Aprobada
		}
		if cond != Aprobada && cond != Regular {
			return fmt.Errorf("subject %d: condition must be %q or %q, got %q", e.SubjectID, Aprobada, Regular, cond)
		}
		in.Prerequisites[e.SubjectID] = append(in.Prerequisites[e.SubjectID], Prerequisite{e.Requires, cond})
	}
	return nil
}
