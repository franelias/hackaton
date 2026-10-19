# fceia-mcp

Read-only MCP server over the FCEIA API (https://fceia-api.ariloc.ar/docs). Go, official `modelcontextprotocol/go-sdk`. Tool contract: `../docs/contratos.md` §3.

## Commands

- Test (default suite, parallel, no network): `go test ./...`
- Live smoke test against the real API: `go test -tags live ./internal/tools`
- Vet: `go vet ./... && go vet -tags live ./...`
- Run over HTTP (Streamable HTTP at `/mcp`, `/health`): `PORT=8080 go run ./cmd/fceia-mcp`
- Run over stdio: `go run ./cmd/fceia-mcp --stdio`
- Add to Claude Code: `claude mcp add fceia -- go run ./cmd/fceia-mcp --stdio` (from `mcp/`)
- Inspect: `npx @modelcontextprotocol/inspector go run ./cmd/fceia-mcp --stdio`
- Docker (from the repository root, the module needs `../corrections`): `docker build -f mcp/Dockerfile -t fceia-mcp . && docker run -p 8080:8080 fceia-mcp`

Config: `PORT` (default 8080), `FCEIA_API_BASE` (default `https://fceia-api.ariloc.ar/api/v1`).

## Conventions

- Tool names, parameters and fields are English; enum values coming from the API (`parcial`, `final`…) pass through.
- Errors are tool errors with `{"error":{"code","message"}}`, codes `not_found | api_unavailable | invalid_argument`. Empty results are empty lists, not errors.
- The API's `text=` filter is accent- and case-sensitive: match locally with `fold` (`internal/tools/fold.go`) or send spelling variants.
- `prerequisites`, `build_schedule` and the bottleneck weights apply the manual review in `../corrections` (3 LCC correlativas are wrong in the API), via `internal/tools/relations.go`.
- File URLs returned to clients are always absolute (`fceia.Client.AbsURL`).
- Tests enter through an in-memory MCP client and stub the FCEIA API at HTTP with recorded JSON in `internal/tools/testdata/`.
