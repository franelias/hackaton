package course

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/franelias/hackaton/backend/internal/tree"
)

// Monday 19 Oct 2026, noon in Argentina.
var now = time.Date(2026, 10, 19, 15, 0, 0, 0, time.UTC)

const subject = 2

func at(daysAgo int) time.Time { return now.Add(-time.Duration(daysAgo) * 24 * time.Hour) }

func exercise(daysAgo int, s int, topic string, correct bool) tree.Activity {
	r, _ := json.Marshal(map[string]bool{"correct": correct})
	return tree.Activity{Type: "exercise", SubjectID: &s, Topic: topic, Result: r, CreatedAt: at(daysAgo)}
}

func civil(y int, m time.Month, d int) *time.Time {
	t := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	return &t
}

func members() []Member {
	other := 12
	return []Member{
		{
			ID: 1, Name: "Ana",
			Tree: tree.Tree{Health: tree.Health{State: tree.Lush, LastActivity: at(0)}, Subjects: []tree.Subject{{SubjectID: subject, State: tree.Enrolled, Flower: true}}},
			Activities: []tree.Activity{
				exercise(0, subject, "Límites", true), exercise(0, subject, "límites", true), exercise(1, subject, "limites", true),
				exercise(8, subject, "continuidad", false),
				exercise(0, other, "inducción", true), // another subject: not counted
				{Type: "mock_exam", SubjectID: new(subject), Result: json.RawMessage(`{"score":55}`), CreatedAt: at(3)},
				{Type: "mock_exam", SubjectID: new(subject), Result: json.RawMessage(`{"score":72}`), CreatedAt: at(2)},
				{Type: "exam", SubjectID: new(subject), Date: civil(2026, 10, 29), CreatedAt: at(20)},
				{Type: "exam", SubjectID: new(subject), Date: civil(2026, 10, 5), CreatedAt: at(30)}, // already past
			},
		},
		{
			ID: 2, Name: "Beto",
			Tree:       tree.Tree{Health: tree.Health{State: tree.Withered, LastActivity: at(12)}, Subjects: []tree.Subject{{SubjectID: subject, State: tree.Enrolled, Dry: true}}},
			Activities: []tree.Activity{exercise(70, subject, "límites", false)},
			Alerts: []Alert{
				{Type: "first_exam_missed", Level: tree.High, SubjectID: new(subject)},
				{Type: "inactivity", Level: tree.Medium},
				{Type: "first_exam_missed", Level: tree.High, SubjectID: &other}, // another subject: not shown
			},
		},
		{
			ID: 3, Name: "Caro",
			Tree: tree.Tree{Health: tree.Health{State: tree.Wilted, LastActivity: at(6)}},
		},
	}
}

func TestBuild(t *testing.T) {
	d := Build(subject, members(), now)

	if s := d.Summary; s.Students != 3 || s.Health != (HealthCount{Lush: 1, Wilted: 1, Withered: 1}) || s.ActiveThisWeek != 1 || s.ExercisesThisWeek != 2 || s.OpenAlerts != 2 {
		t.Errorf("summary = %+v", s)
	}

	// risk order: Beto (high alert), Caro (wilted), Ana (lush)
	var names []string
	for _, s := range d.Students {
		names = append(names, s.Name)
	}
	if len(names) != 3 || names[0] != "Beto" || names[1] != "Caro" || names[2] != "Ana" {
		t.Fatalf("order = %v", names)
	}

	ana := d.Students[2]
	if ana.Exercises != 4 || ana.CorrectRate == nil || *ana.CorrectRate != .75 || ana.MasteredTopics != 1 {
		t.Errorf("ana exercises = %d rate = %v mastered = %d", ana.Exercises, ana.CorrectRate, ana.MasteredTopics)
	}
	if ana.BestMockExam == nil || *ana.BestMockExam != 72 || !ana.Flower || ana.NextExam == nil || *ana.NextExam != "2026-10-29" {
		t.Errorf("ana mock = %v flower = %v next = %v", ana.BestMockExam, ana.Flower, ana.NextExam)
	}
	if beto := d.Students[0]; len(beto.Alerts) != 2 || !beto.Dry || beto.NextExam != nil {
		t.Errorf("beto = %+v", beto)
	}
	if caro := d.Students[1]; caro.CorrectRate != nil || caro.Exercises != 0 || len(caro.Alerts) != 0 {
		t.Errorf("caro = %+v", caro)
	}
}

func TestWeeks(t *testing.T) {
	d := Build(subject, members(), now)
	if len(d.Weeks) != Weeks || d.Weeks[Weeks-1].Week != "2026-10-19" || d.Weeks[0].Week != "2026-08-31" {
		t.Fatalf("weeks = %+v", d.Weeks)
	}
	// this week: Ana's 2 exercises today (Sunday's counts in the previous week)
	last, prev := d.Weeks[Weeks-1], d.Weeks[Weeks-2]
	if last.Exercises != 2 || last.ActiveStudents != 1 {
		t.Errorf("this week = %+v", last)
	}
	// previous week: Sunday's exercise plus both mock exams (active, not exercises)
	if prev.Exercises != 1 || prev.ActiveStudents != 1 {
		t.Errorf("previous week = %+v", prev)
	}
	// Beto's exercise 70 days ago is before the window
	total := 0
	for _, w := range d.Weeks {
		total += w.Exercises
	}
	if total != 4 {
		t.Errorf("exercises in the window = %d", total)
	}
}

func TestTopics(t *testing.T) {
	d := Build(subject, members(), now)
	if len(d.Topics) != 2 {
		t.Fatalf("topics = %+v", d.Topics)
	}
	// "Límites", "límites" and "limites" are one topic, practiced by Ana and Beto
	if l := d.Topics[0]; l.Attempts != 4 || l.Correct != 3 || l.Students != 2 {
		t.Errorf("límites = %+v", l)
	}
	if c := d.Topics[1]; c.Topic != "continuidad" || c.Attempts != 1 || c.Students != 1 {
		t.Errorf("continuidad = %+v", c)
	}
}

func TestEmpty(t *testing.T) {
	d := Build(subject, nil, now)
	if d.Students == nil || d.Topics == nil || len(d.Weeks) != Weeks || d.Summary.Students != 0 {
		t.Errorf("empty = %+v", d)
	}
}
