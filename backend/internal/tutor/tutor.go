// Package tutor runs the AI tutor: one chat turn is a tool-calling loop over
// the MCP tools (FCEIA API) plus the backend's local tools. Models are called
// through Vercel AI Gateway with the OpenAI Chat Completions format, so the
// primary model and its fallbacks can come from any provider.
package tutor

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
)

// GatewayURL is the AI Gateway Chat Completions base URL.
const GatewayURL = "https://ai-gateway.vercel.sh/v1"

// MaxToolRounds caps the tool-calling loop of a single turn.
const MaxToolRounds = 12

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
	Model          string   // e.g. anthropic/claude-sonnet-5-5
	FallbackModels []string // tried in order by the gateway if Model fails
}

// NewGateway builds a Tutor that calls AI Gateway with apiKey.
func NewGateway(apiKey, model string, fallbacks []string) *Tutor {
	client := openai.NewClient(option.WithBaseURL(GatewayURL), option.WithAPIKey(apiKey))
	return &Tutor{LLM: &client.Chat.Completions, Model: model, FallbackModels: fallbacks}
}

// Turn sends the system prompt, history and the new user message, and runs the
// tools the model asks for until it answers. It returns the messages to append
// to the history (the user message first) and the answer text. status is
// called before each tool runs.
func (t *Tutor) Turn(ctx context.Context, history []openai.ChatCompletionMessageParamUnion, user openai.ChatCompletionMessageParamUnion, tools []Tool, status func(tool, message string)) ([]openai.ChatCompletionMessageParamUnion, string, error) {
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
	msgs := append([]openai.ChatCompletionMessageParamUnion{openai.SystemMessage(SystemPrompt)}, history...)
	msgs = append(msgs, user)
	added := []openai.ChatCompletionMessageParamUnion{user}

	var opts []option.RequestOption
	if len(t.FallbackModels) > 0 {
		opts = append(opts, option.WithJSONSet("providerOptions", map[string]any{"gateway": map[string]any{"models": t.FallbackModels}}))
	}

	for range MaxToolRounds {
		resp, err := t.LLM.New(ctx, openai.ChatCompletionNewParams{Model: t.Model, Messages: msgs, Tools: defs}, opts...)
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
			return added, msg.Content, nil
		}
		// Every tool call gets its own tool message, in order.
		for _, call := range msg.ToolCalls {
			out, isErr := "unknown tool "+call.Function.Name, true
			if tool, ok := byName[call.Function.Name]; ok {
				status(tool.Name, tool.Status)
				out, isErr = tool.Run(ctx, json.RawMessage(call.Function.Arguments))
			}
			if isErr {
				out = "ERROR: " + out
			}
			result := openai.ToolMessage(out, call.ID)
			msgs = append(msgs, result)
			added = append(added, result)
		}
	}
	return nil, "", errors.New("tutor: too many tool rounds")
}
