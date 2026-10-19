package tutor

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Status messages shown while each tool runs.
var statusText = map[string]string{
	"search_subject":   "Buscando la materia…",
	"frequent_topics":  "Analizando los temas más tomados…",
	"exercises":        "Buscando parciales…",
	"solution":         "Buscando la resolución…",
	"search_materials": "Buscando en los apuntes…",
	"bibliography":     "Buscando bibliografía…",
	"prerequisites":    "Revisando correlativas…",
	"dates":            "Revisando fechas…",
	"build_schedule":   "Armando horarios…",
}

// ConnectMCP opens a session with the FCEIA MCP server (Streamable HTTP).
func ConnectMCP(ctx context.Context, url string) (*mcp.ClientSession, error) {
	client := mcp.NewClient(&mcp.Implementation{Name: "arbol-backend", Version: "0.1.0"}, nil)
	return client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: url}, nil)
}

// MCPTools exposes every tool of an MCP session as a tutor Tool.
func MCPTools(ctx context.Context, session *mcp.ClientSession) ([]Tool, error) {
	res, err := session.ListTools(ctx, nil)
	if err != nil {
		return nil, err
	}
	var tools []Tool
	for _, t := range res.Tools {
		var schema map[string]any
		b, _ := json.Marshal(t.InputSchema)
		json.Unmarshal(b, &schema)
		status := statusText[t.Name]
		if status == "" {
			status = "Buscando…"
		}
		name := t.Name
		tools = append(tools, Tool{
			Name: name, Description: t.Description, Parameters: schema, Status: status,
			Run: func(ctx context.Context, args json.RawMessage) (string, bool) {
				return CallMCP(ctx, session, name, args)
			},
		})
	}
	return tools, nil
}

// CallMCP calls an MCP tool and returns its JSON result (structured content
// when present, else the text content) and whether it is an error.
func CallMCP(ctx context.Context, session *mcp.ClientSession, name string, args json.RawMessage) (string, bool) {
	if len(args) == 0 {
		args = json.RawMessage("{}")
	}
	res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		return err.Error(), true
	}
	if res.StructuredContent != nil && !res.IsError {
		b, err := json.Marshal(res.StructuredContent)
		if err == nil {
			return string(b), false
		}
	}
	var out strings.Builder
	for _, c := range res.Content {
		if t, ok := c.(*mcp.TextContent); ok {
			out.WriteString(t.Text)
		}
	}
	return out.String(), res.IsError
}
