package db_test

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/franelias/hackaton/backend/internal/db"
	"github.com/franelias/hackaton/backend/internal/db/dbtest"
	"github.com/franelias/hackaton/backend/internal/tree"
)

// Chat messages are loaded one per Argentina day; the tree and the nudges
// must come out as if every message had been loaded.
func TestLoadActivitiesCollapsesChatWithoutChangingTheTree(t *testing.T) {
	g := dbtest.New(t)
	if err := g.Create(&db.Career{Faculty: db.Faculty, ID: 1, Name: "c", MinTerms: 1, CriticalPath: []int{}}).Error; err != nil {
		t.Fatal(err)
	}
	if err := g.Create(&db.Subject{Faculty: db.Faculty, ID: 10, CareerID: 1, Code: "A", Name: "Análisis", Unlocks: []int{}}).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 16, 15, 0, 0, 0, time.UTC) // a Friday
	st := db.Student{FirebaseUID: "u", Name: "x", Faculty: db.Faculty, CareerID: 1, CreatedAt: now.AddDate(0, 0, -90)}
	other := db.Student{FirebaseUID: "v", Name: "y", Faculty: db.Faculty, CareerID: 1, CreatedAt: now.AddDate(0, 0, -90)}
	if err := g.Create(&[]*db.Student{&st, &other}).Error; err != nil {
		t.Fatal(err)
	}

	subject, topic := 10, "límites"
	var rows []db.Activity
	// several chat messages a day for weeks, some either side of Argentina's midnight (03:00 UTC)
	for d := range 40 {
		day := now.AddDate(0, 0, -d)
		for _, h := range []int{1, 2, 3, 4, 14, 23} {
			at := time.Date(day.Year(), day.Month(), day.Day(), h, 30, 0, 0, time.UTC)
			if d%5 == 4 {
				continue // gaps in the streak
			}
			rows = append(rows, db.Activity{StudentID: st.ID, Type: "chat", CreatedAt: at})
		}
	}
	exam := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
	rows = append(rows,
		db.Activity{StudentID: st.ID, Type: "exercise", SubjectID: &subject, Topic: &topic, Result: json.RawMessage(`{"correct":true}`), CreatedAt: now.AddDate(0, 0, -3)},
		db.Activity{StudentID: st.ID, Type: "exam", SubjectID: &subject, Date: &exam, CreatedAt: now.AddDate(0, 0, -2)},
		db.Activity{StudentID: other.ID, Type: "chat", CreatedAt: now.AddDate(0, 0, -1)},
	)
	if err := g.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}

	var all, got []db.Activity
	if err := g.Order("created_at, id").Find(&all, "student_id = ?", st.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.LoadActivities(g, []int{st.ID}, &got); err != nil {
		t.Fatal(err)
	}
	if len(got) >= len(all) {
		t.Fatalf("loaded %d rows of %d: chat was not collapsed", len(got), len(all))
	}

	p, err := db.LoadPlan(g, db.Faculty, 1)
	if err != nil {
		t.Fatal(err)
	}
	for _, offset := range []int{0, 1, 2, 3, 7, 10, 20} { // different "now"s, across weekdays
		at := now.AddDate(0, 0, offset)
		full := p.Input(&st, db.Rows{Acts: all}, at)
		collapsed := p.Input(&st, db.Rows{Acts: got}, at)
		if a, b := tree.Build(full), tree.Build(collapsed); !reflect.DeepEqual(a, b) {
			t.Errorf("+%dd: tree differs\nfull:      %+v\ncollapsed: %+v", offset, a, b)
		}
		if a, b := tree.Nudges(full), tree.Nudges(collapsed); !reflect.DeepEqual(a, b) {
			t.Errorf("+%dd: nudges differ\nfull:      %+v\ncollapsed: %+v", offset, a, b)
		}
	}

	// both students at once come out split by student
	byStudent, err := db.LoadRows(g, []int{st.ID, other.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(byStudent[st.ID].Acts) != len(got) || len(byStudent[other.ID].Acts) != 1 {
		t.Errorf("rows by student: %d and %d activities", len(byStudent[st.ID].Acts), len(byStudent[other.ID].Acts))
	}
}
