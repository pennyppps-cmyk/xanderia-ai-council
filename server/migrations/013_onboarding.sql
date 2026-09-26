-- Onboarding checklist: items tick themselves off from what people actually do; these columns only
-- track whether someone hid the card and how often they were reminded.
ALTER TABLE users
  ADD COLUMN onboarding_dismissed_at timestamptz,
  ADD COLUMN onboarding_welcomed_at  timestamptz,
  ADD COLUMN onboarding_reminders    integer NOT NULL DEFAULT 0,
  ADD COLUMN onboarding_reminded_at  timestamptz;
