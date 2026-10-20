package tree

import (
	"strings"
	"testing"
	"time"
)

func nudgesAt(at time.Time, in Input) map[string]Nudge {
	in.Plan, in.Info, in.Now = plan, info, at
	if in.Since.IsZero() {
		in.Since = at.AddDate(-1, 0, 0)
	}
	out := map[string]Nudge{}
	for _, n := range Nudges(in) {
		if _, ok := out[n.Kind]; !ok {
			out[n.Kind] = n
		}
	}
	return out
}

func exerciseAt(t time.Time, subject int) Activity {
	return Activity{Type: "exercise", SubjectID: new(subject), CreatedAt: t}
}

func TestStreakRisk(t *testing.T) {
	friday, sunday := now.AddDate(0, 0, 4), now.AddDate(0, 0, 6) // 2026-10-23 and 25
	threeWeeks := []Activity{exerciseAt(now.AddDate(0, 0, -7), 1), exerciseAt(now.AddDate(0, 0, -14), 1), exerciseAt(now.AddDate(0, 0, -21), 1)}
	fourWeeks := append([]Activity{exerciseAt(now.AddDate(0, 0, -28), 1)}, threeWeeks...)
	cases := []struct {
		name    string
		at      time.Time
		acts    []Activity
		periods []Period
		key     string // "" for none
		body    string // substring
	}{
		{"monday is too early", now, threeWeeks, nil, "", ""},
		{"friday", friday, threeWeeks, nil, "2026-10-19/soon", "3 semanas seguidas estudiando"},
		{"sunday is the last day", sunday, threeWeeks, nil, "2026-10-19/last", "Si hoy no estudiás, se corta"},
		{"a wildcard would cover it", friday, fourWeeks, nil, "2026-10-19/soon", "gastás un comodín"},
		{"already studied this week", friday, append(threeWeeks, exerciseAt(now, 1)), nil, "", ""},
		{"a checkin does not save it", friday, append(threeWeeks, Activity{Type: "checkin", CreatedAt: now}), nil, "2026-10-19/soon", ""},
		{"no streak", friday, nil, nil, "", ""},
		{"recess week is frozen", friday, threeWeeks, []Period{{Kind: "recess", From: date("2026-10-19"), To: date("2026-10-30")}}, "", ""},
	}
	for _, c := range cases {
		n, ok := nudgesAt(c.at, Input{Activities: c.acts, Periods: c.periods})["streak_risk"]
		if c.key == "" {
			if ok {
				t.Errorf("%s: unexpected %+v", c.name, n)
			}
			continue
		}
		if !ok || n.Key != c.key || !strings.Contains(n.Body, c.body) {
			t.Errorf("%s: got %+v (ok=%v)", c.name, n, ok)
		}
	}
}

func TestWiltingSoon(t *testing.T) {
	enrolled := map[int]string{1: Approved, 2: Enrolled, 3: Enrolled}
	cases := []struct {
		name    string
		days    int
		periods []Period
		key     string
		subject int
	}{
		{"3 days: nothing yet", 3, nil, "", 0},
		{"4 days: wilted tomorrow", 4, nil, "wilted@2026-10-15", 0},
		{"5 days: already wilted", 5, nil, "", 0},
		{"9 days: withered tomorrow, branch of the focus subject", 9, nil, "withered@2026-10-10", 3},
		{"tomorrow is recess", 4, []Period{{Kind: "recess", From: date("2026-10-20"), To: date("2026-10-24")}}, "", 0},
		{"season thresholds: 5 days -> withered at 6", 5, []Period{{Kind: "exams", From: date("2026-10-19"), To: date("2026-10-23")}}, "withered@2026-10-14", 3},
	}
	for _, c := range cases {
		n, ok := nudgesAt(now, Input{States: enrolled, Activities: []Activity{checkinDaysAgo(c.days)}, Periods: c.periods})["wilting_soon"]
		if c.key == "" {
			if ok {
				t.Errorf("%s: unexpected %+v", c.name, n)
			}
			continue
		}
		if !ok || n.Key != c.key {
			t.Errorf("%s: got %+v (ok=%v)", c.name, n, ok)
			continue
		}
		if got := 0; n.SubjectID != nil {
			got = *n.SubjectID
			if got != c.subject || !strings.Contains(n.Title, "Lógica") {
				t.Errorf("%s: subject %d, title %q", c.name, got, n.Title)
			}
		} else if c.subject != 0 {
			t.Errorf("%s: no subject, want %d", c.name, c.subject)
		}
	}
}

