# HANDOFF — Xanderia Council (Internal AI Advisory Chat)

**Owner:** Andrew Boy Chong (AI Systems Orchestrator, Xanderia Services Sdn Bhd)
**For:** Claude Code
**Status:** New build, greenfield repo
**Primary model:** Hermes 3 8B (`hermes3:8b`) on local Ollama, server `aixan`
**Working name:** `xanderia-council` (rename freely)

---

## 1. What we are building

An internal web app where any Xanderia employee, from any department, can:

1. **Ask a question** and get a fast, grounded answer (Quick mode).
2. **Bring a problem, plan or decision** and have it pressure-tested by a *council* of AI advisors with different mandates, then receive one synthesized verdict with an action plan (Council mode).

Think of it as an internal "board of advisors on demand": a credit officer can ask how to structure a new collections workflow, HR can plan a hiring round, finance can sanity-check a cost proposal, and each gets multiple perspectives plus a single clear recommendation.

The council pattern is based on Andrej Karpathy's open-source `llm-council` (3 stages: independent first opinions → anonymized peer review/ranking → chairman synthesis), adapted with business-strategy personas instead of multiple vendor models.

---

## 2. Users and departments

Seed these departments (admin can add/rename later):

| Department | Typical asks |
|---|---|
| Credit & Collections | Collections strategy, customer scripts, delinquency handling, workflow design |
| Finance | Cost proposals, budgeting, pricing scenarios, tender costing |
| Legal & Compliance | Policy drafting, PDPA questions, contract review checklists |
| HR | Hiring plans, policy drafts, staff comms, training plans |
| Operations | SOP design, process bottlenecks, vendor decisions |
| Technology | Integration planning, build-vs-buy, rollout plans |
| Management | Strategy, new product/market decisions |

Roles: `employee`, `dept_lead`, `admin`. Every user belongs to one primary department.

---

## 3. Core flow

```
User message
   │
   ▼
[Intake / Router]  → classifies: department, intent (question | plan | decision),
   │                  sensitivity (contains PII? yes/no), suggests mode
   │
   ├── Quick mode ──► Single department advisor + department knowledge (RAG) ──► answer
   │
   └── Council mode
          Stage 1: Advisors answer independently, in parallel
                   (Contrarian, First Principles, Expansionist,
                    Customer Advocate, Executor, + Department Expert)
          Stage 2: Peer review — each advisor sees the others' answers
                   ANONYMIZED (Advisor A/B/C…) and critiques/ranks them
          Stage 3: Chairman synthesizes everything into one verdict
                   │
                   ▼
          Structured output: Verdict · Why · Action plan (steps, owner role,
          timeline) · Key risks & mitigations · Open questions · Confidence
```

The user can override the router's mode suggestion with a toggle.

---

## 4. Council personas (starting drafts — store in DB, editable in admin)

All personas share a base layer: *You are an advisor to Xanderia Services Sdn Bhd, a Malaysian financing company. Be concrete, cite assumptions, respect Malaysian regulation (PDPA 2010, BNM guidelines where relevant). Reply in the language the user wrote in (English or Bahasa Malaysia).*

- **The Contrarian** — Find the weakest assumptions, failure points, operational and regulatory risks. Argue the case against. Never agree just to agree.
- **First Principles Thinker** — Strip away "how it's usually done." Identify the underlying goal and constraints, rebuild the solution from those.
- **The Expansionist** — Find hidden upside, scaling levers, adjacent opportunities, reuse of existing Xanderia assets.
- **Customer Advocate** — Judge everything from the end customer's (borrower's) or internal user's real experience. Friction, trust, fairness, clarity.
- **The Executor** — Resources, cost, headcount, timeline, dependencies, what can ship in 2 weeks vs 3 months. Produce a realistic sequence.
- **Department Expert** — Dynamically loaded based on the routed department; grounded in that department's knowledge base.
- **The Chairman** — Reads all Stage 1 answers and Stage 2 reviews. Resolves disagreements explicitly ("The Contrarian's concern X outweighs Y because…"). Outputs the structured verdict in §3. Must state confidence and what would change the recommendation.

Prompt architecture: use **layered, DB-stored prompt components** (base → persona → department → task format) assembled at runtime and cached in Redis, same approach as VoxPro's `promptAssembler.js`. Keeps each prompt short and editable without redeploys.

---

## 5. Model layer — Hermes 3 (primary)

**The system is built for Hermes 3 (Nous Research) running locally on Ollama.** Hermes 3 is the default model for every role. Cloud models are optional add-ons, never a requirement.

### 5.1 Host and model

