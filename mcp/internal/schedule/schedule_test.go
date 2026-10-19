package schedule_test

import (
	"strings"
	"testing"

	"github.com/franelias/hackaton/mcp/internal/schedule"
)

func class(day, from, to int, campus string) schedule.Class {
	return schedule.Class{Day: day, From: from, To: to, Campus: campus}
}

func none() (map[int]int, error) { return map[int]int{}, nil }

func TestBackToBackClassesOnDifferentCampusesWarn(t *testing.T) {
	t.Parallel()
	offs := []schedule.Offering{
		{SubjectID: 1, Commissions: []schedule.Commission{{SubjectID: 1, Classes: []schedule.Class{class(2, 9*60, 12*60, "Sede Pellegrini")}}}},
		{SubjectID: 2, Commissions: []schedule.Commission{{SubjectID: 2, Classes: []schedule.Class{class(2, 12*60+30, 15*60, "CUR")}}}},
	}

	res, err := schedule.Solve(offs, schedule.Preferences{}, none)
	if err != nil {
		t.Fatal(err)
	}

	want := "day 2: 30 min between subject 1 (Sede Pellegrini, ends 12:00) and subject 2 (CUR, starts 12:30)"
	if len(res.Warnings) != 1 || res.Warnings[0] != want {
		t.Fatalf("warnings = %q", res.Warnings)
	}
	if len(res.Options) != 1 {
		t.Fatalf("transfer warnings must not drop the option: %+v", res.Options)
	}
}

func TestSameCampusOrUnknownCampusDoesNotWarn(t *testing.T) {
	t.Parallel()
	offs := []schedule.Offering{
		{SubjectID: 1, Commissions: []schedule.Commission{{SubjectID: 1, Classes: []schedule.Class{class(2, 9*60, 12*60, "Sede Pellegrini")}}}},
		{SubjectID: 2, Commissions: []schedule.Commission{{SubjectID: 2, Classes: []schedule.Class{class(2, 12*60+30, 15*60, "")}}}},
	}

	res, err := schedule.Solve(offs, schedule.Preferences{}, none)
	if err != nil {
		t.Fatal(err)
	}

	if len(res.Warnings) != 0 {
		t.Fatalf("warnings = %q", res.Warnings)
	}
}

func TestShiftIsDecidedByTheClassStart(t *testing.T) {
	t.Parallel()
	mk := func(label string, start int) schedule.Commission {
		return schedule.Commission{SubjectID: 1, Label: label, Classes: []schedule.Class{class(1, start, start+60, "")}}
	}
	offs := []schedule.Offering{{SubjectID: 1, Commissions: []schedule.Commission{
		mk("a-1259", 12*60+59), mk("b-1300", 13*60), mk("c-1859", 18*60+59), mk("d-1900", 19*60),
	}}}

	afternoon, _ := schedule.Solve(offs, schedule.Preferences{Shift: schedule.Afternoon}, none)

	var labels []string
	for _, o := range afternoon.Options {
		labels = append(labels, o.Commissions[0].Label)
	}
	if got := strings.Join(labels, " "); got != "b-1300 c-1859 a-1259" {
		t.Fatalf("ranking = %q", got)
	}
}

func TestCommissionLabelsAreParsedFromNotes(t *testing.T) {
	t.Parallel()
	sessions := []schedule.Session{
		{Semester: "2026-2S", Weekday: 1, Start: "07:30", End: "10:30", Notes: "Com.: 630 ciclo básico [x]"},
		{Semester: "2026-2S", Weekday: 2, Start: "07:30", End: "10:30", Notes: "Com: 630 y Com: 660 ciclo básico"},
		{Semester: "2026-2S", Weekday: 3, Start: "07:30", End: "10:30", Notes: "Com: 660"},
	}

	cms, _ := schedule.Commissions(5, sessions, "", "2026-2S")

	if len(cms) != 2 || cms[0].Label != "630" || len(cms[0].Classes) != 2 || cms[1].Label != "660" || len(cms[1].Classes) != 2 {
		t.Fatalf("commissions: %+v", cms)
	}
}

