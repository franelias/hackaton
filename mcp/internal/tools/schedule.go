package tools

import (
	"context"
	"fmt"
	"sort"
	"sync"

	"github.com/franelias/hackaton/mcp/internal/fceia"
	"github.com/franelias/hackaton/mcp/internal/schedule"
)

type preferencesIn struct {
	Shift    string `json:"shift,omitempty" jsonschema:"preferred shift by class start: morning (before 13:00), afternoon (13:00-18:59) or evening (from 19:00)"`
	FreeDays []int  `json:"free_days,omitempty" jsonschema:"days to keep free, ISO weekdays (1 = Monday ... 7 = Sunday)"`
}

type buildScheduleIn struct {
	SubjectIDs         []int          `json:"subject_ids" jsonschema:"subjects the student wants to take this semester (max 12, all from the same career)"`
	ApprovedSubjectIDs []int          `json:"approved_subject_ids,omitempty" jsonschema:"subjects the student already passed; with this or regular_subject_ids, subjects whose correlativas are not met are left out"`
	RegularSubjectIDs  []int          `json:"regular_subject_ids,omitempty" jsonschema:"subjects the student has regular (cursada aprobada) but not passed"`
	Semester           string         `json:"semester,omitempty" jsonschema:"force a semester label such as 2026-2S (default: latest published per subject)"`
	Preferences        *preferencesIn `json:"preferences,omitempty"`
}

type classOut struct {
	Day          int    `json:"day"`
	From         string `json:"from"`
	To           string `json:"to"`
	Campus       string `json:"campus"`
	Room         string `json:"room"`
	EndEstimated bool   `json:"end_estimated"`
}

type commissionOut struct {
	SubjectID  int        `json:"subject_id"`
	Name       string     `json:"name"`
	Commission string     `json:"commission"`
	Stale      bool       `json:"stale"`
	Classes    []classOut `json:"classes"`
}

type optionOut struct {
	Commissions  []commissionOut `json:"commissions"`
	DaysOnCampus int             `json:"days_on_campus"`
	GapHours     float64         `json:"gap_hours"`
}

type conflictOut struct {
	SubjectIDs []int  `json:"subject_ids"`
	Day        int    `json:"day"`
	From       string `json:"from"`
	To         string `json:"to"`
}

type missingOut struct {
	SubjectID int    `json:"subject_id"`
	Code      string `json:"code"`
	Condition string `json:"condition"`
}

type notEnabledOut struct {
	SubjectID int          `json:"subject_id"`
	Name      string       `json:"name"`
	Missing   []missingOut `json:"missing"`
}

type buildScheduleOut struct {
	Options         []optionOut     `json:"options"`
	ScheduledIDs    []int           `json:"scheduled_subject_ids"`
	Conflicts       []conflictOut   `json:"conflicts"`
	SuggestPostpone []int           `json:"suggest_postpone"`
	NotEnabled      []notEnabledOut `json:"not_enabled"`
	WithoutSchedule []int           `json:"without_schedule"`
	Warnings        []string        `json:"warnings"`
}

var shifts = map[string]bool{schedule.Morning: true, schedule.Afternoon: true, schedule.Evening: true}

