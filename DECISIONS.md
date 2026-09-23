# Decisions log

Assumptions made where HANDOFF.md is silent or leaves a choice open. Newest last.
The five open decisions in HANDOFF §12 are listed first, with the default this build
ships with. Each one is a setting or a config change, so none needs a code change.

## Open decisions from HANDOFF §12 (defaults, pending Andrew)

| # | Question | Default shipped | How to change |
|---|---|---|---|
| 1 | Fully local or hybrid cloud Chairman? | **Fully local.** The `cloud` provider row exists but is disabled, and every role uses `ollama`/`hermes3:8b`. | Admin → Model routing: enable `cloud`, set its URL and key env var, and point `chairman` at it. |
| 2 | Council for all employees or leads only? | **All employees.** | Admin → Settings → "Who can use Council mode". |
| 3 | SSO: Google or Microsoft? | Not built. `users.auth_provider` and `users.external_id` are ready, and login is isolated in `routes/auth.ts`. | Phase 3. |
| 4 | Which departments have documents ready? | The knowledge base works for `.txt/.md/.csv` today. PDF/DOCX/XLSX parsing is Phase 2. | Admin → Knowledge. |
| 5 | Same Proxmox host as VoxPro or a separate VM? | Nothing is host-specific. Compose uses its own named volumes, and host ports are configurable (`HTTP_PORT`, `HTTPS_PORT`, `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`). | `.env`. |

## Architecture

- **Monorepo with npm workspaces** (`server`, `web`) and one lockfile. Docker images build from the repo root.
- **Fastify 5 + TypeScript (ESM)** for the API. The worker is a separate process running the same image with a different command.
- **Plain SQL migrations** (`server/migrations/*.sql`) plus a tiny runner that holds an advisory lock. The API and worker both run migrate+seed on boot, and the locks serialise them.
- **Seed is insert-only.** It never overwrites something an admin has edited. Changing `seedData.ts` only affects fresh databases.
- **Secrets never go in the DB.** `providers.api_key_env` stores the *name* of an env var. `providers.base_url` may contain `${OLLAMA_BASE_URL}`, which is expanded at runtime, so `.env` remains the source of truth for the model host.

## Model layer

- **One `num_ctx` (16384) for every Hermes role**, the router included. If `num_ctx` differs between requests, Ollama reloads the model, which costs more than the smaller KV cache saves.
- **The GPU-slot limit lives in the worker, not in BullMQ.** A per-provider `PriorityGate` enforces `max_parallel` (= `OLLAMA_NUM_PARALLEL`) and serves Quick calls (priority 1) before Council calls (priority 10). BullMQ also prioritises Quick/Auto jobs, and runs up to `WORKER_CONCURRENCY` (6) jobs at once, so a Quick question is not stuck behind running councils waiting for a queue slot.
- **Router runs first for Auto and Council.** For an explicit Quick question on a local model, it runs in parallel with the answer, so time-to-first-token isn't delayed by classification. It still runs first if the `quick` role points at a cloud provider, because sensitivity must be known before anything leaves the premises.
- **The router always runs with `sensitivity: high`**, so it can never be routed to the cloud: it sees the raw message. The admin API also refuses to put `router` or `embedding` on a cloud provider.
- **PII guard (gateway):** for cloud-routed roles, an IC or account number anywhere in the prompt, or a router `sensitivity: high`, forces the local fallback model. Other PII (phones, emails, honorific-introduced names) is redacted. Regex PII detection can raise the router's sensitivity but never lower it.
- **Audit writes are not best-effort.** If the `model_call` audit row can't be written, the call fails ("All model calls appear in the audit log").
- **Structured output:** Zod schemas are the source of truth, converted with `z.toJSONSchema` (draft-7, `$schema` stripped) into Ollama's `format`. On failure, there's one retry with the validation error appended, then a plain-text fallback, which the UI labels.
- **The router's language answer is cross-checked.** Hermes 8B sometimes labels English text as `ms` because of Malay names ("Customer Ahmad…"). A small Malay function-word heuristic overrules it in either direction.
- **Chairman prompt forbids head-counting.** In testing, the Chairman resolved conflicts with "the majority view prevails" (HANDOFF §5.5). The persona and task prompt now require the specific argument, fact or risk that decides each conflict.
- **Advisors reason in English, and the Chairman writes in the user's language** (§5.5). Quick answers reply in the user's language.
- **Condensing for the Chairman** is proportional truncation of each opinion when the token estimate (chars/3.5) exceeds `num_ctx − num_predict − prompt − 1200`. It does not run an extra LLM summarisation round, which would cost another full council round on an 8B box.

