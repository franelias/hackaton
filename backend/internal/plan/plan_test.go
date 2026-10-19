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

func lcc(t *testing.T, ov plan.Overrides) *plan.Result {
	t.Helper()
	res, err := plan.Generate(context.Background(), stubFCEIA(t), 1, ov)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func materia(t *testing.T, p plan.Plan, id int) plan.Materia {
	t.Helper()
	for _, m := range p.Materias {
		if m.SubjectID == id {
			return m
		}
	}
	t.Fatalf("subject %d not in plan", id)
	return plan.Materia{}
}

const (
	logica        = 12
	programacionI = 3
	isw1          = 22
	so2           = 23
)

func TestLogicaUnlocksTenSubjectsAndDelaysTheCareerOneCuatrimestreIfPostponedAYear(t *testing.T) {
	t.Parallel()
	m := materia(t, lcc(t, plan.Overrides{}).Plan, logica)

	if !reflect.DeepEqual(m.Destraba, []int{17, 18, 21, 22, 24, 27}) {
		t.Fatalf("destraba = %v", m.Destraba)
	}
	if m.DestrabaTotal != 10 || !m.CuelloDeBotella || m.Holgura != 1 || m.AtrasoPosponerAnio != 1 {
		t.Fatalf("unexpected metrics: %+v", m)
	}
}

func TestProgramacionIIsOnTheCriticalPathAndUnlocksEighteenSubjects(t *testing.T) {
	t.Parallel()
	m := materia(t, lcc(t, plan.Overrides{}).Plan, programacionI)

	if m.DestrabaTotal != 18 || m.Holgura != 0 || m.AtrasoPosponerAnio != 2 {
		t.Fatalf("unexpected metrics: %+v", m)
	}
}

func TestCareerTakesNineCuatrimestresAlongTheCriticalPath(t *testing.T) {
	t.Parallel()
	p := lcc(t, plan.Overrides{}).Plan

	if p.CuatrimestresMinimos != 9 {
		t.Fatalf("cuatrimestres_minimos = %d", p.CuatrimestresMinimos)
	}
	// Álgebra I → Álgebra II → Álgebra Lineal → Complementos I → EDA II →
	// Sistemas Operativos I → Sistemas Operativos II → Ing. de Software I → II
	if want := []int{1, 4, 7, 10, 15, 17, 23, 22, 25}; !reflect.DeepEqual(p.CaminoCritico, want) {
		t.Fatalf("camino_critico = %v, want %v", p.CaminoCritico, want)
	}
}

func TestNineSubjectsAreBottlenecks(t *testing.T) {
	t.Parallel()
	p := lcc(t, plan.Overrides{}).Plan

	var ids []int
	for _, m := range p.Materias {
		if m.CuelloDeBotella {
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
	p := lcc(t, plan.Overrides{}).Plan

	electivas := 0
	for _, m := range p.Materias {
		if m.Opcional {
			electivas++
			if m.AtrasoPosponerAnio != 0 || m.CuelloDeBotella {
				t.Fatalf("optional subject with time metrics: %+v", m)
			}
		}
	}
	if electivas != 7 || p.Materias[len(p.Materias)-1].Opcional != true {
		t.Fatalf("optional subjects = %d, last optional = %v", electivas, p.Materias[len(p.Materias)-1].Opcional)
	}
}

func TestChosenElectiveWithPrerequisitesExtendsTheCriticalPath(t *testing.T) {
	t.Parallel()
	// 33 is an elective; pretend it needs Ingeniería de Software II (25).
	res := lcc(t, plan.Overrides{AddPrerequisites: []plan.PrerequisiteEdit{{SubjectID: 33, Requires: 25}}})

	without, err := res.Analyze(nil)
	if err != nil {
		t.Fatal(err)
	}
	with, err := res.Analyze([]int{33})
	if err != nil {
		t.Fatal(err)
	}

	if without.CuatrimestresMinimos != 9 || with.CuatrimestresMinimos != 10 {
		t.Fatalf("without = %d, with = %d", without.CuatrimestresMinimos, with.CuatrimestresMinimos)
	}
	if got := with.CaminoCritico; got[len(got)-1] != 33 {
		t.Fatalf("critical path with the elective = %v", got)
	}
}

func TestAnalyzeRejectsAnElectiveWhoseElectivePrerequisiteWasNotChosen(t *testing.T) {
	t.Parallel()
	res := lcc(t, plan.Overrides{AddPrerequisites: []plan.PrerequisiteEdit{{SubjectID: 33, Requires: 32}}})

	if _, err := res.Analyze([]int{33}); err == nil || !strings.Contains(err.Error(), "requires elective 32") {
		t.Fatalf("err = %v", err)
	}
}

func TestAnalyzeRejectsAnObligatorySubject(t *testing.T) {
	t.Parallel()
	res := lcc(t, plan.Overrides{})

	if _, err := res.Analyze([]int{logica}); err == nil || !strings.Contains(err.Error(), "not an elective") {
		t.Fatalf("err = %v", err)
	}
}

func TestOverrideCorrectsYearAndCuatrimestre(t *testing.T) {
	t.Parallel()
	year, term := 4, 7
	res := lcc(t, plan.Overrides{Subjects: map[int]plan.SubjectOverride{isw1: {Year: &year, Term: &term}}})

	m := materia(t, res.Plan, isw1)

	if *m.Anio != 4 || *m.Cuatrimestre != 1 {
		t.Fatalf("anio = %d, cuatrimestre = %d", *m.Anio, *m.Cuatrimestre)
	}
}

func TestRemovingAWrongPrerequisiteShortensTheCareer(t *testing.T) {
	t.Parallel()
	res := lcc(t, plan.Overrides{RemovePrerequisites: []plan.PrerequisiteEdit{{SubjectID: isw1, Requires: so2}}})

	if res.Plan.CuatrimestresMinimos != 7 {
		t.Fatalf("cuatrimestres_minimos = %d, want 7", res.Plan.CuatrimestresMinimos)
	}
}

func TestOverrideForUnknownSubjectIsRejected(t *testing.T) {
	t.Parallel()
	year := 1

	_, err := plan.Generate(context.Background(), stubFCEIA(t), 1,
		plan.Overrides{Subjects: map[int]plan.SubjectOverride{9999: {Year: &year}}})

	if err == nil || !strings.Contains(err.Error(), "unknown subject 9999") {
		t.Fatalf("err = %v", err)
	}
}

func TestRemovingAPrerequisiteTheSubjectDoesNotHaveIsRejected(t *testing.T) {
	t.Parallel()

	_, err := plan.Generate(context.Background(), stubFCEIA(t), 1,
		plan.Overrides{RemovePrerequisites: []plan.PrerequisiteEdit{{SubjectID: logica, Requires: 1}}})

	if err == nil || !strings.Contains(err.Error(), "does not require") {
		t.Fatalf("err = %v", err)
	}
}

func TestOverridesFileRejectsUnknownFields(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "ov.json")
	if err := os.WriteFile(path, []byte(`{"subject":{}}`), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := plan.LoadOverrides(path); err == nil {
		t.Fatal("expected an error for the misspelled key")
	}
}

func TestCommittedOverridesFileLoads(t *testing.T) {
	t.Parallel()

	if _, err := plan.LoadOverrides(filepath.Join("..", "..", "data", "overrides", "career_1.json")); err != nil {
		t.Fatal(err)
	}
}

// --- model, on small hand-made careers ---

func subject(id int, name string, elective bool) plan.Subject {
	return plan.Subject{ID: id, Code: "s" + strconv.Itoa(id), Name: name, Elective: elective}
}

func requires(ids ...int) []plan.Prerequisite {
	var out []plan.Prerequisite
	for _, id := range ids {
		out = append(out, plan.Prerequisite{SubjectID: id, Condition: plan.Aprobada})
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

	if d.Holgura != 1 || d.AtrasoPosponerAnio != 1 {
		t.Fatalf("D: %+v", d)
	}
	if a.Holgura != 0 || a.AtrasoPosponerAnio != 2 {
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
	b, err := json.Marshal(lcc(t, plan.Overrides{}).Plan)
	if err != nil {
		t.Fatal(err)
	}

	var raw struct {
		Materias []map[string]json.RawMessage `json:"materias"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatal(err)
	}
	keys := make([]string, 0)
	for k := range raw.Materias[0] {
		keys = append(keys, k)
	}
	want := "anio atraso_posponer_anio code cuatrimestre cuello_de_botella destraba destraba_total holgura nombre opcional requiere subject_id"
	if got := strings.Join(sorted2(keys), " "); got != want {
		t.Fatalf("keys = %q, want %q", got, want)
	}
}
