package plan_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/franelias/hackaton/backend/internal/fceia"
	"github.com/franelias/hackaton/backend/internal/plan"
	"github.com/franelias/hackaton/corrections"
)

// stubFCEIA serves responses recorded from the real API for career 1
// (Licenciatura en Ciencias de la Computación). relations_career1.json holds
// each subject's recorded /relations body under its subject_id.
func stubFCEIA(t *testing.T) *fceia.Client {
	t.Helper()
	read := func(name string) []byte {
		b, err := os.ReadFile(filepath.Join("testdata", name))
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	relations := map[string]json.RawMessage{}
	if err := json.Unmarshal(read("relations_career1.json"), &relations); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/v1")
		switch {
		case path == "/careers/1":
			w.Write(read("career1.json"))
		case path == "/careers/1/curriculum":
			w.Write(read("curriculum_career1.json"))
		case strings.HasPrefix(path, "/subjects/") && strings.HasSuffix(path, "/relations"):
			id := strings.TrimSuffix(strings.TrimPrefix(path, "/subjects/"), "/relations")
			if body, ok := relations[id]; ok {
				w.Write(body)
				return
			}
			http.NotFound(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return fceia.New(srv.URL + "/api/v1")
}

func lcc(t *testing.T, ov corrections.Overrides) *plan.Result {
	t.Helper()
	res, err := plan.Generate(context.Background(), stubFCEIA(t), 1, ov)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func materia(t *testing.T, p plan.Plan, id int) plan.PlanSubject {
	t.Helper()
	for _, m := range p.Subjects {
		if m.SubjectID == id {
			return m
		}
	}
	t.Fatalf("subject %d not in plan", id)
	return plan.PlanSubject{}
}

const (
	logica        = 12
	programacionI = 3
	isw1          = 22
	so2           = 23
)

// Tests from here to the official ones use no corrections: they describe the
// model on what the API says. The TestOfficial ones use the committed review.
func TestLogicaUnlocksTenSubjectsAndDelaysTheCareerOneCuatrimestreIfPostponedAYear(t *testing.T) {
	t.Parallel()
	m := materia(t, lcc(t, corrections.Overrides{}).Plan, logica)

	// Only direct correlativas: in the API, Sistemas Operativos I, Ingeniería de
	// Software I and Inteligencia Artificial reach Lógica through other subjects.
	if !reflect.DeepEqual(m.Unlocks, []int{18, 21, 27}) {
		t.Fatalf("destraba = %v", m.Unlocks)
	}
	if m.UnlocksTotal != 10 || !m.Bottleneck || m.Slack != 1 || m.PostponeYearDelay != 1 {
		t.Fatalf("unexpected metrics: %+v", m)
	}
}

func TestProgramacionIIsOnTheCriticalPathAndUnlocksEighteenSubjects(t *testing.T) {
	t.Parallel()
	m := materia(t, lcc(t, corrections.Overrides{}).Plan, programacionI)

	if m.UnlocksTotal != 18 || m.Slack != 0 || m.PostponeYearDelay != 2 {
		t.Fatalf("unexpected metrics: %+v", m)
	}
}

func TestCareerTakesNineCuatrimestresAlongTheCriticalPath(t *testing.T) {
	t.Parallel()
	p := lcc(t, corrections.Overrides{}).Plan

	if p.MinTerms != 9 {
		t.Fatalf("cuatrimestres_minimos = %d", p.MinTerms)
	}
	// Álgebra I → Álgebra II → Álgebra Lineal → Complementos I → EDA II →
	// Sistemas Operativos I → Sistemas Operativos II → Ing. de Software I → II
	if want := []int{1, 4, 7, 10, 15, 17, 23, 22, 25}; !reflect.DeepEqual(p.CriticalPath, want) {
		t.Fatalf("camino_critico = %v, want %v", p.CriticalPath, want)
	}
}

func TestNineSubjectsAreBottlenecks(t *testing.T) {
	t.Parallel()
	p := lcc(t, corrections.Overrides{}).Plan

	var ids []int
	for _, m := range p.Subjects {
		if m.Bottleneck {
			ids = append(ids, m.SubjectID)
		}
	}
	// Álgebra I y II, Programación I y II, Álgebra Lineal, EDA I y II,
	// Complementos I y Lógica.
	if want := []int{1, 3, 4, 6, 7, 8, 10, 12, 15}; !reflect.DeepEqual(sorted(ids), want) {
		t.Fatalf("bottlenecks = %v, want %v", sorted(ids), want)
	}
}

func TestElectivesAreOptionalAndLeaveTheBasePlanUntouched(t *testing.T) {
	t.Parallel()
	p := lcc(t, corrections.Overrides{}).Plan

	electivas := 0
	for _, m := range p.Subjects {
		if m.Optional {
			electivas++
			if m.PostponeYearDelay != 0 || m.Bottleneck {
				t.Fatalf("optional subject with time metrics: %+v", m)
			}
		}
	}
	if electivas != 7 || p.Subjects[len(p.Subjects)-1].Optional != true {
		t.Fatalf("optional subjects = %d, last optional = %v", electivas, p.Subjects[len(p.Subjects)-1].Optional)
	}
}

func TestChosenElectiveWithPrerequisitesExtendsTheCriticalPath(t *testing.T) {
	t.Parallel()
	// 33 is an elective; pretend it needs Ingeniería de Software II (25).
	res := lcc(t, corrections.Overrides{AddPrerequisites: []corrections.Edit{{SubjectID: 33, Requires: 25}}})

	without, err := res.Analyze(nil)
	if err != nil {
		t.Fatal(err)
	}
	with, err := res.Analyze([]int{33})
	if err != nil {
		t.Fatal(err)
	}

	if without.MinTerms != 9 || with.MinTerms != 10 {
		t.Fatalf("without = %d, with = %d", without.MinTerms, with.MinTerms)
	}
	if got := with.CriticalPath; got[len(got)-1] != 33 {
		t.Fatalf("critical path with the elective = %v", got)
	}
}

func TestAnalyzeRejectsAnElectiveWhoseElectivePrerequisiteWasNotChosen(t *testing.T) {
	t.Parallel()
	res := lcc(t, corrections.Overrides{AddPrerequisites: []corrections.Edit{{SubjectID: 33, Requires: 32}}})

	if _, err := res.Analyze([]int{33}); err == nil || !strings.Contains(err.Error(), "requires elective 32") {
		t.Fatalf("err = %v", err)
	}
}

func TestAnalyzeRejectsAnObligatorySubject(t *testing.T) {
	t.Parallel()
	res := lcc(t, corrections.Overrides{})

	if _, err := res.Analyze([]int{logica}); err == nil || !strings.Contains(err.Error(), "not an elective") {
		t.Fatalf("err = %v", err)
	}
}

func TestOverrideCorrectsYearAndCuatrimestre(t *testing.T) {
	t.Parallel()
	year, term := 4, 7
	res := lcc(t, corrections.Overrides{Subjects: map[int]corrections.Subject{isw1: {Year: &year, Term: &term}}})

	m := materia(t, res.Plan, isw1)

	if *m.Year != 4 || *m.Term != 1 {
		t.Fatalf("anio = %d, cuatrimestre = %d", *m.Year, *m.Term)
	}
}

func TestRemovingAWrongPrerequisiteShortensTheCareer(t *testing.T) {
	t.Parallel()
	res := lcc(t, corrections.Overrides{RemovePrerequisites: []corrections.Edit{{SubjectID: isw1, Requires: so2}}})

	if res.Plan.MinTerms != 7 {
		t.Fatalf("cuatrimestres_minimos = %d, want 7", res.Plan.MinTerms)
	}
}

func TestOverrideForUnknownSubjectIsRejected(t *testing.T) {
	t.Parallel()
	year := 1

	_, err := plan.Generate(context.Background(), stubFCEIA(t), 1,
		corrections.Overrides{Subjects: map[int]corrections.Subject{9999: {Year: &year}}})

	if err == nil || !strings.Contains(err.Error(), "unknown subject 9999") {
		t.Fatalf("err = %v", err)
	}
}

func TestRemovingAPrerequisiteTheSubjectDoesNotHaveIsRejected(t *testing.T) {
	t.Parallel()

	_, err := plan.Generate(context.Background(), stubFCEIA(t), 1,
		corrections.Overrides{RemovePrerequisites: []corrections.Edit{{SubjectID: logica, Requires: 1}}})

	if err == nil || !strings.Contains(err.Error(), "does not require") {
		t.Fatalf("err = %v", err)
	}
}

// --- model, on small hand-made careers ---

func subject(id int, name string, elective bool) plan.Subject {
	return plan.Subject{ID: id, Code: "s" + strconv.Itoa(id), Name: name, Elective: elective}
}

func requires(ids ...int) []plan.Prerequisite {
	var out []plan.Prerequisite
	for _, id := range ids {
		out = append(out, plan.Prerequisite{SubjectID: id, Condition: plan.Approved})
	}
	return out
}

func TestSubjectWithSlackOnlyDelaysTheCareerWhenPostponedBeyondIt(t *testing.T) {
	t.Parallel()
	// A → B → C, and D → C: D has one cuatrimestre of slack.
	res, err := plan.Build(plan.Input{
		Subjects: []plan.Subject{subject(1, "A", false), subject(2, "B", false), subject(3, "C", false), subject(4, "D", false)},
		Prerequisites: map[int][]plan.Prerequisite{
			2: requires(1), 3: requires(2, 4),
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	d, a := materia(t, res.Plan, 4), materia(t, res.Plan, 1)

	if d.Slack != 1 || d.PostponeYearDelay != 1 {
		t.Fatalf("D: %+v", d)
	}
	if a.Slack != 0 || a.PostponeYearDelay != 2 {
		t.Fatalf("A: %+v", a)
	}
}

func TestCyclicPrerequisitesAreRejected(t *testing.T) {
	t.Parallel()

	_, err := plan.Build(plan.Input{
		Subjects:      []plan.Subject{subject(1, "A", false), subject(2, "B", false)},
		Prerequisites: map[int][]plan.Prerequisite{1: requires(2), 2: requires(1)},
	})

	if err == nil || !strings.Contains(err.Error(), "cycle") {
		t.Fatalf("err = %v", err)
	}
}

func TestObligatorySubjectCannotRequireAnElective(t *testing.T) {
	t.Parallel()

	_, err := plan.Build(plan.Input{
		Subjects:      []plan.Subject{subject(1, "A", false), subject(2, "E", true)},
		Prerequisites: map[int][]plan.Prerequisite{1: requires(2)},
	})

	if err == nil || !strings.Contains(err.Error(), "requires elective") {
		t.Fatalf("err = %v", err)
	}
}

func TestPlanSerializesWithTheContractFieldNames(t *testing.T) {
	t.Parallel()
	b, err := json.Marshal(official(t).Plan)
	if err != nil {
		t.Fatal(err)
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatal(err)
	}
	var subjects []map[string]json.RawMessage
	if err := json.Unmarshal(raw["subjects"], &subjects); err != nil {
		t.Fatal(err)
	}

	wantPlan := "career_id critical_path min_terms name subjects"
	wantSubject := "bottleneck code name optional postpone_year_delay requires slack subject_id term unlocks unlocks_total year"
	if got := strings.Join(sorted2(keysOf(raw)), " "); got != wantPlan {
		t.Fatalf("plan keys = %q, want %q", got, wantPlan)
	}
	if got := strings.Join(sorted2(keysOf(subjects[0])), " "); got != wantSubject {
		t.Fatalf("subject keys = %q, want %q", got, wantSubject)
	}
}

func TestRequirementsUseTheContractConditionValues(t *testing.T) {
	t.Parallel()
	b, err := json.Marshal(materia(t, official(t).Plan, 6).Requires)
	if err != nil {
		t.Fatal(err)
	}

	if string(b) != `[{"subject_id":3,"condition":"approved"}]` {
		t.Fatalf("requires = %s", b)
	}
}

func keysOf(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// --- the committed review of LCC (corrections/data/career_1.json) ---

func official(t *testing.T) *plan.Result {
	t.Helper()
	ov, err := corrections.For(1)
	if err != nil {
		t.Fatal(err)
	}
	return lcc(t, ov)
}

func requiresOf(m plan.PlanSubject) []int {
	var ids []int
	for _, r := range m.Requires {
		ids = append(ids, r.SubjectID)
	}
	return ids
}

func TestOfficialCorrelativasFixSistemasOperativosIAnalisisDeLenguajesAndIngenieriaI(t *testing.T) {
	t.Parallel()
	p := official(t).Plan

	if got := requiresOf(materia(t, p, 17)); !reflect.DeepEqual(got, []int{logica}) {
		t.Fatalf("Sistemas Operativos I requires %v", got)
	}
	if got := requiresOf(materia(t, p, 18)); !reflect.DeepEqual(got, []int{logica, 15}) {
		t.Fatalf("Análisis de Lenguajes requires %v", got)
	}
	if got := requiresOf(materia(t, p, isw1)); !reflect.DeepEqual(got, []int{logica, 15, 16}) {
		t.Fatalf("Ingeniería de Software I requires %v", got)
	}
}

func TestOfficialCareerTakesNineCuatrimestresEndingInTheTesina(t *testing.T) {
	t.Parallel()
	p := official(t).Plan

	if p.MinTerms != 9 {
		t.Fatalf("cuatrimestres_minimos = %d", p.MinTerms)
	}
	// Álgebra I → Álgebra II → Álgebra Lineal → Complementos I → EDA II →
	// Teoría de Base de Datos → Inteligencia Artificial → Práctica Profesional → Tesina
	if want := []int{1, 4, 7, 10, 15, 21, 24, 28, 31}; !reflect.DeepEqual(p.CriticalPath, want) {
		t.Fatalf("camino_critico = %v, want %v", p.CriticalPath, want)
	}
}

func TestOfficialLogicaUnlocksThirteenSubjectsButPostponingItCostsNothing(t *testing.T) {
	t.Parallel()
	m := materia(t, official(t).Plan, logica)

	if m.UnlocksTotal != 13 || !m.Bottleneck || m.PostponeYearDelay != 0 || m.Slack != 2 {
		t.Fatalf("unexpected metrics: %+v", m)
	}
}

func TestOfficialBottlenecksAreTheElevenSubjectsWithEightOrMoreDependents(t *testing.T) {
	t.Parallel()
	p := official(t).Plan

	var ids []int
	for _, m := range p.Subjects {
		if m.Bottleneck {
			ids = append(ids, m.SubjectID)
		}
	}
	// Álgebra I y II, Análisis I, Programación I y II, Álgebra Lineal, EDA I y II,
	// Complementos I, Lógica e Inglés.
	if want := []int{1, 2, 3, 4, 6, 7, 8, 10, 12, 15, 16}; !reflect.DeepEqual(sorted(ids), want) {
		t.Fatalf("bottlenecks = %v, want %v", sorted(ids), want)
	}
}

func TestOfficialYearsAndCuatrimestresFollowThePlan(t *testing.T) {
	t.Parallel()
	p := official(t).Plan

	type slot struct{ anio, cuat int }
	want := map[int]slot{
		3: {1, 1}, 8: {2, 1}, 10: {2, 2}, 14: {3, 1}, 15: {3, 1}, 16: {3, 1},
		17: {3, 1}, 18: {3, 2}, isw1: {4, 1}, 28: {5, 1},
	}
	for id, w := range want {
		m := materia(t, p, id)
		if m.Year == nil || m.Term == nil || *m.Year != w.anio || *m.Term != w.cuat {
			t.Errorf("%s: year %v cuatrimestre %v, want %v", m.Name, deref(m.Year), deref(m.Term), w)
		}
	}
}

func TestOfficialOptativasAreObligatorySubjectsWithoutCorrelativas(t *testing.T) {
	t.Parallel()
	p := official(t).Plan

	for _, id := range []int{197, 198, 199} {
		if m := materia(t, p, id); m.Optional || len(m.Requires) != 0 {
			t.Errorf("%s: optional = %v, requires = %v", m.Name, m.Optional, requiresOf(m))
		}
	}
}

// The 23 correlativas from the SIU Guaraní reduce to the last subject of each chain.
func TestOfficialPracticaProfesionalAndTallerDeTesinaKeepOnlyTheirDirectCorrelativas(t *testing.T) {
	t.Parallel()
	p := official(t).Plan

	// Lenguajes Formales, Métodos Numéricos, Análisis de Lenguajes, Modelos Físicos,
	// Comunicaciones, Sistemas Operativos II, Inteligencia Artificial, Ingeniería de Software II.
	want := []int{9, 13, 18, 19, 20, 23, 24, 25}
	for _, id := range []int{28, 29} {
		if got := requiresOf(materia(t, p, id)); !reflect.DeepEqual(got, want) {
			t.Errorf("subject %d requires %v, want %v", id, got, want)
		}
	}
}

func TestOfficialTesinaIsTheLastSubjectOfTheGraph(t *testing.T) {
	t.Parallel()
	p := official(t).Plan

	tesina := materia(t, p, 31)
	// Compiladores, Complementos II, Práctica Profesional, Taller de Tesina,
	// Seguridad Informática and the three optativas: everything else is implied.
	if got := requiresOf(tesina); !reflect.DeepEqual(got, []int{26, 27, 28, 29, 30, 197, 198, 199}) {
		t.Fatalf("Tesina requires %v", got)
	}
	if tesina.Optional || tesina.UnlocksTotal != 0 {
		t.Fatalf("Tesina: %+v", tesina)
	}
	if m := materia(t, p, 30); m.UnlocksTotal != 1 || !reflect.DeepEqual(m.Unlocks, []int{31}) {
		t.Fatalf("Seguridad Informática should unlock only the Tesina: %+v", m)
	}
	if p.CriticalPath[len(p.CriticalPath)-1] != 31 {
		t.Fatalf("the critical path must end in the Tesina: %v", p.CriticalPath)
	}
}

func TestOfficialRedundantCorrelativasAreDropped(t *testing.T) {
	t.Parallel()
	p := official(t).Plan

	cases := map[int][]int{
		15: {10},        // EDA II: EDA I is implied by Complementos de Matemática I
		24: {16, 21},    // Inteligencia Artificial: Lógica and EDA II are implied by Teoría de Base de Datos
		26: {9, 16, 18}, // Compiladores: EDA II is implied by Análisis de Lenguajes
	}
	for id, want := range cases {
		if got := requiresOf(materia(t, p, id)); !reflect.DeepEqual(got, want) {
			t.Errorf("subject %d requires %v, want %v", id, got, want)
		}
	}
}

func deref(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}
