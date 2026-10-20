-- +goose Up
-- The Tesina is now a subject of the correlativa graph (issue #33), not a separate final goal.
ALTER TABLE careers DROP COLUMN final_goal;

-- +goose Down
ALTER TABLE careers ADD COLUMN final_goal jsonb;
