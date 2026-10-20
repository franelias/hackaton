# backend

Go backend of Árbol: plan calculation (issue #3) and the HTTP API of `../docs/contratos.md` §1.1 and §2 (student state, #9). Chat (#7) and alerts (#10) go here too, and `arbol mcp` serves the FCEIA tools (`../fceia`) as an MCP server. Plan: `docs/plan.md` (Spanish).

## Commands

- Test: `go test ./...` (parallel, no network)
- Vet: `go vet ./...`
- Make: the root `Makefile` wraps everything (`make up`, `make up-seed`, `make test`, `make docker`…); `make` lists the targets
- CLI: one binary, `go run ./cmd/arbol <command>` (cobra), run from `backend/`. It loads `.env` first (`--env-file`; variables already set win), so no need to export it
- Everything at once: `go run ./cmd/arbol up [--seed] [--no-docker]` = `docker compose up -d` (Postgres on 5432, Firebase Auth Emulator on 9099) → wait for Postgres → migrate → import plan and periods → seed with `--seed` → serve. Re-running is safe: imports replace
- Regenerate the plan of a career from the real API: `arbol plan` (writes `data/plan_career_1.json`; flags `--career`, `--overrides` to try a review file instead of the embedded one, `--out`; `FCEIA_API_BASE` overrides the API)
- Migrate: `arbol migrate` (goose, SQL embedded from `internal/db/migrations/`)
- Load a plan into the database: `arbol import plan` (flags `--file`, `--faculty`); re-running replaces that career's plan
- Load calendar periods (recess, mesas): `arbol import periods` (`data/periods_fceia_2026.json`, read by hand from the official PDF)
- Demo students: `arbol seed` (re)creates Ana (`ana@arbol.demo`, lush, practicing Análisis I) and Beto (`beto@arbol.demo`, withered, dry Lógica branch, alerts) with dates relative to now; password `DEMO_PASSWORD` (default `arbol-demo`). Run it before each rehearsal; student ids change on every run. It also creates the demo teacher Laura Méndez (`docente@arbol.demo`, verified email, teaches Análisis I and Lógica) and 8 classmates without a Firebase account (uid `seed:<name>`) so the class view has students in every state
- Teacher assistant: `POST /api/teacher/chat` reuses the tutor (`tutor.TeacherTurn` with `TeacherPrompt`) and the FCEIA tools, without student data or `build_schedule`; conversations are `conversations` rows with `teacher_id` (`db.TeacherConversation`, migration 00008)
- Teachers: `arbol teacher add --email … --name … --subject 2 --subject 12` creates or updates a teacher and replaces their subjects (contract §2.6). Teachers are never self-declared
- FCEIA MCP server for external clients: `arbol mcp` (HTTP `/mcp` on `MCP_PORT`, default 8080) or `arbol mcp --stdio`; see `../fceia/AGENTS.md`
- Docker: one image for everything, built from the repository root: `docker build -t arbol .` (from `..`); `docker run arbol` serves the API, `docker run arbol mcp` the MCP server, and any other subcommand works the same (`migrate`, `import plan`…)
- Serve the API: `arbol serve` (`DATABASE_URL`, `PORT`, `FIREBASE_PROJECT_ID`, `FIREBASE_AUTH_EMULATOR_HOST`, `FCEIA_API_BASE`, `OPENROUTER_API_KEY`, `TUTOR_MODEL`, `TUTOR_FALLBACK_MODELS`); without the OpenRouter key `/api/chat` answers 503
- Reminders (push + mail, `internal/notify`): `arbol serve` sends them every `NOTIFY_INTERVAL` (default `1h`, `off` disables); `arbol notify [--any-hour] [--student s-002]` runs once. Mail goes to `SMTP_ADDR` (Mailpit from compose: SMTP `localhost:1025`, inbox http://localhost:8025) or is logged when unset; push needs `PUSH_PROVIDER=fcm` and real Firebase credentials. `APP_URL` is the base of the links
- Emulator ID token for curl: `curl -s -X POST 'http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake' -H 'Content-Type: application/json' -d '{"email":"x@arbol.dev","password":"secret123","returnSecureToken":true}'` → `idToken`

## Conventions

- `internal/plan` is pure: it takes already loaded subjects and correlativas (`plan.Build`) and knows nothing about HTTP. `plan.Generate` loads them from the FCEIA API.
- Manual-review layer (issue #5): the `../corrections` module (`corrections/data/career_<id>.json`), shared with the MCP. `plan.Generate` applies it on top of the API data, which is never modified.
- The plan JSON uses the field names of `docs/contratos.md` §2.1 (`subjects`, `unlocks_total`, `bottleneck`…). `requires`/`unlocks` hold only direct correlativas (`corrections.Graph`); the Tesina is a subject of the graph.
- Tests stub the FCEIA API at HTTP with responses recorded in `internal/plan/testdata/` and assert concrete numbers. Model and edge cases use small hand-made careers.
- Code and wire contract in English; docs prose in Spanish; student-facing messages in Spanish.
- `internal/tree` is pure too: it builds a student's tree (health, streak, leaves, flower) and the alert conditions from plan, subject states, activities and periods; days and weeks are Argentina civil time. `internal/api` loads from Postgres, calls it, syncs the `alerts` table and marks dry branches.
- `internal/course` is pure too: it summarizes the students enrolled in a subject for its teacher (`course.Build`: risk order, weekly activity, topics). `internal/api/teacher.go` loads them (their tree via `state`) and calls it.
- `tree.Nudges` (pure) decides the reminders sent outside the app: `streak_risk`, `wilting_soon`, `final_pending`, `subject_idle`, most urgent first. `internal/notify` sends at most `PerDay` per student per day, between `FromHour` and `ToHour` Argentina, and claims each `(student, kind, subject, cond_key)` in `notifications` before sending (released if no channel delivered). `student_subjects.since` only moves when the state changes (`db.UpsertSubjectStates`). `db.TreeInput` loads a student's `tree.Input` for both the API and the notifier.
- Plan tables are keyed by `(faculty, id)` (`db.Faculty` = `fceia` today) so other faculties can be added without id collisions.
- Auth: Firebase ID token in `Authorization: Bearer`; students are linked by `firebase_uid`, teachers by the token's verified email (`teachers.email`, lower case). `api.Verifier` is the seam for tests.
- Errors: `{"error":{"code","message"}}`, codes `invalid_argument | unauthorized | forbidden | not_found | conflict | rate_limited | tutor_unavailable | internal`.
- Tutor (`internal/tutor`): models go through OpenRouter in the OpenAI Chat Completions format (`openai-go`), so primary and fallback models can be from any provider (fallbacks in the `models` body field). One chat turn is a manual tool-calling loop over the shared FCEIA tools (`../fceia/tools`, the same ones the MCP server serves; the backend calls them in-process, not over MCP) plus local tools (`internal/api/tools.go`), which get the student from the request, never from the model. History is stored append-only as Chat Completions JSON in `conversation_messages`. `tutor.Completions` is the seam for tests (scripted fake + fake `tools.Tool`). `POST /api/schedule` calls `tools.BuildSchedule` directly.
- Tutor hardening: the server context goes in a `<context>` block and the student's text in `<student_message>` (`neutralize` breaks those tags in student input; the name is sanitized by `studentName`). Tool results and student text are data, never instructions (system prompt "Security"). Cost caps: `chatLimiter` (one turn at a time per student plus per-minute/hour/day quotas, in memory), `maxMessageRunes`, `maxHistory`, body limits (`limitBody`), and in `tutor` `MaxToolCalls`, `MaxToolResult`, `MaxTokens`. `record_progress` allows `maxRecordsPerTurn` and grades a mock exam only while one of that subject is running. Database errors are logged, never sent to the client or the model.
