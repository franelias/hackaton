// Package schedule picks class timetables without overlaps. It knows nothing
// about HTTP or MCP: the tool layer turns API sessions into Offerings.
package schedule

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// DefaultClassMinutes is assumed when the API gives no end time. 3 hours is
// the most common class length.
const DefaultClassMinutes = 180

var (
	commissionLabel = regexp.MustCompile(`Com\.?:?\s*(\d+)`)
	termLabel       = regexp.MustCompile(`^(\d{4})-([12])S$`)
)

// Session is one weekly class as the API publishes it.
type Session struct {
	Semester string
	Weekday  int
	Start    string // "HH:MM"
	End      string // "HH:MM" or ""
	Campus   string
	Rooms    []string
	Notes    string
}

type Class struct {
	Day          int
	From, To     int // minutes since midnight
	Campus       string
	Room         string
	EndEstimated bool
}

// Commission is one way of taking a subject: all its classes in the week.
type Commission struct {
	SubjectID int
	Label     string // "" when the subject has a single commission
	Stale     bool   // the schedule is older than the current semester
	Classes   []Class
}

// CurrentSemester returns the latest "YYYY-nS" label, or "" if none.
func CurrentSemester(sessions []Session) string {
	best := ""
	for _, s := range sessions {
		if termLabel.MatchString(s.Semester) && s.Semester > best {
			best = s.Semester
		}
	}
	return best
}

// Commissions builds a subject's commissions. With semester == "" it uses the
// subject's latest labelled semester, falling back to whatever is published
// (flagged stale when that is not the current semester). The second result
// lists warnings about data that had to be set aside.
func Commissions(subjectID int, sessions []Session, semester, current string) ([]Commission, []string) {
	chosen, label := pickSemester(sessions, semester)
	if len(chosen) == 0 {
		return nil, nil
	}
	stale := semester == "" && label != current

	type labelled struct {
		class  Class
		labels []string
	}
	var rows []labelled
	for _, s := range chosen {
		c, ok := toClass(s)
		if !ok {
			continue
		}
		var labels []string
		for _, m := range commissionLabel.FindAllStringSubmatch(s.Notes, -1) {
			labels = append(labels, m[1])
		}
		rows = append(rows, labelled{c, labels})
	}

	set := map[string]bool{}
	for _, r := range rows {
		for _, l := range r.labels {
			set[l] = true
		}
	}
	var warnings []string
	if len(set) == 0 {
		cm := Commission{SubjectID: subjectID, Stale: stale}
		for _, r := range rows {
			cm.Classes = append(cm.Classes, r.class)
		}
		sortClasses(cm.Classes)
		return []Commission{cm}, nil
	}

	// The API repeats some classes without a commission label next to the
	// labelled ones (partial duplicates, mostly without end time): ignore them.
	ignored := 0
	byLabel := map[string]*Commission{}
	for _, r := range rows {
		if len(r.labels) == 0 {
			ignored++
			continue
		}
		for _, l := range r.labels {
			cm := byLabel[l]
			if cm == nil {
				cm = &Commission{SubjectID: subjectID, Label: l, Stale: stale}
				byLabel[l] = cm
			}
			cm.Classes = append(cm.Classes, r.class)
		}
	}
	if ignored > 0 {
		warnings = append(warnings, fmt.Sprintf("subject %d: %d classes without a commission label were ignored", subjectID, ignored))
	}
	labels := make([]string, 0, len(byLabel))
	for l := range byLabel {
		labels = append(labels, l)
	}
	sort.Strings(labels)
	out := make([]Commission, 0, len(labels))
	for _, l := range labels {
		sortClasses(byLabel[l].Classes)
		out = append(out, *byLabel[l])
	}
	return out, warnings
}

func pickSemester(sessions []Session, semester string) ([]Session, string) {
	if semester != "" {
		var out []Session
		for _, s := range sessions {
			if s.Semester == semester {
				out = append(out, s)
			}
		}
		return out, semester
	}
	latest := CurrentSemester(sessions)
	if latest == "" {
		// Only unlabelled publications ("última publicación"): use them all.
		if len(sessions) == 0 {
			return nil, ""
		}
		return sessions, sessions[0].Semester
	}
	var out []Session
	for _, s := range sessions {
		if s.Semester == latest {
			out = append(out, s)
		}
	}
	return out, latest
}

func toClass(s Session) (Class, bool) {
	from, ok := parseClock(s.Start)
	if !ok || s.Weekday < 1 || s.Weekday > 7 {
		return Class{}, false
	}
	c := Class{Day: s.Weekday, From: from, Campus: s.Campus, Room: strings.Join(s.Rooms, " / ")}
	if to, ok := parseClock(s.End); ok && to > from {
		c.To = to
	} else {
		c.To = from + DefaultClassMinutes
		c.EndEstimated = true
	}
	return c, true
}

func sortClasses(cs []Class) {
	sort.SliceStable(cs, func(i, j int) bool {
		if cs[i].Day != cs[j].Day {
			return cs[i].Day < cs[j].Day
		}
		return cs[i].From < cs[j].From
	})
}

func parseClock(s string) (int, bool) {
	h, m, ok := strings.Cut(s, ":")
	if !ok {
		return 0, false
	}
	hh, err1 := strconv.Atoi(h)
	mm, err2 := strconv.Atoi(m)
	if err1 != nil || err2 != nil || hh < 0 || hh > 23 || mm < 0 || mm > 59 {
		return 0, false
	}
	return hh*60 + mm, true
}

// Clock formats minutes since midnight as "HH:MM".
func Clock(minutes int) string {
	return fmt.Sprintf("%02d:%02d", minutes/60, minutes%60)
}
