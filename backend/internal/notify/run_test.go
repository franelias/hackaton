package notify

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/franelias/hackaton/backend/internal/db"
	"github.com/franelias/hackaton/backend/internal/db/dbtest"
	"github.com/franelias/hackaton/backend/internal/tree"
)

type recordingPush struct {
	mu     sync.Mutex
	tokens []string
}

func (p *recordingPush) Push(_ context.Context, tokens []string, _ Message) (int, []string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.tokens = append(p.tokens, tokens...)
	return len(tokens), nil, nil
}

func TestRun(t *testing.T) {
	g := dbtest.New(t)
	now := time.Now()
	if err := g.Create(&db.Career{Faculty: db.Faculty, ID: 1, Name: "c", MinTerms: 1, CriticalPath: []int{}}).Error; err != nil {
		t.Fatal(err)
	}
	if err := g.Create(&db.Subject{Faculty: db.Faculty, ID: 10, CareerID: 1, Code: "A", Name: "Análisis", Unlocks: []int{}}).Error; err != nil {
		t.Fatal(err)
	}

	// idle makes a student with an enrolled subject nobody studied for weeks: it has a nudge
	idle := func(uid string, push bool, token bool) db.Student {
		st := db.Student{FirebaseUID: uid, Name: uid, Faculty: db.Faculty, CareerID: 1, NotifyPush: push, NotifyEmail: false, CreatedAt: now.AddDate(0, 0, -60)}
		if err := g.Create(&st).Error; err != nil {
			t.Fatal(err)
		}
		// gorm turns a false into the column default (true) on insert
		if err := g.Model(&st).Updates(map[string]any{"notify_push": push, "notify_email": false}).Error; err != nil {
			t.Fatal(err)
		}
		if err := g.Create(&db.StudentSubject{StudentID: st.ID, SubjectID: 10, State: tree.Enrolled, Since: now.AddDate(0, 0, -20)}).Error; err != nil {
			t.Fatal(err)
		}
		if token {
			if err := g.Create(&db.PushToken{Token: "tok-" + uid, StudentID: st.ID}).Error; err != nil {
				t.Fatal(err)
			}
		}
		return st
	}
	a := idle("a", true, true)  // gets the reminder
	b := idle("b", true, true)  // already got one today
	c := idle("c", true, false) // push on, no device registered
	d := idle("d", false, true) // every channel off
	e := db.Student{FirebaseUID: "e", Name: "e", Faculty: db.Faculty, CareerID: 1, NotifyPush: true, CreatedAt: now}
	if err := g.Create(&e).Error; err != nil { // nothing to remind
		t.Fatal(err)
	}
	if err := g.Create(&db.PushToken{Token: "tok-e", StudentID: e.ID}).Error; err != nil {
		t.Fatal(err)
	}
	if err := g.Create(&db.Notification{StudentID: b.ID, Kind: "other", CondKey: "k", Title: "t", Body: "b", SentAt: now}).Error; err != nil {
		t.Fatal(err)
	}

	// the premise: a has something to be reminded of, e does not
	in, err := db.TreeInput(g, &a, now)
	if err != nil || len(tree.Nudges(in)) == 0 {
		t.Fatalf("test setup: a has no nudge (%v)", err)
	}
	if in, err := db.TreeInput(g, &e, now); err != nil || len(tree.Nudges(in)) != 0 {
		t.Fatalf("test setup: e has nudges (%v)", err)
	}

	push := &recordingPush{}
	n := &Notifier{DB: g, Push: push, AppURL: "https://arbol.test", Now: func() time.Time { return now }}
	sent, err := n.Run(context.Background(), Options{AnyHour: true})
	if err != nil || sent != 1 {
		t.Fatalf("Run = %d, %v; want 1 student nudged (pushed to %v)", sent, err, push.tokens)
	}
	if len(push.tokens) != 1 || push.tokens[0] != "tok-a" {
		t.Errorf("pushed to %v, want only tok-a", push.tokens)
	}
	var sentTo []int
	g.Model(&db.Notification{}).Where("kind <> 'other'").Pluck("student_id", &sentTo)
	if len(sentTo) != 1 || sentTo[0] != a.ID {
		t.Errorf("notifications claimed for %v, want only student %d", sentTo, a.ID)
	}
	_, _ = c, d

	// each condition goes out once, and a got today's reminder
	if sent, err := n.Run(context.Background(), Options{AnyHour: true}); err != nil || sent != 0 {
		t.Errorf("second Run = %d, %v; want 0", sent, err)
	}
	// one student only
	if sent, err := n.Run(context.Background(), Options{AnyHour: true, StudentID: c.ID}); err != nil || sent != 0 {
		t.Errorf("Run for c = %d, %v; want 0 (no device)", sent, err)
	}
}

// statements counts the statements sent to the database.
type statements struct {
	logger.Interface
	n atomic.Int64
}

func (s *statements) Trace(_ context.Context, _ time.Time, _ func() (string, int64), _ error) {
	s.n.Add(1)
}

// Without a nudge to send a student costs no statements of its own: the run
// loads everything in a few queries, whoever the students are.
func TestRunQueriesDoNotGrowPerStudent(t *testing.T) {
	g := dbtest.New(t)
	now := time.Now()
	if err := g.Create(&db.Career{Faculty: db.Faculty, ID: 1, Name: "c", MinTerms: 1, CriticalPath: []int{}}).Error; err != nil {
		t.Fatal(err)
	}
	if err := g.Create(&db.Subject{Faculty: db.Faculty, ID: 10, CareerID: 1, Code: "A", Name: "Análisis", Unlocks: []int{}}).Error; err != nil {
		t.Fatal(err)
	}
	for i := range 60 { // fresh students: nothing to remind
		st := db.Student{FirebaseUID: fmt.Sprint("u", i), Name: "x", Faculty: db.Faculty, CareerID: 1, NotifyPush: true, CreatedAt: now}
		if err := g.Create(&st).Error; err != nil {
			t.Fatal(err)
		}
		if err := g.Create(&db.PushToken{Token: fmt.Sprint("t", i), StudentID: st.ID}).Error; err != nil {
			t.Fatal(err)
		}
	}
	count := &statements{Interface: logger.Discard}
	n := &Notifier{DB: g.Session(&gorm.Session{Logger: count}), Push: &recordingPush{}, Now: func() time.Time { return now }}
	if sent, err := n.Run(context.Background(), Options{AnyHour: true}); err != nil || sent != 0 {
		t.Fatalf("Run = %d, %v", sent, err)
	}
	got := count.n.Load()
	t.Logf("%d statements for 60 students", got)
	if got > 12 {
		t.Errorf("%d statements for 60 students, want a handful", got)
	}
}