- **Server:** `aixan` (192.168.88.100), Ollama, 16GB VRAM.
- **Chat model:** `hermes3:8b` (Q4_K_M, ~5GB weights). The 70B/405B variants do not fit in 16GB VRAM, so do not target them.
- **Embedding model:** `nomic-embed-text` (or similar small model) on the same Ollama instance for RAG.
- Prompt format: Hermes 3 uses ChatML. Let Ollama's built-in template handle it: send `system`/`user`/`assistant` messages through `/api/chat` and do not hand-build ChatML strings.

### 5.2 Ollama configuration

| Setting | Value | Why |
|---|---|---|
| `num_ctx` | `16384` | Chairman must read all Stage 1 opinions + Stage 2 reviews. Ollama's default is far too small. |
| `OLLAMA_NUM_PARALLEL` | `2` | Each 16k slot needs ~2GB KV cache; 2 slots + weights ≈ 9–10GB, leaving headroom for embeddings. |
| `OLLAMA_MAX_LOADED_MODELS` | `2` | Keep `hermes3:8b` and the embedding model resident together. |
| `keep_alive` | `30m` (or `-1` in business hours) | Avoid cold-load delay between requests. |
| `num_predict` | ~600 per advisor, ~1200 for Chairman | Keeps council runs bounded. |

Make all of these configurable per role in admin, and verify actual VRAM use with `nvidia-smi` under load before raising parallelism.

### 5.3 Role temperatures (starting values)

| Role | Temperature | Notes |
|---|---|---|
| Router / intake | 0.0 | Must return JSON (see 5.4). |
| Contrarian, Expansionist, First Principles | 0.7 | Diversity of views is the point. |
| Customer Advocate, Executor, Department Expert | 0.5 | Grounded, practical. |
| Peer review (Stage 2) | 0.3 | |
| Chairman | 0.2 | Must return structured verdict (see 5.4). |

### 5.4 Structured output

- Use Ollama's `format` parameter with a **JSON schema** for the router and the Chairman verdict. Validate with Zod. On parse failure, retry once with the validation error appended, then fall back to plain-text display.
- Keep persona prompts short and specific. An 8B model follows a tight 150–300 token persona far better than a long one, which is why the layered prompt assembly in §4 matters here.

### 5.5 Known limits of Hermes 3 8B and how to design around them

- **Chairman synthesis is the weakest link.** An 8B model tends to average opinions rather than adjudicate. Mitigations: force the Chairman schema to include an explicit `conflicts[]` field ("Advisor X says…, Advisor Y says…, decision: …, because…"), and feed it a condensed summary of each opinion rather than the full text if context gets tight.
- **Peer review tends to be polite.** In the Stage 2 prompt, require each reviewer to name the single biggest flaw in each other answer and give a 1–5 score. Stage 2 is **toggleable per request** (default off in Phase 1) since it costs a full extra round.
- **Bahasa Malaysia quality is weaker than English.** Default council reasoning to English internally; for BM users, have the Chairman write the final verdict in BM. Flag this for testing with real staff.
- **Latency.** With 2 parallel slots, Stage 1 (6 advisors) runs in 3 rounds. Expect roughly 30 seconds to 2 minutes for a full council. The UI must show live stage progress and let users leave and come back (results persist; notify when done).

### 5.6 Provider abstraction (keep it swappable)

Still build a provider interface so any role can later move to another model without code changes:

- **Default:** Ollama / `hermes3:8b` for all roles.
- **Optional hybrid (disabled by default):** Chairman only on a cloud model, receiving **redacted, condensed advisor opinions only**, never the raw user message. Enable per role in admin.
- **Config per role:** provider, model, temperature, `num_ctx`, `num_predict`.
- Design for easy upgrade to a newer or larger Hermes release (e.g. if VRAM is added) by changing config only.

### 5.7 Queue and privacy

- **Job queue** (Redis/BullMQ) with concurrency matching `OLLAMA_NUM_PARALLEL`. Quick-mode requests get priority over council jobs so everyday questions stay fast.
- **PII guard:** with Hermes local-only, data stays on-prem by default. If a cloud provider is ever enabled for a role, run a redaction pass first (IC numbers, phone numbers, account numbers, names where detectable), and force local-only when the router flags high sensitivity. Show a "processed on-premises" badge in the UI.

---

## 6. Knowledge (RAG)

- Per-department document libraries (SOPs, policies, product sheets, FAQs). Upload PDF/DOCX/XLSX/TXT via admin or dept_lead.
- Chunk + embed into **Postgres with pgvector**. Embeddings via a local model on Ollama by default.
- Access control: a user only retrieves from their own department + documents marked "company-wide," unless admin grants cross-department access.
- Answers must cite the source document and section when knowledge was used.

---

## 7. Interface

