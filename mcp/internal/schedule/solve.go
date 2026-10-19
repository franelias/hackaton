package schedule

import (
	"fmt"
	"sort"
)

const (
	MaxSubjects     = 12
	MaxOptions      = 3
	maxSearchNodes  = 2_000_000
	transferMinutes = 60
)

// Shifts, decided by the class start.
const (
	Morning   = "morning"   // before 13:00
	Afternoon = "afternoon" // 13:00 to 18:59
	Evening   = "evening"   // from 19:00
)

type Offering struct {
	SubjectID   int
	Commissions []Commission
}

type Preferences struct {
	Shift    string
	FreeDays []int // ISO, 1 = Monday
}

type Option struct {
	Commissions []Commission // one per scheduled subject, by subject id
	Days        int
	GapMinutes  int
	OutOfShift  int
}

type Conflict struct {
	SubjectIDs [2]int
	Day        int
	From, To   int
}

type Result struct {
	Options   []Option
	Scheduled []int
	Conflicts []Conflict
	Postpone  []int
	Warnings  []string
}

// Bottlenecks returns destraba_total by subject; it is only called when some
// subjects have to be postponed.
type Bottlenecks func() (map[int]int, error)

// BottleneckThreshold mirrors backend/internal/plan.BottleneckThreshold.
const BottleneckThreshold = 8

// Solve returns the best timetables for all offerings. When none fits, it
// postpones the least important subjects and schedules the rest.
func Solve(offerings []Offering, prefs Preferences, bottlenecks Bottlenecks) (Result, error) {
	offs := append([]Offering(nil), offerings...)
	sort.Slice(offs, func(i, j int) bool { return offs[i].SubjectID < offs[j].SubjectID })

	res := Result{Options: []Option{}, Scheduled: []int{}, Conflicts: []Conflict{}, Postpone: []int{}, Warnings: []string{}}
	if len(offs) == 0 {
		return res, nil
	}

	options, truncated := best(offs, prefs, true)
	if len(options) == 0 && len(prefs.FreeDays) > 0 {
		if options, truncated = best(offs, prefs, false); len(options) > 0 {
			res.Warnings = append(res.Warnings, "no combination keeps the requested free days; they were ignored")
		}
	}
	if truncated {
		res.Warnings = append(res.Warnings, "the search was cut short; better options may exist")
	}
	if len(options) > 0 {
		res.Options = options
		res.Scheduled = ids(offs)
		res.Warnings = append(res.Warnings, transferWarnings(options[0])...)
		return res, nil
	}

	res.Conflicts = conflicts(offs)
	w, err := bottlenecks()
	if err != nil {
		return Result{}, err
	}
	drop := pickPostponement(offs, w)
	if drop == nil {
		res.Warnings = append(res.Warnings, "no subset of the subjects fits in the timetable")
		return res, nil
	}
	res.Postpone = drop
	var rest []Offering
	for _, o := range offs {
		if !contains(drop, o.SubjectID) {
			rest = append(rest, o)
		}
	}
	if len(rest) > 0 {
		options, truncated = best(rest, prefs, true)
		if len(options) == 0 && len(prefs.FreeDays) > 0 {
			options, truncated = best(rest, prefs, false)
			if len(options) > 0 {
				res.Warnings = append(res.Warnings, "no combination keeps the requested free days; they were ignored")
			}
		}
		if truncated {
			res.Warnings = append(res.Warnings, "the search was cut short; better options may exist")
		}
		res.Options = options
		res.Scheduled = ids(rest)
		if len(options) > 0 {
			res.Warnings = append(res.Warnings, transferWarnings(options[0])...)
		}
	}
	return res, nil
}

// pickPostponement chooses the subjects to drop: fewest bottlenecks touched,
// then fewest subjects, then least total destraba_total, then lowest ids.
func pickPostponement(offs []Offering, destraba map[int]int) []int {
	n := len(offs)
	type cand struct {
		ids         []int
		bottlenecks int
		total       int
	}
	var best *cand
	for mask := 1; mask < 1<<n; mask++ {
		var drop []int
		var rest []Offering
		c := cand{}
		for i, o := range offs {
			if mask&(1<<i) != 0 {
				drop = append(drop, o.SubjectID)
				c.total += destraba[o.SubjectID]
				if destraba[o.SubjectID] >= BottleneckThreshold {
					c.bottlenecks++
				}
			} else {
				rest = append(rest, o)
			}
		}
		c.ids = drop
		if best != nil && !better(c.bottlenecks, len(c.ids), c.total, c.ids, best.bottlenecks, len(best.ids), best.total, best.ids) {
			continue
		}
		if len(rest) > 0 && !feasible(rest) {
			continue
		}
		cc := c
		best = &cc
	}
	if best == nil {
		return nil
	}
	return best.ids
}

func better(b1, n1, t1 int, ids1 []int, b2, n2, t2 int, ids2 []int) bool {
	switch {
	case b1 != b2:
		return b1 < b2
	case n1 != n2:
		return n1 < n2
	case t1 != t2:
		return t1 < t2
	}
	for i := range ids1 {
		if ids1[i] != ids2[i] {
			return ids1[i] < ids2[i]
		}
	}
	return false
}

func feasible(offs []Offering) bool {
	var found bool
	walk(offs, func(int, int) bool { return true }, func([]Commission) bool { found = true; return false })
	return found
}

