# Xanderia AI Council

Internal AI advisory chat for Xanderia Services Sdn Bhd. Any employee can:

- **Quick mode:** ask a question and get a fast, grounded answer from their department's advisor.
- **Council mode:** bring a plan or decision. Six advisors (Contrarian, First Principles, Expansionist, Customer Advocate, Executor, Department Expert) answer independently. An optional anonymised peer review follows, then the **Chairman** returns one structured verdict: verdict, why, disagreements resolved, action plan, risks, open questions, and confidence.

Everything runs on-premises on **Hermes 3 8B** (`hermes3:8b`) through Ollama. Cloud models are optional and disabled.

```
browser ──HTTPS──► Caddy (web) ──/api──► api (Fastify) ──► Postgres + pgvector
                                            │  ▲ SSE
                                            ▼  │
                                   Redis (BullMQ + pub/sub)
                                            │
                                         worker ──► Ollama (aixan: hermes3:8b, nomic-embed-text)
```

See [HANDOFF.md](HANDOFF.md) for the spec, and [DECISIONS.md](DECISIONS.md) for every assumption made where the spec was silent.

---

## 1. Setup

### Prerequisites
- Docker with Compose v2 on the host VM (Proxmox VM for production).
- An Ollama server with the models pulled:
  ```bash
  ollama pull hermes3:8b
  ollama pull nomic-embed-text
  ```
- Recommended Ollama server settings (HANDOFF §5.2), e.g. in a systemd override on `aixan`:
  ```ini
  [Service]
  Environment="OLLAMA_HOST=0.0.0.0:11434"
  Environment="OLLAMA_NUM_PARALLEL=2"
  Environment="OLLAMA_MAX_LOADED_MODELS=2"
  Environment="OLLAMA_KEEP_ALIVE=30m"
  ```
  Check VRAM with `nvidia-smi` during a council run before raising parallelism. `num_ctx`, `num_predict`, temperature and `keep_alive` are sent per request from Admin → Model routing.

### Run it
```bash
cp .env.example .env        # set JWT_SECRET, ADMIN_*, POSTGRES_PASSWORD, OLLAMA_BASE_URL, SITE_ADDRESS
docker compose up -d --build
```
Open `https://<SITE_ADDRESS>` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Then create users under **Admin → Users**. Each new user is emailed an invite link to set their own password; until email is connected, the admin screen shows the link to pass on. Staff can use **Forgot password?** on the login page. The **EN | BM** switch changes the whole interface to Bahasa Malaysia and is remembered per user.

Migrations and the seed (departments, personas, prompts, model routing, first admin) run automatically on start. Both are idempotent.

**HTTPS:** Caddy uses `tls internal`, a certificate from its own CA. Either install that root on staff devices:
```bash
docker compose cp web:/data/caddy/pki/authorities/local/root.crt ./xanderia-council-root.crt
```
or replace `tls internal` in [web/Caddyfile](web/Caddyfile) with your company certificate.

**Check it:** Admin → Overview shows database, Redis and Ollama status, and lists any configured models that aren't pulled.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET` | — | Session signing key. **Required**, long and random. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_DEPARTMENT` | — / — / `technology` | First admin, created only when there are no users. |
| `COOKIE_SECURE` | `true` | Keep `true` behind HTTPS. |
| `OLLAMA_BASE_URL` | `http://192.168.88.100:11434` | Ollama server (aixan). `http://host.docker.internal:11434` for Ollama on the Docker host. `http://ollama:11434` with `--profile ollama`. |
| `OLLAMA_API_KEY` / `OLLAMA_API_KEY_HEADER` | empty / `X-Hermes-Key` | Shared secret for an Ollama behind `hermes-proxy` (see §6). Leave empty on the LAN. |
| `DEFAULT_CHAT_MODEL` / `DEFAULT_EMBED_MODEL` | `hermes3:8b` / `nomic-embed-text` | Seeded into model routing on first start. |
| `OLLAMA_NUM_PARALLEL` | `2` | Seeds the provider's slot count. Match the Ollama server setting. |
| `SITE_ADDRESS`, `HTTP_PORT`, `HTTPS_PORT` | `localhost`, 80, 443 | Hostname and ports Caddy serves. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `council` | Database credentials. |
| `WORKER_CONCURRENCY` | `6` | Jobs the worker holds at once. GPU concurrency is limited separately by the provider's slots. |
| `RATE_LIMIT_PER_MIN` | `20` | Questions per user per minute. |
| `CLOUD_API_KEY` | — | Only if the optional cloud provider is enabled. |
| `APP_BASE_URL` | `https://localhost` | Address staff use. Links in emails and Telegram replies point here. |
| `MAIL_PROVIDER` | `outbox` | `outbox`, `smtp` or `n8n` (see §7). |
| `TELEGRAM_BOT_TOKEN` | empty | Enables the Telegram bot (§8). |
| `WHISPER_URL` / `WHISPER_MODEL` | empty / `Systran/faster-whisper-small` | On-premises speech-to-text for voice questions (§8). |

