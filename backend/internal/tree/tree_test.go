package tree

import (
	"encoding/json"
	"testing"
	"time"
)

var now = time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)

// Small career: 1 -> 2 (approved), 1 -> 3 (regular), 2 + 3 -> 4.
var plan = map[int][]Prereq{
	1: nil,
	2: {{RequiresID: 1, Condition: Approved}},
	3: {{RequiresID: 1, Condition: Regular}},
	4: {{RequiresID: 2, Condition: Approved}, {RequiresID: 3, Condition: Approved}},
}

func states(t Tree) map[int]string {
	m := map[int]string{}
	for _, s := range t.Subjects {
		m[s.SubjectID] = s.State
	}
	return m
}

func TestSubjectStates(t *testing.T) {
	cases := []struct {
		name string
		in   map[int]string
		want map[int]string
	}{
		{"new student: only roots available", nil, map[int]string{1: Available}},
		{"regular unlocks only regular-condition", map[int]string{1: Regular}, map[int]string{1: Regular, 3: Available}},
		{"approved unlocks both", map[int]string{1: Approved}, map[int]string{1: Approved, 2: Available, 3: Available}},
		{"all prereqs needed", map[int]string{1: Approved, 2: Approved, 3: Regular}, map[int]string{1: Approved, 2: Approved, 3: Regular}},
		{"loaded state wins over locks", map[int]string{4: Enrolled}, map[int]string{1: Available, 4: Enrolled}},
	}
	for _, c := range cases {
		got := states(Build(Input{Plan: plan, States: c.in, Since: now, Now: now}))
		if len(got) != len(c.want) {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
			continue
		}
		for k, v := range c.want {
			if got[k] != v {
				t.Errorf("%s: got %v, want %v", c.name, got, c.want)
				break
			}
		}
	}
}

// The grade shows only on an approved subject; aplazos show on any visible one.
func TestGradesAndFails(t *testing.T) {
	in := Input{Plan: plan, States: map[int]string{1: Approved, 3: Regular}, Grades: map[int]int{1: 8, 3: 9},
		Fails: map[int][]Fail{1: {{ID: 5, Grade: 2}}, 3: {{ID: 6, Grade: 4}}}, Since: now, Now: now}
	by := map[int]Subject{}
	for _, s := range Build(in).Subjects {
		by[s.SubjectID] = s
	}
	if g := by[1].Grade; g == nil || *g != 8 {
		t.Errorf("approved grade = %v, want 8", g)
	}
	if by[3].Grade != nil {
		t.Errorf("regular has grade %d", *by[3].Grade)
	}
	if len(by[1].Fails) != 1 || by[1].Fails[0].ID != 5 || len(by[3].Fails) != 1 {
		t.Errorf("fails = %v, %v", by[1].Fails, by[3].Fails)
	}
	if by[2].Grade != nil || by[2].Fails != nil {
		t.Errorf("available subject = %+v", by[2])
	}
}

func TestLeavesAndFlower(t *testing.T) {
	score := func(s int) json.RawMessage { b, _ := json.Marshal(map[string]int{"score": s}); return b }
	in := Input{
		Plan:   plan,
		States: map[int]string{1: Approved, 2: Enrolled},
		Activities: []Activity{
			{Type: "exercise", SubjectID: new(2), CreatedAt: now},
			{Type: "exercise", SubjectID: new(2), CreatedAt: now},
			{Type: "checkin", CreatedAt: now},
			{Type: "mock_exam", SubjectID: new(2), Result: score(59), CreatedAt: now},
			{Type: "mock_exam", SubjectID: new(1), Result: score(90), CreatedAt: now}, // approved: no flower
			{Type: "exam", SubjectID: new(2), CreatedAt: now},                         // a date, not a leaf
		},
		Since: now, Now: now,
	}
	got := map[int]Subject{}
	for _, s := range Build(in).Subjects {
		got[s.SubjectID] = s
	}
	if got[2].Leaves != 3 || got[2].Flower {
		t.Errorf("subject 2 = %+v, want 3 leaves and no flower (59 < 60)", got[2])
	}
	if got[1].Flower {
		t.Error("an approved subject never gets a flower")
	}
	in.Activities = append(in.Activities, Activity{Type: "mock_exam", SubjectID: new(2), Result: score(60), CreatedAt: now})
	for _, s := range Build(in).Subjects {
		if s.SubjectID == 2 && !s.Flower {
			t.Error("60 should pass the mock exam")
		}
	}
}

func TestHealth(t *testing.T) {
	cases := []struct {
		daysAgo int
		want    string
	}{{0, Lush}, {4, Lush}, {5, Wilted}, {9, Wilted}, {10, Withered}, {30, Withered}}
	for _, c := range cases {
		last := now.AddDate(0, 0, -c.daysAgo)
		got := Build(Input{Plan: plan, Since: now.AddDate(-1, 0, 0), Activities: []Activity{{Type: "checkin", CreatedAt: last}}, Now: now}).Health
		if got.State != c.want || !got.LastActivity.Equal(last) {
			t.Errorf("%d days: got %+v, want %s", c.daysAgo, got, c.want)
		}
	}
	// No activity yet: the join date counts, so a new tree is lush.
	if got := Build(Input{Plan: plan, Since: now, Now: now}).Health.State; got != Lush {
		t.Errorf("new student: got %s, want lush", got)
	}
}
