package tree

import (
	"fmt"
	"strconv"
	"time"
)

const (
	Low    = "low"
	Medium = "medium"
	High   = "high"
)

type Action struct {
	Type      string `json:"type"` // open_tutor | build_schedule | view_dates | contact_tutor
	SubjectID *int   `json:"subject_id,omitempty"`
}

type Alert struct {
	Type      string // inactivity | first_exam_missed
	SubjectID *int
	Level     string
	Message   string // Spanish, read by the student
	Action    Action
	// Key identifies the condition: a dismissed alert comes back only when it changes.
	Key string
}

func alerts(in Input, days int, season bool) []Alert {
	var out []Alert
	if a, ok := inactivity(in, days, season); ok {
		out = append(out, a)
	}
	return append(out, missedExams(in)...)
}

func inactivity(in Input, days int, season bool) (Alert, bool) {
	th := thresholds(season)
	switch {
	case days >= th[2]:
		return Alert{
			Type: "inactivity", Level: High, Key: High,
			Message: fmt.Sprintf("Hace %d días que no pasás por acá. ¿Querés hablar con un tutor o un compañero?", days),
			Action:  Action{Type: "contact_tutor"},
		}, true
	case days >= th[1]:
		a := Alert{Type: "inactivity", Level: Medium, Key: Medium, Message: "¿Practicamos 1 ejercicio? Con eso tu árbol vuelve a crecer.", Action: Action{Type: "open_tutor"}}
		if id, exam := focusSubject(in); id != 0 {
			a.SubjectID, a.Action.SubjectID = &id, &id
			a.Message = fmt.Sprintf("¿Practicamos 1 ejercicio de %s?", in.Info[id].Name)
			if exam {
				a.Message = fmt.Sprintf("Se viene el parcial de %s, ¿practicamos 1 ejercicio?", in.Info[id].Name)
			}
		}
		return a, true
	case days >= th[0]:
		return Alert{
			Type: "inactivity", Level: Low, Key: Low,
			Message: "Tu árbol te extraña. Un check-in rápido alcanza para regarlo.",
			Action:  Action{Type: "open_tutor"},
		}, true
	}
	return Alert{}, false
}

// focusSubject picks what to propose to an inactive student: the enrolled
// subject with the nearest upcoming exam, else the enrolled one that unlocks
// the most. exam reports whether it has an upcoming exam.
func focusSubject(in Input) (id int, exam bool) {
	today := day(in.Now)
	var next time.Time
	for _, a := range in.Activities {
		if a.Type != "exam" || a.Date == nil || a.SubjectID == nil || a.Date.Before(today) || in.States[*a.SubjectID] != Enrolled {
			continue
		}
		if next.IsZero() || a.Date.Before(next) {
			next, id = *a.Date, *a.SubjectID
		}
	}
	if id != 0 {
		return id, true
	}
	for s, st := range in.States {
		if st != Enrolled {
			continue
		}
		if id == 0 || in.Info[s].UnlocksTotal > in.Info[id].UnlocksTotal || (in.Info[s].UnlocksTotal == in.Info[id].UnlocksTotal && s < id) {
			id = s
		}
	}
	return id, false
}

// missedExams: per subject not yet regular or approved, the earliest past
// exam date with no exam activity carrying a result for that date.
func missedExams(in Input) []Alert {
	today := day(in.Now)
	taken := map[string]bool{}
	for _, a := range in.Activities {
		if a.Type == "exam" && a.Date != nil && a.SubjectID != nil && len(a.Result) > 0 && string(a.Result) != "null" {
			taken[examKey(*a.SubjectID, *a.Date)] = true
		}
	}
	missed := map[int]time.Time{}
	for _, a := range in.Activities {
		if a.Type != "exam" || a.Date == nil || a.SubjectID == nil || !a.Date.Before(today) || taken[examKey(*a.SubjectID, *a.Date)] {
			continue
		}
		if st := in.States[*a.SubjectID]; st == Approved || st == Regular {
			continue
		}
		if d, ok := missed[*a.SubjectID]; !ok || a.Date.Before(d) {
			missed[*a.SubjectID] = *a.Date
		}
	}
	var out []Alert
	for id, d := range missed {
		level := Medium
		if in.Info[id].Bottleneck {
			level = High
		}
		out = append(out, Alert{
			Type: "first_exam_missed", SubjectID: &id, Level: level, Key: d.Format(time.DateOnly),
			Message: fmt.Sprintf("No registraste cómo te fue en el parcial de %s del %s. ¿Lo preparamos juntos para el recuperatorio?", in.Info[id].Name, d.Format("02/01")),
			Action:  Action{Type: "open_tutor", SubjectID: &id},
		})
	}
	return out
}

func examKey(subject int, d time.Time) string {
	return strconv.Itoa(subject) + "@" + d.Format(time.DateOnly)
}
