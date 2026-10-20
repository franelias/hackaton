# corrections

Manual-review layer over the FCEIA API (issue #5). One embedded JSON per career: `data/career_<id>.json`. The API is never modified; the backend (`plan_career_<id>.json`) and the MCP (`prerequisites`, `build_schedule`) both apply it, so they never disagree in front of a student.

## Commands

- Test: `go test ./...`
- Evidence and how to repeat the review: `../docs/revision-plan-lcc.md`

## Conventions

- Every entry carries a `note` citing the official source (plan resolution or the subject's 2024 program). Without a source it does not go in.
- `subjects` fixes `year`/`term` (absolute cuatrimestre 1..10) or turns a subject `elective`. `TermOfYear` turns the absolute term into 1 or 2 within the year.
- `add_prerequisites` / `remove_prerequisites` fix correlativas. `condition` is `approved` (default) or `regular`. List every correlativa the source gives: `Graph` reduces them to the direct ones (a correlativa implied by another one approved is dropped), for the plan and the tools alike.
- Unknown JSON fields, unknown subjects and removals of correlativas the API does not have are errors, so a typo never drops a correction silently.
- Used from `backend/` and `fceia/` through `replace github.com/franelias/hackaton/corrections => ../corrections`. Anything that builds a module needs the repository root as context (see the root `Dockerfile`).
