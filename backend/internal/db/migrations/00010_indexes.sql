-- +goose Up
-- The teacher view lists who is enrolled in a subject (subject_id, state);
-- the primary key starts with student_id and can't serve that.
CREATE INDEX student_subjects_subject_state ON student_subjects (subject_id, state);

-- A student's plan is loaded on every read of the tree (faculty, career_id).
CREATE INDEX subjects_career ON subjects (faculty, career_id);

-- Calendar periods are read with the plan, by faculty.
CREATE INDEX periods_faculty ON periods (faculty);

-- Reminders look a student's tokens up, and deleting a student cascades here.
CREATE INDEX push_tokens_student ON push_tokens (student_id);

-- The reminder run only scans students with a channel on.
CREATE INDEX students_notify ON students (id) WHERE notify_push OR notify_email;

-- Foreign keys that cascade on delete, so the cascade doesn't scan the table.
CREATE INDEX conversations_student ON conversations (student_id);
CREATE INDEX conversations_teacher ON conversations (teacher_id);
CREATE INDEX students_career ON students (faculty, career_id);
CREATE INDEX prerequisites_requires ON prerequisites (faculty, requires_id);

-- +goose Down
DROP INDEX prerequisites_requires, students_career, conversations_teacher, conversations_student,
    students_notify, push_tokens_student, periods_faculty, subjects_career, student_subjects_subject_state;
