package tools

import (
	"context"
	"strings"
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
	Term      *int   `json:"term"`
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
		out.Subjects = append(out.Subjects, subjectOut{s.ID, s.Code, s.Name, s.CareerID, s.Year, s.Term})
	}
	return out, nil
}
