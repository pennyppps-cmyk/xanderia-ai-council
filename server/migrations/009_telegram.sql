-- Telegram bot: one private chat per user, linked with a one-time code from the web app.
CREATE TABLE telegram_links (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  chat_id    bigint NOT NULL UNIQUE,
  username   text,
  linked_at  timestamptz NOT NULL DEFAULT now()
);
