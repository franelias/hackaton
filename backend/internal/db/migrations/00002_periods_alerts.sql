-- +goose Up
CREATE TABLE periods (
    id      serial PRIMARY KEY,
    faculty text   NOT NULL,
    kind    text   NOT NULL CHECK (kind IN ('recess', 'exams')),
    label   text   NOT NULL,
    starts  date   NOT NULL,
    ends    date   NOT NULL CHECK (ends >= starts)
);

-- One row per open or dismissed condition. A dismissed alert comes back only
-- when cond_key changes (a new inactivity level, another exam date).
CREATE TABLE alerts (
    id         serial      PRIMARY KEY,
    student_id integer     NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    type       text        NOT NULL,
    subject_id integer,
    level      text        NOT NULL CHECK (level IN ('low', 'medium', 'high')),
    message    text        NOT NULL,
    action     jsonb       NOT NULL,
    cond_key   text        NOT NULL,
    dismissed  boolean     NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (student_id, type, subject_id)
);

-- +goose Down
DROP TABLE alerts, periods;
