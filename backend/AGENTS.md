# backend

Go backend of Árbol: plan calculation (issue #3) and the HTTP API of `../docs/contratos.md` §1.1 and §2 (student state, #9). Chat (#7) and alerts (#10) go here too. Plan: `docs/plan.md` (Spanish).

## Commands

- Test: `go test ./...` (parallel, no network)
- Vet: `go vet ./...`
- Regenerate the plan of a career from the real API: `go run ./cmd/plan` (writes `data/plan_career_1.json`; flags `-career`, `-overrides`, `-out`; `FCEIA_API_BASE` overrides the API)
- Local services: `docker compose up -d` (Postgres on 5432, Firebase Auth Emulator on 9099); `cp .env.example .env` and export it
- Migrate: `go run ./cmd/migrate` (goose, SQL in `internal/db/migrations/`)
- Load a plan into the database: `go run ./cmd/import-plan` (flags `-file`, `-faculty`); re-running replaces that career's plan
- Serve the API: `go run ./cmd/server` (`DATABASE_URL`, `PORT`, `FIREBASE_PROJECT_ID`, `FIREBASE_AUTH_EMULATOR_HOST`)
- Emulator ID token for curl: `curl -s -X POST 'http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake' -H 'Content-Type: application/json' -d '{"email":"x@arbol.dev","password":"secret123","returnSecureToken":true}'` → `idToken`

## Conventions

- `internal/plan` is pure: it takes already loaded subjects and correlativas (`plan.Build`) and knows nothing about HTTP. `plan.Generate` loads them from the FCEIA API.
- Manual-review layer (issue #5): `data/overrides/career_<id>.json`. It fixes year/term and adds or removes correlativas on top of the API, which is never modified. Unknown fields and references to missing subjects are errors.
- Tests stub the FCEIA API at HTTP with responses recorded in `internal/plan/testdata/` and assert concrete numbers. Model and edge cases use small hand-made careers.
- Code and wire contract in English; docs prose in Spanish; student-facing messages in Spanish.
- `internal/tree` is pure too: it builds a student's tree from plan, subject states and activities. `internal/api` loads from Postgres and calls it.
- Plan tables are keyed by `(faculty, id)` (`db.Faculty` = `fceia` today) so other faculties can be added without id collisions.
- Auth: Firebase ID token in `Authorization: Bearer`; students are linked by `firebase_uid`. `api.Verifier` is the seam for tests.
- Errors: `{"error":{"code","message"}}`, codes `invalid_argument | unauthorized | forbidden | not_found | conflict | internal`.
