package tree

import (
	"fmt"
	"sort"
	"time"
)

// Thresholds of the nudges, to be calibrated.
const (
	// SubjectIdleDays without studying an enrolled subject (recess days don't count).
	SubjectIdleDays = 14
	// FinalPendingDays a subject has been regular before reminding its final.
	FinalPendingDays = 30
	// MesasNoticeDays before a mesas period starts to remind pending finals.
	MesasNoticeDays = 14
)

// Nudge is a reminder sent outside the app (push and mail), Duolingo style:
// unlike alerts, it looks ahead, at something the student is about to lose.
type Nudge struct {
	Kind      string // streak_risk | wilting_soon | final_pending | subject_idle
	SubjectID *int
	Title     string // Spanish: push title and mail subject
	Body      string // Spanish
	Action    Action
	// Key identifies the condition: the caller sends each (Kind, SubjectID, Key) once.
	Key string
}

// Nudges returns the reminders that hold now, most urgent first. The caller
// decides how many to send and when (hours of the day, one a day).
func Nudges(in Input) []Nudge {
	var out []Nudge
	if n, ok := streakRisk(in); ok {
		out = append(out, n)
	}
	if n, ok := wiltingSoon(in); ok {
		out = append(out, n)
	}
	out = append(out, finalsPending(in)...)
	return append(out, idleSubjects(in)...)
}

// streakRisk: from Friday on, the streak is alive but this week has no
// session yet. A second, last-day nudge goes on Sunday.
func streakRisk(in Input) (Nudge, bool) {
	today := day(in.Now)
	week := monday(today)
	left := 7 - int(today.Sub(week).Hours()/24) // days left in the week, today included
	if left > 3 || inPeriod(week.AddDate(0, 0, 2), "recess", in.Periods) {
		return Nudge{}, false
	}
	for _, a := range in.Activities {
		if studySession(a) && !day(a.CreatedAt).Before(week) {
			return Nudge{}, false
		}
	}
	s := streak(in)
	if s.Weeks == 0 {
		return Nudge{}, false
	}
	n := Nudge{
		Kind: "streak_risk", Key: week.Format(time.DateOnly) + "/soon", Action: Action{Type: "open_tutor"},
		Title: "🔥 Tu racha está en juego",
		Body:  fmt.Sprintf("Llevás %s seguidas estudiando. Un ejercicio antes del domingo la mantiene viva.", weeks(s.Weeks)),
	}
	if s.Wildcards > 0 {
		n.Body = fmt.Sprintf("Llevás %s seguidas. Si no estudiás antes del domingo, gastás un comodín.", weeks(s.Weeks))
	}
	if left == 1 {
		n.Key = week.Format(time.DateOnly) + "/last"
		n.Title = "🔥 Último día para salvar tu racha"
		n.Body = fmt.Sprintf("Llevás %s seguidas. Si hoy no estudiás, se corta. Con un ejercicio alcanza.", weeks(s.Weeks))
		if s.Wildcards > 0 {
			n.Body = fmt.Sprintf("Llevás %s seguidas. Si hoy no estudiás, gastás un comodín.", weeks(s.Weeks))
		}
	}
	return n, true
}

// wiltingSoon: tomorrow the tree turns wilted, or withered (which dries the
// branch of the subject the inactivity alert will point to).
func wiltingSoon(in Input) (Nudge, bool) {
	tomorrow := day(in.Now).AddDate(0, 0, 1)
	if inPeriod(tomorrow, "recess", in.Periods) {
		return Nudge{}, false
	}
	last := lastActivity(in)
	days, th := inactiveDays(last, in), thresholds(examSeason(in))
	since := day(last).Format(time.DateOnly)
	switch days + 1 {
	case th[0]:
		return Nudge{
			Kind: "wilting_soon", Key: Wilted + "@" + since, Action: Action{Type: "open_tutor"},
			Title: "🍂 Tu árbol se está por poner mustio",
			Body:  fmt.Sprintf("Hace %d días que no pasás por Árbol. Un check-in rápido hoy lo mantiene frondoso.", days),
		}, true
	case th[1]:
		n := Nudge{
			Kind: "wilting_soon", Key: Withered + "@" + since, Action: Action{Type: "open_tutor"},
			Title: "🍂 Mañana tu árbol se marchita",
			Body:  fmt.Sprintf("Hace %d días que no estudiás. Un ejercicio hoy lo salva.", days),
		}
		if id, _ := focusSubject(in); id != 0 {
			name := in.Info[id].Name
			n.SubjectID, n.Action.SubjectID = &id, &id
			n.Title = fmt.Sprintf("🍂 Se está por secar la rama de %s", name)
			n.Body = fmt.Sprintf("Hace %d días que no estudiás. Un ejercicio de %s hoy la mantiene verde.", days, name)
		}
		return n, true
	}
	return Nudge{}, false
}

