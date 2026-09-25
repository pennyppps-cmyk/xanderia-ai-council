-- Action Crew: who each task owner should work with (people from the staff directory only).
ALTER TABLE action_tasks ADD COLUMN collaborators jsonb NOT NULL DEFAULT '[]'::jsonb;
