-- +goose Up
ALTER TABLE students
    ADD COLUMN notify_push  boolean NOT NULL DEFAULT true,
    ADD COLUMN notify_email boolean NOT NULL DEFAULT true;

-- When the subject got its current state: a regular subject waiting for its
-- final for months, an enrolled one never studied. Existing rows start now.
ALTER TABLE student_subjects ADD COLUMN since timestamptz NOT NULL DEFAULT now();

-- FCM registration tokens, one per browser or device. A token moves to the
-- student that registers it last.
CREATE TABLE push_tokens (
    token      text        PRIMARY KEY,
    student_id integer     NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Reminders already sent (push and/or mail). A condition is sent once: the
-- unique key is claimed before sending.
CREATE TABLE notifications (
    id         serial      PRIMARY KEY,
    student_id integer     NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    kind       text        NOT NULL,
    subject_id integer,
    cond_key   text        NOT NULL,
    title      text        NOT NULL,
    body       text        NOT NULL,
    sent_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (student_id, kind, subject_id, cond_key)
);
CREATE INDEX notifications_student_sent ON notifications (student_id, sent_at);

-- +goose Down
DROP TABLE notifications, push_tokens;
ALTER TABLE student_subjects DROP COLUMN since;
ALTER TABLE students DROP COLUMN notify_push, DROP COLUMN notify_email;
