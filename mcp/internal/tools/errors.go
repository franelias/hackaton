package tools

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/franelias/hackaton/mcp/internal/fceia"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Error codes from the shared contract (docs/contratos.md §0).
const (
	codeNotFound       = "not_found"
	codeAPIUnavailable = "api_unavailable"
	codeInvalidArg     = "invalid_argument"
)

type invalidArgument string

func (e invalidArgument) Error() string { return string(e) }

type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func errorResult(err error) *mcp.CallToolResult {
	code := codeAPIUnavailable
	var inv invalidArgument
	switch {
	case errors.As(err, &inv):
		code = codeInvalidArg
	case errors.Is(err, fceia.ErrNotFound):
		code = codeNotFound
	}
	b, _ := json.Marshal(errorBody{Error: errorDetail{Code: code, Message: err.Error()}})
	return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: string(b)}}}
}

// handle adapts a plain function to an SDK handler, reporting failures as
// {"error":{"code","message"}} tool errors instead of protocol errors.
func handle[In, Out any](f func(context.Context, In) (Out, error)) mcp.ToolHandlerFor[In, Out] {
	return func(ctx context.Context, _ *mcp.CallToolRequest, in In) (*mcp.CallToolResult, Out, error) {
		out, err := f(ctx, in)
		if err != nil {
			var zero Out
			return errorResult(err), zero, nil
		}
		return nil, out, nil
	}
}