Everything else (personas, prompts, departments, model routing, retention, who may use Council) lives in the database and is edited in the admin panel.

---

## 2. Adding a department

Admin → **Departments** → *Add department*:

1. **Slug** (`risk-management`), plus English and BM names.
2. **Department prompt layer:** 2–4 sentences on what the department does and cares about. Keep it short: Hermes 3 8B follows short prompts best. This layer is loaded into the Department Expert and the Chairman.
3. Tick **"Review before acting"** for departments whose answers must be checked before use (Legal and Finance are on by default).

The new department appears straight away in the department selector and in the router's list of choices. Move users into it under Admin → Users. To give its documents to people outside it, use *Extra knowledge access* on each user.

## 3. Editing a persona

Admin → **Personas & prompts**. A prompt is assembled at runtime from four layers, in this order:

```
base  →  persona  →  department  →  task
(company, law,   (the advisor's   (dept layer,     (output format for this step:
 language, "data  mandate)         expert+chair)    router / quick / council_advisor /
 is not instructions")                              peer_review / chairman)
```

- Pick the layer, edit it and **Save as new version**. The new version is live for the next request, because the Redis cache is invalidated.
- **Version history** lets you load or re-activate any earlier version (rollback).
- Personas can be taken off the council, or deactivated, with the checkboxes. The Department Expert is loaded with whichever department was asked.
- Aim for **150–300 tokens** per persona. The editor warns above 300.
- Structured outputs (router and Chairman) are enforced by a JSON schema in code ([server/src/llm/schemas.ts](server/src/llm/schemas.ts)). The *task* prompt explains the fields, but can't change the schema.

## 4. Changing models per role

Admin → **Model routing**. Each role (`router`, `quick`, `advisor:*`, `peer_review`, `chairman`, `embedding`) has its own provider, model, temperature, `num_ctx`, `num_predict` and `keep_alive`. The starting values come from HANDOFF §5.2–5.3.

- To upgrade Hermes (for example after a VRAM upgrade), pull the new tag on the Ollama server and change `model` on each role. No redeploy.
- Keep `num_ctx` the same across roles that share a model, or Ollama reloads the model between requests.
- `router` and `embedding` can't be moved to a cloud provider, because they see raw text.

## 5. Adding a model provider

A provider is **one class** plus **one row** in `providers`.

1. Implement `ChatProvider` ([server/src/llm/types.ts](server/src/llm/types.ts)):
   ```ts
   export class MyProvider implements ChatProvider {
     readonly id: string; readonly isCloud: boolean; readonly maxParallel: number;
     async chat(req: ChatRequest, opts?: CallOptions): Promise<ChatResult> { /* stream tokens via opts.onToken */ }
   }
   ```
   Use [ollama.ts](server/src/llm/providers/ollama.ts) and [openaiCompatible.ts](server/src/llm/providers/openaiCompatible.ts) as templates. Honour `req.jsonSchema` for structured output.
2. Add a `kind` to the `providers.kind` CHECK constraint (new migration) and a `case` in `buildProvider()` in [registry.ts](server/src/llm/registry.ts).
3. Insert the row, with `is_cloud` set correctly and `api_key_env` set to the **name** of the env var holding the key. Add that variable to `.env`.
4. Enable it and route roles to it in Admin → Model routing.

