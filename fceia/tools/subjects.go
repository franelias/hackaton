package tools

import (
	"context"
	"strings"

	"github.com/franelias/hackaton/corrections"
)

type searchSubjectIn struct {
	Name     string `json:"name" jsonschema:"subject name or part of it"`
	CareerID int    `json:"career_id,omitempty" jsonschema:"restrict to a career (1 = Licenciatura en Ciencias de la Computación)"`
}

type subjectOut struct {
	SubjectID int    `json:"subject_id"`
	Code      string `json:"code"`
	Name      string `json:"name"`
	CareerID  int    `json:"career_id"`
	Year      *int   `json:"year"`
	Term      *int   `json:"term"` // 1 or 2 within the year
}

type searchSubjectOut struct {
	Subjects []subjectOut `json:"subjects"`
}

func (t *Tools) searchSubject(ctx context.Context, in searchSubjectIn) (searchSubjectOut, error) {
	if strings.TrimSpace(in.Name) == "" {
		return searchSubjectOut{}, invalidArgument("name must not be empty")
	}
	found, err := t.api.SearchSubjects(ctx, in.Name, in.CareerID)
	if err != nil {
		return searchSubjectOut{}, err
	}
	out := searchSubjectOut{Subjects: []subjectOut{}}
	for _, s := range found {
		// Year and term as in the reviewed plan, with term 1 or 2 within the year.
		year, term := s.Year, s.Term
		ov, err := reviewOf(s.CareerID)
		if err != nil {
			return searchSubjectOut{}, err
		}
		if o, ok := ov.Subjects[s.ID]; ok {
			if o.Year != nil {
				year = o.Year
			}
			if o.Term != nil {
				term = o.Term
			}
		}
		out.Subjects = append(out.Subjects, subjectOut{s.ID, s.Code, s.Name, s.CareerID, year, corrections.TermOfYear(term)})
	}
	return out, nil
}
