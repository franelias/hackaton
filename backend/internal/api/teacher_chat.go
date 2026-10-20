package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/openai/openai-go/v3"

	"github.com/franelias/hackaton/backend/internal/db"
	"github.com/franelias/hackaton/backend/internal/tutor"
)

// Teacher assistant (docs/contratos.md §2.6): the tutor's model and FCEIA tools
// with another prompt. It sees no student data.

// teacherChat answers one teacher message, streamed as SSE like /api/chat.
func (s *Server) teacherChat(w http.ResponseWriter, r *http.Request) {
	t, ok := s.ownTeacher(w, r)
	if !ok {
		return
	}
	var body struct {
		Message        string  `json:"message"`
		ConversationID *string `json:"conversation_id"`
		ImageBase64    *string `json:"image_base64"`
	}
	if !decode(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.Message) == "" && body.ImageBase64 == nil {
		writeErr(w, http.StatusBadRequest, "invalid_argument", "falta message")
		return
	}
	if utf8.RuneCountInString(body.Message) > maxMessageRunes {
		writeErr(w, http.StatusBadRequest, "invalid_argument", fmt.Sprintf("el mensaje supera los %d caracteres", maxMessageRunes))
		return
	}
	image, msg := imageURL(body.ImageBase64)
	if msg != "" {
		writeErr(w, http.StatusBadRequest, "invalid_argument", msg)
		return
	}
	if s.Tutor == nil {
		writeErr(w, http.StatusServiceUnavailable, "tutor_unavailable", "el asistente no está configurado (falta OPENROUTER_API_KEY)")
		return
	}
	release, msg := s.teacherChats.acquire(t.ID, s.Now())
	if msg != "" {
		writeErr(w, http.StatusTooManyRequests, "rate_limited", msg)
		return
	}
	defer release()

	conv := db.TeacherConversation{TeacherID: t.ID}
	if body.ConversationID != nil {
		id, ok := parseConvID(*body.ConversationID)
		if err := s.DB.First(&conv, "id = ? AND teacher_id = ?", id, t.ID).Error; !ok || err != nil {
			writeErr(w, http.StatusNotFound, "not_found", "conversación inexistente")
			return
		}
	} else if err := s.DB.Create(&conv).Error; err != nil {
		s.dbErr(w, err, "")
		return
	}
	var rows []db.ConversationMessage
	var subjects []db.Subject
	if err := parallel(
		func() (err error) { rows, err = loadHistory(s.DB, conv.ID); return err },
		func() (err error) { subjects, err = s.taught(t); return err },
	); err != nil {
		s.dbErr(w, err, "")
		return
	}
	history := make([]openai.ChatCompletionMessageParamUnion, len(rows))
	for i, m := range rows {
		if err := json.Unmarshal(m.Content, &history[i]); err != nil {
			s.dbErr(w, err, "")
			return
		}
	}

	parts := []openai.ChatCompletionContentPartUnionParam{openai.TextContentPart(
		s.teacherContext(t, subjects) + "\n\n<teacher_message>\n" + neutralize(body.Message) + "\n</teacher_message>")}
	if image != "" {
		parts = append(parts, openai.ImageContentPart(openai.ChatCompletionContentPartImageImageURLParam{URL: image}))
	}
	user := openai.UserMessage(parts)
	var turnTools []tutor.Tool
	for _, tool := range tutor.FCEIATools(s.FCEIA.List()) {
		if tool.Name != "build_schedule" { // timetables are for students
			turnTools = append(turnTools, tool)
		}
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	send := func(event string, data any) {
		b, _ := json.Marshal(data)
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, b)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}

	added, text, err := s.Tutor.TeacherTurn(r.Context(), history, user, turnTools, func(tool, message string) {
		send("status", map[string]string{"tool": tool, "message": message})
	})
	if err != nil {
		log.Printf("teacher chat: turn: %v", err)
		send("error", map[string]any{"error": map[string]string{"code": "tutor_unavailable", "message": "El asistente no está disponible ahora. Probá de nuevo en un rato."}})
		return
	}
	msgs, err := turnMessages(conv.ID, added, body.Message, text)
	if err == nil {
		err = s.DB.Create(&msgs).Error // one statement: all or nothing
	}
	if err != nil {
		log.Printf("teacher chat: saving turn: %v", err)
		send("error", map[string]any{"error": map[string]string{"code": "internal", "message": "No se pudo guardar la conversación."}})
		return
	}
	send("text", map[string]string{"delta": text})
	send("done", map[string]any{"conversation_id": formatConvID(conv.ID)})
}

// teacherContext is the per-turn context of the assistant: today's date, the
// teacher and the subjects they teach (no student data).
func (s *Server) teacherContext(t *db.Teacher, subjects []db.Subject) string {
	now := s.Now()
	c := fmt.Sprintf("<context>Hoy es %s %s. Docente: %s.", weekdays[now.Weekday()], now.Format(time.DateOnly), studentName(t.Name))
	if len(subjects) > 0 {
		if faculty := db.FacultyNames[subjects[0].Faculty]; faculty != "" {
			c += " Facultad: " + faculty + "."
		}
		names := make([]string, len(subjects))
		for i, m := range subjects {
			names[i] = fmt.Sprintf("%s (subject_id %d)", m.Name, m.ID)
		}
		c += " Materias que dicta: " + strings.Join(names, ", ") + "."
	}
	return c + "</context>"
}

func (s *Server) getTeacherConversation(w http.ResponseWriter, r *http.Request) {
	t, ok := s.ownTeacher(w, r)
	if !ok {
		return
	}
	id, ok := parseConvID(chi.URLParam(r, "conversation_id"))
	var conv db.TeacherConversation
	if err := s.DB.First(&conv, "id = ? AND teacher_id = ?", id, t.ID).Error; !ok || err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "conversación inexistente")
		return
	}
	var rows []db.ConversationMessage
	if err := s.DB.Order("id").Find(&rows, "conversation_id = ? AND text IS NOT NULL", conv.ID).Error; err != nil {
		s.dbErr(w, err, "")
		return
	}
	type message struct {
		Role      string    `json:"role"`
		Text      string    `json:"text"`
		CreatedAt time.Time `json:"created_at"`
	}
	out := []message{}
	for _, m := range rows {
		out = append(out, message{m.Role, *m.Text, m.CreatedAt})
	}
	writeJSON(w, http.StatusOK, map[string]any{"conversation_id": formatConvID(conv.ID), "messages": out})
}
