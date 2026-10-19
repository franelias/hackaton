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

// relations returns what a subject requires and unlocks after the manual
// review, so the tutor never says something the plan contradicts.
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

	codes, names := map[int]string{}, map[int]string{}
	var apiReqs []corrections.Requirement
	for _, p := range rel.Prerequisites {
		codes[p.RelatedSubjectID] = p.RelatedCode
		cond := corrections.Approved
		if p.Requirement == "regular" {
			cond = corrections.Regular
		}
		apiReqs = append(apiReqs, corrections.Requirement{SubjectID: p.RelatedSubjectID, Condition: cond})
	}
	var apiUnlocks []int
	for _, u := range rel.RequiredBy {
		names[u.SubjectID] = u.SubjectName
		apiUnlocks = append(apiUnlocks, u.SubjectID)
	}

	for _, r := range ov.Prerequisites(subjectID, apiReqs) {
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
	for _, id := range ov.Unlocks(subjectID, apiUnlocks) {
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
