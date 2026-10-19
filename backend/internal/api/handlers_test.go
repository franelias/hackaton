package api

import (
	"encoding/json"
	"testing"

	"github.com/franelias/hackaton/backend/internal/db"
)

func TestValidateActivity(t *testing.T) {
	topic := "inducción"
	cases := []struct {
		name    string
		a       db.Activity
		date    *string
		wantErr bool
	}{
		{"checkin", db.Activity{Type: "checkin"}, nil, false},
		{"exercise ok", db.Activity{Type: "exercise", SubjectID: new(12), Topic: &topic, Result: json.RawMessage(`{"correct":false}`)}, nil, false},
		{"exercise without correct", db.Activity{Type: "exercise", SubjectID: new(12), Topic: &topic, Result: json.RawMessage(`{}`)}, nil, true},
		{"exercise without topic", db.Activity{Type: "exercise", SubjectID: new(12), Result: json.RawMessage(`{"correct":true}`)}, nil, true},
		{"exercise without subject", db.Activity{Type: "exercise", Topic: &topic, Result: json.RawMessage(`{"correct":true}`)}, nil, true},
		{"mock_exam ok", db.Activity{Type: "mock_exam", SubjectID: new(12), Result: json.RawMessage(`{"score":60}`)}, nil, false},
		{"mock_exam over 100", db.Activity{Type: "mock_exam", SubjectID: new(12), Result: json.RawMessage(`{"score":101}`)}, nil, true},
		{"exam ok", db.Activity{Type: "exam", SubjectID: new(12)}, new("2026-11-15"), false},
		{"exam bad date", db.Activity{Type: "exam", SubjectID: new(12)}, new("15/11"), true},
		{"exam without date", db.Activity{Type: "exam", SubjectID: new(12)}, nil, true},
		{"chat is internal", db.Activity{Type: "chat"}, nil, true},
	}
	for _, c := range cases {
		if got := validateActivity(&c.a, c.date); (got != "") != c.wantErr {
			t.Errorf("%s: got %q, wantErr %v", c.name, got, c.wantErr)
		}
	}
}

func TestParseStudentID(t *testing.T) {
	for in, want := range map[string]int{"s-001": 1, "s-42": 42, "s-0": 0, "a-001": 0, "s-x": 0, "": 0} {
		got, ok := parseStudentID(in)
		if (want == 0 && ok) || (want != 0 && got != want) {
			t.Errorf("parseStudentID(%q) = %d, %v", in, got, ok)
		}
	}
	if formatStudentID(7) != "s-007" {
		t.Error(formatStudentID(7))
	}
}

func TestParseMockExam(t *testing.T) {
	if s, m, msg := parseMockExam(json.RawMessage(`{"subject_id":12,"minutes":120}`)); s != 12 || m != 120 || msg != "" {
		t.Errorf("got %d %d %q", s, m, msg)
	}
	for _, bad := range []string{`{"minutes":120}`, `{"subject_id":12,"minutes":5}`, `{"subject_id":12,"minutes":301}`, `not json`} {
		if _, _, msg := parseMockExam(json.RawMessage(bad)); msg == "" {
			t.Errorf("%s: want an error", bad)
		}
	}
}
