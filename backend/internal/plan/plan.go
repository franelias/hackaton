// Package plan turns a career's correlativas into the plan tree of
// docs/contratos.md §2.1: what each subject unlocks, which ones are
// bottlenecks and how much the career slips if a subject is held back.
//
// Model: each subject takes one cuatrimestre, there is no limit of subjects
// per cuatrimestre and a subject can start the cuatrimestre after all its
// prerequisites. That is a lower bound for how long the career takes.
// Subjects are offered once a year, so "leaving" one means postponing it
// PostponeTerms cuatrimestres.
package plan

import (
	"fmt"
	"sort"
)

const (
	// BottleneckThreshold is the destraba_total from which a subject is a
	// cuello de botella.
	BottleneckThreshold = 8
	// PostponeTerms is how long a missed subject is held back: it is offered
	// once a year.
	PostponeTerms = 2
)

type Requisito struct {
	SubjectID int    `json:"subject_id"`
	Condicion string `json:"condition"`
}

type Materia struct {
	SubjectID       int         `json:"subject_id"`
	Code            string      `json:"code"`
	Nombre          string      `json:"name"`
	Anio            *int        `json:"year"`
	Cuatrimestre    *int        `json:"term"`
	Opcional        bool        `json:"optional"`
	Requiere        []Requisito `json:"requires"`
	Destraba        []int       `json:"unlocks"`
	DestrabaTotal   int         `json:"unlocks_total"`
	CuelloDeBotella bool        `json:"bottleneck"`
	// Holgura: cuatrimestres que se puede demorar sin atrasar la carrera.
	// Es 0 en el camino crítico. Solo se calcula para las materias del plan base.
	Holgura int `json:"slack"`
	// AtrasoPosponerAnio: cuatrimestres que se atrasa la carrera si la materia
	// se pospone un año.
	AtrasoPosponerAnio int `json:"postpone_year_delay"`
}

type Plan struct {
	CareerID             int       `json:"career_id"`
	Nombre               string    `json:"name"`
	CuatrimestresMinimos int       `json:"min_terms"`
	CaminoCritico        []int     `json:"critical_path"`
	Materias             []Materia `json:"subjects"`
}

// Analysis is the critical path of the obligatory subjects plus the electives
// a student chose.
type Analysis struct {
	CuatrimestresMinimos int
	CaminoCritico        []int
}

// Result is a built plan that can also be analysed with chosen electives.
type Result struct {
	Plan Plan
	g    *graph
}

// Build validates the correlativas and computes the base plan, which covers
// the obligatory subjects. Electives appear as optional subjects with no
// time metrics: use Analyze to see them in the critical path.
func Build(in Input) (*Result, error) {
	g, err := newGraph(in)
	if err != nil {
		return nil, err
	}
	base := map[int]bool{}
	for _, id := range g.ids {
		if !g.subjects[id].Elective {
			base[id] = true
		}
	}
	sched := g.schedule(base, nil)

	p := Plan{
		CareerID:             in.CareerID,
		Nombre:               in.Name,
		CuatrimestresMinimos: sched.terms,
		CaminoCritico:        g.criticalPath(sched),
		Materias:             []Materia{},
	}
	for _, id := range g.ids {
		s := g.subjects[id]
		m := Materia{
			SubjectID: id, Code: s.Code, Nombre: s.Name, Anio: s.Year,
			Cuatrimestre: termOfYear(s.Term), Opcional: s.Elective,
			Requiere: []Requisito{}, Destraba: g.unlocks[id],
			DestrabaTotal: g.descendants(id),
		}
		if m.Destraba == nil {
			m.Destraba = []int{}
		}
		for _, r := range g.requires[id] {
			m.Requiere = append(m.Requiere, Requisito{r.SubjectID, r.Condition})
		}
		m.CuelloDeBotella = m.DestrabaTotal >= BottleneckThreshold
		if base[id] {
			m.Holgura = g.slack(sched, id)
			m.AtrasoPosponerAnio = g.postponeDelay(base, sched, id, PostponeTerms)
		}
		p.Materias = append(p.Materias, m)
	}
	sort.SliceStable(p.Materias, func(i, j int) bool {
		a, b := p.Materias[i], p.Materias[j]
		if a.Opcional != b.Opcional {
			return !a.Opcional
		}
		if ay, by := yearKey(a.Anio), yearKey(b.Anio); ay != by {
			return ay < by
		}
		if at, bt := termKey(a.Cuatrimestre), termKey(b.Cuatrimestre); at != bt {
			return at < bt
		}
		return a.SubjectID < b.SubjectID
	})
	return &Result{Plan: p, g: g}, nil
}

func (g *graph) postponeDelay(active map[int]bool, base schedule, id, terms int) int {
	held := g.schedule(active, map[int]int{id: base.start[id] + terms})
	return held.terms - base.terms
}

// Analyze recomputes the critical path with the chosen electives added to the
// obligatory subjects.
func (r *Result) Analyze(chosenElectives []int) (Analysis, error) {
	active := map[int]bool{}
	for _, id := range r.g.ids {
		if !r.g.subjects[id].Elective {
			active[id] = true
		}
	}
	for _, id := range chosenElectives {
		s, ok := r.g.subjects[id]
		if !ok {
			return Analysis{}, fmt.Errorf("unknown subject %d", id)
		}
		if !s.Elective {
			return Analysis{}, fmt.Errorf("subject %d is not an elective", id)
		}
		active[id] = true
	}
	for id := range active {
		for _, p := range r.g.requires[id] {
			if !active[p.SubjectID] {
				return Analysis{}, fmt.Errorf("elective %d requires elective %d, which was not chosen", id, p.SubjectID)
			}
		}
	}
	sched := r.g.schedule(active, nil)
	return Analysis{CuatrimestresMinimos: sched.terms, CaminoCritico: r.g.criticalPath(sched)}, nil
}

// termOfYear turns the API's absolute term (1..10) into 1 or 2 within the year.
func termOfYear(term *int) *int {
	if term == nil || *term <= 0 {
		return nil
	}
	t := (*term-1)%2 + 1
	return &t
}

func yearKey(y *int) int {
	if y == nil {
		return 99
	}
	return *y
}

func termKey(t *int) int {
	if t == nil {
		return 99
	}
	return *t
}