// best finds up to MaxOptions timetables. With enforceFree, commissions with
// classes on a free day are skipped.
func best(offs []Offering, prefs Preferences, enforceFree bool) ([]Option, bool) {
	free := map[int]bool{}
	for _, d := range prefs.FreeDays {
		free[d] = true
	}
	allowed := func(i, j int) bool {
		if !enforceFree {
			return true
		}
		for _, c := range offs[i].Commissions[j].Classes {
			if free[c.Day] {
				return false
			}
		}
		return true
	}
	var top []Option
	truncated := walk(offs, allowed, func(chosen []Commission) bool {
		o := score(chosen, prefs.Shift)
		top = append(top, o)
		sort.SliceStable(top, func(i, j int) bool { return less(top[i], top[j]) })
		if len(top) > MaxOptions {
			top = top[:MaxOptions]
		}
		return true
	})
	return top, truncated
}

// walk enumerates every overlap-free choice of one commission per offering.
// visit returns false to stop. The result tells whether the node limit hit.
func walk(offs []Offering, allowed func(i, j int) bool, visit func([]Commission) bool) (truncated bool) {
	chosen := make([]Commission, len(offs))
	nodes := 0
	stop := false
	var rec func(i int)
	rec = func(i int) {
		if stop {
			return
		}
		if i == len(offs) {
			if !visit(append([]Commission(nil), chosen...)) {
				stop = true
			}
			return
		}
		for j, cm := range offs[i].Commissions {
			if nodes++; nodes > maxSearchNodes {
				truncated, stop = true, true
				return
			}
			if !allowed(i, j) || clashesAny(cm, chosen[:i]) {
				continue
			}
			chosen[i] = cm
			rec(i + 1)
			if stop {
				return
			}
		}
	}
	rec(0)
	return truncated
}

func overlap(a, b Class) bool {
	return a.Day == b.Day && a.From < b.To && b.From < a.To
}

func clashesAny(cm Commission, others []Commission) bool {
	for _, o := range others {
		if clash(cm, o) {
			return true
		}
	}
	return false
}

func clash(a, b Commission) bool {
	for _, x := range a.Classes {
		for _, y := range b.Classes {
			if overlap(x, y) {
				return true
			}
		}
	}
	return false
}

func shiftOf(from int) string {
	switch {
	case from < 13*60:
		return Morning
	case from < 19*60:
		return Afternoon
	}
	return Evening
}

func score(chosen []Commission, shift string) Option {
	o := Option{Commissions: chosen}
	byDay := map[int][]Class{}
	for _, cm := range chosen {
		for _, c := range cm.Classes {
			byDay[c.Day] = append(byDay[c.Day], c)
			if shift != "" && shiftOf(c.From) != shift {
				o.OutOfShift++
			}
		}
	}
	o.Days = len(byDay)
	for _, cs := range byDay {
		sort.Slice(cs, func(i, j int) bool { return cs[i].From < cs[j].From })
		end := cs[0].To
		for _, c := range cs[1:] {
			if c.From > end {
				o.GapMinutes += c.From - end
			}
			if c.To > end {
				end = c.To
			}
		}
	}
	return o
}

func less(a, b Option) bool {
	switch {
	case a.OutOfShift != b.OutOfShift:
		return a.OutOfShift < b.OutOfShift
	case a.Days != b.Days:
		return a.Days < b.Days
	case a.GapMinutes != b.GapMinutes:
		return a.GapMinutes < b.GapMinutes
	}
	for i := range a.Commissions {
		if a.Commissions[i].Label != b.Commissions[i].Label {
			return a.Commissions[i].Label < b.Commissions[i].Label
		}
	}
	return false
}

// conflicts lists the pairs of subjects that overlap in every combination of
// their commissions, with the overlapping slots of their first commissions.
func conflicts(offs []Offering) []Conflict {
	out := []Conflict{}
	for i := range offs {
		for j := i + 1; j < len(offs); j++ {
			hard := true
			for _, a := range offs[i].Commissions {
				for _, b := range offs[j].Commissions {
					if !clash(a, b) {
						hard = false
					}
				}
			}
			if !hard {
				continue
			}
			a, b := offs[i].Commissions[0], offs[j].Commissions[0]
			for _, x := range a.Classes {
				for _, y := range b.Classes {
					if overlap(x, y) {
						out = append(out, Conflict{
							SubjectIDs: [2]int{offs[i].SubjectID, offs[j].SubjectID},
							Day:        x.Day, From: max(x.From, y.From), To: min(x.To, y.To),
						})
					}
				}
			}
		}
	}
	return out
}

// transferWarnings flags back-to-back classes on different campuses.
func transferWarnings(o Option) []string {
	type tagged struct {
		Class
		subject int
	}
	byDay := map[int][]tagged{}
	for _, cm := range o.Commissions {
		for _, c := range cm.Classes {
			byDay[c.Day] = append(byDay[c.Day], tagged{c, cm.SubjectID})
		}
	}
	days := make([]int, 0, len(byDay))
	for d := range byDay {
		days = append(days, d)
	}
	sort.Ints(days)
	var out []string
	for _, d := range days {
		cs := byDay[d]
		sort.Slice(cs, func(i, j int) bool { return cs[i].From < cs[j].From })
		for i := 0; i+1 < len(cs); i++ {
			a, b := cs[i], cs[i+1]
			if a.Campus != "" && b.Campus != "" && a.Campus != b.Campus && b.From-a.To < transferMinutes {
				out = append(out, fmt.Sprintf("day %d: %d min between subject %d (%s, ends %s) and subject %d (%s, starts %s)",
					d, b.From-a.To, a.subject, a.Campus, Clock(a.To), b.subject, b.Campus, Clock(b.From)))
			}
		}
	}
	return out
}

func ids(offs []Offering) []int {
	out := make([]int, 0, len(offs))
	for _, o := range offs {
		out = append(out, o.SubjectID)
	}
	return out
}

func contains(s []int, v int) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
