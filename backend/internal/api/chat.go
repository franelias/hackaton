package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/openai/openai-go/v3"
	"gorm.io/gorm"

	"github.com/franelias/hackaton/backend/internal/db"
	"github.com/franelias/hackaton/backend/internal/tutor"
)

const maxImageBytes = 5 << 20

var weekdays = []string{"domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"}

// chat answers one student message with the tutor, streamed as SSE (contract §2.5).
func (s *Server) chat(w http.ResponseWriter, r *http.Request) {
	var body struct {
		StudentID      string  `json:"student_id"`
		Message        string  `json:"message"`
		ConversationID *string `json:"conversation_id"`
		ImageBase64    *string `json:"image_base64"`
	}
	if !decode(w, r, &body) {
		return
	}
	st, ok := s.owned(w, r, body.StudentID)
	if !ok {
		return
	}
	if strings.TrimSpace(body.Message) == "" && body.ImageBase64 == nil {
		writeErr(w, http.StatusBadRequest, "invalid_argument", "falta message")
		return
	}
	image, msg := imageURL(body.ImageBase64)
	if msg != "" {
		writeErr(w, http.StatusBadRequest, "invalid_argument", msg)
		return
	}
	if s.Tutor == nil {
		writeErr(w, http.StatusServiceUnavailable, "tutor_unavailable", "el tutor no está configurado (falta OPENROUTER_API_KEY)")
		return
	}

	conv := db.Conversation{StudentID: st.ID}
	if body.ConversationID != nil {
		id, ok := parseConvID(*body.ConversationID)
		if err := s.DB.First(&conv, "id = ? AND student_id = ?", id, st.ID).Error; !ok || err != nil {
			writeErr(w, http.StatusNotFound, "not_found", "conversación inexistente")
			return
		}
	} else if err := s.DB.Create(&conv).Error; err != nil {
		s.dbErr(w, err, "")
		return
	}
	var rows []db.ConversationMessage
	if err := s.DB.Order("id").Find(&rows, "conversation_id = ?", conv.ID).Error; err != nil {
		s.dbErr(w, err, "")
		return
	}
	// shortcut: the whole history is sent every turn; trim or summarize if conversations get long.
	history := make([]openai.ChatCompletionMessageParamUnion, len(rows))
	for i, m := range rows {
		if err := json.Unmarshal(m.Content, &history[i]); err != nil {
			s.dbErr(w, err, "")
			return
		}
	}

	parts := []openai.ChatCompletionContentPartUnionParam{openai.TextContentPart(s.turnContext(st, &conv) + "\n\n" + body.Message)}
	if image != "" {
		parts = append(parts, openai.ImageContentPart(openai.ChatCompletionContentPartImageImageURLParam{URL: image}))
	}
	user := openai.UserMessage(parts)

	ctx := r.Context()
	tools := s.localTools(st, &conv)
	if session, err := tutor.ConnectMCP(ctx, s.MCPURL); err != nil {
		log.Printf("chat: MCP unavailable, local tools only: %v", err)
	} else {
		defer session.Close()
		mcpTools, err := tutor.MCPTools(ctx, session)
		if err != nil {
			log.Printf("chat: listing MCP tools: %v", err)
		}
		tools = append(mcpTools, tools...)
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

	added, text, err := s.Tutor.Turn(ctx, history, user, tools, func(tool, message string) {
		send("status", map[string]string{"tool": tool, "message": message})
	})
	if err != nil {
		log.Printf("chat: tutor turn: %v", err)
		send("error", map[string]any{"error": map[string]string{"code": "tutor_unavailable", "message": "El tutor no está disponible ahora. Probá de nuevo en un rato."}})
		return
	}

	err = s.DB.Transaction(func(tx *gorm.DB) error {
		for i, m := range added {
			content, err := json.Marshal(m)
			if err != nil {
				return err
			}
			row := db.ConversationMessage{ConversationID: conv.ID, Role: *m.GetRole(), Content: content}
			switch i {
			case 0:
				row.Text = &body.Message
			case len(added) - 1:
				row.Text = &text
			}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
		}
		return tx.Create(&db.Activity{StudentID: st.ID, Type: "chat"}).Error
	})
	if err != nil {
		log.Printf("chat: saving turn: %v", err)
		send("error", map[string]any{"error": map[string]string{"code": "internal", "message": "No se pudo guardar la conversación."}})
		return
	}
	send("text", map[string]string{"delta": text})
	// Every chat message counts as activity, so the tree always changes.
	send("done", map[string]any{"tree_changed": true, "conversation_id": formatConvID(conv.ID)})
}

// turnContext is the per-turn context the model needs: today's date, the
// student and a mock exam in progress. It goes in the user message so the
// system prompt stays cacheable.
func (s *Server) turnContext(st *db.Student, conv *db.Conversation) string {
	now := s.Now()
	c := fmt.Sprintf("[Contexto: hoy es %s %s. Alumno: %s.", weekdays[now.Weekday()], now.Format(time.DateOnly), st.Name)
	if conv.MockStartedAt != nil && conv.MockSubjectID != nil && conv.MockMinutes != nil {
		var subj db.Subject
		s.DB.First(&subj, "faculty = ? AND id = ?", st.Faculty, *conv.MockSubjectID)
		c += fmt.Sprintf(" Simulacro en curso de %s: pasaron %d de %d minutos.", subj.Name, int(now.Sub(*conv.MockStartedAt).Minutes()), *conv.MockMinutes)
	}
	return c + "]"
}

// imageURL turns image_base64 (raw base64 or a data URL) into a data URL. It
// returns a message for the student when the image is invalid.
func imageURL(raw *string) (string, string) {
	if raw == nil || *raw == "" {
		return "", ""
	}
	data := *raw
	if _, rest, ok := strings.Cut(data, ";base64,"); ok && strings.HasPrefix(data, "data:") {
		data = rest
	}
	b, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return "", "image_base64 no es base64 válido"
	}
	if len(b) > maxImageBytes {
		return "", "la imagen supera los 5 MB"
	}
	mime := http.DetectContentType(b)
	if !strings.HasPrefix(mime, "image/") {
		return "", "image_base64 no es una imagen"
	}
	return "data:" + mime + ";base64," + data, ""
}

