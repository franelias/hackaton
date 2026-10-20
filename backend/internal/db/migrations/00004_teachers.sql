-- +goose Up
-- Teachers are loaded by the backend (arbol teacher add, seed), never self-declared.
-- A user is a teacher when the verified email of their Firebase token matches.
CREATE TABLE teachers (
    id         serial      PRIMARY KEY,
    email      text        NOT NULL UNIQUE CHECK (email = lower(email)),
    name       text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- The subjects a teacher teaches. No foreign key to subjects, like
-- student_subjects: importing a plan replaces its subjects and would cascade.
CREATE TABLE teacher_subjects (
    teacher_id integer NOT NULL REFERENCES teachers (id) ON DELETE CASCADE,
    faculty    text    NOT NULL,
    subject_id integer NOT NULL,
    PRIMARY KEY (teacher_id, faculty, subject_id)
);

-- +goose Down
DROP TABLE teacher_subjects, teachers;
