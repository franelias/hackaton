package api

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm/clause"

	"github.com/franelias/hackaton/backend/internal/db"
)

type notificationPrefs struct {
	Push  bool `json:"push"`
	Email bool `json:"email"`
}

func (s *Server) getNotifications(w http.ResponseWriter, r *http.Request) {
	st := studentFrom(r)
	writeJSON(w, http.StatusOK, notificationPrefs{st.NotifyPush, st.NotifyEmail})
}

// putNotifications turns the reminder channels on or off; a missing field keeps its value.
func (s *Server) putNotifications(w http.ResponseWriter, r *http.Request) {
	st := studentFrom(r)
	var body struct {
		Push  *bool `json:"push"`
		Email *bool `json:"email"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Push != nil {
		st.NotifyPush = *body.Push
	}
	if body.Email != nil {
		st.NotifyEmail = *body.Email
	}
	if err := s.DB.Model(st).Updates(map[string]any{"notify_push": st.NotifyPush, "notify_email": st.NotifyEmail}).Error; err != nil {
		s.dbErr(w, err, "")
		return
	}
	writeJSON(w, http.StatusOK, notificationPrefs{st.NotifyPush, st.NotifyEmail})
}

// postPushToken registers this browser's FCM token. A token already linked
// to another student (same device, other account) moves to this one.
func (s *Server) postPushToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token string `json:"token"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Token = strings.TrimSpace(body.Token); body.Token == "" || len(body.Token) > 4096 {
		writeErr(w, http.StatusBadRequest, "invalid_argument", "falta token (hasta 4096 caracteres)")
		return
	}
	row := db.PushToken{Token: body.Token, StudentID: studentFrom(r).ID}
	err := s.DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "token"}},
		DoUpdates: clause.AssignmentColumns([]string{"student_id"}),
	}).Create(&row).Error
	if err != nil {
		s.dbErr(w, err, "")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// deletePushToken forgets this browser's token (204 even if it was not there).
func (s *Server) deletePushToken(w http.ResponseWriter, r *http.Request) {
	// chi gives the escaped path segment when the client escaped it
	token, err := url.PathUnescape(chi.URLParam(r, "token"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_argument", "token inválido")
		return
	}
	if err := s.DB.Delete(&db.PushToken{}, "token = ? AND student_id = ?", token, studentFrom(r).ID).Error; err != nil {
		s.dbErr(w, err, "")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
