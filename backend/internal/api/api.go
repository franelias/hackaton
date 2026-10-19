// Package api is the HTTP API the app talks to (docs/contratos.md §1.1 and §2).
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"firebase.google.com/go/v4/auth"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"gorm.io/gorm"

	"github.com/franelias/hackaton/backend/internal/db"
)

// Verifier checks a Firebase ID token. *auth.Client implements it.
type Verifier interface {
	VerifyIDToken(ctx context.Context, idToken string) (*auth.Token, error)
}

type Server struct {
	DB   *gorm.DB
	Auth Verifier
	Now  func() time.Time
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "OPTIONS"},
		AllowedHeaders: []string{"Authorization", "Content-Type"},
	}))

	r.Get("/api/careers/{career_id}/plan", s.getPlan)
	r.Group(func(r chi.Router) {
		r.Use(s.authenticate)
		r.Get("/api/me", s.getMe)
		r.Post("/api/students", s.createStudent)
		r.Route("/api/students/{student_id}", func(r chi.Router) {
			r.Use(s.ownStudent)
			r.Get("/tree", s.getTree)
			r.Put("/subjects/{subject_id}", s.putSubject)
			r.Post("/activity", s.postActivity)
		})
	})
	return r
}

type ctxKey int

const (
	uidKey ctxKey = iota
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
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), uidKey, tok.UID)))
	})
}

// ownStudent loads {student_id} and checks the authenticated user owns it.
func (s *Server) ownStudent(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := parseStudentID(chi.URLParam(r, "student_id"))
		if !ok {
			writeErr(w, http.StatusNotFound, "not_found", "alumno inexistente")
			return
		}
		var st db.Student
		if err := s.DB.First(&st, id).Error; err != nil {
			s.dbErr(w, err, "alumno inexistente")
			return
		}
		if st.FirebaseUID != r.Context().Value(uidKey).(string) {
			writeErr(w, http.StatusForbidden, "forbidden", "este alumno pertenece a otro usuario")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), studentKey, &st)))
	})
}

func studentFrom(r *http.Request) *db.Student { return r.Context().Value(studentKey).(*db.Student) }

func formatStudentID(id int) string { return fmt.Sprintf("s-%03d", id) }

func parseStudentID(s string) (int, bool) {
	n, ok := strings.CutPrefix(s, "s-")
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

// dbErr maps a missing row to 404 and anything else to 500.
func (s *Server) dbErr(w http.ResponseWriter, err error, notFound string) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		writeErr(w, http.StatusNotFound, "not_found", notFound)
		return
	}
	writeErr(w, http.StatusInternalServerError, "internal", err.Error())
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
