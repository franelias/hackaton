package tools

import (
	"context"
	"sync"

	"github.com/franelias/hackaton/corrections"
)

// linked is a subject on the other end of a correlativa.
type linked struct {
	SubjectID int
	Code      string
	Name      string
	Condition string // "approved" or "regular"
}

// reviews caches each career's embedded manual review.
var reviews sync.Map // career_id -> corrections.Overrides

func reviewOf(careerID int) (corrections.Overrides, error) {
	if v, ok := reviews.Load(careerID); ok {
		return v.(corrections.Overrides), nil
	}
	ov, err := corrections.For(careerID)
	if err != nil {
		return corrections.Overrides{}, err
	}
	reviews.Store(careerID, ov)
	return ov, nil
}

func conditionOf(c string) string {
	if c == corrections.Regular {
		return "regular"
	}
	return "approved"
}

// relations returns what a subject directly requires and unlocks after the
// manual review: a correlativa implied by another one is left out, the same
// way the backend plan does, so the tutor never says something the plan
// contradicts.
func (t *Tools) relations(ctx context.Context, subjectID int) (requires, unlocks []linked, err error) {
	rel, err := t.api.Relations(ctx, subjectID)
	if err != nil {
		return nil, nil, err
	}
	subject, err := t.api.Subject(ctx, subjectID)
	if err != nil {
		return nil, nil, err
	}
	ov, err := reviewOf(subject.CareerID)
	if err != nil {
		return nil, nil, err
	}

	g := map[int][]corrections.Requirement{}
	codes := map[int]string{}
	if err := t.loadBackward(ctx, ov, subjectID, g, codes); err != nil {
		return nil, nil, err
	}
	for _, r := range corrections.Reduce(g)[subjectID] {
		code, ok := codes[r.SubjectID]
		if !ok { // added by the review: the API does not know this link
			s, err := t.api.Subject(ctx, r.SubjectID)
			if err != nil {
				return nil, nil, err
			}
			code = s.Code
		}
		requires = append(requires, linked{SubjectID: r.SubjectID, Code: code, Condition: conditionOf(r.Condition)})
	}

	names := map[int]string{}
	var apiUnlocks []int
	for _, u := range rel.RequiredBy {
		names[u.SubjectID] = u.SubjectName
		apiUnlocks = append(apiUnlocks, u.SubjectID)
	}
	for _, id := range ov.Unlocks(subjectID, apiUnlocks) {
		// Keep it only if this subject is still a direct correlativa of it.
		if err := t.loadBackward(ctx, ov, id, g, codes); err != nil {
			return nil, nil, err
		}
		direct := false
		for _, r := range corrections.Reduce(g)[id] {
			direct = direct || r.SubjectID == subjectID
		}
		if !direct {
			continue
		}
		name, ok := names[id]
		if !ok {
			s, err := t.api.Subject(ctx, id)
			if err != nil {
				return nil, nil, err
			}
			name = s.Name
		}
		unlocks = append(unlocks, linked{SubjectID: id, Name: name})
	}
	return requires, unlocks, nil
}

// loadBackward adds to g the corrected correlativas of id and of everything
// before it, which is what reducing id's correlativas needs. codes collects
// the codes the API gives for them.
func (t *Tools) loadBackward(ctx context.Context, ov corrections.Overrides, id int, g map[int][]corrections.Requirement, codes map[int]string) error {
	if _, done := g[id]; done {
		return nil
	}
	rel, err := t.api.Relations(ctx, id)
	if err != nil {
		return err
	}
	var api []corrections.Requirement
	for _, p := range rel.Prerequisites {
		codes[p.RelatedSubjectID] = p.RelatedCode
		cond := corrections.Approved
		if p.Requirement == "regular" {
			cond = corrections.Regular
		}
		api = append(api, corrections.Requirement{SubjectID: p.RelatedSubjectID, Condition: cond})
	}
	g[id] = ov.Prerequisites(id, api)
	for _, r := range g[id] {
		if err := t.loadBackward(ctx, ov, r.SubjectID, g, codes); err != nil {
			return err
		}
	}
	return nil
}
