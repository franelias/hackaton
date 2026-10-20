package corrections_test

import (
	"reflect"
	"strings"
	"testing"

	"github.com/franelias/hackaton/corrections"
)

func req(ids ...int) []corrections.Requirement {
	var out []corrections.Requirement
	for _, id := range ids {
		out = append(out, corrections.Requirement{SubjectID: id, Condition: corrections.Approved})
	}
	return out
}

func TestCareerWithoutAReviewHasNoCorrections(t *testing.T) {
	t.Parallel()
	ov, err := corrections.For(999)
	if err != nil {
		t.Fatal(err)
	}

	if len(ov.Subjects) != 0 || len(ov.AddPrerequisites) != 0 || len(ov.RemovePrerequisites) != 0 {
		t.Fatalf("unexpected corrections: %+v", ov)
	}
}

func TestReviewOfLCCIsEmbedded(t *testing.T) {
	t.Parallel()
	ov, err := corrections.For(1)
	if err != nil {
		t.Fatal(err)
	}

	// 1 from the 2024 programs + 23 + 23 + 33 from the SIU Guaraní (Práctica Profesional, Taller de Tesina, Tesina).
	if len(ov.RemovePrerequisites) != 3 || len(ov.AddPrerequisites) != 80 {
		t.Fatalf("unexpected review: %+v", ov)
	}
}

func TestEveryCorrectionCitesItsOfficialSource(t *testing.T) {
	t.Parallel()
	ov, err := corrections.For(1)
	if err != nil {
		t.Fatal(err)
	}

	for id, s := range ov.Subjects {
		if strings.TrimSpace(s.Note) == "" {
			t.Errorf("subject %d has no note", id)
		}
	}
	for _, e := range append(append([]corrections.Edit(nil), ov.AddPrerequisites...), ov.RemovePrerequisites...) {
		if strings.TrimSpace(e.Note) == "" {
			t.Errorf("edit %d/%d has no note", e.SubjectID, e.Requires)
		}
	}
}

func TestMisspelledFieldIsRejected(t *testing.T) {
	t.Parallel()

	if _, err := corrections.Parse([]byte(`{"subject":{}}`)); err == nil {
		t.Fatal("expected an error for the misspelled key")
	}
}

func TestUnknownConditionIsRejected(t *testing.T) {
	t.Parallel()

	_, err := corrections.Parse([]byte(`{"add_prerequisites":[{"subject_id":1,"requires":2,"condition":"maybe"}]}`))

	if err == nil || !strings.Contains(err.Error(), "condition must be") {
		t.Fatalf("err = %v", err)
	}
}

