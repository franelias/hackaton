package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"firebase.google.com/go/v4/auth"
	"github.com/spf13/cobra"
	"gorm.io/gorm"

	"github.com/franelias/hackaton/backend/internal/db"
)

const (
	algebraI   = 1
	analisisI  = 2
	programI   = 3
	algebraII  = 4
	analisisII = 5
	programII  = 6
	logica     = 12
)

type activity struct {
	ago     time.Duration // before now
	typ     string
	subject int
	topic   string
	result  string // JSON
	date    *time.Time
}

type demoStudent struct {
	email, name string
	joined      time.Duration // before now
	states      map[int]string
	activities  []activity
}

const day = 24 * time.Hour

func seedCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "seed",
		Short: "(Re)create the demo students Ana and Beto, their classmates and the demo teacher (password DEMO_PASSWORD, default arbol-demo)",
		Args:  cobra.NoArgs,
		RunE:  func(cmd *cobra.Command, _ []string) error { return seed(cmd.Context()) },
	}
}

// seed (re)creates the two demo students, with dates relative to now so
// every rehearsal starts the same:
//
//   - Ana (ana@arbol.demo): first year, practicing Análisis Matemático I for
//     6 weeks, exam in 10 days, one topic mastered and no flower yet. Her tree
//     is lush; in the demo she passes a mock exam and the flower appears.
//   - Beto (beto@arbol.demo): second year with first year approved, enrolled
//     in Lógica (a bottleneck). He stopped coming 12 days ago and missed the
//     Lógica exam 3 days ago: withered tree, dry Lógica branch, alerts.
//   - Laura Méndez (docente@arbol.demo): the teacher of Análisis I and Lógica,
//     with 8 more classmates (no Firebase account) so the class view has
//     students in every state. See classmates.go.
//
// Config: DATABASE_URL, FIREBASE_PROJECT_ID (FIREBASE_AUTH_EMULATOR_HOST for
// the emulator), DEMO_PASSWORD (default "arbol-demo"). Other students are not
// touched.
func seed(ctx context.Context) error {
	now := time.Now()
	password := env("DEMO_PASSWORD", "arbol-demo")
	g, err := openDB()
	if err != nil {
		return err
	}
	fb, err := firebaseAuth(ctx)
	if err != nil {
		return err
	}

	for _, d := range []demoStudent{ana(now), beto(now)} {
		uid, err := upsertUser(ctx, fb, d.email, d.name, password)
		if err != nil {
			return fmt.Errorf("%s: %w", d.email, err)
		}
		id, err := reset(g, uid, d, now)
		if err != nil {
			return fmt.Errorf("%s: %w", d.email, err)
		}
		log.Printf("%s -> s-%03d (%s)", d.email, id, d.name)
	}
	if err := seedTeacher(ctx, g, fb, password, now); err != nil {
		return err
	}
	log.Printf("password: %s", password)
	return nil
}

// ana practiced Análisis I every week for 6 weeks (the current one included).
// Topic names are the ones frequent_topics returns for subject 2.
func ana(now time.Time) demoStudent {
	examDate := civil(now.AddDate(0, 0, 10))
	acts := []activity{{ago: 30 * day, typ: "exam", subject: analisisI, date: &examDate}}
	// Mastered: límites (3 correct). In progress: continuidad, función inversa.
	practice := []struct {
		week    int
		topic   string
		correct bool
	}{
		{5, "límites", false}, {5, "límites", true},
		{4, "límites", true}, {4, "continuidad", false},
		{3, "continuidad", true}, {3, "límites", true},
		{2, "función inversa", false}, {2, "continuidad", false},
		{1, "continuidad", true}, {1, "función inversa", true},
		{0, "función inversa", false},
	}
	for i, p := range practice {
		r, _ := json.Marshal(map[string]bool{"correct": p.correct})
		ago := time.Duration(p.week)*7*day + time.Duration(i%2+1)*time.Hour
		acts = append(acts, activity{ago: ago, typ: "exercise", subject: analisisI, topic: p.topic, result: string(r)})
	}
	acts = append(acts, activity{ago: 2 * day, typ: "chat"}, activity{ago: 9 * day, typ: "chat"})
	return demoStudent{
		email: "ana@arbol.demo", name: "Ana", joined: 7 * 7 * day,
		states:     map[int]string{analisisI: "enrolled", algebraI: "enrolled"},
		activities: acts,
	}
}

// beto had an 8-week study streak (weeks 14 to 7 ago), then only check-ins
// until 12 days ago. The streak shows 0 with best 8.
func beto(now time.Time) demoStudent {
	topics := []string{
		"consecuencia semántica y contraejemplos",
		"validez de secuentes (árboles y pruebas lineales)",
		"modelos de lógica de predicados",
		"reglas de introducción y eliminación en deducción natural",
	}
	var acts []activity
	for w := 7; w <= 14; w++ {
		r, _ := json.Marshal(map[string]bool{"correct": w%3 != 0})
		acts = append(acts, activity{ago: time.Duration(w)*7*day + 20*time.Hour, typ: "exercise", subject: logica, topic: topics[w%len(topics)], result: string(r)})
	}
	examDate := civil(now.AddDate(0, 0, -3))
	acts = append(acts,
		activity{ago: 40 * day, typ: "exam", subject: logica, date: &examDate},
		activity{ago: 25 * day, typ: "checkin"},
		activity{ago: 12 * day, typ: "checkin"},
	)
	states := map[int]string{logica: "enrolled"}
	for _, s := range []int{algebraI, analisisI, programI, algebraII, analisisII, programII} {
		states[s] = "approved"
	}
	return demoStudent{email: "beto@arbol.demo", name: "Beto", joined: 400 * day, states: states, activities: acts}
}

// civil is t's date at UTC midnight, the way dates are stored.
func civil(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func upsertUser(ctx context.Context, fb *auth.Client, email, name, password string) (string, error) {
	u, err := fb.GetUserByEmail(ctx, email)
	if auth.IsUserNotFound(err) {
		u, err = fb.CreateUser(ctx, (&auth.UserToCreate{}).Email(email).Password(password).DisplayName(name))
		if err != nil {
			return "", err
		}
		return u.UID, nil
	}
	if err != nil {
		return "", err
	}
	_, err = fb.UpdateUser(ctx, u.UID, (&auth.UserToUpdate{}).Password(password).DisplayName(name))
	return u.UID, err
}

// reset deletes the student linked to uid (cascading to everything it owns)
// and creates it again from d.
func reset(g *gorm.DB, uid string, d demoStudent, now time.Time) (int, error) {
	st := db.Student{FirebaseUID: uid, Name: d.name, Faculty: db.Faculty, CareerID: 1, CreatedAt: now.Add(-d.joined)}
	err := g.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("firebase_uid = ?", uid).Delete(&db.Student{}).Error; err != nil {
			return err
		}
		if err := tx.Create(&st).Error; err != nil {
			return err
		}
		for subject, state := range d.states {
			if err := tx.Create(&db.StudentSubject{StudentID: st.ID, SubjectID: subject, State: state}).Error; err != nil {
				return err
			}
		}
		for _, a := range d.activities {
			row := db.Activity{StudentID: st.ID, Type: a.typ, Date: a.date, CreatedAt: now.Add(-a.ago)}
			if a.subject != 0 {
				row.SubjectID = &a.subject
			}
			if a.topic != "" {
				row.Topic = &a.topic
			}
			if a.result != "" {
				row.Result = json.RawMessage(a.result)
			}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return st.ID, err
}
