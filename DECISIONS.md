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
| 4 | Which departments have documents ready? | The knowledge base accepts PDF, DOCX, XLSX, TXT, MD and CSV. | Admin → Knowledge. |
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
- Uploads: PDF, DOCX, XLSX, TXT, MD and CSV (see *Phase 2 gaps closed* below). `dept_lead`s manage their own department's library, and admins manage everything, including company-wide.

## Privacy & retention

- The audit log stores **who asked, a message reference and a SHA-256 of the text, not the text itself**. When a user deletes their history (a PDPA right), the content goes, but the audit trail stays intact.
- `audit_log` is append-only via a trigger (UPDATE, DELETE and TRUNCATE all raise). The nightly retention job is the only thing allowed to delete, using a transaction-local flag.
- Retention (default 12 months) deletes conversations by `updated_at`, and audit rows by `at`.

## Streaming

- **SSE per assistant message** plus a per-user SSE for "your council verdict is ready" notifications. Tokens are batched about every 60 ms, appended to a Redis key (TTL 1 h) and published with a JS-string offset. A client that (re)connects gets a snapshot including partial text, and uses offsets to drop overlap.
- The browser `Notification` permission is requested on the first click, not on page load.

## UI

- The mode toggle is **Auto / Quick / Council**. Auto is the default, and the router's suggestion is shown as a badge.
- ~~Export to PDF uses the browser's print-to-PDF.~~ Replaced by the server-generated analytics report (see below).
- Share links and the "test this prompt" sandbox are built (see below). Bilingual UI labels are not built (a v1 nice-to-have). Staff can already write in BM, and answers come back in BM.

## Connecting to a remote GPU box (RDP / Otto AI pattern)

- Otto AI reaches a self-hosted Ollama through `hermes-proxy.js`, which checks an `X-Hermes-Key` header, behind a tunnel. This build supports the same pattern: set `OLLAMA_BASE_URL` to the proxy/tunnel URL and `OLLAMA_API_KEY` to the shared secret. The header name is configurable via `OLLAMA_API_KEY_HEADER`.
- During the build, the Hermes tunnel hostname in `~/.cloudflared/config.yml` (`hermes.late-glade-1d66.workers.dev`) returned 404, and `aixan` (192.168.88.100) didn't respond from the dev laptop. Development and testing therefore used the laptop's local `hermes3:8b` via `host.docker.internal`.

## Analytics report, clarifying questions (2026-09-23)

- **Report PDF is generated on the server with pdfkit**, with charts drawn as vectors. There's no headless browser in the image. The Inter font comes from `@fontsource/inter`. Characters the font can't draw, such as emoji, are dropped rather than shown as boxes.
- **Advisors declare their own stance** on a `**Stance:** For / Conditional / Against, n/5` line, which is parsed into data. If the line is missing, the stance is inferred from the Position line.
- **The verdict schema requires risk likelihood/impact and `start_week`/`duration_weeks`.** Older verdicts without them still render: timeline weeks are parsed from the text, and the heat map says the ratings aren't available.
- **Clarifying questions run only before a council.** Quick mode is told to ask briefly or state its assumption instead. If the check itself fails it never blocks the council. After the user replies, the original question plus the Q&A is what the council considers (`options.effectiveQuestion`).
- **Shipped prompts upgrade themselves on deploy** if no admin has edited them (`created_by IS NULL`). An admin's edits are never overwritten.

## Action Crew (HANDOFF §14), 2026-09-24

Defaults chosen for the open decisions in §12:

| # | Decision | Default shipped |
|---|---|---|
| 6 | Email route | **`MAIL_PROVIDER=outbox`**: emails are recorded (Admin → Action Crew & email) but not sent. SMTP (works with a Workspace or M365 relay) and an n8n webhook are built in. Gmail API / Microsoft Graph OAuth are not built; with n8n they aren't needed. |
| 7 | Staff directory | **CSV import** in Admin → Staff directory (`name, position, department, email, manager_email`; re-import upserts by email). |
| 8 | Manager escalation | **On, after 3 working days overdue, and only after the requester approves each escalation.** It can be switched off, or the timing changed, in admin. |

- **All email goes through an outbox table.** A sender job runs every minute, but only in business hours (09:00–18:00 KL, Mon–Fri, not on listed holidays), and uses the configured provider. Emails queued outside hours wait. This gives one audit point, a visible history, and "no emails outside business hours" for free.
- **Approval is enforced in `queueTaskEmail`**, the only code path that creates task emails: it throws unless the task is approved and has a directory owner. Reminders only exist for tasks already sent, and escalation emails need an explicit requester decision.
- **Owners come only from the directory.** The Dispatcher is shown the list of real positions. Resolution is exact match, then "same department" as a tie-breaker, then a single close fuzzy match. Otherwise the requester chooses, or the task is left unassigned. The model never supplies a name or an email address.
- **One-click links open a confirm page** (GET), and the status only changes on the POST from that page. Otherwise corporate link scanners such as Outlook Safe Links, which fetch every URL in an email, would accept or complete tasks on the owner's behalf. That's one extra click, knowingly traded for safety.
- **Link tokens** are HMAC-signed (keyed from `JWT_SECRET`), expire after 45 days, and only authorise status changes on their own task.
- **Working days:** Sat–Sun weekend by default; Kedah, Kelantan and Terengganu can be set to Fri–Sat. Public holidays are entered by an admin, because movable Islamic, Chinese and Hindu holidays and state holidays can't be computed reliably.
- **The Herald gets no base prompt layer**, because the model echoed its `<document>` wording into emails. Greetings and sign-offs are stripped, since the template adds them. Every body and title is PII-scrubbed when drafted and again when the email is built.
- **The Runner runs at background priority** in the GPU gate, below Quick and Council. Its output is always a draft for the requester to approve, never sent anywhere.
- **Reassigning a launched task** sends it back to "draft" so the new owner's email is approved again.

