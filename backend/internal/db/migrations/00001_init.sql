-- +goose Up
-- Plan tables are keyed by (faculty, id): ids come from each faculty's data provider and may collide.
CREATE TABLE careers (
    faculty       text    NOT NULL,
    id            integer NOT NULL,
    name          text    NOT NULL,
    min_terms     integer NOT NULL,
    critical_path jsonb   NOT NULL DEFAULT '[]',
    PRIMARY KEY (faculty, id)
);

CREATE TABLE subjects (
    faculty             text    NOT NULL,
    id                  integer NOT NULL,
    career_id           integer NOT NULL,
    code                text    NOT NULL,
    name                text    NOT NULL,
    year                integer,
    term                integer,
    optional            boolean NOT NULL DEFAULT false,
    unlocks             jsonb   NOT NULL DEFAULT '[]',
    unlocks_total       integer NOT NULL DEFAULT 0,
    bottleneck          boolean NOT NULL DEFAULT false,
    slack               integer NOT NULL DEFAULT 0,
    postpone_year_delay integer NOT NULL DEFAULT 0,
    PRIMARY KEY (faculty, id),
    FOREIGN KEY (faculty, career_id) REFERENCES careers (faculty, id) ON DELETE CASCADE
);

CREATE TABLE prerequisites (
    faculty     text    NOT NULL,
    subject_id  integer NOT NULL,
    requires_id integer NOT NULL,
    condition   text    NOT NULL CHECK (condition IN ('approved', 'regular')),
    PRIMARY KEY (faculty, subject_id, requires_id),
    FOREIGN KEY (faculty, subject_id) REFERENCES subjects (faculty, id) ON DELETE CASCADE,
    FOREIGN KEY (faculty, requires_id) REFERENCES subjects (faculty, id) ON DELETE CASCADE
);

CREATE TABLE students (
    id           serial      PRIMARY KEY,
    firebase_uid text        NOT NULL UNIQUE,
    name         text        NOT NULL,
    faculty      text        NOT NULL,
    career_id    integer     NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (faculty, career_id) REFERENCES careers (faculty, id)
);

CREATE TABLE student_subjects (
    student_id integer NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    subject_id integer NOT NULL,
    state      text    NOT NULL CHECK (state IN ('approved', 'regular', 'enrolled')),
    PRIMARY KEY (student_id, subject_id)
);

CREATE TABLE activities (
    id         serial      PRIMARY KEY,
    student_id integer     NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    type       text        NOT NULL CHECK (type IN ('checkin', 'exercise', 'mock_exam', 'exam', 'chat')),
    subject_id integer,
    topic      text,
    result     jsonb,
    date       date,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_student_created ON activities (student_id, created_at);

-- +goose Down
DROP TABLE activities, student_subjects, students, prerequisites, subjects, careers;