Web app, responsive, works on phone.

- **Login** (email + password to start; design so Google Workspace / Microsoft SSO can be added later).
- **Chat screen**
  - Mode toggle: Quick / Council.
  - Department selector (defaults to user's own; "Ask another department" allowed).
  - Streaming responses (SSE).
  - Council mode shows a live progress strip (Stage 1 → 2 → 3), then the **Chairman verdict on top**, with collapsible cards for each advisor's opinion and the peer reviews underneath.
  - Actions on a verdict: copy, export to PDF, share link to a colleague, "Ask a follow-up," thumbs up/down with comment.
- **History:** searchable list of past conversations, pin/rename.
- **Admin panel**
  - Users, departments, roles.
  - Persona/prompt editor with versioning and a "test this prompt" sandbox.
  - Model routing per role.
  - Knowledge base management.
  - Usage analytics: questions per department, council vs quick ratio, cost per provider, feedback scores, latency.
  - Audit log viewer.

Bilingual UI labels (English / Bahasa Malaysia) are a nice-to-have for v1, required for v2.

---

## 8. Tech stack (match existing infra)

- **Backend:** Node.js (TypeScript), Express or Fastify.
- **Frontend:** React (Next.js or Vite) + Tailwind.
- **DB:** PostgreSQL + pgvector. **Cache/queue:** Redis (+ BullMQ).
- **Deploy:** Docker Compose on in-house Proxmox VM. Reverse proxy (Caddy or Nginx) with HTTPS, internal network only for v1.
- **Config:** `.env` for secrets; everything else (personas, routing, departments) in DB.

---

## 9. Security & compliance (non-negotiable)

- PDPA 2010: PII redaction before cloud calls, local-only mode for sensitive content, configurable retention (default 12 months), user can delete own history.
- RBAC on every endpoint and on RAG retrieval.
- Immutable audit log: who asked what, which models were called, which documents were retrieved.
- Prompt-injection hardening: treat uploaded documents and retrieved chunks as data, never instructions; delimit them clearly in prompts.
- Rate limits per user.
- Visible disclaimer: advisory output only, final decisions sit with the responsible staff/management. Legal/finance answers flagged "review before acting."

---

## 10. Build phases

**Phase 1 — MVP (target: 2 weeks)**
- Auth, departments, users.
- Quick mode with one advisor, no RAG.
- Council mode (Stage 1 + Stage 3 only; skip peer review initially).
- Provider layer with Ollama / `hermes3:8b` as default for all roles (cloud provider interface stubbed, disabled), queue with Quick-mode priority, Hermes settings from §5.2.
- Basic chat UI with streaming and history.

**Phase 2 — Full council + knowledge**
- Stage 2 anonymized peer review.
- RAG with per-department libraries and citations.
- Admin persona editor + model routing UI.
- Export to PDF, share links, feedback.

**Phase 3 — Operate**
- Analytics dashboard, audit log viewer, cost tracking.
- SSO, bilingual UI.
- Optional: WhatsApp or email entry point via n8n.

---

## 11. Acceptance criteria (Phase 1)

- An employee can log in, ask a question in Quick mode and see streamed tokens from Hermes 3 within ~5s when the queue is idle, or a clear "queued" state when busy.
- A full council run on Hermes 3 completes and shows live stage progress; the user can navigate away and return to the finished result.
- Router and Chairman outputs validate against their JSON schemas (with the retry/fallback behaviour in §5.4).
- Council mode returns a structured Chairman verdict containing all fields in §3, with each advisor's opinion viewable.
- A message containing a Malaysian IC number never reaches a cloud provider (write a test for this).
- A user from HR cannot retrieve Finance-only data (write a test for this).
- All model calls appear in the audit log.
- `docker compose up` brings up the full stack from a clean machine with a documented `.env.example`.

---

## 12. Open decisions — confirm with Andrew before starting

1. Stay fully local on Hermes 3, or enable the hybrid Chairman on a cloud model? If cloud, which model and monthly budget cap?
2. Should Council mode be available to all employees or only dept_leads/management at first?
3. SSO provider: Google Workspace or Microsoft 365?
4. Which departments have documents ready for the knowledge base in Phase 2?
5. Hosting: same Proxmox host as VoxPro, or a separate VM?

---

## 13. Working instructions for Claude Code

- Start by scaffolding the repo, `docker-compose.yml`, DB schema and migrations, then the provider layer and its tests, before any UI.
- Commit in small, reviewable steps with clear messages.
- Keep a `DECISIONS.md` log of any assumption made where this spec is silent.
- Write a `README.md` covering setup, env vars, adding a department, editing a persona, and adding a model provider.
- Ask before introducing any new paid external service.
