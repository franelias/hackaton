package tutor

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"

	"github.com/franelias/hackaton/fceia/tools"
)

// fakeLLM returns scripted responses and records each request body.
type fakeLLM struct {
	responses []string
	requests  []string
}

func (f *fakeLLM) New(_ context.Context, body openai.ChatCompletionNewParams, _ ...option.RequestOption) (*openai.ChatCompletion, error) {
	b, _ := json.Marshal(body)
	f.requests = append(f.requests, string(b))
	var c openai.ChatCompletion
	err := json.Unmarshal([]byte(f.responses[0]), &c)
	f.responses = f.responses[1:]
	return &c, err
}

func toolCall(id, name, args string) string {
	b, _ := json.Marshal(args)
	return `{"choices":[{"index":0,"finish_reason":"tool_calls","message":{"role":"assistant","content":"","tool_calls":[{"id":"` + id + `","type":"function","function":{"name":"` + name + `","arguments":` + string(b) + `}}]}}]}`
}

func answer(text string) string {
	return `{"choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"` + text + `"}}]}`
}

// fakeFCEIA is one shared tool, "frequent_topics", that echoes its subject_id.
func fakeFCEIA() []tools.Tool {
	return []tools.Tool{{
		Name: "frequent_topics", Description: "topics", InputSchema: &jsonschema.Schema{Type: "object"},
		Call: func(_ context.Context, args json.RawMessage) (any, error) {
			var in struct {
				SubjectID int `json:"subject_id"`
			}
			json.Unmarshal(args, &in)
			return map[string]any{"subject_id": in.SubjectID, "topics": []string{"inducción"}}, nil
		},
	}}
}

func TestTurnRunsFCEIAAndLocalTools(t *testing.T) {
	ctx := context.Background()
	fceiaTools := FCEIATools(fakeFCEIA())
	if len(fceiaTools) != 1 || fceiaTools[0].Status != "Analizando los temas más tomados…" || fceiaTools[0].Parameters["type"] != "object" {
		t.Fatalf("FCEIATools = %+v", fceiaTools)
	}
	var recorded string
	local := Tool{Name: "record_progress", Status: "Registrando tu progreso…", Parameters: map[string]any{"type": "object"},
		Run: func(_ context.Context, args json.RawMessage) (string, bool) {
			recorded = string(args)
			return "ok", false
		}}

	llm := &fakeLLM{responses: []string{
		toolCall("c1", "frequent_topics", `{"subject_id":12}`),
		toolCall("c2", "record_progress", `{"type":"exercise"}`),
		toolCall("c3", "nope", `{}`),
		answer("Arranquemos por inducción."),
	}}
	tu := &Tutor{LLM: llm, Model: "anthropic/claude-sonnet-5.5"}
	var statuses []string
	added, text, err := tu.Turn(ctx, nil, openai.UserMessage("Preparame Lógica"), append(fceiaTools, local), func(tool, msg string) {
		statuses = append(statuses, tool+":"+msg)
	})
	if err != nil {
		t.Fatal(err)
	}
	if text != "Arranquemos por inducción." {
		t.Errorf("text = %q", text)
	}
	if want := "frequent_topics:Analizando los temas más tomados…,record_progress:Registrando tu progreso…"; strings.Join(statuses, ",") != want {
		t.Errorf("statuses = %v", statuses)
	}
	if recorded != `{"type":"exercise"}` {
		t.Errorf("local tool args = %q", recorded)
	}
	// user + 3 x (assistant tool call + tool result) + final assistant
	if len(added) != 8 {
		t.Fatalf("added %d messages, want 8", len(added))
	}
	// The tool result reaches the model as JSON, and an unknown tool is an error result.
	last := llm.requests[len(llm.requests)-1]
	for _, want := range []string{`{\"subject_id\":12,\"topics\":[\"inducción\"]}`, `ERROR: unknown tool nope`, `"tool_call_id":"c3"`} {
		if !strings.Contains(last, want) {
			t.Errorf("last request misses %s:\n%s", want, last)
		}
	}
	// The history round-trips through JSON (it is stored in Postgres).
	for _, m := range added {
		b, _ := json.Marshal(m)
		var back openai.ChatCompletionMessageParamUnion
		if err := json.Unmarshal(b, &back); err != nil {
			t.Fatal(err)
		}
		if b2, _ := json.Marshal(back); string(b2) != string(b) {
			t.Errorf("round trip changed %s -> %s", b, b2)
		}
	}
}

func TestTurnStopsRunawayLoops(t *testing.T) {
	var responses []string
	for range MaxToolRounds {
		responses = append(responses, toolCall("x", "nope", `{}`))
	}
	tu := &Tutor{LLM: &fakeLLM{responses: responses}, Model: "m"}
	if _, _, err := tu.Turn(context.Background(), nil, openai.UserMessage("hola"), nil, func(string, string) {}); err == nil {
		t.Fatal("want an error after MaxToolRounds")
	}
}

func TestFallbackModelsInRequestBody(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(answer("hola")))
	}))
	defer srv.Close()
	client := openai.NewClient(option.WithBaseURL(srv.URL), option.WithAPIKey("k"))
	tu := &Tutor{LLM: &client.Chat.Completions, Model: "anthropic/claude-sonnet-5.5", FallbackModels: []string{"openai/gpt-6-astra", "google/gemini-3.1-pro-preview"}}
	if _, text, err := tu.Turn(context.Background(), nil, openai.UserMessage("hola"), nil, func(string, string) {}); err != nil || text != "hola" {
		t.Fatal(text, err)
	}
	if body["model"] != "anthropic/claude-sonnet-5.5" || fmt.Sprint(body["models"]) != "[openai/gpt-6-astra google/gemini-3.1-pro-preview]" {
		t.Errorf("body model=%v models=%v", body["model"], body["models"])
	}
}

func TestTurnCapsToolCallsAndResults(t *testing.T) {
	// One round asks for more tools than MaxToolCalls; only the first ones run.
	var calls []string
	for i := range MaxToolCalls + 3 {
		calls = append(calls, fmt.Sprintf(`{"id":"c%d","type":"function","function":{"name":"big","arguments":"{}"}}`, i))
	}
	many := `{"choices":[{"index":0,"finish_reason":"tool_calls","message":{"role":"assistant","content":"","tool_calls":[` + strings.Join(calls, ",") + `]}}]}`
	llm := &fakeLLM{responses: []string{many, answer("listo")}}
	runs := 0
	big := Tool{Name: "big", Parameters: map[string]any{"type": "object"}, Run: func(context.Context, json.RawMessage) (string, bool) {
		runs++
		return strings.Repeat("ñ", MaxToolResult), false
	}}
	tu := &Tutor{LLM: llm, Model: "m"}
	added, _, err := tu.Turn(context.Background(), nil, openai.UserMessage("hola"), []Tool{big}, func(string, string) {})
	if err != nil {
		t.Fatal(err)
	}
	if runs != MaxToolCalls {
		t.Errorf("ran %d tools, want %d", runs, MaxToolCalls)
	}
	for _, m := range added {
		if m.OfTool == nil {
			continue
		}
		if s := m.OfTool.Content.OfString.Value; len(s) > MaxToolResult+len("…[truncated]") || !utf8.ValidString(s) {
			t.Fatalf("tool result of %d bytes, valid UTF-8 %v", len(s), utf8.ValidString(s))
		}
	}
	if !strings.Contains(llm.requests[1], "too many tool calls") || !strings.Contains(llm.requests[0], `"max_tokens":4096`) {
		t.Error("want the extra calls refused and max_tokens set")
	}
}
