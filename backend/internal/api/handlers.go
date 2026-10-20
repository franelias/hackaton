package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"

	"github.com/franelias/hackaton/backend/internal/db"
	"github.com/franelias/hackaton/backend/internal/plan"
	"github.com/franelias/hackaton/backend/internal/tree"
)

// getFaculties lists the faculties and the careers each one has loaded, for onboarding.
func (s *Server) getFaculties(w http.ResponseWriter, r *http.Request) {
	type career struct {
		CareerID int    `json:"career_id"`
		Name     string `json:"name"`
	}
	type faculty struct {
		FacultyID string   `json:"faculty_id"`
		Name      string   `json:"name"`
		Careers   []career `json:"careers"`
	}
	var careers []db.Career
	if err := s.DB.Order("faculty, name").Find(&careers).Error; err != nil {
		s.dbErr(w, err, "")
		return
	}
	out := []faculty{}
	for _, c := range careers {
		if len(out) == 0 || out[len(out)-1].FacultyID != c.Faculty {
			name := db.FacultyNames[c.Faculty]
			if name == "" {
				name = c.Faculty
			}
			out = append(out, faculty{FacultyID: c.Faculty, Name: name})
		}
		f := &out[len(out)-1]
		f.Careers = append(f.Careers, career{CareerID: c.ID, Name: c.Name})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) getPlan(w http.ResponseWriter, r *http.Request) {
	careerID, err := strconv.Atoi(chi.URLParam(r, "career_id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "carrera inexistente")
		return
	}
	var c db.Career
	var subjects []db.Subject
	var prereqs []db.Prerequisite
	if err := parallel(
		func() error { return s.DB.First(&c, "faculty = ? AND id = ?", db.Faculty, careerID).Error },
		func() error {
			return s.DB.Order("id").Find(&subjects, "faculty = ? AND career_id = ?", db.Faculty, careerID).Error
		},
		func() error {
			return s.DB.Order("requires_id").Find(&prereqs, "faculty = ? AND subject_id IN (?)", db.Faculty,
				s.DB.Model(&db.Subject{}).Select("id").Where("faculty = ? AND career_id = ?", db.Faculty, careerID)).Error
		},
	); err != nil {
		s.dbErr(w, err, "carrera inexistente")
		return
	}
	requires := map[int][]plan.Requirement{}
	for _, p := range prereqs {
		requires[p.SubjectID] = append(requires[p.SubjectID], plan.Requirement{SubjectID: p.RequiresID, Condition: p.Condition})
	}
	out := plan.Plan{CareerID: c.ID, Name: c.Name, MinTerms: c.MinTerms, CriticalPath: c.CriticalPath, Subjects: []plan.PlanSubject{}}
	for _, m := range subjects {
		out.Subjects = append(out.Subjects, plan.PlanSubject{
			SubjectID: m.ID, Code: m.Code, Name: m.Name, Year: m.Year, Term: m.Term, Optional: m.Optional,
			Requires: nonNil(requires[m.ID]), Unlocks: nonNil(m.Unlocks), UnlocksTotal: m.UnlocksTotal,
			Bottleneck: m.Bottleneck, Slack: m.Slack, PostponeYearDelay: m.PostponeYearDelay,
		})
	}
	w.Header().Set("Cache-Control", "public, max-age=3600")
	writeJSON(w, http.StatusOK, out)
}

func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

func (s *Server) getMe(w http.ResponseWriter, r *http.Request) {
	me := map[string]any{"student_id": nil, "teacher_id": nil}
	var students []db.Student
	var t *db.Teacher
	err := parallel(
		func() error {
			return s.DB.Limit(1).Find(&students, "firebase_uid = ?", r.Context().Value(uidKey)).Error
		},
		func() (err error) { t, err = s.teacher(r); return err },
	)
	if err != nil {
		s.dbErr(w, err, "")
		return
	}
	if len(students) > 0 {
		me["student_id"] = formatStudentID(students[0].ID)
	}
	if t != nil {
		me["teacher_id"] = formatTeacherID(t.ID)
	}
	writeJSON(w, http.StatusOK, me)
}

func (s *Server) createStudent(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name      string `json:"name"`
		FacultyID string `json:"faculty_id"`
		CareerID  int    `json:"career_id"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Name = strings.TrimSpace(body.Name); body.Name == "" {
		writeErr(w, http.StatusBadRequest, "invalid_argument", "falta name")
		return
	}
	if utf8.RuneCountInString(body.Name) > 80 || strings.IndexFunc(body.Name, unicode.IsControl) >= 0 {
		writeErr(w, http.StatusBadRequest, "invalid_argument", "name tiene que ser una línea de hasta 80 caracteres")
		return
	}
	if body.FacultyID == "" {
		body.FacultyID = db.Faculty
	}
	if err := s.DB.First(&db.Career{}, "faculty = ? AND id = ?", body.FacultyID, body.CareerID).Error; err != nil {
		s.dbErr(w, err, "carrera inexistente en esa facultad")
		return
	}
	uid := r.Context().Value(uidKey).(string)
	st := db.Student{FirebaseUID: uid, Name: body.Name, Faculty: body.FacultyID, CareerID: body.CareerID}
	// ON CONFLICT DO NOTHING leaves ID at 0 when this uid already has a student.
	res := s.DB.Exec(`INSERT INTO students (firebase_uid, name, faculty, career_id) VALUES (?, ?, ?, ?) ON CONFLICT (firebase_uid) DO NOTHING`,
		st.FirebaseUID, st.Name, st.Faculty, st.CareerID)
	if res.Error != nil {
		s.dbErr(w, res.Error, "")
		return
	}
	if res.RowsAffected == 0 {
		writeErr(w, http.StatusConflict, "conflict", "este usuario ya tiene un alumno")
		return
	}
	if err := s.DB.First(&st, "firebase_uid = ?", uid).Error; err != nil {
		s.dbErr(w, err, "")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"student_id": formatStudentID(st.ID)})
}

func (s *Server) getTree(w http.ResponseWriter, r *http.Request) {
	s.writeTree(w, studentFrom(r))
}

func (s *Server) putSubject(w http.ResponseWriter, r *http.Request) {
	st := studentFrom(r)
	subjectID, ok := s.careerSubject(w, st, chi.URLParam(r, "subject_id"))
	if !ok {
		return
	}
	var body struct {
		State string `json:"state"`
		Grade *int   `json:"grade"` // optional, approved only; without it the grade stays
	}
	if !decode(w, r, &body) {
		return
	}
	switch body.State {
	case tree.Approved, tree.Regular, tree.Enrolled:
	default:
		writeErr(w, http.StatusBadRequest, "invalid_argument", "state debe ser approved, regular o enrolled")
		return
	}
	if body.Grade != nil && (body.State != tree.Approved || !validGrade(*body.Grade)) {
		writeErr(w, http.StatusBadRequest, "invalid_argument", "grade va de 1 a 10 y solo en una materia approved")
		return
	}
	if err := db.UpsertSubjectStates(s.DB, []db.StudentSubject{{StudentID: st.ID, SubjectID: subjectID, State: body.State, Since: s.Now(), Grade: body.Grade}}); err != nil {
		s.dbErr(w, err, "")
		return
	}
	s.writeTree(w, st)
}

// deleteSubject clears the state the student marked, so the subject goes back to
// available or locked by its correlativas. Clearing an unmarked subject is not an error.
func (s *Server) deleteSubject(w http.ResponseWriter, r *http.Request) {
	st := studentFrom(r)
	subjectID, ok := s.careerSubject(w, st, chi.URLParam(r, "subject_id"))
	if !ok {
		return
	}
	if err := s.DB.Delete(&db.StudentSubject{}, "student_id = ? AND subject_id = ?", st.ID, subjectID).Error; err != nil {
		s.dbErr(w, err, "")
		return
	}
	s.writeTree(w, st)
}

func validGrade(g int) bool { return g >= 1 && g <= 10 }

// postFail records a failed final (aplazo) of a subject.
func (s *Server) postFail(w http.ResponseWriter, r *http.Request) {
	st := studentFrom(r)
	subjectID, ok := s.careerSubject(w, st, chi.URLParam(r, "subject_id"))
	if !ok {
		return
	}
	var body struct {
		Grade int `json:"grade"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !validGrade(body.Grade) {
		writeErr(w, http.StatusBadRequest, "invalid_argument", "grade va de 1 a 10")
		return
	}
	if err := s.DB.Create(&db.FailedExam{StudentID: st.ID, SubjectID: subjectID, Grade: body.Grade}).Error; err != nil {
		s.dbErr(w, err, "")
		return
	}
	s.writeTree(w, st)
}

// deleteFail removes an aplazo loaded by mistake.
func (s *Server) deleteFail(w http.ResponseWriter, r *http.Request) {
	st := studentFrom(r)
	id, err := strconv.Atoi(chi.URLParam(r, "fail_id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "aplazo inexistente")
		return
	}
	res := s.DB.Delete(&db.FailedExam{}, "id = ? AND student_id = ?", id, st.ID)
	if res.Error != nil {
		s.dbErr(w, res.Error, "")
		return
	}
	if res.RowsAffected == 0 {
		writeErr(w, http.StatusNotFound, "not_found", "aplazo inexistente")
		return
	}
	s.writeTree(w, st)
}

// putSubjects sets the state of several subjects at once (onboarding). Subjects
// not in the body keep their state. All or nothing: one invalid entry rejects the request.
func (s *Server) putSubjects(w http.ResponseWriter, r *http.Request) {
	st := studentFrom(r)
	var body struct {
		Subjects []struct {
			SubjectID int    `json:"subject_id"`
			State     string `json:"state"`
		} `json:"subjects"`
	}
	if !decode(w, r, &body) {
		return
	}
	// keyed by subject so a repeated subject keeps its last state
	states := map[int]string{}
	for _, m := range body.Subjects {
		switch m.State {
		case tree.Approved, tree.Regular, tree.Enrolled:
		default:
			writeErr(w, http.StatusBadRequest, "invalid_argument", "state debe ser approved, regular o enrolled")
			return
		}
		states[m.SubjectID] = m.State
	}
	rows := make([]db.StudentSubject, 0, len(states))
	ids := make([]int, 0, len(states))
	for id, state := range states {
		rows = append(rows, db.StudentSubject{StudentID: st.ID, SubjectID: id, State: state, Since: s.Now()})
		ids = append(ids, id)
	}
	if len(rows) > 0 {
		var n int64
		if err := s.DB.Model(&db.Subject{}).Where("faculty = ? AND career_id = ? AND id IN ?", st.Faculty, st.CareerID, ids).Count(&n).Error; err != nil {
			s.dbErr(w, err, "")
			return
		}
		if int(n) != len(ids) {
			writeErr(w, http.StatusNotFound, "not_found", "alguna materia no es de la carrera del alumno")
			return
		}
		// one upsert statement, so it's all or nothing
		if err := db.UpsertSubjectStates(s.DB, rows); err != nil {
			s.dbErr(w, err, "")
			return
		}
	}
	s.writeTree(w, st)
}

func (s *Server) postActivity(w http.ResponseWriter, r *http.Request) {
	st := studentFrom(r)
	var body struct {
		Type      string          `json:"type"`
		SubjectID *int            `json:"subject_id"`
		Topic     *string         `json:"topic"`
		Result    json.RawMessage `json:"result"`
		Date      *string         `json:"date"`
	}
	if !decode(w, r, &body) {
		return
	}
	a := db.Activity{StudentID: st.ID, Type: body.Type, SubjectID: body.SubjectID, Topic: body.Topic, Result: body.Result}
	if msg := validateActivity(&a, body.Date); msg != "" {
		writeErr(w, http.StatusBadRequest, "invalid_argument", msg)
		return
	}
	if a.SubjectID != nil {
		if _, ok := s.careerSubject(w, st, strconv.Itoa(*a.SubjectID)); !ok {
			return
		}
	}
	if err := s.DB.Create(&a).Error; err != nil {
		s.dbErr(w, err, "")
		return
	}
	s.writeTree(w, st)
}

// validateActivity checks the per-type fields of contract §2.4 and sets a.Date.
// It returns a message for the student, or "" when valid.
func validateActivity(a *db.Activity, date *string) string {
	needSubject := a.Type != "checkin"
	switch a.Type {
	case "checkin":
	case "exercise":
		var r struct{ Correct *bool }
		if a.Topic == nil || *a.Topic == "" {
			return "exercise necesita topic"
		}
		if json.Unmarshal(a.Result, &r) != nil || r.Correct == nil {
			return `exercise necesita result: {"correct": bool}`
		}
	case "mock_exam":
		var r struct{ Score *float64 }
		if json.Unmarshal(a.Result, &r) != nil || r.Score == nil || *r.Score < 0 || *r.Score > 100 {
			return `mock_exam necesita result: {"score": 0-100}`
		}
	case "exam":
		if date == nil {
			return "exam necesita date (YYYY-MM-DD)"
		}
		d, err := time.Parse(time.DateOnly, *date)
		if err != nil {
			return "date debe ser YYYY-MM-DD"
		}
		a.Date = &d
	default:
		return "type debe ser checkin, exercise, mock_exam o exam"
	}
	if needSubject && a.SubjectID == nil {
		return a.Type + " necesita subject_id"
	}
	return ""
}

// careerSubject parses a subject id and checks it belongs to the student's career.
func (s *Server) careerSubject(w http.ResponseWriter, st *db.Student, raw string) (int, bool) {
	id, err := strconv.Atoi(raw)
	if err == nil {
		err = s.subjectInCareer(st, id)
	}
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			s.dbErr(w, err, "")
			return 0, false
		}
		writeErr(w, http.StatusNotFound, "not_found", "la materia no es de la carrera del alumno")
		return 0, false
	}
	return id, true
}

func (s *Server) writeTree(w http.ResponseWriter, st *db.Student) {
	t, _, err := s.state(st)
	if err != nil {
		s.dbErr(w, err, "")
		return
	}
	writeJSON(w, http.StatusOK, struct {
		StudentID string `json:"student_id"`
		CareerID  int    `json:"career_id"`
		tree.Tree
	}{formatStudentID(st.ID), st.CareerID, t})
}

// state builds the student's tree, syncs the alerts table with the conditions
// that hold now and returns the open (not dismissed) alerts.
func (s *Server) state(st *db.Student) (tree.Tree, []db.Alert, error) {
	in, err := db.TreeInput(s.DB, st, s.Now())
	if err != nil {
		return tree.Tree{}, nil, err
	}
	t := tree.Build(in)
	if t.Subjects == nil {
		t.Subjects = []tree.Subject{}
	}

	open, err := s.syncAlerts(st.ID, t.Alerts)
	if err != nil {
		return tree.Tree{}, nil, err
	}
	alerted := map[int]bool{}
	for _, a := range open {
		if a.SubjectID != nil {
			alerted[*a.SubjectID] = true
		}
	}
	tree.MarkDry(&t, alerted)
	return t, open, nil
}

// alertsLock is the advisory lock class of syncAlerts: pg_advisory_xact_lock(alertsLock, student).
const alertsLock = 1

// syncAlerts makes the student's alert rows match want: new conditions are
// inserted, a changed key reopens a dismissed alert, and conditions that no
// longer hold are deleted. Only the rows that change are written: it runs on
// every read of the tree and the alerts, and most of the time nothing changes.
// The app reads the tree and the alerts at once, so the writes take a lock per
// student and diff again under it: two syncs never insert the same alert.
func (s *Server) syncAlerts(studentID int, want []tree.Alert) ([]db.Alert, error) {
	var rows []db.Alert
	if err := s.DB.Find(&rows, "student_id = ?", studentID).Error; err != nil {
		return nil, err
	}
	d := diffAlerts(studentID, rows, want)
	if len(d.save) > 0 || len(d.remove) > 0 {
		err := s.DB.Transaction(func(tx *gorm.DB) error {
			if err := tx.Exec("SELECT pg_advisory_xact_lock(?, ?)", alertsLock, studentID).Error; err != nil {
				return err
			}
			// another sync may have written while this one waited for the lock
			rows = nil
			if err := tx.Find(&rows, "student_id = ?", studentID).Error; err != nil {
				return err
			}
			d = diffAlerts(studentID, rows, want)
			for i := range d.save {
				if err := tx.Save(&d.save[i]).Error; err != nil {
					return err
				}
			}
			for _, r := range d.remove {
				if err := tx.Delete(&r).Error; err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
		for _, r := range d.save {
			if !r.Dismissed {
				d.open = append(d.open, r)
			}
		}
	}
	open := d.open
	sort.Slice(open, func(i, j int) bool {
		return levelRank[open[i].Level] > levelRank[open[j].Level] || (open[i].Level == open[j].Level && open[i].ID < open[j].ID)
	})
	return open, nil
}

type alertDiff struct {
	open   []db.Alert // unchanged and not dismissed
	save   []db.Alert // to insert or update
	remove []db.Alert // conditions that no longer hold
}

// diffAlerts compares the stored rows with the conditions that hold now.
func diffAlerts(studentID int, rows []db.Alert, want []tree.Alert) alertDiff {
	key := func(typ string, subject *int) string {
		if subject == nil {
			return typ
		}
		return typ + "/" + strconv.Itoa(*subject)
	}
	existing := map[string]db.Alert{}
	for _, r := range rows {
		existing[key(r.Type, r.SubjectID)] = r
	}
	var d alertDiff
	for _, a := range want {
		action, _ := json.Marshal(a.Action)
		r, ok := existing[key(a.Type, a.SubjectID)]
		delete(existing, key(a.Type, a.SubjectID))
		before := r
		switch {
		case !ok:
			r = db.Alert{StudentID: studentID, Type: a.Type, SubjectID: a.SubjectID}
		case r.CondKey == a.Key:
			// Same condition: keep it dismissed if it was, refresh the text.
		default:
			r.Dismissed = false
		}
		r.Level, r.Message, r.Action, r.CondKey = a.Level, a.Message, action, a.Key
		if !ok || r.Dismissed != before.Dismissed || r.Level != before.Level || r.Message != before.Message || r.CondKey != before.CondKey || !bytes.Equal(r.Action, before.Action) {
			d.save = append(d.save, r)
		} else if !r.Dismissed {
			d.open = append(d.open, r)
		}
	}
	for _, r := range existing {
		d.remove = append(d.remove, r)
	}
	return d
}

var levelRank = map[string]int{tree.Low: 0, tree.Medium: 1, tree.High: 2}

func (s *Server) getAlerts(w http.ResponseWriter, r *http.Request) {
	_, open, err := s.state(studentFrom(r))
	if err != nil {
		s.dbErr(w, err, "")
		return
	}
	type alert struct {
		ID        string          `json:"id"`
		Level     string          `json:"level"`
		Type      string          `json:"type"`
		SubjectID *int            `json:"subject_id"`
		Message   string          `json:"message"`
		Action    json.RawMessage `json:"action"`
	}
	out := []alert{}
	for _, a := range open {
		out = append(out, alert{formatAlertID(a.ID), a.Level, a.Type, a.SubjectID, a.Message, a.Action})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) dismissAlert(w http.ResponseWriter, r *http.Request) {
	id, ok := parseAlertID(chi.URLParam(r, "alert_id"))
	res := s.DB.Model(&db.Alert{}).Where("id = ? AND student_id = ?", id, studentFrom(r).ID).Update("dismissed", true)
	if res.Error != nil {
		s.dbErr(w, res.Error, "")
		return
	}
	if !ok || res.RowsAffected == 0 {
		writeErr(w, http.StatusNotFound, "not_found", "alerta inexistente")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// subjectInCareer returns gorm.ErrRecordNotFound when the subject is not in the student's career.
func (s *Server) subjectInCareer(st *db.Student, id int) error {
	return s.DB.First(&db.Subject{}, "faculty = ? AND id = ? AND career_id = ?", st.Faculty, id, st.CareerID).Error
}