func (t *tools) buildSchedule(ctx context.Context, in buildScheduleIn) (buildScheduleOut, error) {
	ids, err := uniqueSubjectIDs(in.SubjectIDs)
	if err != nil {
		return buildScheduleOut{}, err
	}
	var prefs schedule.Preferences
	if p := in.Preferences; p != nil {
		if p.Shift != "" && !shifts[p.Shift] {
			return buildScheduleOut{}, invalidArgument("shift must be morning, afternoon or evening")
		}
		for _, d := range p.FreeDays {
			if d < 1 || d > 7 {
				return buildScheduleOut{}, invalidArgument("free_days must be ISO weekdays between 1 and 7")
			}
		}
		prefs = schedule.Preferences{Shift: p.Shift, FreeDays: p.FreeDays}
	}

	out := buildScheduleOut{
		Options: []optionOut{}, ScheduledIDs: []int{}, Conflicts: []conflictOut{}, SuggestPostpone: []int{},
		NotEnabled: []notEnabledOut{}, WithoutSchedule: []int{}, Warnings: []string{},
	}

	subjects := map[int]fceia.Subject{}
	for _, id := range ids {
		s, err := t.api.Subject(ctx, id)
		if err != nil {
			return buildScheduleOut{}, err
		}
		if len(subjects) > 0 && s.CareerID != subjects[ids[0]].CareerID {
			return buildScheduleOut{}, invalidArgument(fmt.Sprintf("subjects %d and %d belong to different careers; a subject has a different subject_id in each career", ids[0], id))
		}
		subjects[id] = s
	}
	careerID := subjects[ids[0]].CareerID

	enabled := ids
	if in.ApprovedSubjectIDs != nil || in.RegularSubjectIDs != nil {
		enabled, out.NotEnabled, err = t.filterEnabled(ctx, ids, subjects, in.ApprovedSubjectIDs, in.RegularSubjectIDs)
		if err != nil {
			return buildScheduleOut{}, err
		}
	} else {
		out.Warnings = append(out.Warnings, "approved_subject_ids and regular_subject_ids were not given: correlativas were not checked")
	}

	sessions := map[int][]schedule.Session{}
	var all []schedule.Session
	for _, id := range enabled {
		raw, err := t.api.Sessions(ctx, id)
		if err != nil {
			return buildScheduleOut{}, err
		}
		for _, s := range raw {
			ss := schedule.Session{Semester: s.Semester, Weekday: s.Weekday, Start: s.StartTime, Rooms: s.Rooms}
			if s.EndTime != nil {
				ss.End = *s.EndTime
			}
			if s.Campus != nil {
				ss.Campus = *s.Campus
			}
			if s.Notes != nil {
				ss.Notes = *s.Notes
			}
			sessions[id] = append(sessions[id], ss)
			all = append(all, ss)
		}
	}
	current := schedule.CurrentSemester(all)
	if in.Semester != "" {
		current = in.Semester
	}

	var offerings []schedule.Offering
	estimated := map[int]bool{}
	for _, id := range enabled {
		cms, warns := schedule.Commissions(id, sessions[id], in.Semester, current)
		out.Warnings = append(out.Warnings, warns...)
		if len(cms) == 0 {
			out.WithoutSchedule = append(out.WithoutSchedule, id)
			continue
		}
		if cms[0].Stale {
			msg := fmt.Sprintf("subject %d has no %s schedule; its latest published schedule may be outdated", id, current)
			if current == "" {
				msg = fmt.Sprintf("subject %d only has its latest published schedule, which may be outdated", id)
			}
			out.Warnings = append(out.Warnings, msg)
		}
		for _, cm := range cms {
			for _, c := range cm.Classes {
				if c.EndEstimated {
					estimated[id] = true
				}
			}
		}
		offerings = append(offerings, schedule.Offering{SubjectID: id, Commissions: cms})
	}
	for _, id := range sortedKeys(estimated) {
		out.Warnings = append(out.Warnings, fmt.Sprintf("subject %d has classes without an end time; %d minutes were assumed", id, schedule.DefaultClassMinutes))
	}
	if len(offerings) == 0 {
		return out, nil
	}

	res, err := schedule.Solve(offerings, prefs, func() (map[int]int, error) { return t.destrabaTotal(ctx, careerID) })
	if err != nil {
		return buildScheduleOut{}, err
	}
	out.ScheduledIDs = res.Scheduled
	out.SuggestPostpone = res.Postpone
	out.Warnings = append(out.Warnings, res.Warnings...)
	for _, c := range res.Conflicts {
		out.Conflicts = append(out.Conflicts, conflictOut{
			SubjectIDs: []int{c.SubjectIDs[0], c.SubjectIDs[1]}, Day: c.Day,
			From: schedule.Clock(c.From), To: schedule.Clock(c.To),
		})
	}
	for _, o := range res.Options {
		oo := optionOut{DaysOnCampus: o.Days, GapHours: float64(o.GapMinutes) / 60, Commissions: []commissionOut{}}
		for _, cm := range o.Commissions {
			co := commissionOut{SubjectID: cm.SubjectID, Name: subjects[cm.SubjectID].Name, Commission: cm.Label, Stale: cm.Stale, Classes: []classOut{}}
			for _, c := range cm.Classes {
				co.Classes = append(co.Classes, classOut{c.Day, schedule.Clock(c.From), schedule.Clock(c.To), c.Campus, c.Room, c.EndEstimated})
			}
			oo.Commissions = append(oo.Commissions, co)
		}
		out.Options = append(out.Options, oo)
	}
	return out, nil
}

