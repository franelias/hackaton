-- +goose Up
CREATE TABLE conversations (
    id              serial      PRIMARY KEY,
    student_id      integer     NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    -- Timed mock exam in progress, set by the start_mock_exam tool.
    mock_subject_id integer,
    mock_minutes    integer,
    mock_started_at timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- The model-facing history, append-only, in Chat Completions format. text is
-- what the student sees (null for tool calls and tool results).
CREATE TABLE conversation_messages (
    id              serial      PRIMARY KEY,
    conversation_id integer     NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    role            text        NOT NULL,
    content         jsonb       NOT NULL,
    text            text,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_messages_conv ON conversation_messages (conversation_id, id);

-- +goose Down
DROP TABLE conversation_messages, conversations;
