package tree

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

// now (tree_test.go) is Monday 2026-10-19, 09:00 in Argentina.
func date(s string) time.Time { d, _ := time.Parse(time.DateOnly, s); return d }

func checkinDaysAgo(n int) Activity {
	return Activity{Type: "checkin", CreatedAt: now.AddDate(0, 0, -n)}
}

func TestHealthRecessAndSeason(t *testing.T) {
	recess := []Period{{Kind: "recess", From: date("2026-10-12"), To: date("2026-10-16")}} // 5 weekdays last week
	cases := []struct {
		name string
		in   Input
		want string
	}{
		{"7 days, 5 of them recess -> 2", Input{Activities: []Activity{checkinDaysAgo(7)}, Periods: recess}, Lush},
		{"7 days, no recess", Input{Activities: []Activity{checkinDaysAgo(7)}}, Wilted},
		{"4 days in mesas -> wilted at 3", Input{Activities: []Activity{checkinDaysAgo(4)}, Periods: []Period{{Kind: "exams", From: date("2026-10-19"), To: date("2026-10-23")}}}, Wilted},
		{"4 days, exam loaded in 5 days", Input{Activities: []Activity{checkinDaysAgo(4), {Type: "exam", SubjectID: new(2), Date: new(date("2026-10-24")), CreatedAt: now.AddDate(0, 0, -4)}}}, Wilted},
		{"4 days, exam in 10 days is not season", Input{Activities: []Activity{checkinDaysAgo(4), {Type: "exam", SubjectID: new(2), Date: new(date("2026-10-29")), CreatedAt: now.AddDate(0, 0, -4)}}}, Lush},
		{"6 days in season -> withered", Input{Activities: []Activity{checkinDaysAgo(6)}, Periods: []Period{{Kind: "exams", From: date("2026-10-19"), To: date("2026-10-23")}}}, Withered},
	}
	for _, c := range cases {
		c.in.Plan, c.in.Since, c.in.Now = plan, now.AddDate(-1, 0, 0), now
		if got := Build(c.in).Health.State; got != c.want {
			t.Errorf("%s: got %s, want %s", c.name, got, c.want)
		}
	}
}

// sessions builds one exercise per given week offset (0 = this week, 1 = last week...).
func sessions(weeksAgo ...int) []Activity {
	var out []Activity
	for _, w := range weeksAgo {
		out = append(out, Activity{Type: "exercise", SubjectID: new(1), CreatedAt: now.AddDate(0, 0, -7*w)})
	}
	return out
}