func (s *Server) getConversation(w http.ResponseWriter, r *http.Request) {
	st := studentFrom(r)
	id, ok := parseConvID(chi.URLParam(r, "conversation_id"))
	var conv db.Conversation
	if err := s.DB.First(&conv, "id = ? AND student_id = ?", id, st.ID).Error; !ok || err != nil {
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

// schedule passes the request to the MCP build_schedule tool (contract §2.4).
func (s *Server) schedule(w http.ResponseWriter, r *http.Request) {
	var body struct {
		StudentID  string `json:"student_id"`
		SubjectIDs []int  `json:"subject_ids"`
	}
	if !decode(w, r, &body) {
		return
	}
	st, ok := s.owned(w, r, body.StudentID)
	if !ok {
		return
	}
	// Send the student's approved and regular subjects so the tool checks correlativas.
	var states []db.StudentSubject
	if err := s.DB.Find(&states, "student_id = ? AND state IN ('approved', 'regular')", st.ID).Error; err != nil {
		s.dbErr(w, err, "")
		return
	}
	approved, regular := []int{}, []int{}
	for _, x := range states {
		if x.State == "approved" {
			approved = append(approved, x.SubjectID)
		} else {
			regular = append(regular, x.SubjectID)
		}
	}
	session, err := tutor.ConnectMCP(r.Context(), s.MCPURL)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "api_unavailable", "el servidor MCP no responde")
		return
	}
	defer session.Close()
	args, _ := json.Marshal(map[string]any{"subject_ids": body.SubjectIDs, "approved_subject_ids": approved, "regular_subject_ids": regular})
	out, isErr := tutor.CallMCP(r.Context(), session, "build_schedule", args)
	if isErr {
		var e struct {
			Error struct{ Code, Message string }
		}
		json.Unmarshal([]byte(out), &e)
		status := map[string]int{"invalid_argument": http.StatusBadRequest, "not_found": http.StatusNotFound}[e.Error.Code]
		if status == 0 {
			status, e.Error.Code, e.Error.Message = http.StatusBadGateway, "api_unavailable", out
		}
		writeErr(w, status, e.Error.Code, e.Error.Message)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(out))
}
