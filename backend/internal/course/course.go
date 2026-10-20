// Package course summarizes the students of a subject for the teacher who
// teaches it (contract §2.6). It is pure: no database, no HTTP.
package course

import (
	"encoding/json"
	"sort"
	"time"

	"github.com/franelias/hackaton/backend/internal/tree"
)

// Weeks is how many weeks of activity the detail shows, the current one included.
const Weeks = 8

// Member is one student of the subject: their tree, all their activity and
// their open alerts.
type Member struct {
	ID         int
	Name       string
	Tree       tree.Tree
	Activities []tree.Activity
	Alerts     []Alert
}

type Alert struct {
	Type      string `json:"type"`
	Level     string `json:"level"`
	Message   string `json:"message"`
	SubjectID *int   `json:"-"`
}

type HealthCount struct {
	Lush     int `json:"lush"`
	Wilted   int `json:"wilted"`
	Withered int `json:"withered"`
}

type Summary struct {
	Students          int         `json:"students"`
	Health            HealthCount `json:"health"`
	ActiveThisWeek    int         `json:"active_this_week"`
	ExercisesThisWeek int         `json:"exercises_this_week"`
	OpenAlerts        int         `json:"open_alerts"`
}

type Student struct {
	ID             int         `json:"-"`
	Name           string      `json:"name"`
	Health         tree.Health `json:"health"`
	Exercises      int         `json:"exercises"`
	CorrectRate    *float64    `json:"correct_rate"`
	MasteredTopics int         `json:"mastered_topics"`
	BestMockExam   *float64    `json:"best_mock_exam"`
	Flower         bool        `json:"flower"`
	Dry            bool        `json:"dry"`
	NextExam       *string     `json:"next_exam"`
	Alerts         []Alert     `json:"alerts"`
}

type Week struct {
	Week           string `json:"week"`
	Exercises      int    `json:"exercises"`
	ActiveStudents int    `json:"active_students"`
}

type Topic struct {
	Topic    string `json:"topic"`
	Attempts int    `json:"attempts"`
	Correct  int    `json:"correct"`
	Students int    `json:"students"`
}

type Detail struct {
	Summary  Summary   `json:"summary"`
	Students []Student `json:"students"`
	Weeks    []Week    `json:"weeks"`
	Topics   []Topic   `json:"topics"`
}

// studying is the activity that counts as working on a subject.
func studying(a tree.Activity, subjectID int) bool {
	return a.SubjectID != nil && *a.SubjectID == subjectID && (a.Type == "exercise" || a.Type == "mock_exam" || a.Type == "chat")
}

// Build summarizes subjectID's members as of now.
func Build(subjectID int, members []Member, now time.Time) Detail {
	today := tree.CivilDay(now)
	thisWeek := tree.WeekStart(today)
	first := thisWeek.AddDate(0, 0, -7*(Weeks-1))

	d := Detail{Students: []Student{}, Weeks: make([]Week, Weeks), Topics: []Topic{}}
	activeIn := make([]map[int]bool, Weeks)
	for i := range d.Weeks {
		d.Weeks[i].Week = first.AddDate(0, 0, 7*i).Format(time.DateOnly)
		activeIn[i] = map[int]bool{}
	}
	topics := map[string]*Topic{}
	var topicOrder []string

	for _, m := range members {
		st := Student{ID: m.ID, Name: m.Name, Health: m.Tree.Health, Alerts: []Alert{}}
		for _, s := range m.Tree.Subjects {
			if s.SubjectID == subjectID {
				st.Flower, st.Dry = s.Flower, s.Dry
			}
		}
		for _, a := range m.Alerts {
			if a.SubjectID == nil || *a.SubjectID == subjectID {
				st.Alerts = append(st.Alerts, a)
			}
		}

		correct, examsDone := 0, map[time.Time]bool{}
		var upcoming []time.Time
		for _, a := range m.Activities {
			if a.SubjectID == nil || *a.SubjectID != subjectID {
				continue
			}
			switch a.Type {
			case "exercise":
				st.Exercises++
				var r struct{ Correct bool }
				if json.Unmarshal(a.Result, &r) == nil && r.Correct {
					correct++
				}
			case "mock_exam":
				var r struct{ Score *float64 }
				if json.Unmarshal(a.Result, &r) == nil && r.Score != nil && (st.BestMockExam == nil || *r.Score > *st.BestMockExam) {
					st.BestMockExam = r.Score
				}
			case "exam":
				if a.Date == nil {
					break
				}
				if len(a.Result) > 0 && string(a.Result) != "null" {
					examsDone[*a.Date] = true
				} else if !a.Date.Before(today) {
					upcoming = append(upcoming, *a.Date)
				}
			}
			if studying(a, subjectID) {
				day := tree.CivilDay(a.CreatedAt)
				if i := int(day.Sub(first).Hours() / 24 / 7); !day.Before(first) && i < Weeks {
					activeIn[i][m.ID] = true
					if a.Type == "exercise" {
						d.Weeks[i].Exercises++
					}
				}
			}
		}
		if st.Exercises > 0 {
			rate := float64(correct) / float64(st.Exercises)
			st.CorrectRate = &rate
		}
		sort.Slice(upcoming, func(i, j int) bool { return upcoming[i].Before(upcoming[j]) })
		for _, e := range upcoming {
			if !examsDone[e] {
				s := e.Format(time.DateOnly)
				st.NextExam = &s
				break
			}
		}

		seen := map[string]bool{}
		for _, t := range tree.Topics(m.Activities)[subjectID] {
			if t.Mastered {
				st.MasteredTopics++
			}
			key := tree.TopicKey(t.Topic)
			agg := topics[key]
			if agg == nil {
				agg = &Topic{Topic: t.Topic}
				topics[key] = agg
				topicOrder = append(topicOrder, key)
			}
			agg.Attempts += t.Attempts
			agg.Correct += t.Correct
			if !seen[key] {
				agg.Students++
				seen[key] = true
			}
		}

		switch st.Health.State {
		case tree.Lush:
			d.Summary.Health.Lush++
		case tree.Wilted:
			d.Summary.Health.Wilted++
		case tree.Withered:
			d.Summary.Health.Withered++
		}
		d.Summary.OpenAlerts += len(st.Alerts)
		d.Students = append(d.Students, st)
	}

	d.Summary.Students = len(d.Students)
	d.Summary.ActiveThisWeek = len(activeIn[Weeks-1])
	d.Summary.ExercisesThisWeek = d.Weeks[Weeks-1].Exercises
	for i := range d.Weeks {
		d.Weeks[i].ActiveStudents = len(activeIn[i])
	}
	for _, k := range topicOrder {
		d.Topics = append(d.Topics, *topics[k])
	}
	sort.SliceStable(d.Topics, func(i, j int) bool {
		a, b := d.Topics[i], d.Topics[j]
		return a.Attempts > b.Attempts || (a.Attempts == b.Attempts && a.Topic < b.Topic)
	})
	sort.SliceStable(d.Students, func(i, j int) bool {
		a, b := d.Students[i], d.Students[j]
		if ra, rb := risk(a), risk(b); ra != rb {
			return ra > rb
		}
		return a.Health.LastActivity.Before(b.Health.LastActivity)
	})
	return d
}

// risk orders students for the teacher: a high alert first, then by health.
func risk(s Student) int {
	r := map[string]int{tree.Lush: 0, tree.Wilted: 1, tree.Withered: 2}[s.Health.State]
	for _, a := range s.Alerts {
		if a.Level == tree.High {
			return 3
		}
	}
	return r
}
