# fceia

Shared Go module with the read-only FCEIA tools over the FCEIA API (https://fceia-api.ariloc.ar/docs). The backend uses them in-process (tutor and `POST /api/schedule`) and serves them over MCP with `arbol mcp` (`../backend/cmd/arbol`). Tool contract: `../docs/contratos.md` §3.

## Commands

- Test (default suite, parallel, no network): `go test ./...`
- Live smoke test against the real API: `go test -tags live ./mcpserver`
- Vet: `go vet ./... && go vet -tags live ./...`
- Run the MCP server (from `../backend`): `go run ./cmd/arbol mcp` (Streamable HTTP at `/mcp` and `/health`, port `--port` / `MCP_PORT`, default 8080) or `go run ./cmd/arbol mcp --stdio`
- Add to Claude Code (from `../backend`): `claude mcp add fceia -- go run ./cmd/arbol mcp --stdio`
- Inspect (from `../backend`): `npx @modelcontextprotocol/inspector go run ./cmd/arbol mcp --stdio`

## Layout

- `fceia` (root): HTTP client of the FCEIA API with a GET cache (`FCEIA_API_BASE`, default `DefaultBase`).
- `schedule`: pure timetable solver behind `build_schedule`.
- `tools`: the nine operations as plain functions. `Tools.List` describes them (name, description, JSON Schemas from the In/Out types via `jsonschema-go`, `Call` on raw JSON) for any tool-calling client. Errors carry a contract code (`Code`, `ErrorJSON`): `not_found | api_unavailable | invalid_argument`.
- `mcpserver`: serves `tools` over MCP (official `modelcontextprotocol/go-sdk`), reporting errors as tool errors with `{"error":{"code","message"}}`.

## Conventions

- Adding a tool in `tools` makes it appear both in the MCP server and in the tutor; add its status text in `../backend/internal/tutor/fceia.go`.
- Tool names, parameters and fields are English; enum values coming from the API (`parcial`, `final`…) pass through. Empty results are empty lists, not errors.
- The API's `text=` filter is accent- and case-sensitive: match locally with `fold` (`tools/fold.go`) or send spelling variants.
- `prerequisites`, `build_schedule` and the bottleneck weights apply the manual review in `../corrections` (3 LCC correlativas are wrong in the API), via `tools/relations.go`.
- File URLs returned to clients are always absolute (`Client.AbsURL`).
- Tests enter through an in-memory MCP client (`mcpserver`) and stub the FCEIA API at HTTP with recorded JSON in `mcpserver/testdata/`.