## Phase 2 gaps closed (2026-09-24)

- **Knowledge uploads:** PDF (`unpdf`: text PDFs only; scans are rejected with a clear message, because OCR isn't included), Word .docx (`mammoth`, headings kept), and Excel .xlsx (`exceljs`, one section per sheet, max 2,000 rows per sheet). PDF pages become sections, so citations read "Document › Page 3".
- **Share links** are read-only, open only to signed-in colleagues, revocable, and every view is audited. Sharing is the owner's explicit choice, so this is consistent with PDPA handling of their own history.
- **Prompt sandbox** runs an unsaved draft through the same layers, model role and JSON schema as the real step, and reports schema validity. It runs in the API process, which has its own GPU gate separate from the worker's. That's acceptable for an admin-only tool.
- **Not built:** SSO (waiting on decision #3), bilingual UI labels (a v2 requirement), and the WhatsApp/email entry point via n8n (optional).

## Bahasa Malaysia UI and account invites (2026-09-24)

- **SSO not built:** Andrew is fine with staff having a separate Council password. Decision #3 is closed.
- **UI translation uses English strings as keys** (`tl('Save')`), with a Malay dictionary in `web/src/i18n.ms.ts`. Missing entries fall back to English, so a new screen never shows blank text. A codemod wrapped the existing JSX text and label attributes. Persona and department names use their stored `name_ms`.
- **The language choice is saved on the user's account** (`users.locale`) and follows them across devices. The login-page choice is kept in the browser and copied to the account at sign-in. Switching language re-renders the app.
- **Not translated:** AI output (it already follows the question's language), notification texts saved before a switch, the analytics PDF labels, and task emails. Task emails are written in the plan's language by the Herald; their fixed labels are English.
- **New users get an invite email** with a single-use link to set their own password (valid 7 days). **"Forgot password?"** sends a 1-hour reset link, and always answers the same whether or not the email exists.
- **Only a SHA-256 of each link token is stored.** Issuing a new link cancels older ones, and setting a password uses up all open links.
- **Account emails are bilingual** (English, then BM). They go through the same outbox and domain allowlist, but are sent **immediately**, not held for business hours.
- **While email isn't connected** (`MAIL_PROVIDER=outbox`) or the address is outside the allowed domains, the admin screen shows the link so the admin can pass it on. Admins can already set passwords, so this doesn't widen their access.

## Templates, decisions and safety seats (2026-09-24)

- **Templates are stored in the database** (`council_templates`), so admins can add more without a release. The client sends only the key. The server looks up the mode, task and persona, so a template can't be used to pick an arbitrary prompt.
- **The Compliance Officer is a seat, not a seventh advisor for everyone.** It joins only for the departments listed in `compliance_seat_departments`, to keep council time down elsewhere.
- **Red flags never block the answer.** Blocking would teach people to rephrase. The answer comes with a visible warning, and Compliance is told.
- **Outcome check-ins go to the person who recorded the decision**, at 30 and 60 days (per decision, `check_in_days`). Marking a decision dropped stops them.

## What-if, tools, digest and channels (2026-09-24)

- **What-if re-runs only the Contrarian and the Executor.** They're the two whose views move most with an assumption; the others' opinions are reused, marked "(original run)". This takes about 70 s against about 90–130 s for a full council on the dev laptop.
- **Word export is built with the `docx` library from the answer's Markdown.** It covers headings, lists, tables and bold/italic. It's meant for editing, not typesetting.
- **Calculators run in the browser.** Nothing is sent until the user chooses "Ask the council". The rebate calculator shows both Rule of 78 and straight-line and doesn't say which is legally required, because that depends on the product and regulator.
- **Arrears files are never stored.** They're parsed in memory, the audit log records only the file name, row count and the columns used, and only bucket/branch/product totals reach the model.
- **Digest emails contain counts only**, never question text. A head of department shouldn't be able to read what their team asked. Decisions and outcomes are named because they're already visible to the department in the register.
- **The heatmap uses the router's department as the "area".** No topic model is added, which keeps it cheap and explainable.
- **Telegram uses long polling from the worker**, not a webhook, so the server needs no public URL or open port. A Redis lock ensures one poller when several workers run. Telegram is a third-party cloud: the bot's help text and the link dialog both warn against sending customer data. The normal PII guard and audit still apply. Group chats are ignored.
- **Voice uses an OpenAI-compatible Whisper server inside the stack** (speaches, CPU image, `faster-whisper-small` by default). It handles BM and English with language auto-detection, because staff mix the two. Audio is not stored. A GPU image and a larger model (`medium`) improve BM accuracy if the RDP GPU box is used.