## Council

- **Stage 2 is off by default** (§5.5). It can be toggled per request, or set as the default in Admin → Settings. With peer review on, a run takes about 3 minutes on an RTX 4060 laptop; without it, about 75–90 s.
- **Anonymisation:** labels A–F are shuffled per run. Reviewers see only labels, never persona names, and never their own answer. Scores are mapped back to advisor keys after the fact. The Chairman sees persona names, because it has to write "The Contrarian's concern…".
- **Knowledge goes only to the Department Expert** in council mode, which keeps the other advisors' context short. In Quick mode, the single advisor *is* the Department Expert.
- **A council survives one failed advisor**, but needs at least 2 opinions.
- **The selected department wins.** The router's department classification is stored and shown, but doesn't override the department the user picked.

## Knowledge / RAG

- **Retrieval scope = the user's own department + admin grants + company-wide**, whichever department they *ask*. "Ask another department" changes the advisor, not data access. Admins follow the same rule, and grant themselves access if needed.
- **Access is enforced in the SQL `WHERE` clause**, never by filtering results afterwards.
- **Distance cut-off 0.6 (cosine)**, and only sources the answer actually cites (`[S1]`…) are shown as citations.
- **`vector(768)` is fixed** to `nomic-embed-text`. Changing the embedding model means a new migration and re-embedding.
- Phase 1 upload accepts `.txt/.md/.csv`. `dept_lead`s manage their own department's library, and admins manage everything, including company-wide.

## Privacy & retention

- The audit log stores **who asked, a message reference and a SHA-256 of the text, not the text itself**. When a user deletes their history (a PDPA right), the content goes, but the audit trail stays intact.
- `audit_log` is append-only via a trigger (UPDATE, DELETE and TRUNCATE all raise). The nightly retention job is the only thing allowed to delete, using a transaction-local flag.
- Retention (default 12 months) deletes conversations by `updated_at`, and audit rows by `at`.

## Streaming

- **SSE per assistant message** plus a per-user SSE for "your council verdict is ready" notifications. Tokens are batched about every 60 ms, appended to a Redis key (TTL 1 h) and published with a JS-string offset. A client that (re)connects gets a snapshot including partial text, and uses offsets to drop overlap.
- The browser `Notification` permission is requested on the first click, not on page load.

## UI

- The mode toggle is **Auto / Quick / Council**. Auto is the default, and the router's suggestion is shown as a badge.
- Export to PDF uses the browser's print-to-PDF on the verdict element: no server-side PDF dependency.
- Share links and the "test this prompt" sandbox are Phase 2 and not built. Bilingual UI labels are not built (a v1 nice-to-have). Staff can already write in BM, and answers come back in BM.

## Connecting to a remote GPU box (RDP / Otto AI pattern)

- Otto AI reaches a self-hosted Ollama through `hermes-proxy.js`, which checks an `X-Hermes-Key` header, behind a tunnel. This build supports the same pattern: set `OLLAMA_BASE_URL` to the proxy/tunnel URL and `OLLAMA_API_KEY` to the shared secret. The header name is configurable via `OLLAMA_API_KEY_HEADER`.
- During the build, the Hermes tunnel hostname in `~/.cloudflared/config.yml` (`hermes.late-glade-1d66.workers.dev`) returned 404, and `aixan` (192.168.88.100) didn't respond from the dev laptop. Development and testing therefore used the laptop's local `hermes3:8b` via `host.docker.internal`.
