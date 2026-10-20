package db

import (
	"errors"
	"sync"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/franelias/hackaton/backend/internal/tree"
)

// Plan is what every student of a career shares: its subjects and
// correlativas, and the calendar periods of its faculty.
type Plan struct {
	Subjects []Subject
	Prereqs  []Prerequisite
	Periods  []Period
}

// Rows is what a student adds to a Plan to make a tree.Input.
type Rows struct {
	States []StudentSubject
	Acts   []Activity
	Fails  []FailedExam
}

// LoadPlan loads the plan of a career.
func LoadPlan(g *gorm.DB, faculty string, careerID int) (*Plan, error) {
	p := &Plan{}
	return p, Parallel(p.queries(g, faculty, careerID)...)
}

func (p *Plan) queries(g *gorm.DB, faculty string, careerID int) []func() error {
	q := g.Model(&Subject{}).Select("id").Where("faculty = ? AND career_id = ?", faculty, careerID)
	return []func() error{
		func() error { return g.Find(&p.Subjects, "faculty = ? AND career_id = ?", faculty, careerID).Error },
		func() error { return g.Find(&p.Prereqs, "faculty = ? AND subject_id IN (?)", faculty, q).Error },
		func() error { return g.Find(&p.Periods, "faculty = ?", faculty).Error },
	}
}

// LoadRows loads the states, activities and failed finals of the students in
// one query each, split by student.
func LoadRows(g *gorm.DB, studentIDs []int) (map[int]*Rows, error) {
	var all Rows
	if err := Parallel(all.queries(g, studentIDs)...); err != nil {
		return nil, err
	}
	out := make(map[int]*Rows, len(studentIDs))
	of := func(id int) *Rows {
		if out[id] == nil {
			out[id] = &Rows{}
		}
		return out[id]
	}
	for _, x := range all.States {
		of(x.StudentID).States = append(of(x.StudentID).States, x)
	}
	for _, a := range all.Acts {
		of(a.StudentID).Acts = append(of(a.StudentID).Acts, a)
	}
	for _, f := range all.Fails {
		of(f.StudentID).Fails = append(of(f.StudentID).Fails, f)
	}
	return out, nil
}

func (r *Rows) queries(g *gorm.DB, ids []int) []func() error {
	return []func() error{
		func() error { return g.Find(&r.States, "student_id IN ?", ids).Error },
		func() error { return LoadActivities(g, ids, &r.Acts) },
		func() error { return g.Order("id").Find(&r.Fails, "student_id IN ?", ids).Error },
	}
}

// civilDay is created_at's date in Argentina, the calendar the tree counts days in.
const civilDay = `(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date`

// LoadActivities loads the students' activities, oldest first. Every chat
// message is an activity, so they pile up with use; the tree only reads a
// chat row for its civil day and for the newest instant (chat has no
// subject), so only the last chat row of each day is loaded.
func LoadActivities(g *gorm.DB, studentIDs []int, out *[]Activity) error {
	return g.Raw(`SELECT * FROM (
		(SELECT * FROM activities WHERE student_id IN ? AND type <> 'chat')
		UNION ALL
		(SELECT DISTINCT ON (student_id, `+civilDay+`) * FROM activities WHERE student_id IN ? AND type = 'chat'
			ORDER BY student_id, `+civilDay+`, created_at DESC)
	) a ORDER BY created_at, id`, studentIDs, studentIDs).Scan(out).Error
}

// Input makes the tree.Input of a student of the plan's career from its rows.
func (p *Plan) Input(st *Student, r Rows, now time.Time) tree.Input {
	in := tree.Input{Plan: map[int][]tree.Prereq{}, Info: map[int]tree.SubjectInfo{}, States: map[int]string{}, StateSince: map[int]time.Time{}, Grades: map[int]int{}, Fails: map[int][]tree.Fail{}, Since: st.CreatedAt, Now: now}
	for _, m := range p.Subjects {
		in.Plan[m.ID] = nil
		in.Info[m.ID] = tree.SubjectInfo{Name: m.Name, Bottleneck: m.Bottleneck, UnlocksTotal: m.UnlocksTotal}
	}
	for _, x := range p.Prereqs {
		in.Plan[x.SubjectID] = append(in.Plan[x.SubjectID], tree.Prereq{RequiresID: x.RequiresID, Condition: x.Condition})
	}
	for _, x := range r.States {
		in.States[x.SubjectID] = x.State
		in.StateSince[x.SubjectID] = x.Since
		if x.Grade != nil {
			in.Grades[x.SubjectID] = *x.Grade
		}
	}
	for _, f := range r.Fails {
		in.Fails[f.SubjectID] = append(in.Fails[f.SubjectID], tree.Fail{ID: f.ID, Grade: f.Grade})
	}
	for _, a := range r.Acts {
		var topic string
		if a.Topic != nil {
			topic = *a.Topic
		}
		in.Activities = append(in.Activities, tree.Activity{Type: a.Type, SubjectID: a.SubjectID, Topic: topic, Result: a.Result, Date: a.Date, CreatedAt: a.CreatedAt})
	}
	for _, x := range p.Periods {
		in.Periods = append(in.Periods, tree.Period{Kind: x.Kind, From: x.Starts, To: x.Ends})
	}
	return in
}

// TreeInput loads what tree.Build and tree.Nudges need for a student.
func TreeInput(g *gorm.DB, st *Student, now time.Time) (tree.Input, error) {
	var p Plan
	var r Rows
	if err := Parallel(append(p.queries(g, st.Faculty, st.CareerID), r.queries(g, []int{st.ID})...)...); err != nil {
		return tree.Input{}, err
	}
	return p.Input(st, r, now), nil
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
