package tree

import "time"

// Initial thresholds in days without activity, to be calibrated:
// wilted (alert low), withered (alert medium), alert high.
var (
	Thresholds       = [3]int{5, 10, 15}
	SeasonThresholds = [3]int{3, 6, 10} // mesas weeks or an exam in the next week
)

// inactiveDays counts the days since the last activity, skipping recess days.
func inactiveDays(last time.Time, in Input) int {
	n := 0
	for d := day(last).AddDate(0, 0, 1); !d.After(day(in.Now)); d = d.AddDate(0, 0, 1) {
		if !inPeriod(d, "recess", in.Periods) {
			n++
		}
	}
	return n
}

// examSeason: it is mesas time, or the student loaded an exam in the next 7 days.
func examSeason(in Input) bool {
	today := day(in.Now)
	if inPeriod(today, "exams", in.Periods) {
		return true
	}
	for _, a := range in.Activities {
		if a.Type == "exam" && a.Date != nil && !a.Date.Before(today) && !a.Date.After(today.AddDate(0, 0, 7)) {
			return true
		}
	}
	return false
}

func thresholds(season bool) [3]int {
	if season {
		return SeasonThresholds
	}
	return Thresholds
}

func healthState(days int, season bool) string {
	th := thresholds(season)
	switch {
	case days >= th[1]:
		return Withered
	case days >= th[0]:
		return Wilted
	}
	return Lush
}