func TestSubjectWithoutLabelsHasASingleCommission(t *testing.T) {
	t.Parallel()
	sessions := []schedule.Session{
		{Semester: "2026-2S", Weekday: 1, Start: "07:30", End: "10:30", Notes: "[https://example.org]"},
		{Semester: "2026-2S", Weekday: 4, Start: "09:30", End: "13:00"},
	}

	cms, _ := schedule.Commissions(5, sessions, "", "2026-2S")

	if len(cms) != 1 || cms[0].Label != "" || len(cms[0].Classes) != 2 {
		t.Fatalf("commissions: %+v", cms)
	}
}

func TestForcedSemesterUsesOnlyThatSemester(t *testing.T) {
	t.Parallel()
	sessions := []schedule.Session{
		{Semester: "2026-2S", Weekday: 1, Start: "07:30", End: "10:30"},
		{Semester: "última publicación", Weekday: 3, Start: "07:30", End: "10:30"},
	}

	cms, _ := schedule.Commissions(5, sessions, "última publicación", "2026-2S")

	if len(cms) != 1 || len(cms[0].Classes) != 1 || cms[0].Classes[0].Day != 3 {
		t.Fatalf("commissions: %+v", cms)
	}
}

func TestKeepsOnlyTheBottleneckWhenEverySubjectNeedsTheSameSlot(t *testing.T) {
	t.Parallel()
	one := func(id int) schedule.Offering {
		return schedule.Offering{SubjectID: id, Commissions: []schedule.Commission{{SubjectID: id, Classes: []schedule.Class{class(1, 8*60, 10*60, "")}}}}
	}

	res, err := schedule.Solve([]schedule.Offering{one(1), one(2), one(3)}, schedule.Preferences{}, func() (map[int]int, error) {
		return map[int]int{1: 9, 2: 2, 3: 4}, nil
	})
	if err != nil {
		t.Fatal(err)
	}

	// Keep one subject: spare the bottleneck (1), then drop the one that unlocks least first.
	if len(res.Postpone) != 2 || res.Postpone[0] != 2 || res.Postpone[1] != 3 || len(res.Scheduled) != 1 || res.Scheduled[0] != 1 {
		t.Fatalf("postpone = %v, scheduled = %v", res.Postpone, res.Scheduled)
	}
}

func TestSparesTheBottleneckEvenIfThatMeansPostponingMoreSubjects(t *testing.T) {
	t.Parallel()
	one := func(id, from, to int) schedule.Offering {
		return schedule.Offering{SubjectID: id, Commissions: []schedule.Commission{{SubjectID: id, Classes: []schedule.Class{class(1, from, to, "")}}}}
	}
	// Subject 1 (a bottleneck) clashes with 2 and 3, which fit together.
	offs := []schedule.Offering{one(1, 8*60, 10*60), one(2, 8*60, 9*60), one(3, 9*60, 10*60)}

	res, err := schedule.Solve(offs, schedule.Preferences{}, func() (map[int]int, error) {
		return map[int]int{1: 9, 2: 2, 3: 2}, nil
	})
	if err != nil {
		t.Fatal(err)
	}

	if len(res.Postpone) != 2 || res.Postpone[0] != 2 || res.Postpone[1] != 3 || len(res.Scheduled) != 1 || res.Scheduled[0] != 1 {
		t.Fatalf("postpone = %v, scheduled = %v", res.Postpone, res.Scheduled)
	}
}

func TestClassesThatTouchDoNotClash(t *testing.T) {
	t.Parallel()
	offs := []schedule.Offering{
		{SubjectID: 1, Commissions: []schedule.Commission{{SubjectID: 1, Classes: []schedule.Class{class(1, 8*60, 10*60, "")}}}},
		{SubjectID: 2, Commissions: []schedule.Commission{{SubjectID: 2, Classes: []schedule.Class{class(1, 10*60, 12*60, "")}}}},
	}

	res, err := schedule.Solve(offs, schedule.Preferences{}, none)
	if err != nil {
		t.Fatal(err)
	}

	if len(res.Options) != 1 || len(res.Conflicts) != 0 || len(res.Postpone) != 0 {
		t.Fatalf("unexpected result: %+v", res)
	}
}
