package tree

import "time"

const MaxWildcards = 2

// streak counts consecutive ISO weeks with any activity (exercise, mock
// exam, chat or a checkin). An empty week spends a wildcard or
// breaks the streak; a recess week freezes it; the current week only counts
// once it has a session. A wildcard is earned every 4 weeks of streak.
func streak(in Input) Streak {
	weeks := map[time.Time]bool{}
	var first time.Time
	for _, a := range in.Activities {
		if !streakActivity(a) {
			continue
		}
		w := monday(day(a.CreatedAt))
		weeks[w] = true
		if first.IsZero() || w.Before(first) {
			first = w
		}
	}
	var s Streak
	if first.IsZero() {
		return s
	}
	current := monday(day(in.Now))
	for w := first; !w.After(current); w = w.AddDate(0, 0, 7) {
		switch {
		case weeks[w]:
			s.Weeks++
			if s.Weeks%4 == 0 && s.Wildcards < MaxWildcards {
				s.Wildcards++
			}
			s.Best = max(s.Best, s.Weeks)
		case w.Equal(current):
		// shortcut: a week is in recess when its Wednesday is; fine for the 2+ week recesses we have.
		case inPeriod(w.AddDate(0, 0, 2), "recess", in.Periods):
		case s.Wildcards > 0:
			s.Wildcards--
		default:
			s.Weeks = 0
		}
	}
	return s
}

// streakActivity: what counts for the streak (a study session or a checkin).
func streakActivity(a Activity) bool {
	return studySession(a) || a.Type == "checkin"
}

// studySession: real study, as opposed to a checkin.
func studySession(a Activity) bool {
	return a.Type == "exercise" || a.Type == "mock_exam" || a.Type == "chat"
}
