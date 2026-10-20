package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/franelias/hackaton/backend/internal/course"
	"github.com/franelias/hackaton/backend/internal/db"
	"github.com/franelias/hackaton/backend/internal/tree"
)

// Teacher view (docs/contratos.md §2.6).

// teacher is the teacher whose email is the token's verified email, or nil.
func (s *Server) teacher(r *http.Request) (*db.Teacher, error) {
	email := r.Context().Value(emailKey).(string)
	if email == "" {
		return nil, nil
	}
	// Find, not First: most users are not teachers, and First logs every miss
	var t db.Teacher
	res := s.DB.Limit(1).Find(&t, "email = ?", email)
	if res.Error != nil || res.RowsAffected == 0 {
		return nil, res.Error
	}
	return &t, nil
}

// ownTeacher is teacher, writing 403 when the user is not one.
func (s *Server) ownTeacher(w http.ResponseWriter, r *http.Request) (*db.Teacher, bool) {
	t, err := s.teacher(r)
	if err != nil {
		s.dbErr(w, err, "")
		return nil, false
	}
	if t == nil {
		writeErr(w, http.StatusForbidden, "forbidden", "esta cuenta no es de un docente (o su mail no está verificado)")
		return nil, false
	}
	return t, true
}

// taught are the subjects t teaches, by year and term.
func (s *Server) taught(t *db.Teacher) ([]db.Subject, error) {
	var subjects []db.Subject
	err := s.DB.
		Joins("JOIN teacher_subjects ts ON ts.faculty = subjects.faculty AND ts.subject_id = subjects.id").
		Where("ts.teacher_id = ?", t.ID).
		Order("subjects.year, subjects.term, subjects.name").
		Find(&subjects).Error
	return subjects, err
}

type subjectInfo struct {
	SubjectID int    `json:"subject_id"`
	CareerID  int    `json:"career_id"`
	Name      string `json:"name"`
	Year      *int   `json:"year"`
	Term      *int   `json:"term"`
}

func infoOf(m db.Subject) subjectInfo {
	return subjectInfo{SubjectID: m.ID, CareerID: m.CareerID, Name: m.Name, Year: m.Year, Term: m.Term}
}

