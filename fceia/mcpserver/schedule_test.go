package mcpserver_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

// stubSchedule serves responses recorded from the real FCEIA API:
// subjects 7, 10, 11, 12, 15-20 of career 1 (Licenciatura en Ciencias de la
// Computación) and 55, 56 of career 6 (the ones with several commissions).
// The *_by_id files hold each recorded body under its subject_id.
func stubSchedule(t *testing.T) *httptest.Server {
	t.Helper()
	load := func(name string) map[string]json.RawMessage {
		b, err := os.ReadFile(filepath.Join("testdata", "schedule", name))
		if err != nil {
			t.Fatal(err)
		}
		m := map[string]json.RawMessage{}
		if err := json.Unmarshal(b, &m); err != nil {
			t.Fatal(err)
		}
		return m
	}
	subjects, sessions, relations := load("subject_by_id.json"), load("sessions_by_subject.json"), load("relations_career1.json")
	careerSubjects, err := os.ReadFile(filepath.Join("testdata", "schedule", "career1_subjects.json"))
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/v1")
		parts := strings.Split(strings.Trim(path, "/"), "/")
		serve := func(m map[string]json.RawMessage, id string) {
			if body, ok := m[id]; ok {
				w.Write(body)
				return
			}
			http.NotFound(w, r)
		}
		switch {
		case path == "/subjects" && r.URL.Query().Get("career_id") == "1":
			w.Write(careerSubjects)
		case len(parts) == 2 && parts[0] == "subjects":
			serve(subjects, parts[1])
		case len(parts) == 3 && parts[0] == "subjects" && parts[2] == "sessions":
			serve(sessions, parts[1])
		case len(parts) == 3 && parts[0] == "subjects" && parts[2] == "relations":
			if _, ok := relations[parts[1]]; ok {
				serve(relations, parts[1])
				return
			}
			// Subjects of other careers (Cálculo II and its neighbours), recorded one per file.
			if body, err := os.ReadFile(filepath.Join("testdata", "relations_s"+parts[1]+".json")); err == nil {
				w.Write(body)
				return
			}
			http.NotFound(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

const (
	algebraLineal = 7
	complementosI = 10
	arquitectura  = 11
	edaII         = 15
	ingles        = 16
	calculoII     = 55
	fisicaI       = 56
)

type schedResult struct {
	Options []struct {
		Commissions []struct {
			SubjectID  int    `json:"subject_id"`
			Name       string `json:"name"`
			Commission string `json:"commission"`
			Stale      bool   `json:"stale"`
			Classes    []struct {
				Day          int    `json:"day"`
				From         string `json:"from"`
				To           string `json:"to"`
				EndEstimated bool   `json:"end_estimated"`
			} `json:"classes"`
		} `json:"commissions"`
		DaysOnCampus int     `json:"days_on_campus"`
		GapHours     float64 `json:"gap_hours"`
	} `json:"options"`
	Scheduled []int `json:"scheduled_subject_ids"`
	Conflicts []struct {
		SubjectIDs []int  `json:"subject_ids"`
		Day        int    `json:"day"`
		From       string `json:"from"`
		To         string `json:"to"`
	} `json:"conflicts"`
	Postpone   []int `json:"suggest_postpone"`
	NotEnabled []struct {
		SubjectID int `json:"subject_id"`
		Missing   []struct {
			SubjectID int    `json:"subject_id"`
			Code      string `json:"code"`
			Condition string `json:"condition"`
		} `json:"missing"`
	} `json:"not_enabled"`
	WithoutSchedule []int    `json:"without_schedule"`
	Warnings        []string `json:"warnings"`
}

func (r schedResult) commissionsOf(option int) map[int]string {
	out := map[int]string{}
	for _, c := range r.Options[option].Commissions {
		out[c.SubjectID] = c.Commission
	}
	return out
}

func (r schedResult) labels(subject int) []string {
	var out []string
	for i := range r.Options {
		out = append(out, r.commissionsOf(i)[subject])
	}
	return out
}

func (r schedResult) hasWarning(substr string) bool {
	for _, w := range r.Warnings {
		if strings.Contains(w, substr) {
			return true
		}
	}
	return false
}

func build(t *testing.T, args map[string]any) schedResult {
	t.Helper()
	cs := connect(t, stubSchedule(t).URL, nil)
	return ok[schedResult](t, cs, "build_schedule", args)
}

func TestOverlappingBottlenecksPostponeTheOneThatUnlocksLess(t *testing.T) {
	t.Parallel()
	// Lógica (unlocks 10) and Álgebra Lineal (unlocks 12) both meet Monday 07:30-11:00.
	got := build(t, map[string]any{"subject_ids": []int{algebraLineal, 12}})

	if len(got.Conflicts) != 1 || !reflect.DeepEqual(got.Conflicts[0].SubjectIDs, []int{algebraLineal, 12}) ||
		got.Conflicts[0].Day != 1 || got.Conflicts[0].From != "07:30" || got.Conflicts[0].To != "11:00" {
		t.Fatalf("conflicts: %+v", got.Conflicts)
	}
	if !reflect.DeepEqual(got.Postpone, []int{12}) || !reflect.DeepEqual(got.Scheduled, []int{algebraLineal}) {
		t.Fatalf("postpone = %v, scheduled = %v", got.Postpone, got.Scheduled)
	}
	if len(got.Options) != 1 || got.Options[0].Commissions[0].SubjectID != algebraLineal {
		t.Fatalf("the rest should still get a timetable: %+v", got.Options)
	}
}

func TestPostponesTheNonBottleneckWhenEitherFixWorks(t *testing.T) {
	t.Parallel()
	// Álgebra Lineal (bottleneck) clashes with Arquitectura (unlocks 5) on Wednesday and Friday.
	got := build(t, map[string]any{"subject_ids": []int{algebraLineal, arquitectura}})

	days := []int{got.Conflicts[0].Day, got.Conflicts[1].Day}
	if len(got.Conflicts) != 2 || !reflect.DeepEqual(days, []int{3, 5}) {
		t.Fatalf("conflicts: %+v", got.Conflicts)
	}
	if !reflect.DeepEqual(got.Postpone, []int{arquitectura}) {
		t.Fatalf("postpone = %v", got.Postpone)
	}
}

func TestPostponesTheFewestSubjectsWhenEveryFixTouchesABottleneck(t *testing.T) {
	t.Parallel()
	// Álgebra Lineal clashes with both others: dropping it alone beats dropping Lógica and Arquitectura.
	got := build(t, map[string]any{"subject_ids": []int{algebraLineal, arquitectura, 12}})

	if len(got.Conflicts) != 3 {
		t.Fatalf("conflicts: %+v", got.Conflicts)
	}
	if !reflect.DeepEqual(got.Postpone, []int{algebraLineal}) || !reflect.DeepEqual(got.Scheduled, []int{arquitectura, 12}) {
		t.Fatalf("postpone = %v, scheduled = %v", got.Postpone, got.Scheduled)
	}
}

func TestCompatibleSubjectsGetOneOptionWithoutConflicts(t *testing.T) {
	t.Parallel()
	got := build(t, map[string]any{"subject_ids": []int{12, arquitectura}})

	if len(got.Options) != 1 || len(got.Conflicts) != 0 || len(got.Postpone) != 0 {
		t.Fatalf("unexpected result: %+v", got)
	}
	o := got.Options[0]
	if o.DaysOnCampus != 4 || o.GapHours != 0 || !reflect.DeepEqual(got.Scheduled, []int{arquitectura, 12}) {
		t.Fatalf("option: days=%d gap=%v scheduled=%v", o.DaysOnCampus, o.GapHours, got.Scheduled)
	}
	if !got.hasWarning("correlativas were not checked") {
		t.Fatalf("warnings: %v", got.Warnings)
	}
}

func TestSubjectWithoutCurrentSemesterIsMarkedStale(t *testing.T) {
	t.Parallel()
	got := build(t, map[string]any{"subject_ids": []int{12, edaII}})

	stale := map[int]bool{}
	for _, c := range got.Options[0].Commissions {
		stale[c.SubjectID] = c.Stale
	}
	if stale[12] || !stale[edaII] || !got.hasWarning("subject 15 has no 2026-2S schedule") {
		t.Fatalf("stale = %v, warnings = %v", stale, got.Warnings)
	}
}

func TestSubjectWithNoPublishedClassesIsLeftOut(t *testing.T) {
	t.Parallel()
	got := build(t, map[string]any{"subject_ids": []int{12, ingles}})

	if !reflect.DeepEqual(got.WithoutSchedule, []int{ingles}) || !reflect.DeepEqual(got.Scheduled, []int{12}) {
		t.Fatalf("without = %v, scheduled = %v", got.WithoutSchedule, got.Scheduled)
	}
}

func TestMissingEndTimeAssumesThreeHoursAndSaysSo(t *testing.T) {
	t.Parallel()
	got := build(t, map[string]any{"subject_ids": []int{algebraLineal}})

	friday := got.Options[0].Commissions[0].Classes[2]
	if friday.Day != 5 || friday.From != "09:30" || friday.To != "12:30" || !friday.EndEstimated {
		t.Fatalf("friday class: %+v", friday)
	}
	if !got.hasWarning("subject 7 has classes without an end time") {
		t.Fatalf("warnings: %v", got.Warnings)
	}
}

func TestSubjectWithUnmetCorrelativasIsNotEnabled(t *testing.T) {
	t.Parallel()
	got := build(t, map[string]any{"subject_ids": []int{12}, "approved_subject_ids": []int{}})

	if len(got.NotEnabled) != 1 || got.NotEnabled[0].SubjectID != 12 ||
		got.NotEnabled[0].Missing[0].SubjectID != 6 || got.NotEnabled[0].Missing[0].Code != "r123" ||
		got.NotEnabled[0].Missing[0].Condition != "approved" {
		t.Fatalf("not_enabled: %+v", got.NotEnabled)
	}
	if len(got.Options) != 0 || len(got.Scheduled) != 0 || got.hasWarning("were not checked") {
		t.Fatalf("unexpected result: %+v", got)
	}
}

func TestSubjectWithApprovedCorrelativasIsScheduled(t *testing.T) {
	t.Parallel()
	got := build(t, map[string]any{"subject_ids": []int{12}, "approved_subject_ids": []int{6}})

	if len(got.NotEnabled) != 0 || !reflect.DeepEqual(got.Scheduled, []int{12}) {
		t.Fatalf("not_enabled = %+v, scheduled = %v", got.NotEnabled, got.Scheduled)
	}
}

func TestRegularCorrelativaIsMetByRegularOrApproved(t *testing.T) {
	t.Parallel()
	// Cálculo II requires 51 approved and 52 regular.
	cs := connect(t, stubSchedule(t).URL, nil)

	regular := ok[schedResult](t, cs, "build_schedule", map[string]any{"subject_ids": []int{calculoII}, "approved_subject_ids": []int{51}, "regular_subject_ids": []int{52}})
	approved := ok[schedResult](t, cs, "build_schedule", map[string]any{"subject_ids": []int{calculoII}, "approved_subject_ids": []int{51, 52}})
	missing := ok[schedResult](t, cs, "build_schedule", map[string]any{"subject_ids": []int{calculoII}, "approved_subject_ids": []int{51}})

	if len(regular.NotEnabled) != 0 || len(approved.NotEnabled) != 0 {
		t.Fatalf("regular: %+v, approved: %+v", regular.NotEnabled, approved.NotEnabled)
	}
	m := missing.NotEnabled[0].Missing[0]
	if m.SubjectID != 52 || m.Code != "FB3" || m.Condition != "regular" {
		t.Fatalf("missing: %+v", m)
	}
}

func TestPreferredShiftThenFewerDaysRanksCommissions(t *testing.T) {
	t.Parallel()
	// 640 and 650 both start before 13:00 on two days; 610 needs three days.
	got := build(t, map[string]any{"subject_ids": []int{calculoII}, "preferences": map[string]any{"shift": "morning"}})

	if want := []string{"640", "650", "610"}; !reflect.DeepEqual(got.labels(calculoII), want) {
		t.Fatalf("commissions = %v, want %v", got.labels(calculoII), want)
	}
	if got.Options[0].DaysOnCampus != 2 {
		t.Fatalf("days = %d", got.Options[0].DaysOnCampus)
	}
}

func TestFreeDaysExcludeCommissionsMeetingThatDay(t *testing.T) {
	t.Parallel()
	// Only 630, 660 and 670 have no Tuesday class; 670 is all evening.
	got := build(t, map[string]any{"subject_ids": []int{calculoII}, "preferences": map[string]any{"shift": "morning", "free_days": []int{2}}})

	if want := []string{"630", "660", "670"}; !reflect.DeepEqual(got.labels(calculoII), want) {
		t.Fatalf("commissions = %v, want %v", got.labels(calculoII), want)
	}
}

func TestFreeDaysAreIgnoredWithAWarningWhenNothingKeepsThem(t *testing.T) {
	t.Parallel()
	// Every Cálculo II commission meets on Monday.
	got := build(t, map[string]any{"subject_ids": []int{calculoII}, "preferences": map[string]any{"free_days": []int{1}}})

	if len(got.Options) == 0 || !got.hasWarning("no combination keeps the requested free days") {
		t.Fatalf("options = %d, warnings = %v", len(got.Options), got.Warnings)
	}
}

func TestTwoSubjectsWithCommissionsGetTheTightestPair(t *testing.T) {
	t.Parallel()
	got := build(t, map[string]any{"subject_ids": []int{calculoII, fisicaI}})

	best := got.commissionsOf(0)
	if best[calculoII] != "640" || best[fisicaI] != "631" || got.Options[0].DaysOnCampus != 2 || got.Options[0].GapHours != 0.25 {
		t.Fatalf("best option: %v days=%d gap=%v", best, got.Options[0].DaysOnCampus, got.Options[0].GapHours)
	}
}

func TestClassesWithoutCommissionLabelAreIgnoredWhenOthersHaveOne(t *testing.T) {
	t.Parallel()
	got := build(t, map[string]any{"subject_ids": []int{fisicaI}})

	if !got.hasWarning("subject 56: 9 classes without a commission label were ignored") {
		t.Fatalf("warnings: %v", got.Warnings)
	}
}

func TestSubjectsOfDifferentCareersAreRejected(t *testing.T) {
	t.Parallel()
	cs := connect(t, stubSchedule(t).URL, nil)

	if e := fails(t, cs, "build_schedule", map[string]any{"subject_ids": []int{12, calculoII}}); e.Error.Code != "invalid_argument" {
		t.Fatalf("code = %q", e.Error.Code)
	}
}

func TestInvalidScheduleRequestsAreRejected(t *testing.T) {
	t.Parallel()
	cs := connect(t, stubSchedule(t).URL, nil)
	thirteen := make([]int, 13)
	for i := range thirteen {
		thirteen[i] = i + 1
	}

	cases := map[string]map[string]any{
		"no subjects":   {"subject_ids": []int{}},
		"too many":      {"subject_ids": thirteen},
		"unknown shift": {"subject_ids": []int{12}, "preferences": map[string]any{"shift": "night"}},
		"bad free day":  {"subject_ids": []int{12}, "preferences": map[string]any{"free_days": []int{8}}},
	}
	for name, args := range cases {
		if e := fails(t, cs, "build_schedule", args); e.Error.Code != "invalid_argument" {
			t.Errorf("%s: code = %q (%s)", name, e.Error.Code, strconv.Quote(e.Error.Message))
		}
	}
}

// --- the manual review of LCC (corrections/data/career_1.json) ---

const (
	isw1      = 22
	so2       = 23
	analisisL = 18
	modelosF  = 19
	comunic   = 20
)

type prereqResult struct {
	Requires []struct {
		SubjectID int    `json:"subject_id"`
		Code      string `json:"code"`
		Condition string `json:"condition"`
	} `json:"requires"`
	Unlocks []struct {
		SubjectID int    `json:"subject_id"`
		Name      string `json:"name"`
	} `json:"unlocks"`
}

func (p prereqResult) requiredIDs() []int {
	var ids []int
	for _, r := range p.Requires {
		ids = append(ids, r.SubjectID)
	}
	return ids
}

func (p prereqResult) unlockedIDs() []int {
	ids := []int{}
	for _, u := range p.Unlocks {
		ids = append(ids, u.SubjectID)
	}
	return ids
}

func prerequisites(t *testing.T, subject int) prereqResult {
	t.Helper()
	cs := connect(t, stubSchedule(t).URL, nil)
	return ok[prereqResult](t, cs, "prerequisites", map[string]any{"subject_id": subject})
}

func TestPrerequisitesDropTheWrongCorrelativaTheAPIHas(t *testing.T) {
	t.Parallel()
	// The API says Ingeniería de Software I requires Sistemas Operativos II;
	// the official program only recommends it alongside.
	got := prerequisites(t, isw1)

	if !reflect.DeepEqual(got.requiredIDs(), []int{12, 15, 16}) {
		t.Fatalf("requires %v", got.requiredIDs())
	}
	// What it unlocks is Práctica Profesional and Taller de Tesina (SIU Guaraní), not Ingeniería de Software I.
	var unlocked []int
	for _, u := range prerequisites(t, so2).Unlocks {
		unlocked = append(unlocked, u.SubjectID)
	}
	if !reflect.DeepEqual(unlocked, []int{28, 29}) {
		t.Fatalf("Sistemas Operativos II unlocks %v, want [28 29]", unlocked)
	}
}

func TestPrerequisitesAddTheCorrelativaTheAPIIsMissing(t *testing.T) {
	t.Parallel()
	got := prerequisites(t, analisisL)

	if !reflect.DeepEqual(got.requiredIDs(), []int{12, edaII}) || got.Requires[1].Code != "r312" || got.Requires[1].Condition != "approved" {
		t.Fatalf("requires %+v", got.Requires)
	}
	unlocks := prerequisites(t, edaII).Unlocks
	var names []string
	for _, u := range unlocks {
		names = append(names, u.Name)
	}
	if !strings.Contains(strings.Join(names, "|"), "Análisis de Lenguajes de Programación") {
		t.Fatalf("EDA II should now unlock Análisis de Lenguajes: %v", names)
	}
}

func TestSubjectIsEnabledWithTheOfficialCorrelativasAlone(t *testing.T) {
	t.Parallel()
	// With the API's data Ingeniería de Software I would also need Sistemas Operativos II.
	got := build(t, map[string]any{"subject_ids": []int{isw1}, "approved_subject_ids": []int{12, edaII, ingles}})

	if len(got.NotEnabled) != 0 || !reflect.DeepEqual(got.Scheduled, []int{isw1}) {
		t.Fatalf("not_enabled = %+v, scheduled = %v", got.NotEnabled, got.Scheduled)
	}
}

func TestSubjectMissingAnOfficialCorrelativaIsNotEnabled(t *testing.T) {
	t.Parallel()
	got := build(t, map[string]any{"subject_ids": []int{isw1}, "approved_subject_ids": []int{12, edaII}})

	if len(got.NotEnabled) != 1 || len(got.NotEnabled[0].Missing) != 1 ||
		got.NotEnabled[0].Missing[0].SubjectID != ingles || got.NotEnabled[0].Missing[0].Code != "r314" {
		t.Fatalf("not_enabled: %+v", got.NotEnabled)
	}
}

func TestBottlenecksFollowTheReviewedGraph(t *testing.T) {
	t.Parallel()
	// EDA II clashes with Modelos Físicos and Comunicaciones, which fit together.
	// Reviewed, EDA II unlocks 10 subjects (Práctica Profesional, Taller de Tesina
	// and the Tesina need it), so it is a bottleneck and the other two, which
	// unlock 3 each, are postponed instead.
	got := build(t, map[string]any{"subject_ids": []int{edaII, modelosF, comunic}})

	if !reflect.DeepEqual(got.Postpone, []int{modelosF, comunic}) || !reflect.DeepEqual(got.Scheduled, []int{edaII}) {
		t.Fatalf("postpone = %v, scheduled = %v", got.Postpone, got.Scheduled)
	}
}

func TestPrerequisitesReturnOnlyDirectCorrelativasLikeThePlan(t *testing.T) {
	t.Parallel()
	cases := map[int][]int{
		edaII: {complementosI},                 // EDA I is implied by Complementos de Matemática I
		24:    {ingles, 21},                    // Inteligencia Artificial: Lógica and EDA II are implied by Teoría de Base de Datos
		28:    {9, 13, 18, 19, 20, 23, 24, 25}, // Práctica Profesional: 23 correlativas in the SIU Guaraní, 8 direct
		31:    {26, 27, 28, 29, 30, 197, 198, 199},
	}
	for id, want := range cases {
		if got := prerequisites(t, id).requiredIDs(); !reflect.DeepEqual(got, want) {
			t.Errorf("subject %d requires %v, want %v", id, got, want)
		}
	}
	// Lógica no longer lists Inteligencia Artificial as something it unlocks directly.
	for _, u := range prerequisites(t, 12).Unlocks {
		if u.SubjectID == 24 {
			t.Error("Lógica should not unlock Inteligencia Artificial directly")
		}
	}
}
