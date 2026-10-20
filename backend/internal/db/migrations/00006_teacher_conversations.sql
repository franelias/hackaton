-- +goose Up
-- A conversation belongs to a student (the tutor) or to a teacher (their
-- assistant, contract §2.6). Messages are shared: conversation_messages.
ALTER TABLE conversations
    ALTER COLUMN student_id DROP NOT NULL,
    ADD COLUMN teacher_id integer REFERENCES teachers (id) ON DELETE CASCADE,
    ADD CONSTRAINT conversations_owner CHECK ((student_id IS NULL) <> (teacher_id IS NULL));

-- +goose Down
DELETE FROM conversations WHERE teacher_id IS NOT NULL;
ALTER TABLE conversations
    DROP CONSTRAINT conversations_owner,
    DROP COLUMN teacher_id,
    ALTER COLUMN student_id SET NOT NULL;
