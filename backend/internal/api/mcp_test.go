package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/franelias/hackaton/backend/internal/db"
	"github.com/franelias/hackaton/fceia"
	"github.com/franelias/hackaton/fceia/tools"
)

func TestMCPServerIsReadOnlyWithTutorPrompt(t *testing.T) {
	s := &Server{FCEIA: tools.New(fceia.New("http://invalid.test"), nil)}
	ct, st := mcp.NewInMemoryTransports()
	ctx := context.Background()
	ss, err := s.mcpServer(&db.Student{ID: 1}).Connect(ctx, st, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ss.Close()
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "test"}, nil).Connect(ctx, ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()

	list, err := cs.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, tool := range list.Tools {
		names = append(names, tool.Name)
	}
	if !slices.Contains(names, "view_my_tree") || !slices.Contains(names, "build_schedule") {
		t.Errorf("tools = %v, want view_my_tree and the FCEIA tools", names)
	}
	for _, write := range []string{"record_progress", "start_mock_exam"} {
		if slices.Contains(names, write) {
			t.Errorf("%s must not be exposed over MCP", write)
		}
	}
	p, err := cs.GetPrompt(ctx, &mcp.GetPromptParams{Name: "tutor"})
	if err != nil || len(p.Messages) != 1 {
		t.Fatalf("tutor prompt = %+v, %v", p, err)
	}
}

func TestMCPHandlerRejectsMissingToken(t *testing.T) {
	s := &Server{} // no DB: these requests must not reach it
	for _, auth := range []string{"", "Bearer ", "Bearer eyJ.firebase.idtoken", "Basic arb_x"} {
		req := httptest.NewRequest(http.MethodPost, "/mcp", nil)
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		rec := httptest.NewRecorder()
		s.MCPHandler().ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("Authorization %q: status %d, want 401", auth, rec.Code)
		}
	}
}

func TestHashToken(t *testing.T) {
	if hashToken("arb_a") == hashToken("arb_b") || hashToken("arb_a") != hashToken("arb_a") || len(hashToken("arb_a")) != 64 {
		t.Error("hashToken must be a stable 64-char digest")
	}
}
