-- +goose Up
-- The final's grade of an approved subject; any other state has none.
ALTER TABLE student_subjects ADD COLUMN grade smallint CHECK (grade BETWEEN 1 AND 10);

-- Failed finals (aplazos): they count in the average "con aplazos".
CREATE TABLE failed_exams (
    id         serial      PRIMARY KEY,
    student_id integer     NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    subject_id integer     NOT NULL,
    grade      smallint    NOT NULL CHECK (grade BETWEEN 1 AND 10),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX failed_exams_student ON failed_exams (student_id);

-- +goose Down
DROP TABLE failed_exams;
ALTER TABLE student_subjects DROP COLUMN grade;
