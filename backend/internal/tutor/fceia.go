package tutor

import (
	"context"
	"encoding/json"

	"github.com/franelias/hackaton/fceia/tools"
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

// FCEIATools exposes the shared FCEIA tools (../fceia/tools, the same ones
// the MCP server serves) as tutor Tools. Results and errors are JSON.
func FCEIATools(ts []tools.Tool) []Tool {
	var out []Tool
	for _, t := range ts {
		var schema map[string]any
		b, _ := json.Marshal(t.InputSchema)
		json.Unmarshal(b, &schema)
		status := statusText[t.Name]
		if status == "" {
			status = "Buscando…"
		}
		call := t.Call
		out = append(out, Tool{
			Name: t.Name, Description: t.Description, Parameters: schema, Status: status,
			Run: func(ctx context.Context, args json.RawMessage) (string, bool) {
				res, err := call(ctx, args)
				if err != nil {
					return tools.ErrorJSON(err), true
				}
				b, err := json.Marshal(res)
				if err != nil {
					return err.Error(), true
				}
				return string(b), false
			},
		})
	}
	return out
}
