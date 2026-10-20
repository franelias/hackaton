package tree

import (
	"time"
	_ "time/tzdata" // the server may run without system tz data
)

// Days and weeks are counted in Argentina's civil calendar.
var loc, _ = time.LoadLocation("America/Argentina/Buenos_Aires")

// day is t's civil date in Argentina, at UTC midnight, comparable with
// dates loaded from the database.
func day(t time.Time) time.Time {
	y, m, d := t.In(loc).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func monday(d time.Time) time.Time {
	return d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7))
}

func inPeriod(d time.Time, kind string, periods []Period) bool {
	for _, p := range periods {
		if p.Kind == kind && !d.Before(p.From) && !d.After(p.To) {
			return true
		}
	}
	return false
}

// CivilDay is t's civil date in Argentina at UTC midnight, the way dates are stored.
func CivilDay(t time.Time) time.Time { return day(t) }

// WeekStart is the Monday of d's week (d a civil date).
func WeekStart(d time.Time) time.Time { return monday(d) }
