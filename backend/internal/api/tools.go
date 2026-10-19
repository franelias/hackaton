package api

import (
	"context"
	"encoding/json"
	"errors"

	"gorm.io/gorm"

	"github.com/franelias/hackaton/backend/internal/db"
	"github.com/franelias/hackaton/backend/internal/tree"
	"github.com/franelias/hackaton/backend/internal/tutor"
)

// localTools are the tutor tools backed by our database. The student is fixed
// by the authenticated request, never chosen by the model.
func (s *Server) localTools(st *db.Student, conv *db.Conversation) []tutor.Tool {
	return []tutor.Tool{
		{
			Name:        "view_my_tree",
			Description: "The student's tree: health, weekly streak, each subject with its state (approved, regular, enrolled, available; locked ones are omitted), leaves (exercises and sessions), flower (mock exam passed), the topics practiced (correct/attempts, mastered after 3 correct) and the open alerts.",
			Parameters:  map[string]any{"type": "object", "properties": map[string]any{}},
			Status:      "Mirando tu árbol…",
			Run:         func(context.Context, json.RawMessage) (string, bool) { return s.viewTree(st) },
		},
		{
			Name: "record_progress",
			Description: "Save the student's progress. type exercise: an exercise the student answered (topic and result {correct: bool} required). " +
				"type mock_exam: a graded mock exam (result {score: 0-100} required). type exam: the date of an upcoming real exam (date YYYY-MM-DD required), " +
				"or that the student took it (same date plus result, e.g. {score: 70}).",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"type":       map[string]any{"type": "string", "enum": []string{"exercise", "mock_exam", "exam"}},
					"subject_id": map[string]any{"type": "integer"},
					"topic":      map[string]any{"type": "string"},
					"result":     map[string]any{"type": "object"},
					"date":       map[string]any{"type": "string", "description": "YYYY-MM-DD"},
				},
				"required": []string{"type", "subject_id"},
			},
			Status: "Registrando tu progreso…",
			Run: func(_ context.Context, args json.RawMessage) (string, bool) {
				return s.recordProgress(st, conv, args)
			},
		},
		{
			Name:        "start_mock_exam",
			Description: "Start a timed mock exam. While it runs, each student message tells you the elapsed minutes.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"subject_id": map[string]any{"type": "integer"},
					"minutes":    map[string]any{"type": "integer", "minimum": 10, "maximum": 300},
				},
				"required": []string{"subject_id", "minutes"},
			},
			Status: "Preparando el simulacro…",
			Run: func(_ context.Context, args json.RawMessage) (string, bool) {
				subjectID, minutes, msg := parseMockExam(args)
				if msg != "" {
					return msg, true
				}
				if err := s.subjectInCareer(st, subjectID); err != nil {
					return "subject not in the student's career", true
				}
				now := s.Now()
				conv.MockSubjectID, conv.MockMinutes, conv.MockStartedAt = &subjectID, &minutes, &now
				if err := s.DB.Save(conv).Error; err != nil {
					return err.Error(), true
				}
				return "mock exam started", false
			},
		},
	}
}

func (s *Server) viewTree(st *db.Student) (string, bool) {
	t, alerts, err := s.state(st)
	if err != nil {
		return err.Error(), true
	}
	var subjects []db.Subject
	if err := s.DB.Find(&subjects, "faculty = ? AND career_id = ?", st.Faculty, st.CareerID).Error; err != nil {
		return err.Error(), true
	}
	names := map[int]string{}
	for _, m := range subjects {
		names[m.ID] = m.Name
	}
	var exercises []db.Activity
	if err := s.DB.Find(&exercises, "student_id = ? AND type = 'exercise'", st.ID).Error; err != nil {
		return err.Error(), true
	}
	var acts []tree.Activity
	for _, a := range exercises {
		if a.Topic != nil {
			acts = append(acts, tree.Activity{Type: a.Type, SubjectID: a.SubjectID, Topic: *a.Topic, Result: a.Result})
		}
	}
	topics := tree.Topics(acts)
	type subject struct {
		tree.Subject
		Name   string           `json:"name"`
		Topics []tree.TopicStat `json:"topics,omitempty"`
	}
	type alert struct {
		Level     string `json:"level"`
		Type      string `json:"type"`
		Message   string `json:"message"`
		SubjectID *int   `json:"subject_id"`
	}
	out := struct {
		Health   tree.Health `json:"health"`
		Streak   tree.Streak `json:"streak"`
		Subjects []subject   `json:"subjects"`
		Alerts   []alert     `json:"alerts"`
	}{Health: t.Health, Streak: t.Streak}
	for _, x := range t.Subjects {
		out.Subjects = append(out.Subjects, subject{x, names[x.SubjectID], topics[x.SubjectID]})
	}
	for _, a := range alerts {
		out.Alerts = append(out.Alerts, alert{a.Level, a.Type, a.Message, a.SubjectID})
	}
	b, _ := json.Marshal(out)
	return string(b), false
}

func (s *Server) recordProgress(st *db.Student, conv *db.Conversation, args json.RawMessage) (string, bool) {
	var in struct {
		Type      string          `json:"type"`
		SubjectID *int            `json:"subject_id"`
		Topic     *string         `json:"topic"`
		Result    json.RawMessage `json:"result"`
		Date      *string         `json:"date"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return "invalid arguments: " + err.Error(), true
	}
	if in.Type == "checkin" {
		return "type must be exercise, mock_exam or exam", true
	}
	a := db.Activity{StudentID: st.ID, Type: in.Type, SubjectID: in.SubjectID, Topic: in.Topic, Result: in.Result}
	if msg := validateActivity(&a, in.Date); msg != "" {
		return msg, true
	}
	if err := s.subjectInCareer(st, *a.SubjectID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "subject not in the student's career", true
		}
		return err.Error(), true
	}
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&a).Error; err != nil {
			return err
		}
		if a.Type == "mock_exam" && conv.MockStartedAt != nil {
			conv.MockSubjectID, conv.MockMinutes, conv.MockStartedAt = nil, nil, nil
			return tx.Model(conv).Updates(map[string]any{"mock_subject_id": nil, "mock_minutes": nil, "mock_started_at": nil}).Error
		}
		return nil
	})
	if err != nil {
		return err.Error(), true
	}
	// Report the subject's branch so the model can celebrate a new flower.
	t, _, err := s.state(st)
	if err != nil {
		return "saved", false
	}
	for _, x := range t.Subjects {
		if x.SubjectID == *a.SubjectID {
			b, _ := json.Marshal(x)
			return "saved; branch now " + string(b), false
		}
	}
	return "saved", false
}

// parseMockExam reads start_mock_exam's arguments; msg is set when they are invalid.
func parseMockExam(args json.RawMessage) (subjectID, minutes int, msg string) {
	var in struct {
		SubjectID int `json:"subject_id"`
		Minutes   int `json:"minutes"`
	}
	if json.Unmarshal(args, &in) != nil || in.SubjectID <= 0 || in.Minutes < 10 || in.Minutes > 300 {
		return 0, 0, "subject_id and minutes (10-300) are required"
	}
	return in.SubjectID, in.Minutes, ""
}
