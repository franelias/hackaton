// Package mcpserver serves the shared FCEIA tools (../tools) over MCP.
package mcpserver

import (
	"context"
	"encoding/json"
	"time"

	"github.com/franelias/hackaton/fceia"
	"github.com/franelias/hackaton/fceia/tools"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// NewServer registers the nine read-only tools. A nil now uses time.Now.
func NewServer(api *fceia.Client, now func() time.Time) *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{Name: "fceia-mcp", Version: "0.1.0"}, nil)
	AddTools(s, tools.New(api, now).List())
	return s
}

// AddTools registers tools on s, for servers that add their own next to the
// FCEIA ones.
func AddTools(s *mcp.Server, ts []tools.Tool) {
	for _, t := range ts {
		mt := &mcp.Tool{Name: t.Name, Description: t.Description, InputSchema: t.InputSchema}
		if t.OutputSchema != nil { // a nil *Schema in the interface field is not nil
			mt.OutputSchema = t.OutputSchema
		}
		s.AddTool(mt, handle(t))
	}
}

// handle runs a tool, reporting failures as {"error":{"code","message"}} tool
// errors instead of protocol errors.
func handle(t tools.Tool) mcp.ToolHandler {
	return func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		out, err := t.Call(ctx, req.Params.Arguments)
		if err != nil {
			return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: tools.ErrorJSON(err)}}}, nil
		}
		b, err := json.Marshal(out)
		if err != nil {
			return nil, err
		}
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(b)}}, StructuredContent: json.RawMessage(b)}, nil
	}
}
