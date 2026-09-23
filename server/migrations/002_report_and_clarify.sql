-- Analytics report + clarifying questions.

-- The verdict now carries risk ratings and a numeric schedule; give the Chairman room
-- (only if the admin has not already changed the seeded value).
UPDATE model_roles SET num_predict = 1600 WHERE role = 'chairman' AND num_predict = 1200;

-- An assistant message can be a set of clarifying questions instead of an answer.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_mode_check;
ALTER TABLE messages ADD CONSTRAINT messages_mode_check CHECK (mode IN ('quick', 'council', 'clarify'));
