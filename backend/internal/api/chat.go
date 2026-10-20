package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/openai/openai-go/v3"
	"gorm.io/gorm"

	"github.com/franelias/hackaton/backend/internal/db"
	"github.com/franelias/hackaton/backend/internal/tutor"
	"github.com/franelias/hackaton/fceia/tools"
)

const (
	maxImageBytes   = 5 << 20
	maxMessageRunes = 8000
	// maxHistory is how many stored messages of the conversation go to the model.
	maxHistory = 40
)

// Image types every model behind OpenRouter accepts.
var imageTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true}

// promptTags matches the tags that separate server context from the user's
// text, so a student or a teacher (or their name) can't open or close one.
var promptTags = regexp.MustCompile(`(?i)<\s*/?\s*(context|student_message|teacher_message)\b`)

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
		writeErr(w, http.StatusServiceUnavailable, "tutor_unavailable", "el tutor no está configurado (falta OPENROUTER_API_KEY)")
		return
	}
	release, msg := s.chats.acquire(st.ID, s.Now())
	if msg != "" {
		writeErr(w, http.StatusTooManyRequests, "rate_limited", msg)
		return
	}
	defer release()

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
	rows = recent(rows, maxHistory)
	history := make([]openai.ChatCompletionMessageParamUnion, len(rows))
	for i, m := range rows {
		if err := json.Unmarshal(m.Content, &history[i]); err != nil {
			s.dbErr(w, err, "")
			return
		}
	}

	parts := []openai.ChatCompletionContentPartUnionParam{openai.TextContentPart(
		s.turnContext(st, &conv) + "\n\n<student_message>\n" + neutralize(body.Message) + "\n</student_message>")}
	if image != "" {
		parts = append(parts, openai.ImageContentPart(openai.ChatCompletionContentPartImageImageURLParam{URL: image}))
	}
	user := openai.UserMessage(parts)

	ctx := r.Context()
	turnTools := append(tutor.FCEIATools(s.FCEIA.List()), s.localTools(st, &conv)...)

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

	added, text, err := s.Tutor.Turn(ctx, history, user, turnTools, func(tool, message string) {
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
			// GetRole() is empty for constant roles until marshaled, so read it from the JSON.
			var role struct{ Role string }
			json.Unmarshal(content, &role)
			row := db.ConversationMessage{ConversationID: conv.ID, Role: role.Role, Content: content}
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
// student with their faculty and career, and a mock exam in progress. It goes
// in the user message so the system prompt stays cacheable and the same for
// every faculty, in a <context> block the student can't forge.
func (s *Server) turnContext(st *db.Student, conv *db.Conversation) string {
	now := s.Now()
	c := fmt.Sprintf("<context>Hoy es %s %s. Alumno: %s.", weekdays[now.Weekday()], now.Format(time.DateOnly), studentName(st.Name))
	if faculty := db.FacultyNames[st.Faculty]; faculty != "" {
		c += " Facultad: " + faculty + "."
	}
	var career db.Career
	if s.DB.First(&career, "faculty = ? AND id = ?", st.Faculty, st.CareerID).Error == nil {
		c += " Carrera: " + career.Name + "."
	}
	if conv.MockStartedAt != nil && conv.MockSubjectID != nil && conv.MockMinutes != nil {
		var subj db.Subject
		s.DB.First(&subj, "faculty = ? AND id = ?", st.Faculty, *conv.MockSubjectID)
		c += fmt.Sprintf(" Simulacro en curso de %s: pasaron %d de %d minutos.", subj.Name, int(now.Sub(*conv.MockStartedAt).Minutes()), *conv.MockMinutes)
	}
	return c + "</context>"
}

// neutralize breaks any of the promptTags in a student's or teacher's text.
func neutralize(s string) string {
	return promptTags.ReplaceAllStringFunc(s, func(m string) string { return "‹" + m[1:] })
}

// studentName is the student's name as it goes in the context: one short line
// with no brackets, since the student chose it.
func studentName(name string) string {
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || strings.ContainsRune("<>[]{}", r) {
			return ' '
		}
		return r
	}, name)
	name = strings.Join(strings.Fields(name), " ")
	if r := []rune(name); len(r) > 60 {
		name = string(r[:60])
	}
	return name
}

// recent keeps at most the last n messages, starting at a user message so no
// tool result is left without the assistant message that called it.
func recent(rows []db.ConversationMessage, n int) []db.ConversationMessage {
	if len(rows) <= n {
		return rows
	}
	for i := len(rows) - n; i < len(rows); i++ {
		if rows[i].Role == "user" {
			return rows[i:]
		}
	}
	return nil
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
	if !imageTypes[mime] {
		return "", "image_base64 tiene que ser una imagen PNG, JPEG, GIF o WebP"
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

// schedule runs the shared build_schedule tool for the student (contract §2.4).
func (s *Server) schedule(w http.ResponseWriter, r *http.Request) {
	var body struct {
		StudentID   string               `json:"student_id"`
		SubjectIDs  []int                `json:"subject_ids"`
		Preferences *tools.PreferencesIn `json:"preferences"`
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
	out, err := s.FCEIA.BuildSchedule(r.Context(), tools.BuildScheduleIn{
		SubjectIDs: body.SubjectIDs, ApprovedSubjectIDs: approved, RegularSubjectIDs: regular, Preferences: body.Preferences,
	})
	if err != nil {
		code := tools.Code(err)
		status := map[string]int{tools.CodeInvalidArg: http.StatusBadRequest, tools.CodeNotFound: http.StatusNotFound}[code]
		if status == 0 {
			status = http.StatusBadGateway
		}
		writeErr(w, status, code, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}
