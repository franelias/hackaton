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

	if len(ov.RemovePrerequisites) != 3 || len(ov.AddPrerequisites) != 1 || !ov.Subjects[31].FinalGoal {
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