// finalsPending: subjects regular for a while, not approved yet, when a mesas
// period is running or starts within MesasNoticeDays. Once per period.
func finalsPending(in Input) []Nudge {
	today := day(in.Now)
	var mesas *Period
	for i, p := range in.Periods {
		if p.Kind != "exams" || p.To.Before(today) || p.From.After(today.AddDate(0, 0, MesasNoticeDays)) {
			continue
		}
		if mesas == nil || p.From.Before(mesas.From) {
			mesas = &in.Periods[i]
		}
	}
	if mesas == nil {
		return nil
	}
	var ids []int
	for id, st := range in.States {
		since, ok := in.StateSince[id]
		if st == Regular && ok && int(today.Sub(day(since)).Hours()/24) >= FinalPendingDays {
			ids = append(ids, id)
		}
	}
	sortByUnlocks(ids, in.Info)
	when := fmt.Sprintf("se vienen las mesas (del %s al %s)", mesas.From.Format("02/01"), mesas.To.Format("02/01"))
	if !mesas.From.After(today) {
		when = fmt.Sprintf("hay mesas hasta el %s", mesas.To.Format("02/01"))
	}
	var out []Nudge
	for _, id := range ids {
		name := in.Info[id].Name
		out = append(out, Nudge{
			Kind: "final_pending", SubjectID: &id, Key: mesas.From.Format(time.DateOnly),
			Title:  fmt.Sprintf("📝 ¿Rendimos %s?", name),
			Body:   fmt.Sprintf("Tenés %s regularizada y todavía no la rendiste: %s. ¿Armamos un plan para el final?", name, when),
			Action: Action{Type: "open_tutor", SubjectID: &id},
		})
	}
	return out
}

// idleSubjects: enrolled subjects with no study session for SubjectIdleDays,
// counting from the last one, from enrollment or from joining. The longest
// idle first.
func idleSubjects(in Input) []Nudge {
	today := day(in.Now)
	lastStudy := map[int]time.Time{}
	exam := map[int]time.Time{} // nearest upcoming exam per subject
	for _, a := range in.Activities {
		if a.SubjectID == nil {
			continue
		}
		id := *a.SubjectID
		if studySession(a) && a.CreatedAt.After(lastStudy[id]) {
			lastStudy[id] = a.CreatedAt
		}
		if a.Type == "exam" && a.Date != nil && !a.Date.Before(today) && (exam[id].IsZero() || a.Date.Before(exam[id])) {
			exam[id] = *a.Date
		}
	}
	type idle struct {
		id, days int
		since    time.Time
	}
	var all []idle
	for id, st := range in.States {
		if st != Enrolled {
			continue
		}
		last := in.Since
		for _, t := range []time.Time{in.StateSince[id], lastStudy[id]} {
			if t.After(last) {
				last = t
			}
		}
		if d := inactiveDays(last, in); d >= SubjectIdleDays {
			all = append(all, idle{id, d, last})
		}
	}
	sort.Slice(all, func(i, j int) bool {
		a, b := all[i], all[j]
		if a.days != b.days {
			return a.days > b.days
		}
		return a.id < b.id
	})
	var out []Nudge
	for _, x := range all {
		name := in.Info[x.id].Name
		n := Nudge{
			Kind: "subject_idle", SubjectID: &x.id, Key: day(x.since).Format(time.DateOnly),
			Title:  fmt.Sprintf("📚 %s te extraña", name),
			Body:   fmt.Sprintf("Hace %d días que no practicás %s. ¿Hacemos 1 ejercicio?", x.days, name),
			Action: Action{Type: "open_tutor", SubjectID: &x.id},
		}
		if d, ok := exam[x.id]; ok {
			n.Body = fmt.Sprintf("El parcial de %s es el %s y hace %d días que no la practicás. ¿Hacemos 1 ejercicio?", name, d.Format("02/01"), x.days)
		}
		out = append(out, n)
	}
	return out
}

// sortByUnlocks puts the subjects that unlock the most first.
func sortByUnlocks(ids []int, info map[int]SubjectInfo) {
	sort.Slice(ids, func(i, j int) bool {
		a, b := info[ids[i]].UnlocksTotal, info[ids[j]].UnlocksTotal
		return a > b || (a == b && ids[i] < ids[j])
	})
}

func weeks(n int) string {
	if n == 1 {
		return "1 semana"
	}
	return fmt.Sprintf("%d semanas", n)
}
