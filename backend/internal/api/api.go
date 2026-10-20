// Package api is the HTTP API the app talks to (docs/contratos.md §1.1 and §2).
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"firebase.google.com/go/v4/auth"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"gorm.io/gorm"

	"github.com/franelias/hackaton/backend/internal/db"
	"github.com/franelias/hackaton/backend/internal/tutor"
	"github.com/franelias/hackaton/fceia/tools"
)

// Verifier checks a Firebase ID token. *auth.Client implements it.
type Verifier interface {
	VerifyIDToken(ctx context.Context, idToken string) (*auth.Token, error)
}

type Server struct {
	DB    *gorm.DB
	Auth  Verifier
	Now   func() time.Time
	Tutor *tutor.Tutor
	// FCEIA is the FCEIA API as tools, shared with the MCP server.
	FCEIA *tools.Tools

	chats        chatLimiter // per student
	teacherChats chatLimiter // per teacher
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(limitBody)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "OPTIONS"},
		AllowedHeaders: []string{"Authorization", "Content-Type"},
	}))

	r.Get("/api/faculties", s.getFaculties)
	r.Get("/api/careers/{career_id}/plan", s.getPlan)
	r.Group(func(r chi.Router) {
		r.Use(s.authenticate)
		r.Get("/api/me", s.getMe)
		r.Get("/api/teacher", s.getTeacher)
		r.Get("/api/teacher/subjects/{subject_id}", s.getTeacherSubject)
		r.Post("/api/teacher/chat", s.teacherChat)
		r.Get("/api/teacher/conversations/{conversation_id}", s.getTeacherConversation)
		r.Post("/api/students", s.createStudent)
		r.Post("/api/chat", s.chat)
		r.Post("/api/schedule", s.schedule)
		r.Route("/api/students/{student_id}", func(r chi.Router) {
			r.Use(s.ownStudent)
			r.Get("/tree", s.getTree)
			r.Put("/subjects", s.putSubjects)
			r.Put("/subjects/{subject_id}", s.putSubject)
			r.Post("/activity", s.postActivity)
			r.Get("/alerts", s.getAlerts)
			r.Post("/alerts/{alert_id}/dismiss", s.dismissAlert)
			r.Get("/conversations/{conversation_id}", s.getConversation)
		})
	})
	return r
}

type ctxKey int

const (
	uidKey ctxKey = iota
	emailKey
	studentKey
)

func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || raw == "" {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "falta el header Authorization: Bearer <Firebase ID token>")
			return
		}
		tok, err := s.Auth.VerifyIDToken(r.Context(), raw)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "token de Firebase inválido o vencido")
			return
		}
		ctx := context.WithValue(r.Context(), uidKey, tok.UID)
		ctx = context.WithValue(ctx, emailKey, verifiedEmail(tok))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// ownStudent loads {student_id} and checks the authenticated user owns it.
func (s *Server) ownStudent(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		st, ok := s.owned(w, r, chi.URLParam(r, "student_id"))
		if !ok {
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), studentKey, st)))
	})
}

// owned loads the student with id raw ("s-001") if the authenticated user owns
// it; otherwise it writes the error response.
func (s *Server) owned(w http.ResponseWriter, r *http.Request, raw string) (*db.Student, bool) {
	id, ok := parseStudentID(raw)
	if !ok {
		writeErr(w, http.StatusNotFound, "not_found", "alumno inexistente")
		return nil, false
	}
	var st db.Student
	if err := s.DB.First(&st, id).Error; err != nil {
		s.dbErr(w, err, "alumno inexistente")
		return nil, false
	}
	if st.FirebaseUID != r.Context().Value(uidKey).(string) {
		writeErr(w, http.StatusForbidden, "forbidden", "este alumno pertenece a otro usuario")
		return nil, false
	}
	return &st, true
}

// verifiedEmail is the token's email in lower case, or "" if it is missing or
// not verified: only a verified email can make a user a teacher.
func verifiedEmail(tok *auth.Token) string {
	email, _ := tok.Claims["email"].(string)
	if verified, _ := tok.Claims["email_verified"].(bool); !verified {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(email))
}

func studentFrom(r *http.Request) *db.Student { return r.Context().Value(studentKey).(*db.Student) }

func formatStudentID(id int) string    { return fmt.Sprintf("s-%03d", id) }
func formatAlertID(id int) string      { return fmt.Sprintf("al-%d", id) }
func formatConvID(id int) string       { return fmt.Sprintf("c-%d", id) }
func formatTeacherID(id int) string    { return fmt.Sprintf("t-%d", id) }
func parseConvID(s string) (int, bool) { return parseID(s, "c-") }

func parseStudentID(s string) (int, bool) { return parseID(s, "s-") }
func parseAlertID(s string) (int, bool)   { return parseID(s, "al-") }

func parseID(s, prefix string) (int, bool) {
	n, ok := strings.CutPrefix(s, prefix)
	if !ok {
		return 0, false
	}
	id, err := strconv.Atoi(n)
	return id, err == nil && id > 0
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code, msg string) {
	type body struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	writeJSON(w, status, map[string]body{"error": {code, msg}})
}

// dbErr maps a missing row to 404 and anything else to 500. The database error
// is logged, never sent: it can show table names and queries.
func (s *Server) dbErr(w http.ResponseWriter, err error, notFound string) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		writeErr(w, http.StatusNotFound, "not_found", notFound)
		return
	}
	log.Printf("db: %v", err)
	writeErr(w, http.StatusInternalServerError, "internal", "error interno")
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_argument", "body inválido: "+err.Error())
		return false
	}
	return true
}

// parallel runs independent queries at once: with a remote database every
// round trip counts.
func parallel(queries ...func() error) error {
	errs := make([]error, len(queries))
	var wg sync.WaitGroup
	for i, q := range queries {
		wg.Go(func() { errs[i] = q() })
	}
	wg.Wait()
	return errors.Join(errs...)
}
