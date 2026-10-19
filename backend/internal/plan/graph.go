package plan

import (
	"fmt"
	"sort"
)

// Condition values, as in docs/contratos.md §2.1.
const (
	Aprobada = "aprobada"
	Regular  = "regular"
)

type Subject struct {
	ID       int
	Code     string
	Name     string
	Year     *int
	Term     *int // absolute cuatrimestre in the career (1..10) or 1/2 for electives
	Elective bool
}

type Prerequisite struct {
	SubjectID int
	Condition string
}

// Input is a career's subjects and their correlativas, already loaded.
type Input struct {
	CareerID      int
	Name          string
	Subjects      []Subject
	Prerequisites map[int][]Prerequisite // subject_id -> what it requires
}

type graph struct {
	subjects map[int]Subject
	requires map[int][]Prerequisite
	unlocks  map[int][]int
	ids      []int // sorted
}

func newGraph(in Input) (*graph, error) {
	g := &graph{
		subjects: map[int]Subject{},
		requires: map[int][]Prerequisite{},
		unlocks:  map[int][]int{},
	}
	for _, s := range in.Subjects {
		g.subjects[s.ID] = s
		g.ids = append(g.ids, s.ID)
	}
	sort.Ints(g.ids)
	for _, id := range g.ids {
		seen := map[int]bool{}
		for _, p := range in.Prerequisites[id] {
			req, ok := g.subjects[p.SubjectID]
			if !ok {
				return nil, fmt.Errorf("subject %d requires unknown subject %d", id, p.SubjectID)
			}
			if p.SubjectID == id {
				return nil, fmt.Errorf("subject %d requires itself", id)
			}
			if req.Elective && !g.subjects[id].Elective {
				return nil, fmt.Errorf("obligatory subject %d requires elective %d", id, p.SubjectID)
			}
			if seen[p.SubjectID] {
				continue
			}
			seen[p.SubjectID] = true
			g.requires[id] = append(g.requires[id], p)
			g.unlocks[p.SubjectID] = append(g.unlocks[p.SubjectID], id)
		}
		sort.Slice(g.requires[id], func(i, j int) bool { return g.requires[id][i].SubjectID < g.requires[id][j].SubjectID })
	}
	for _, kids := range g.unlocks {
		sort.Ints(kids)
	}
	if err := g.checkAcyclic(); err != nil {
		return nil, err
	}
	return g, nil
}

func (g *graph) checkAcyclic() error {
	const (
		visiting = 1
		done     = 2
	)
	state := map[int]int{}
	var visit func(id int, path []int) error
	visit = func(id int, path []int) error {
		switch state[id] {
		case done:
			return nil
		case visiting:
			return fmt.Errorf("correlativas form a cycle: %v", append(path, id))
		}
		state[id] = visiting
		for _, p := range g.requires[id] {
			if err := visit(p.SubjectID, append(path, id)); err != nil {
				return err
			}
		}
		state[id] = done
		return nil
	}
	for _, id := range g.ids {
		if err := visit(id, nil); err != nil {
			return err
		}
	}
	return nil
}

// descendants counts every subject that directly or indirectly requires id.
func (g *graph) descendants(id int) int {
	seen := map[int]bool{}
	var walk func(int)
	walk = func(n int) {
		for _, k := range g.unlocks[n] {
			if !seen[k] {
				seen[k] = true
				walk(k)
			}
		}
	}
	walk(id)
	return len(seen)
}

// schedule is the earliest-start timetable of the active subjects: one
// cuatrimestre per subject, no limit of subjects per cuatrimestre, a subject
// starts the cuatrimestre after all its prerequisites. floor can hold back
// individual subjects.
type schedule struct {
	start    map[int]int
	terms    int
	order    []int // topological, prerequisites first
	activeBy map[int]bool
}

func (g *graph) schedule(active map[int]bool, floor map[int]int) schedule {
	s := schedule{start: map[int]int{}, activeBy: active}
	var visit func(id int) int
	visit = func(id int) int {
		if t, ok := s.start[id]; ok {
			return t
		}
		t := 1
		for _, p := range g.requires[id] {
			if pt := visit(p.SubjectID) + 1; pt > t {
				t = pt
			}
		}
		if f := floor[id]; f > t {
			t = f
		}
		s.start[id] = t
		s.order = append(s.order, id)
		if t > s.terms {
			s.terms = t
		}
		return t
	}
	for _, id := range g.ids {
		if active[id] {
			visit(id)
		}
	}
	return s
}

// criticalPath returns one longest chain, ending at the lowest subject_id
// among those that finish last and walking back through the lowest-id
// prerequisite that starts right before.
func (g *graph) criticalPath(s schedule) []int {
	end := 0
	for _, id := range g.ids {
		if s.activeBy[id] && s.start[id] == s.terms {
			end = id
			break
		}
	}
	if end == 0 {
		return []int{}
	}
	path := []int{end}
	for cur := end; s.start[cur] > 1; {
		for _, p := range g.requires[cur] {
			if s.start[p.SubjectID] == s.start[cur]-1 {
				cur = p.SubjectID
				break
			}
		}
		path = append([]int{cur}, path...)
	}
	return path
}

// slack is how many cuatrimestres id can be held back before the career
// takes longer: latest start minus earliest start.
func (g *graph) slack(s schedule, id int) int {
	tail := map[int]int{}
	for i := len(s.order) - 1; i >= 0; i-- {
		n := s.order[i]
		longest := 0
		for _, k := range g.unlocks[n] {
			if s.activeBy[k] && tail[k] > longest {
				longest = tail[k]
			}
		}
		tail[n] = longest + 1
	}
	return s.terms - tail[id] + 1 - s.start[id]
}