func TestStreak(t *testing.T) {
	cases := []struct {
		name    string
		acts    []Activity
		periods []Period
		want    Streak
	}{
		{"none", nil, nil, Streak{}},
		{"checkins do not count", []Activity{checkinDaysAgo(1), checkinDaysAgo(8)}, nil, Streak{}},
		{"3 weeks up to last, current empty", sessions(3, 2, 1), nil, Streak{Weeks: 3, Best: 3}},
		{"current week counts once it has a session", sessions(2, 1, 0), nil, Streak{Weeks: 3, Best: 3}},
		{"empty last week spends the wildcard", sessions(6, 5, 4, 3, 2), nil, Streak{Weeks: 5, Best: 5, Wildcards: 0}},
		{"wildcard kept while active", sessions(4, 3, 2, 1), nil, Streak{Weeks: 4, Best: 4, Wildcards: 1}},
		{"gap without wildcard breaks", sessions(5, 4, 2, 1), nil, Streak{Weeks: 2, Best: 2}},
		{"wildcard covers a gap", sessions(6, 5, 4, 3, 1), nil, Streak{Weeks: 5, Best: 5, Wildcards: 0}},
		{"two empty weeks: wildcard then break", sessions(7, 6, 5, 4, 1), nil, Streak{Weeks: 1, Best: 4}},
		{"recess freezes", sessions(4, 3, 1), []Period{{Kind: "recess", From: date("2026-10-05"), To: date("2026-10-09")}}, Streak{Weeks: 3, Best: 3}},
		{"max 2 wildcards", sessions(12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1), nil, Streak{Weeks: 12, Best: 12, Wildcards: 2}},
	}
	for _, c := range cases {
		got := Build(Input{Plan: plan, Activities: c.acts, Periods: c.periods, Since: now.AddDate(-1, 0, 0), Now: now}).Streak
		if got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
}

var info = map[int]SubjectInfo{
	1: {Name: "Álgebra", UnlocksTotal: 3, Bottleneck: true},
	2: {Name: "Análisis", UnlocksTotal: 1},
	3: {Name: "Lógica", UnlocksTotal: 2, Bottleneck: true},
}

func alertsFor(in Input) map[string]Alert {
	in.Plan, in.Info, in.Since, in.Now = plan, info, now.AddDate(-1, 0, 0), now
	out := map[string]Alert{}
	for _, a := range Build(in).Alerts {
		out[a.Type] = a
	}
	return out
}

func TestInactivityAlerts(t *testing.T) {
	enrolled := map[int]string{1: Approved, 2: Enrolled, 3: Enrolled}
	cases := []struct {
		days      int
		level     string
		action    string
		subjectID int
	}{{4, "", "", 0}, {5, Low, "open_tutor", 0}, {10, Medium, "open_tutor", 3}, {15, High, "contact_tutor", 0}}
	for _, c := range cases {
		a, ok := alertsFor(Input{States: enrolled, Activities: []Activity{checkinDaysAgo(c.days)}})["inactivity"]
		if c.level == "" {
			if ok {
				t.Errorf("%d days: unexpected alert %+v", c.days, a)
			}
			continue
		}
		if a.Level != c.level || a.Key != c.level || a.Action.Type != c.action {
			t.Errorf("%d days: got %+v", c.days, a)
		}
		if got := 0; a.SubjectID != nil {
			got = *a.SubjectID
			if got != c.subjectID {
				t.Errorf("%d days: subject %d, want %d (most unlocking enrolled)", c.days, got, c.subjectID)
			}
		} else if c.subjectID != 0 {
			t.Errorf("%d days: no subject, want %d", c.days, c.subjectID)
		}
	}
	// An upcoming exam wins over unlocks_total.
	a := alertsFor(Input{States: enrolled, Activities: []Activity{
		checkinDaysAgo(12),
		{Type: "exam", SubjectID: new(2), Date: new(date("2026-11-15")), CreatedAt: now.AddDate(0, 0, -20)},
	}})["inactivity"]
	if a.SubjectID == nil || *a.SubjectID != 2 || a.Message != "Se viene el parcial de Análisis, ¿practicamos 1 ejercicio?" {
		t.Errorf("exam focus: got %+v", a)
	}
}

func TestMissedExam(t *testing.T) {
	exam := func(subject int, d string, result string) Activity {
		a := Activity{Type: "exam", SubjectID: new(subject), Date: new(date(d)), CreatedAt: now.AddDate(0, 0, -30)}
		if result != "" {
			a.Result = json.RawMessage(result)
		}
		return a
	}
	states := map[int]string{1: Approved, 2: Enrolled, 3: Enrolled}
	cases := []struct {
		name  string
		acts  []Activity
		want  string // level, "" for none
		key   string
		state map[int]string
	}{
		{"past without result, bottleneck", []Activity{exam(3, "2026-10-16", "")}, High, "2026-10-16", states},
		{"past without result, not bottleneck", []Activity{exam(2, "2026-10-16", "")}, Medium, "2026-10-16", states},
		{"today is not missed yet", []Activity{exam(3, "2026-10-19", "")}, "", "", states},
		{"result for that date", []Activity{exam(3, "2026-10-16", ""), exam(3, "2026-10-16", `{"score":40}`)}, "", "", states},
		{"already regular", []Activity{exam(3, "2026-10-16", "")}, "", "", map[int]string{1: Approved, 3: Regular}},
		{"earliest missed date wins", []Activity{exam(3, "2026-10-16", ""), exam(3, "2026-09-20", "")}, High, "2026-09-20", states},
	}
	for _, c := range cases {
		a, ok := alertsFor(Input{States: c.state, Activities: append(c.acts, checkinDaysAgo(0))})["first_exam_missed"]
		if c.want == "" {
			if ok {
				t.Errorf("%s: unexpected %+v", c.name, a)
			}
			continue
		}
		if !ok || a.Level != c.want || a.Key != c.key || a.Action.Type != "open_tutor" {
			t.Errorf("%s: got %+v (ok=%v)", c.name, a, ok)
		}
	}
}

func TestMarkDry(t *testing.T) {
	tr := Build(Input{Plan: plan, States: map[int]string{1: Approved, 2: Enrolled}, Since: now, Now: now})
	MarkDry(&tr, map[int]bool{1: true, 2: true})
	for _, s := range tr.Subjects {
		if s.Dry != (s.SubjectID == 2) {
			t.Errorf("subject %d dry=%v; approved never dries", s.SubjectID, s.Dry)
		}
	}
}

func TestTopics(t *testing.T) {
	ex := func(subject int, topic string, correct bool) Activity {
		r, _ := json.Marshal(map[string]bool{"correct": correct})
		return Activity{Type: "exercise", SubjectID: new(subject), Topic: topic, Result: r}
	}
	got := Topics([]Activity{
		ex(12, "Inducción", true), ex(12, "induccion ", true), ex(12, "INDUCCIÓN", false), ex(12, "inducción", true),
		ex(12, "deducción natural", false),
		ex(2, "límites", true),
		{Type: "mock_exam", SubjectID: new(12), Topic: "inducción"}, // not an exercise
		ex(12, "", true),                                            // no topic
	})
	want := []TopicStat{{Topic: "Inducción", Correct: 3, Attempts: 4, Mastered: true}, {Topic: "deducción natural", Attempts: 1}}
	if fmt.Sprint(got[12]) != fmt.Sprint(want) {
		t.Errorf("subject 12 = %+v, want %+v", got[12], want)
	}
	if len(got[2]) != 1 || got[2][0].Mastered {
		t.Errorf("subject 2 = %+v", got[2])
	}
}
