package db

import (
	"errors"
	"sync"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/franelias/hackaton/backend/internal/tree"
)

// TreeInput loads what tree.Build and tree.Nudges need for a student.
func TreeInput(g *gorm.DB, st *Student, now time.Time) (tree.Input, error) {
	var subjects []Subject
	var prereqs []Prerequisite
	var states []StudentSubject
	var acts []Activity
	var periods []Period
	var fails []FailedExam
	q := g.Model(&Subject{}).Select("id").Where("faculty = ? AND career_id = ?", st.Faculty, st.CareerID)
	if err := Parallel(
		func() error {
			return g.Find(&subjects, "faculty = ? AND career_id = ?", st.Faculty, st.CareerID).Error
		},
		func() error { return g.Find(&prereqs, "faculty = ? AND subject_id IN (?)", st.Faculty, q).Error },
		func() error { return g.Find(&states, "student_id = ?", st.ID).Error },
		func() error { return g.Find(&acts, "student_id = ?", st.ID).Error },
		func() error { return g.Find(&periods, "faculty = ?", st.Faculty).Error },
		func() error { return g.Order("id").Find(&fails, "student_id = ?", st.ID).Error },
	); err != nil {
		return tree.Input{}, err
	}

	in := tree.Input{Plan: map[int][]tree.Prereq{}, Info: map[int]tree.SubjectInfo{}, States: map[int]string{}, StateSince: map[int]time.Time{}, Grades: map[int]int{}, Fails: map[int][]tree.Fail{}, Since: st.CreatedAt, Now: now}
	for _, m := range subjects {
		in.Plan[m.ID] = nil
		in.Info[m.ID] = tree.SubjectInfo{Name: m.Name, Bottleneck: m.Bottleneck, UnlocksTotal: m.UnlocksTotal}
	}
	for _, p := range prereqs {
		in.Plan[p.SubjectID] = append(in.Plan[p.SubjectID], tree.Prereq{RequiresID: p.RequiresID, Condition: p.Condition})
	}
	for _, x := range states {
		in.States[x.SubjectID] = x.State
		in.StateSince[x.SubjectID] = x.Since
		if x.Grade != nil {
			in.Grades[x.SubjectID] = *x.Grade
		}
	}
	for _, f := range fails {
		in.Fails[f.SubjectID] = append(in.Fails[f.SubjectID], tree.Fail{ID: f.ID, Grade: f.Grade})
	}
	for _, a := range acts {
		var topic string
		if a.Topic != nil {
			topic = *a.Topic
		}
		in.Activities = append(in.Activities, tree.Activity{Type: a.Type, SubjectID: a.SubjectID, Topic: topic, Result: a.Result, Date: a.Date, CreatedAt: a.CreatedAt})
	}
	for _, p := range periods {
		in.Periods = append(in.Periods, tree.Period{Kind: p.Kind, From: p.Starts, To: p.Ends})
	}
	return in, nil
}

// UpsertSubjectStates saves subject states in one statement; since only moves
// when the state changes. A row without grade keeps the one it had, and leaving
// approved drops it.
func UpsertSubjectStates(g *gorm.DB, rows []StudentSubject) error {
	return g.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "student_id"}, {Name: "subject_id"}},
		DoUpdates: clause.Set{
			{Column: clause.Column{Name: "state"}, Value: gorm.Expr("excluded.state")},
			{Column: clause.Column{Name: "since"}, Value: gorm.Expr("CASE WHEN student_subjects.state = excluded.state THEN student_subjects.since ELSE excluded.since END")},
			{Column: clause.Column{Name: "grade"}, Value: gorm.Expr("CASE WHEN excluded.state = 'approved' THEN COALESCE(excluded.grade, student_subjects.grade) END")},
		},
	}).Create(&rows).Error
}

// Parallel runs independent queries at once: with a remote database every
// round trip counts.
func Parallel(queries ...func() error) error {
	errs := make([]error, len(queries))
	var wg sync.WaitGroup
	for i, q := range queries {
		wg.Go(func() { errs[i] = q() })
	}
	wg.Wait()
	return errors.Join(errs...)
}
