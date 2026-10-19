# fceia

Shared Go module with the read-only FCEIA tools, used by the MCP server (`../mcp`, served over MCP) and by the backend (`../backend`, in-process in the tutor and `POST /api/schedule`). Tool contract: `../docs/contratos.md` §3.

## Commands

- Test: `go test ./...` (parallel, no network). The tools are tested end to end through MCP in `../mcp/internal/tools`
- Vet: `go vet ./...`

## Layout

- `fceia` (root): HTTP client of the FCEIA API with a GET cache (`FCEIA_API_BASE`, default `DefaultBase`).
- `schedule`: pure timetable solver behind `build_schedule`.
- `tools`: the nine operations as plain functions. `Tools.List` describes them (name, description, JSON Schemas from the In/Out types via `jsonschema-go`, `Call` on raw JSON) for any tool-calling client. Errors carry a contract code (`Code`, `ErrorJSON`): `not_found | api_unavailable | invalid_argument`.

## Conventions

- Adding a tool here makes it appear both in the MCP server and in the tutor; add its status text in `../backend/internal/tutor/fceia.go`.
- `prerequisites`, `build_schedule` and bottleneck weights apply the manual review in `../corrections`.