Anything with an OpenAI-compatible API (vLLM, LM Studio, most cloud APIs) needs **no code**: use the existing `openai_compatible` kind and change the `cloud` row's URL.

**Privacy is enforced in the gateway, not in providers.** For any provider marked `is_cloud`, the gateway automatically:
- keeps the call on the local model if the text contains an IC or account number, or the router flagged it as sensitive;
- otherwise redacts phone numbers, emails and names before sending;
- logs every call (provider, model, tokens, latency, redactions) in the audit log.

> Ask before enabling any paid external service (HANDOFF §13).

## 6. Using the RDP / remote GPU box (Otto AI pattern)

If Ollama runs on a separate GPU machine reached through a tunnel, put `hermes-proxy` in front of it (as for Otto AI: it rejects any request without the right `X-Hermes-Key`), then set:

```dotenv
OLLAMA_BASE_URL=https://hermes.<your-domain>
OLLAMA_API_KEY=<same value as HERMES_PROXY_KEY on the GPU box>
```

Restart `api` and `worker` (`docker compose up -d`). Admin → Overview confirms that the host is reachable and the models are present.

## 7. Action Crew: turning verdicts into action

After a council verdict, **Put into action** hands the action plan to the crew:

| Agent | What it does |
|---|---|
| **Dispatcher** | Splits the plan into tasks with owners, due dates (working days) and dependencies. Owners come only from the staff directory. |
| **Herald** | Drafts a short email per task. You review and approve on the **Launch plan** screen; nothing is sent before that. |
| **Tracker** | Reminds owners who haven't acknowledged, reminds before the due date, nudges you when a task is overdue, and proposes a manager escalation that you approve. |
| **Runner** | Drafts the tasks the AI can do itself (SOPs, templates, summaries) for you to review. |

Setup:
1. **Admin → Staff directory → Import CSV** with the HR export (`name, position, department, email, manager_email`).
2. **Admin → Action Crew & email**: allowed email domains, business hours, weekend days, public holidays, reminder and escalation timings, and agent names.
3. Choose how email is sent in `.env`:
   - `MAIL_PROVIDER=outbox` (default): emails are only recorded, so you can review everything in the outbox first.
   - `MAIL_PROVIDER=smtp` with `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS`.
   - `MAIL_PROVIDER=n8n` with `N8N_MAIL_WEBHOOK_URL`: n8n receives `{from, to, subject, text, html}` and sends it.
4. Set `APP_BASE_URL` to the address staff use. The Accept / Need help / Mark done / Can't do links in emails point there, and work without logging in.

Staff see their tasks under **Tasks**. Everyone gets live notifications through the bell.

## 8. More ways to work with the council