func TestPrerequisitesDropRemovedAddMissingAndKeepTheRestSorted(t *testing.T) {
	t.Parallel()
	ov := corrections.Overrides{
		RemovePrerequisites: []corrections.Edit{{SubjectID: 7, Requires: 3}},
		AddPrerequisites:    []corrections.Edit{{SubjectID: 7, Requires: 9, Condition: corrections.Regular}, {SubjectID: 7, Requires: 2}, {SubjectID: 8, Requires: 1}},
	}

	got := ov.Prerequisites(7, req(5, 3, 2))

	want := []corrections.Requirement{{SubjectID: 2, Condition: "approved"}, {SubjectID: 5, Condition: "approved"}, {SubjectID: 9, Condition: "regular"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestPrerequisitesOfAnUntouchedSubjectAreUnchanged(t *testing.T) {
	t.Parallel()
	ov := corrections.Overrides{RemovePrerequisites: []corrections.Edit{{SubjectID: 7, Requires: 3}}}

	if got := ov.Prerequisites(8, req(4, 2)); !reflect.DeepEqual(got, req(2, 4)) {
		t.Fatalf("got %+v", got)
	}
}

func TestUnlocksMirrorTheCorrectedPrerequisites(t *testing.T) {
	t.Parallel()
	ov := corrections.Overrides{
		RemovePrerequisites: []corrections.Edit{{SubjectID: 20, Requires: 5}},
		AddPrerequisites:    []corrections.Edit{{SubjectID: 30, Requires: 5}},
	}

	if got := ov.Unlocks(5, []int{20, 10}); !reflect.DeepEqual(got, []int{10, 30}) {
		t.Fatalf("got %v", got)
	}
}

func TestReduceKeepsOnlyDirectCorrelativas(t *testing.T) {
	t.Parallel()
	// 1 <- 2 <- 3, and 3 also lists 1 directly: implied through 2.
	g := map[int][]corrections.Requirement{1: nil, 2: req(1), 3: req(1, 2), 4: req(1, 3)}

	got := corrections.Reduce(g)

	want := map[int][]corrections.Requirement{1: {}, 2: req(1), 3: req(2), 4: req(3)}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestReduceDoesNotFollowRegularCorrelativas(t *testing.T) {
	t.Parallel()
	reg := func(id int) corrections.Requirement {
		return corrections.Requirement{SubjectID: id, Condition: corrections.Regular}
	}
	g := map[int][]corrections.Requirement{
		2: req(1),
		// 3 needs 2 only regular: being regular in 2 says nothing about 1.
		3: {reg(2), {SubjectID: 1, Condition: corrections.Approved}},
		// 5 needs 4 approved, and 4 needs 1 regular: 1 approved is not implied...
		4: {reg(1)},
		5: append(req(4), corrections.Requirement{SubjectID: 1, Condition: corrections.Approved}),
		// ...but 1 regular is.
		6: append(req(4), reg(1)),
	}

	got := corrections.Reduce(g)

	if len(got[3]) != 2 || len(got[5]) != 2 {
		t.Errorf("dropped a correlativa that is not implied: 3=%+v 5=%+v", got[3], got[5])
	}
	if !reflect.DeepEqual(got[6], req(4)) {
		t.Errorf("6 = %+v, want only 4", got[6])
	}
}

func TestGraphAppliesCorrectionsBeforeReducing(t *testing.T) {
	t.Parallel()
	ov := corrections.Overrides{
		// 9 is not in the API at all; it gets its correlativas only from the review.
		AddPrerequisites:    []corrections.Edit{{SubjectID: 9, Requires: 1}, {SubjectID: 9, Requires: 3}},
		RemovePrerequisites: []corrections.Edit{{SubjectID: 3, Requires: 2}},
	}
	api := map[int][]corrections.Requirement{2: req(1), 3: req(1, 2)}

	got := ov.Graph(api)

	// Without the 3 <- 2 link, 3 <- 1 is no longer implied and stays; 9 <- 1 is implied by 3.
	want := map[int][]corrections.Requirement{2: req(1), 3: req(1), 9: req(3)}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestTermOfYear(t *testing.T) {
	t.Parallel()
	for abs, want := range map[int]int{1: 1, 2: 2, 3: 1, 4: 2, 10: 2} {
		if got := corrections.TermOfYear(&abs); got == nil || *got != want {
			t.Errorf("TermOfYear(%d) = %v, want %d", abs, got, want)
		}
	}
	if corrections.TermOfYear(nil) != nil {
		t.Error("nil term must stay nil")
	}
}

func TestValidateRejectsAnUnknownSubjectAndARemovalOfAMissingCorrelativa(t *testing.T) {
	t.Parallel()
	known := map[int]bool{1: true, 2: true}
	api := map[int][]corrections.Requirement{2: req(1)}

	cases := map[string]corrections.Overrides{
		"override on unknown subject": {Subjects: map[int]corrections.Subject{9: {}}},
		"prerequisite to unknown":     {AddPrerequisites: []corrections.Edit{{SubjectID: 9, Requires: 1}}},
		"added prerequisite unknown":  {AddPrerequisites: []corrections.Edit{{SubjectID: 1, Requires: 9}}},
		"removing a missing edge":     {RemovePrerequisites: []corrections.Edit{{SubjectID: 1, Requires: 2}}},
	}
	for name, ov := range cases {
		if err := ov.Validate(known, api); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
	if err := (corrections.Overrides{RemovePrerequisites: []corrections.Edit{{SubjectID: 2, Requires: 1}}}).Validate(known, api); err != nil {
		t.Fatalf("a valid removal was rejected: %v", err)
	}
}
