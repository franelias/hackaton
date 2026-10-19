package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"

	"github.com/franelias/hackaton/backend/internal/db"
	"github.com/franelias/hackaton/backend/internal/plan"
	"github.com/franelias/hackaton/backend/internal/tree"
)

func (s *Server) getPlan(w http.ResponseWriter, r *http.Request) {
	careerID, err := strconv.Atoi(chi.URLParam(r, "career_id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "carrera inexistente")
		return
	}
	var c db.Career
	if err := s.DB.First(&c, "faculty = ? AND id = ?", db.Faculty, careerID).Error; err != nil {
		s.dbErr(w, err, "carrera inexistente")
		return
	}
	var subjects []db.Subject
	var prereqs []db.Prerequisite
	if err := s.DB.Order("id").Find(&subjects, "faculty = ? AND career_id = ?", db.Faculty, careerID).Error; err != nil {
		s.dbErr(w, err, "")
		return
	}
	if err := s.DB.Order("requires_id").Find(&prereqs, "faculty = ? AND subject_id IN (?)", db.Faculty,
		s.DB.Model(&db.Subject{}).Select("id").Where("faculty = ? AND career_id = ?", db.Faculty, careerID)).Error; err != nil {
		s.dbErr(w, err, "")
		return
	}
	requires := map[int][]plan.Requisito{}
	for _, p := range prereqs {
		requires[p.SubjectID] = append(requires[p.SubjectID], plan.Requisito{SubjectID: p.RequiresID, Condicion: p.Condition})
	}
	out := plan.Plan{CareerID: c.ID, Nombre: c.Name, CuatrimestresMinimos: c.MinTerms, CaminoCritico: c.CriticalPath, Materias: []plan.Materia{}}
	for _, m := range subjects {
		out.Materias = append(out.Materias, plan.Materia{
			SubjectID: m.ID, Code: m.Code, Nombre: m.Name, Anio: m.Year, Cuatrimestre: m.Term, Opcional: m.Optional,
			Requiere: nonNil(requires[m.ID]), Destraba: nonNil(m.Unlocks), DestrabaTotal: m.UnlocksTotal,
			CuelloDeBotella: m.Bottleneck, Holgura: m.Slack, AtrasoPosponerAnio: m.PostponeYearDelay,
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
	var st db.Student
	err := s.DB.First(&st, "firebase_uid = ?", r.Context().Value(uidKey)).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"student_id": nil})
		return
	}
	if err != nil {
		s.dbErr(w, err, "")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"student_id": formatStudentID(st.ID)})
}

func (s *Server) createStudent(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     string `json:"name"`
		CareerID int    `json:"career_id"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Name == "" {
		writeErr(w, http.StatusBadRequest, "invalid_argument", "falta name")
		return
	}
	if err := s.DB.First(&db.Career{}, "faculty = ? AND id = ?", db.Faculty, body.CareerID).Error; err != nil {
		s.dbErr(w, err, "carrera inexistente")
		return
	}
	uid := r.Context().Value(uidKey).(string)
	st := db.Student{FirebaseUID: uid, Name: body.Name, Faculty: db.Faculty, CareerID: body.CareerID}
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
	if err := s.DB.Save(&db.StudentSubject{StudentID: st.ID, SubjectID: subjectID, State: body.State}).Error; err != nil {
		s.dbErr(w, err, "")
		return
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
		err = s.DB.First(&db.Subject{}, "faculty = ? AND id = ? AND career_id = ?", st.Faculty, id, st.CareerID).Error
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
	var subjects []db.Subject
	var prereqs []db.Prerequisite
	var states []db.StudentSubject
	var acts []db.Activity
	q := s.DB.Model(&db.Subject{}).Select("id").Where("faculty = ? AND career_id = ?", st.Faculty, st.CareerID)
	for _, err := range []error{
		s.DB.Find(&subjects, "faculty = ? AND career_id = ?", st.Faculty, st.CareerID).Error,
		s.DB.Find(&prereqs, "faculty = ? AND subject_id IN (?)", st.Faculty, q).Error,
		s.DB.Find(&states, "student_id = ?", st.ID).Error,
		s.DB.Find(&acts, "student_id = ?", st.ID).Error,
	} {
		if err != nil {
			s.dbErr(w, err, "")
			return
		}
	}

	in := tree.Input{Plan: map[int][]tree.Prereq{}, States: map[int]string{}, Since: st.CreatedAt, Now: s.Now()}
	for _, m := range subjects {
		in.Plan[m.ID] = nil
	}
	for _, p := range prereqs {
		in.Plan[p.SubjectID] = append(in.Plan[p.SubjectID], tree.Prereq{RequiresID: p.RequiresID, Condition: p.Condition})
	}
	for _, x := range states {
		in.States[x.SubjectID] = x.State
	}
	for _, a := range acts {
		in.Activities = append(in.Activities, tree.Activity{Type: a.Type, SubjectID: a.SubjectID, Result: a.Result, CreatedAt: a.CreatedAt})
	}
	t := tree.Build(in)
	if t.Subjects == nil {
		t.Subjects = []tree.Subject{}
	}
	writeJSON(w, http.StatusOK, struct {
		StudentID string `json:"student_id"`
		CareerID  int    `json:"career_id"`
		tree.Tree
	}{formatStudentID(st.ID), st.CareerID, t})
}