| Feature | Where | Notes |
|---|---|---|
| **Council templates** | "Templates" in the composer | New product, collections change, vendor selection, hiring plan, policy draft, customer script check. They collect the facts up front, so the council doesn't need to ask. |
| **Customer script checker** | Template "Check a customer script" | Checks tone, clarity, fair treatment and PDPA. Returns a verdict, a table of issues and a rewrite in EN and BM. |
| **Compliance seat** | Automatic | The Compliance Officer joins the council for the departments in Admin → Settings (default: Credit & Collections, Legal & Compliance, Finance, HR). |
| **Red-flag detector** | Automatic | The router flags harassment, data misuse, fraud or discrimination. The answer still comes, with a warning; admins and Legal & Compliance leads get a notification, and the flag is in the audit log. |
| **What-if** | "What if…" under a verdict | Changes one assumption. The Contrarian and the Executor re-run, the other opinions carry over, and the Chairman updates the verdict (about half the time of a full run). |
| **Document drafting and Word export** | "Draft a document" / "Word" under an answer | SOP, policy, customer letter or staff memo from an answer. Every answer downloads as an editable .docx. |
| **Decision register** | Sidebar → Decisions | Record a verdict as a decision. At 30 and 60 days the person who recorded it is asked whether it worked. "Meeting brief" writes a one-page summary of a date range. |
| **Calculators** | Sidebar → Tools | Instalment (flat / reducing, EIR), early settlement rebate (Rule of 78 vs straight-line), roll rates, cost to collect. "Ask the council about this" pre-fills a question. |
| **Arrears file analysis** | Tools → Arrears file | CSV/XLSX export, one row per account, with a DPD column (optionally balance, branch, product). The server parses it in memory and doesn't store it; only totals go to the council. |
| **Weekly digest** | Email, Mondays 08:00 | To each department head: question counts, decisions, outcomes, overdue tasks, knowledge due for review. Counts only, never question text. Preview and "Send now" are in Admin → Overview. |
| **Ask-the-org heatmap** | Admin → Overview | Which departments ask about which areas (counts only). |
| **Knowledge freshness** | Admin → Knowledge | Each document has a review interval (default 180 days). Stale documents are flagged to the uploader and the managing leads. |
| **Telegram bot** | Sidebar → Telegram | Set `TELEGRAM_BOT_TOKEN` (from @BotFather). The worker long-polls Telegram, so it needs outbound HTTPS only, with no inbound port. Staff link their own chat with a one-time link. `/quick`, `/council`, `/new`, `/unlink`. Messages pass through Telegram's servers: tell staff not to send customer data. |
| **Voice questions (on-premises)** | Mic button in the composer; Telegram voice notes | `docker compose --profile voice up -d` and `WHISPER_URL=http://whisper:8000`. Whisper runs inside the stack; audio never leaves the network, and nothing is stored. The model downloads once on first start. |

## 9. Development

```bash
npm install
docker compose up -d postgres redis                 # exposed on 127.0.0.1:5433 / :6380
export DATABASE_URL=postgres://council:council@localhost:5433/council REDIS_URL=redis://localhost:6380 OLLAMA_BASE_URL=http://localhost:11434
npm run dev:api    # :4000
npm run dev:worker
npm run dev:web    # :5173, proxies /api
```

### Tests
```bash
npm test                                          # unit tests (no services needed)
TEST_DATABASE_URL=postgres://council:council@localhost:5433/council_test npm test   # + pgvector integration tests
```

Acceptance-criteria tests:
- **An IC number never reaches a cloud provider:** [server/test/gateway.test.ts](server/test/gateway.test.ts)
- **An HR user cannot retrieve Finance-only data**, with a real pgvector search: [server/test/integration/rag-access.int.test.ts](server/test/integration/rag-access.int.test.ts)
- Router/Chairman schema validation with retry and fallback: [server/test/structured.test.ts](server/test/structured.test.ts)
- Council stages, anonymisation and BM verdicts: [server/test/council.test.ts](server/test/council.test.ts)
- Audit log append-only: in the integration test.

### Layout
```
server/
  migrations/          SQL migrations
  src/llm/             provider interface, Ollama + OpenAI-compatible providers, gateway (PII guard, audit, GPU gate), structured output
  src/council/         router, council engine, pipeline (the worker's job), formatting
  src/prompts/         layered prompt assembler (Redis-cached)
  src/rag/             chunking, ingestion, access-controlled retrieval
  src/privacy/         PII detection & redaction
  src/routes/          HTTP API
  src/worker.ts        BullMQ worker + nightly retention
web/                   React + Vite + Tailwind SPA, Caddyfile
```

## 10. Operations notes

- **Latency** (measured on an RTX 4060 laptop, `hermes3:8b`, 2 slots): Quick mode shows its first token in about 4.5 s. Council takes about 75–90 s, or about 3 min with peer review. The UI shows live progress, and users can leave and come back. A browser notification and an in-app toast announce finished verdicts.
- **Queue:** Quick questions jump ahead of council work at the GPU. Users see "Queued · position N" when the model is busy.
- **Backups:** the `pgdata` volume holds everything that matters. Redis holds only queues and in-flight stream text.
- **Retention:** runs nightly at 03:00 (Admin → Settings → Retention). Users can delete one conversation or their whole history.