func uniqueSubjectIDs(in []int) ([]int, error) {
	if len(in) == 0 {
		return nil, invalidArgument("subject_ids must not be empty")
	}
	seen := map[int]bool{}
	var out []int
	for _, id := range in {
		if id <= 0 {
			return nil, invalidArgument("subject_ids must be positive")
		}
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	if len(out) > schedule.MaxSubjects {
		return nil, invalidArgument(fmt.Sprintf("at most %d subjects at a time", schedule.MaxSubjects))
	}
	sort.Ints(out)
	return out, nil
}

// filterEnabled splits subjects into those whose correlativas are met and
// those that are not. A "regular" correlativa is met by regular or approved;
// anything else needs approved.
func (t *tools) filterEnabled(ctx context.Context, ids []int, subjects map[int]fceia.Subject, approved, regular []int) ([]int, []notEnabledOut, error) {
	passed, reg := toSet(approved), toSet(regular)
	enabled := []int{}
	blocked := []notEnabledOut{}
	for _, id := range ids {
		rel, err := t.api.Relations(ctx, id)
		if err != nil {
			return nil, nil, err
		}
		var missing []missingOut
		for _, p := range rel.Prerequisites {
			cond := "approved"
			met := passed[p.RelatedSubjectID]
			if p.Requirement == "regular" {
				cond = "regular"
				met = met || reg[p.RelatedSubjectID]
			}
			if !met {
				missing = append(missing, missingOut{p.RelatedSubjectID, p.RelatedCode, cond})
			}
		}
		if len(missing) == 0 {
			enabled = append(enabled, id)
		} else {
			blocked = append(blocked, notEnabledOut{SubjectID: id, Name: subjects[id].Name, Missing: missing})
		}
	}
	return enabled, blocked, nil
}

// destrabaTotal counts, for every subject of a career, the subjects that
// directly or indirectly require it (same measure as backend/internal/plan).
func (t *tools) destrabaTotal(ctx context.Context, careerID int) (map[int]int, error) {
	subjects, err := t.api.CareerSubjects(ctx, careerID)
	if err != nil {
		return nil, err
	}
	inCareer := map[int]bool{}
	for _, s := range subjects {
		inCareer[s.ID] = true
	}
	rels := make([]fceia.Relations, len(subjects))
	errs := make([]error, len(subjects))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i, s := range subjects {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			rels[i], errs[i] = t.api.Relations(ctx, s.ID)
		}()
	}
	wg.Wait()
	unlocks := map[int][]int{}
	for i, s := range subjects {
		if errs[i] != nil {
			return nil, errs[i]
		}
		for _, p := range rels[i].Prerequisites {
			if inCareer[p.RelatedSubjectID] {
				unlocks[p.RelatedSubjectID] = append(unlocks[p.RelatedSubjectID], s.ID)
			}
		}
	}
	out := map[int]int{}
	for _, s := range subjects {
		seen := map[int]bool{}
		var walk func(int)
		walk = func(n int) {
			for _, k := range unlocks[n] {
				if !seen[k] {
					seen[k] = true
					walk(k)
				}
			}
		}
		walk(s.ID)
		out[s.ID] = len(seen)
	}
	return out, nil
}

func toSet(s []int) map[int]bool {
	m := map[int]bool{}
	for _, v := range s {
		m[v] = true
	}
	return m
}

func sortedKeys(m map[int]bool) []int {
	out := make([]int, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Ints(out)
	return out
}
