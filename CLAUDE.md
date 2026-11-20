# Xanderia AI Council

Internal AI advisory chat for Xanderia Services: quick answers from a department's advisor, a council mode where six advisors
debate a plan, and an Action Crew that turns verdicts into actions. Runs on local models (Hermes 3 via Ollama) with optional
other providers. Setup and admin tasks in `README.md`; design decisions in `DECISIONS.md`; current state in `HANDOFF.md`.

## Layout

- npm workspaces: `server/` and `web/`.
- `server/`: Fastify + TypeScript API (`src/index.ts`) and a BullMQ worker (`src/worker.ts`) on Redis; SQL migrations in
  `server/migrations/`; tests in `server/test/` (Vitest).
- `web/`: the chat app (Vite + TypeScript), served by Caddy in production (`web/Caddyfile`).
- `docs/`: deployment guide, user guide and persona PDFs (built by the `build_*.py` scripts) and `docs/knowledge/` for advisors.
- `docker-compose.yml`, `backup.sh`, `update.sh`: production stack, backups and updates.

## Commands

- `npm run dev:api`, `npm run dev:worker`, `npm run dev:web` for development.
- `npm test`, `npm run typecheck`, `npm run build` from the root before committing.
- In `server/`: `npm run migrate`, `npm run seed`.

## Rules

- Secrets in `.env` only (template `.env.example`); never commit it, conversation exports or uploaded files.
- Personas and departments are data: follow README sections 2 to 5 to add or change them, not hard-coded logic.
- Record a significant design choice in `DECISIONS.md`, and update `HANDOFF.md` at the end of a piece of work.
- Advisors must answer from their knowledge files and say when they don't know.