func (s *Server) getTeacher(w http.ResponseWriter, r *http.Request) {
	t, ok := s.ownTeacher(w, r)
	if !ok {
		return
	}
	subjects, err := s.taught(t)
	if err != nil {
		s.dbErr(w, err, "")
		return
	}
	type item struct {
		subjectInfo
		Students   int                `json:"students"`
		Health     course.HealthCount `json:"health"`
		OpenAlerts int                `json:"open_alerts"`
	}
	out := struct {
		TeacherID string `json:"teacher_id"`
		Name      string `json:"name"`
		Subjects  []item `json:"subjects"`
	}{formatTeacherID(t.ID), t.Name, []item{}}
	classes, err := s.classes(subjects)
	if err != nil {
		s.dbErr(w, err, "")
		return
	}
	for _, m := range subjects {
		sum := course.Build(m.ID, classes[m.ID], s.Now()).Summary
		out.Subjects = append(out.Subjects, item{infoOf(m), sum.Students, sum.Health, sum.OpenAlerts})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) getTeacherSubject(w http.ResponseWriter, r *http.Request) {
	t, ok := s.ownTeacher(w, r)
	if !ok {
		return
	}
	subjects, err := s.taught(t)
	if err != nil {
		s.dbErr(w, err, "")
		return
	}
	id, _ := strconv.Atoi(chi.URLParam(r, "subject_id"))
	var subject *db.Subject
	for i := range subjects {
		if subjects[i].ID == id {
			subject = &subjects[i]
		}
	}
	if subject == nil {
		writeErr(w, http.StatusNotFound, "not_found", "no dictás esa materia")
		return
	}
	classes, err := s.classes([]db.Subject{*subject})
	if err != nil {
		s.dbErr(w, err, "")
		return
	}
	d := course.Build(subject.ID, classes[subject.ID], s.Now())

	type student struct {
		StudentID string `json:"student_id"`
		course.Student
	}
	out := struct {
		subjectInfo
		Summary  course.Summary `json:"summary"`
		Students []student      `json:"students"`
		Weeks    []course.Week  `json:"weeks"`
		Topics   []course.Topic `json:"topics"`
	}{infoOf(*subject), d.Summary, []student{}, d.Weeks, d.Topics}
	for _, st := range d.Students {
		out.Students = append(out.Students, student{formatStudentID(st.ID), st})
	}
	writeJSON(w, http.StatusOK, out)
}

// classes loads the students enrolled in each subject (by subject id) with
// their tree, activity and alerts, in a few queries for all of them: the
// database is remote and a query per student made the page take 20 seconds.
//
// It only reads. The alerts are the conditions the tree has now, including
// the ones the student dismissed: the teacher still needs to see them.
func (s *Server) classes(subjects []db.Subject) (map[int][]course.Member, error) {
	out := map[int][]course.Member{}
	if len(subjects) == 0 {
		return out, nil
	}
	faculty := subjects[0].Faculty // a teacher teaches in one faculty
	ids := make([]int, len(subjects))
	for i, m := range subjects {
		ids[i] = m.ID
	}

	var enrolled []db.StudentSubject
	var students []db.Student
	q := s.DB.Model(&db.StudentSubject{}).Select("student_id").Where("subject_id IN ? AND state = ?", ids, tree.Enrolled)
	if err := parallel(
		func() error { return s.DB.Find(&enrolled, "subject_id IN ? AND state = ?", ids, tree.Enrolled).Error },
		func() error { return s.DB.Order("id").Find(&students, "faculty = ? AND id IN (?)", faculty, q).Error },
	); err != nil {
		return nil, err
	}
	if len(students) == 0 {
		return out, nil
	}
	studentIDs := make([]int, len(students))
	careers := map[int]bool{}
	for i, st := range students {
		studentIDs[i] = st.ID
		careers[st.CareerID] = true
	}
	careerIDs := make([]int, 0, len(careers))
	for c := range careers {
		careerIDs = append(careerIDs, c)
	}

	var planSubjects []db.Subject
	var prereqs []db.Prerequisite
	var periods []db.Period
	var states []db.StudentSubject
	var acts []db.Activity
	inCareers := s.DB.Model(&db.Subject{}).Select("id").Where("faculty = ? AND career_id IN ?", faculty, careerIDs)
	if err := parallel(
		func() error {
			return s.DB.Find(&planSubjects, "faculty = ? AND career_id IN ?", faculty, careerIDs).Error
		},
		func() error {
			return s.DB.Find(&prereqs, "faculty = ? AND subject_id IN (?)", faculty, inCareers).Error
		},
		func() error { return s.DB.Find(&periods, "faculty = ?", faculty).Error },
		func() error { return s.DB.Find(&states, "student_id IN ?", studentIDs).Error },
		func() error { return db.LoadActivities(s.DB, studentIDs, &acts) },
	); err != nil {
		return nil, err
	}

	// the same tree.Input that state builds, from the rows loaded above
	// each career's subjects and correlativas once, not scanned again per student
	careerOf := map[int]int{}
	subjectsOf := map[int][]db.Subject{}
	prereqsOf := map[int][]db.Prerequisite{}
	for _, m := range planSubjects {
		careerOf[m.ID] = m.CareerID
		subjectsOf[m.CareerID] = append(subjectsOf[m.CareerID], m)
	}
	for _, p := range prereqs {
		prereqsOf[careerOf[p.SubjectID]] = append(prereqsOf[careerOf[p.SubjectID]], p)
	}
	statesOf := map[int]map[int]string{}
	for _, x := range states {
		if statesOf[x.StudentID] == nil {
			statesOf[x.StudentID] = map[int]string{}
		}
		statesOf[x.StudentID][x.SubjectID] = x.State
	}
	actsOf := map[int][]tree.Activity{}
	for _, a := range acts {
		var topic string
		if a.Topic != nil {
			topic = *a.Topic
		}
		actsOf[a.StudentID] = append(actsOf[a.StudentID], tree.Activity{Type: a.Type, SubjectID: a.SubjectID, Topic: topic, Result: a.Result, Date: a.Date, CreatedAt: a.CreatedAt})
	}
	var tperiods []tree.Period
	for _, p := range periods {
		tperiods = append(tperiods, tree.Period{Kind: p.Kind, From: p.Starts, To: p.Ends})
	}

	members := map[int]course.Member{}
	for _, st := range students {
		in := tree.Input{Plan: map[int][]tree.Prereq{}, Info: map[int]tree.SubjectInfo{}, States: statesOf[st.ID], Activities: actsOf[st.ID], Periods: tperiods, Since: st.CreatedAt, Now: s.Now()}
		if in.States == nil {
			in.States = map[int]string{}
		}
		for _, m := range subjectsOf[st.CareerID] {
			in.Plan[m.ID] = nil
			in.Info[m.ID] = tree.SubjectInfo{Name: m.Name, Bottleneck: m.Bottleneck, UnlocksTotal: m.UnlocksTotal}
		}
		for _, p := range prereqsOf[st.CareerID] {
			in.Plan[p.SubjectID] = append(in.Plan[p.SubjectID], tree.Prereq{RequiresID: p.RequiresID, Condition: p.Condition})
		}
		t := tree.Build(in)
		m := course.Member{ID: st.ID, Name: st.Name, Activities: in.Activities}
		alerted := map[int]bool{}
		for _, a := range t.Alerts {
			m.Alerts = append(m.Alerts, course.Alert{Type: a.Type, Level: a.Level, Message: a.Message, SubjectID: a.SubjectID})
			if a.SubjectID != nil {
				alerted[*a.SubjectID] = true
			}
		}
		tree.MarkDry(&t, alerted)
		m.Tree = t
		members[st.ID] = m
	}

	for _, e := range enrolled {
		if m, ok := members[e.StudentID]; ok {
			out[e.SubjectID] = append(out[e.SubjectID], m)
		}
	}
	return out, nil
}
