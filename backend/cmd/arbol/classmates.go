package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"firebase.google.com/go/v4/auth"
	"gorm.io/gorm"

	"github.com/franelias/hackaton/backend/internal/db"
)

// The demo teacher teaches Análisis I (Ana's class) and Lógica (Beto's).
const (
	teacherEmail = "docente@arbol.demo"
	teacherName  = "Laura Méndez"
)

// seedTeacher (re)creates the demo teacher, with a verified email so the API
// recognizes them, and the classmates that fill their classes.
func seedTeacher(ctx context.Context, g *gorm.DB, fb *auth.Client, password string, now time.Time) error {
	uid, err := upsertUser(ctx, fb, teacherEmail, teacherName, password)
	if err != nil {
		return fmt.Errorf("%s: %w", teacherEmail, err)
	}
	if _, err := fb.UpdateUser(ctx, uid, (&auth.UserToUpdate{}).EmailVerified(true)); err != nil {
		return fmt.Errorf("%s: %w", teacherEmail, err)
	}
	t, err := addTeacher(g, teacherEmail, teacherName, db.Faculty, []int{analisisI, logica})
	if err != nil {
		return err
	}
	log.Printf("%s -> t-%d (%s)", t.Email, t.ID, t.Name)

	for _, c := range classmates {
		d := c.student(now)
		// No Firebase account: nobody signs in as them.
		id, err := reset(g, "seed:"+strings.ToLower(c.name), d, now)
		if err != nil {
			return fmt.Errorf("%s: %w", c.name, err)
		}
		log.Printf("classmate -> s-%03d (%s)", id, c.name)
	}
	return nil
}

// classmate is a student of the demo teacher's classes, described by how they
// practice: perWeek exercises for weeks weeks, the last one idle days ago.
type classmate struct {
	name     string
	subject  int
	idle     int // days since the last exercise
	weeks    int
	perWeek  int
	accuracy int // correct out of every 4 exercises
	mock     int // best mock exam score, 0 for none
}

var classmates = []classmate{
	{name: "Caro", subject: analisisI, idle: 0, weeks: 6, perWeek: 4, accuracy: 3, mock: 81},
	{name: "Dani", subject: analisisI, idle: 6, weeks: 3, perWeek: 2, accuracy: 2},
	{name: "Eli", subject: analisisI, idle: 20, weeks: 2, perWeek: 2, accuracy: 1},
	{name: "Facu", subject: analisisI, idle: 1, weeks: 5, perWeek: 3, accuracy: 1, mock: 38},
	{name: "Gabi", subject: analisisI, idle: 2, weeks: 4, perWeek: 3, accuracy: 4},
	{name: "Hugo", subject: analisisI, idle: -1},
	{name: "Inés", subject: logica, idle: 1, weeks: 5, perWeek: 3, accuracy: 3, mock: 70},
	{name: "Juan", subject: logica, idle: 8, weeks: 3, perWeek: 2, accuracy: 2},
}

// Topic names are the ones frequent_topics returns for each subject.
var classTopics = map[int][]string{
	analisisI: {"límites", "continuidad", "función inversa", "derivadas"},
	logica: {
		"consecuencia semántica y contraejemplos",
		"validez de secuentes (árboles y pruebas lineales)",
		"modelos de lógica de predicados",
	},
}

func (c classmate) student(now time.Time) demoStudent {
	var acts []activity
	topics := classTopics[c.subject]
	for w := range c.weeks {
		for k := range c.perWeek {
			r, _ := json.Marshal(map[string]bool{"correct": (w+k)%4 < c.accuracy})
			ago := time.Duration(c.idle+7*w)*day + time.Duration(k+1)*time.Hour
			acts = append(acts, activity{ago: ago, typ: "exercise", subject: c.subject, topic: topics[(w+k)%len(topics)], result: string(r)})
		}
	}
	if c.mock > 0 {
		acts = append(acts, activity{ago: time.Duration(c.idle)*day + 30*time.Minute, typ: "mock_exam", subject: c.subject, result: fmt.Sprintf(`{"score":%d}`, c.mock)})
	}
	if c.subject == analisisI && c.idle >= 0 && c.idle < 7 {
		examDate := civil(now.AddDate(0, 0, 10)) // the same exam as Ana
		acts = append(acts, activity{ago: 30 * day, typ: "exam", subject: analisisI, date: &examDate})
	}

	states := map[int]string{c.subject: "enrolled"}
	if c.subject == logica {
		for _, s := range []int{algebraI, analisisI, programI, algebraII, analisisII, programII} {
			states[s] = "approved"
		}
	}
	return demoStudent{name: c.name, joined: 8 * 7 * day, states: states, activities: acts}
}
