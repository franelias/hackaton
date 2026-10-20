package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/franelias/hackaton/backend/internal/db"
	"github.com/franelias/hackaton/backend/internal/tutor"
	"github.com/franelias/hackaton/fceia/mcpserver"
	"github.com/franelias/hackaton/fceia/tools"
)

// mcpTokenPrefix marks a personal MCP token, so a leaked one is recognizable.
const mcpTokenPrefix = "arb_"

// mcpPrompt is the tutor's system prompt for a student's own client. That
// client has no record_progress or start_mock_exam, so progress is never saved
// from there.
const mcpPrompt = tutor.SystemPrompt + `

## Cliente externo
Estás corriendo dentro del cliente del alumno (no en la app de Árbol), conectado por MCP. No tenés record_progress ni start_mock_exam: no guardes progreso ni arranques un simulacro con cronómetro. Si el alumno resuelve un ejercicio o rinde un simulacro, corregilo igual y decile que lo registre en la app para que cuente en su árbol. El contexto del alumno (nombre, fecha) no llega por mensaje: llamá view_my_tree.`

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// postMCPToken creates the student's MCP token, replacing the previous one.
// The token is shown only in this response.
func (s *Server) postMCPToken(w http.ResponseWriter, r *http.Request) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		s.dbErr(w, err, "")
		return
	}
	raw := mcpTokenPrefix + base64.RawURLEncoding.EncodeToString(buf)
	row := db.MCPToken{StudentID: studentFrom(r).ID, TokenHash: hashToken(raw)}
	err := s.DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "student_id"}},
		DoUpdates: clause.Assignments(map[string]any{"token_hash": row.TokenHash, "created_at": s.Now(), "last_used_at": nil}),
	}).Create(&row).Error
	if err != nil {
		s.dbErr(w, err, "")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"token": raw})
}

// deleteMCPToken revokes the student's MCP token (204 even if there was none).
func (s *Server) deleteMCPToken(w http.ResponseWriter, r *http.Request) {
	if err := s.DB.Delete(&db.MCPToken{}, "student_id = ?", studentFrom(r).ID).Error; err != nil {
		s.dbErr(w, err, "")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// MCPHandler serves /mcp: the FCEIA tools plus the student's own tree, for the
// student's own MCP client. Every request carries the personal token, and the
// server is stateless, so a session can't outlive a revoked token or be
// replayed by someone else. It is read-only: progress is only saved by the app.
func (s *Server) MCPHandler() http.Handler {
	h := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		return s.mcpServer(studentFrom(r))
	}, &mcp.StreamableHTTPOptions{Stateless: true})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || !strings.HasPrefix(raw, mcpTokenPrefix) {
			w.Header().Set("WWW-Authenticate", `Bearer realm="arbol"`)
			writeErr(w, http.StatusUnauthorized, "unauthorized", "falta el header Authorization: Bearer <token de Árbol>")
			return
		}
		var st db.Student
		err := s.DB.Joins("JOIN mcp_tokens t ON t.student_id = students.id AND t.token_hash = ?", hashToken(raw)).First(&st).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "token inválido o revocado")
			return
		}
		if err != nil {
			s.dbErr(w, err, "")
			return
		}
		s.DB.Model(&db.MCPToken{}).Where("student_id = ?", st.ID).Update("last_used_at", s.Now())
		h.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), studentKey, &st)))
	})
}

// mcpServer is the MCP server of one student.
func (s *Server) mcpServer(st *db.Student) *mcp.Server {
	srv := mcp.NewServer(&mcp.Implementation{Name: "arbol-mcp", Version: "0.1.0"}, nil)
	mcpserver.AddTools(srv, append(s.FCEIA.List(), tools.Tool{
		Name:        "view_my_tree",
		Description: "The student's tree: health, weekly streak, each subject with its state (approved, regular, enrolled, available; locked ones are omitted), leaves (exercises and sessions), flower (mock exam passed), the topics practiced (correct/attempts, mastered after 3 correct) and the open alerts. Call it at the start of every conversation.",
		InputSchema: &jsonschema.Schema{Type: "object"},
		Call: func(context.Context, json.RawMessage) (any, error) {
			out, isErr := s.viewTree(st)
			if isErr {
				return nil, errors.New(out)
			}
			return json.RawMessage(out), nil
		},
	}))
	srv.AddPrompt(&mcp.Prompt{
		Name:        "tutor",
		Title:       "Tutor de Árbol",
		Description: "Activa el tutor de Árbol: diagnostica con tu árbol, arma el plan y te toma ejercicios de parciales reales.",
	}, func(context.Context, *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
		return &mcp.GetPromptResult{Messages: []*mcp.PromptMessage{
			{Role: "user", Content: &mcp.TextContent{Text: mcpPrompt + "\n\nEmpezá llamando view_my_tree y saludame."}},
		}}, nil
	})
	return srv
}
