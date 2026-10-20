-- +goose Up
-- Personal access tokens for the student's own MCP client (Claude Desktop,
-- Claude Code). Only the SHA-256 of the token is stored; one per student, a new
-- one replaces the old.
CREATE TABLE mcp_tokens (
    student_id   integer     PRIMARY KEY REFERENCES students (id) ON DELETE CASCADE,
    token_hash   text        NOT NULL UNIQUE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz
);

-- +goose Down
DROP TABLE mcp_tokens;
