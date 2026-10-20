// Package tutor runs the AI tutor: one chat turn is a tool-calling loop over
// the shared FCEIA tools (../fceia/tools, the same the MCP server serves) plus
// the backend's local tools. Models are called through OpenRouter with the
// OpenAI Chat Completions format, so the primary model and its fallbacks can
// come from any provider.
package tutor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
)

// OpenRouterURL is the OpenRouter Chat Completions base URL.
const OpenRouterURL = "https://openrouter.ai/api/v1"

// Limits of a single turn, so one message can't run up an unbounded bill.
const (
	MaxToolRounds = 12    // model calls of the tool-calling loop
	MaxToolCalls  = 24    // tool calls across all rounds
	MaxToolResult = 30000 // bytes of each tool result sent back to the model
	MaxTokens     = 8192  // tokens of each model answer, reasoning included
	// MaxTeacherTokens is MaxTokens for the teachers' assistant: an exam with its
	// answer key is much longer than a tutor reply.
	MaxTeacherTokens = 16384
	// MaxReasoning caps the model's thinking, so it never spends the whole
	// answer budget thinking and replies with nothing.
	MaxReasoning = 2048
)

// Completions is the Chat Completions API. *openai.ChatCompletionService
// implements it; tests use a scripted fake.
type Completions interface {
	New(ctx context.Context, body openai.ChatCompletionNewParams, opts ...option.RequestOption) (*openai.ChatCompletion, error)
}

// Tool is a tool the model can call during a turn.
type Tool struct {
	Name        string
	Description string
	Parameters  map[string]any // JSON Schema of the arguments
	// Status is shown to the student while the tool runs ("Buscando parciales…").
	Status string
	// Run returns the tool result text and whether it is an error.
	Run func(ctx context.Context, args json.RawMessage) (string, bool)
}

type Tutor struct {
	LLM            Completions
	Model          string   // e.g. anthropic/claude-sonnet-5.5
	FallbackModels []string // tried in order by OpenRouter if Model fails
}

// NewOpenRouter builds a Tutor that calls OpenRouter with apiKey.
func NewOpenRouter(apiKey, model string, fallbacks []string) *Tutor {
	client := openai.NewClient(option.WithBaseURL(OpenRouterURL), option.WithAPIKey(apiKey))
	return &Tutor{LLM: &client.Chat.Completions, Model: model, FallbackModels: fallbacks}
}

// Turn sends the system prompt, history and the new user message, and runs the
// tools the model asks for until it answers. It returns the messages to append
// to the history (the user message first) and the answer text. status is
// called before each tool runs.
func (t *Tutor) Turn(ctx context.Context, history []openai.ChatCompletionMessageParamUnion, user openai.ChatCompletionMessageParamUnion, tools []Tool, status func(tool, message string)) ([]openai.ChatCompletionMessageParamUnion, string, error) {
	return t.turn(ctx, SystemPrompt, MaxTokens, history, user, tools, status)
}

// TeacherTurn is Turn with the teacher assistant's prompt (contract §2.6).
func (t *Tutor) TeacherTurn(ctx context.Context, history []openai.ChatCompletionMessageParamUnion, user openai.ChatCompletionMessageParamUnion, tools []Tool, status func(tool, message string)) ([]openai.ChatCompletionMessageParamUnion, string, error) {
	return t.turn(ctx, TeacherPrompt, MaxTeacherTokens, history, user, tools, status)
}

func (t *Tutor) turn(ctx context.Context, system string, maxTokens int, history []openai.ChatCompletionMessageParamUnion, user openai.ChatCompletionMessageParamUnion, tools []Tool, status func(tool, message string)) ([]openai.ChatCompletionMessageParamUnion, string, error) {
	byName := map[string]Tool{}
	var defs []openai.ChatCompletionToolUnionParam
	for _, tool := range tools {
		byName[tool.Name] = tool
		defs = append(defs, openai.ChatCompletionFunctionTool(openai.FunctionDefinitionParam{
			Name:        tool.Name,
			Description: openai.String(tool.Description),
			Parameters:  tool.Parameters,
		}))
	}
	msgs := append([]openai.ChatCompletionMessageParamUnion{openai.SystemMessage(system)}, history...)
	msgs = append(msgs, user)
	added := []openai.ChatCompletionMessageParamUnion{user}

	opts := []option.RequestOption{option.WithJSONSet("reasoning", map[string]any{"max_tokens": MaxReasoning})}
	if len(t.FallbackModels) > 0 {
		opts = append(opts, option.WithJSONSet("models", t.FallbackModels))
	}

	calls := 0
	for range MaxToolRounds {
		resp, err := t.LLM.New(ctx, openai.ChatCompletionNewParams{Model: t.Model, Messages: msgs, Tools: defs, MaxTokens: openai.Int(int64(maxTokens))}, opts...)
		if err != nil {
			return nil, "", err
		}
		if len(resp.Choices) == 0 {
			return nil, "", errors.New("tutor: empty response")
		}
		msg := resp.Choices[0].Message
		msgs = append(msgs, msg.ToParam())
		added = append(added, msg.ToParam())
		if len(msg.ToolCalls) == 0 {
			// an empty answer (e.g. the budget went to reasoning) is not saved as a reply
			if strings.TrimSpace(msg.Content) == "" {
				return nil, "", fmt.Errorf("tutor: empty answer (finish_reason %s)", resp.Choices[0].FinishReason)
			}
			return added, msg.Content, nil
		}
		// Every tool call gets its own tool message, in order.
		for _, call := range msg.ToolCalls {
			calls++
			out, isErr := "unknown tool "+call.Function.Name, true
			if tool, ok := byName[call.Function.Name]; ok && calls <= MaxToolCalls {
				status(tool.Name, tool.Status)
				out, isErr = tool.Run(ctx, json.RawMessage(call.Function.Arguments))
			} else if ok {
				out = "too many tool calls in this turn; answer with what you have"
			}
			if isErr {
				out = "ERROR: " + out
			}
			out = truncate(out, MaxToolResult)
			result := openai.ToolMessage(out, call.ID)
			msgs = append(msgs, result)
			added = append(added, result)
		}
	}
	return nil, "", errors.New("tutor: too many tool rounds")
}

// truncate cuts s to at most n bytes on a rune boundary and says it was cut.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n] + "…[truncated]"
}