func TestFinalPending(t *testing.T) {
	mesas := func(from, to string) []Period { return []Period{{Kind: "exams", From: date(from), To: date(to)}} }
	since := func(daysAgo int) map[int]time.Time { return map[int]time.Time{3: now.AddDate(0, 0, -daysAgo)} }
	cases := []struct {
		name    string
		since   map[int]time.Time
		periods []Period
		body    string // substring, "" for none
	}{
		{"mesas in 10 days", since(40), mesas("2026-10-29", "2026-11-06"), "se vienen las mesas (del 29/10 al 06/11)"},
		{"mesas running", since(40), mesas("2026-10-12", "2026-10-23"), "hay mesas hasta el 23/10"},
		{"mesas too far", since(40), mesas("2026-11-09", "2026-11-13"), ""},
		{"mesas over", since(40), mesas("2026-10-05", "2026-10-16"), ""},
		{"regular since recently", since(10), mesas("2026-10-29", "2026-11-06"), ""},
		{"no since", nil, mesas("2026-10-29", "2026-11-06"), ""},
	}
	for _, c := range cases {
		n, ok := nudgesAt(now, Input{States: map[int]string{1: Approved, 3: Regular}, StateSince: c.since, Periods: c.periods, Activities: []Activity{checkinDaysAgo(0)}})["final_pending"]
		if c.body == "" {
			if ok {
				t.Errorf("%s: unexpected %+v", c.name, n)
			}
			continue
		}
		if !ok || *n.SubjectID != 3 || n.Key != c.periods[0].From.Format(time.DateOnly) || !strings.Contains(n.Body, c.body) {
			t.Errorf("%s: got %+v (ok=%v)", c.name, n, ok)
		}
	}
}

func TestIdleSubjects(t *testing.T) {
	long := map[int]time.Time{2: now.AddDate(0, -3, 0), 3: now.AddDate(0, -3, 0)}
	all := func(in Input) []Nudge {
		in.Plan, in.Info, in.Now, in.Since = plan, info, now, now.AddDate(-1, 0, 0)
		var out []Nudge
		for _, n := range Nudges(in) {
			if n.Kind == "subject_idle" {
				out = append(out, n)
			}
		}
		return out
	}
	// 2 studied 20 days ago, 3 studied 15 days ago, both still enrolled; activity elsewhere keeps the tree lush.
	got := all(Input{
		States: map[int]string{1: Approved, 2: Enrolled, 3: Enrolled}, StateSince: long,
		Activities: []Activity{exerciseAt(now.AddDate(0, 0, -20), 2), exerciseAt(now.AddDate(0, 0, -15), 3), exerciseAt(now, 1)},
	})
	if len(got) != 2 || *got[0].SubjectID != 2 || got[0].Key != "2026-09-29" || *got[1].SubjectID != 3 {
		t.Fatalf("got %+v, want 2 then 3", got)
	}
	if got[0].Body != "Hace 20 días que no practicás Análisis. ¿Hacemos 1 ejercicio?" {
		t.Errorf("body %q", got[0].Body)
	}

	cases := []struct {
		name string
		in   Input
		want int
	}{
		{"13 days is not idle", Input{States: map[int]string{2: Enrolled}, StateSince: long, Activities: []Activity{exerciseAt(now.AddDate(0, 0, -13), 2)}}, 0},
		{"enrolled recently, never studied", Input{States: map[int]string{2: Enrolled}, StateSince: map[int]time.Time{2: now.AddDate(0, 0, -5)}}, 0},
		{"enrolled long ago, never studied", Input{States: map[int]string{2: Enrolled}, StateSince: long}, 1},
		{"regular subjects are not idle", Input{States: map[int]string{2: Regular}, StateSince: long}, 0},
	}
	for _, c := range cases {
		if got := all(c.in); len(got) != c.want {
			t.Errorf("%s: got %+v", c.name, got)
		}
	}

	exam := all(Input{States: map[int]string{2: Enrolled}, StateSince: long, Activities: []Activity{
		exerciseAt(now.AddDate(0, 0, -15), 2),
		{Type: "exam", SubjectID: new(2), Date: new(date("2026-11-02")), CreatedAt: now.AddDate(0, 0, -30)},
	}})
	if len(exam) != 1 || !strings.HasPrefix(exam[0].Body, "El parcial de Análisis es el 02/11") {
		t.Errorf("upcoming exam: got %+v", exam)
	}
}

func TestNudgesOrder(t *testing.T) {
	// Friday, streak alive, 4 days idle (wilted tomorrow), an idle subject: streak first.
	friday := now.AddDate(0, 0, 4)
	in := Input{
		Plan: plan, Info: info, Now: friday, Since: now.AddDate(-1, 0, 0),
		States: map[int]string{2: Enrolled}, StateSince: map[int]time.Time{2: now.AddDate(0, -3, 0)},
		Activities: []Activity{exerciseAt(now.AddDate(0, 0, -21), 1), exerciseAt(now.AddDate(0, 0, -14), 1), exerciseAt(now.AddDate(0, 0, -7), 1), checkinDaysAgo(0)},
	}
	var kinds []string
	for _, n := range Nudges(in) {
		kinds = append(kinds, n.Kind)
	}
	if strings.Join(kinds, ",") != "streak_risk,wilting_soon,subject_idle" {
		t.Errorf("got %v", kinds)
	}
}
