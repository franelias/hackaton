# backend

Go backend of Árbol. Today it only holds the plan calculation (issue #3); the chat, tree and alerts endpoints (#7, #9, #10) go here too.

## Commands

- Test: `go test ./...` (parallel, no network)
- Vet: `go vet ./...`
- Regenerate the plan of a career from the real API: `go run ./cmd/plan` (writes `data/plan_career_1.json`; flags `-career`, `-overrides`, `-out`; `FCEIA_API_BASE` overrides the API)

## Conventions

- `internal/plan` is pure: it takes already loaded subjects and correlativas (`plan.Build`) and knows nothing about HTTP. `plan.Generate` loads them from the FCEIA API.
- Manual-review layer (issue #5): `data/overrides/career_<id>.json`. It fixes year/term and adds or removes correlativas on top of the API, which is never modified. Unknown fields and references to missing subjects are errors.
- Tests stub the FCEIA API at HTTP with responses recorded in `internal/plan/testdata/` and assert concrete numbers. Model and edge cases use small hand-made careers.
