# Xanderia AI Council: how it is deployed, and how to move it to a server

Written for Xanderia IT and the AI Systems team. Last updated 25 September 2026.

## 1. How it runs today

| Part | Where it runs now | What it is |
|---|---|---|
| Web app, API, worker, database, queue | Andrew's laptop, in Docker Compose | Caddy (HTTPS web server), Fastify API, background worker, PostgreSQL 17 with pgvector, Redis |
| AI model for answers (Hermes 3 8B) | **Andrew's laptop** for now (local Ollama). Target: GPU server **xtracthor**, 192.168.88.179 (Proxmox VM, RTX 5070 Ti 16 GB, Ollama 0.32.6) | All chat roles: router, quick answers, the six advisors, Chairman, clarifier, Action Crew, drafting |
| Embedding model (nomic-embed-text) | Andrew's laptop (local Ollama) | Used for the knowledge-base search. Temporary: the GPU server's disk was full, so it isn't installed there yet |
| Speech-to-text (optional) | Andrew's laptop, Whisper container (`voice` profile) | Voice questions from the web app and Telegram |

The laptop reaches the GPU server over the office network or the OpenVPN. **If the laptop is off, or the VPN drops, the Council is unavailable.** Only the laptop can open https://localhost, so colleagues can't use it yet. This is a pilot setup, not production.

Model routing is set per role in **Admin → Model routing**. Provider `gpu` = http://192.168.88.179:11434; provider `ollama` = the laptop's Ollama.

**GPU server status (25 September 2026):** reachable over the VPN, and fast at first (about 150 tokens per second). During a council run it then loaded Hermes with no GPU memory (`size_vram: 0`, so it ran on the CPU and took 30–60 seconds per advisor), and soon after Ollama stopped accepting connections. The chat roles were moved back to the laptop until this is fixed (Step 1).

## 2. Target setup

```
Staff browsers / phones (office LAN or VPN)
        │  HTTPS  https://council.<company domain>
        ▼
App server (Linux VM, e.g. on aixan 192.168.88.100)
  Docker Compose: web (Caddy) · api · worker · postgres · redis · whisper (optional)
        │  HTTP 11434, LAN only
        ▼
GPU server xtracthor 192.168.88.179 (Ollama: hermes3:8b + nomic-embed-text)
```

Everything stays inside Xanderia's network. No inbound port from the internet is needed. Outbound internet is only needed for email (SMTP) and the optional Telegram bot.

### App server sizing

| Item | Minimum | Recommended |
|---|---|---|
| CPU | 4 vCPU | 8 vCPU (if voice is on) |
| Memory | 8 GB | 16 GB |
| Disk | 60 GB SSD | 120 GB SSD (database, backups, Whisper model) |
| OS | Ubuntu 24.04 LTS or Debian 12 | Same |
| Software | Docker Engine with the Compose plugin, git | Same |

The app server needs no GPU; the model runs on xtracthor.

## 3. Step-by-step plan

### Step 1: Prepare the GPU server (xtracthor), about 1 hour
0. Fix the GPU problem first: run `nvidia-smi` and check the RTX 5070 Ti is visible and which processes use its memory (the other service on port 8000 and the minicpm vision model may be holding it). Check `journalctl -u ollama` for crashes and out-of-memory errors. Ollama must show `size_vram` equal to the model size in `/api/ps` after a request.
1. Free disk space. The disk was 100% full: remove unused models (`ollama list`, `ollama rm <name>`), old logs and old Docker images.
2. Install the embedding model: `ollama pull nomic-embed-text` (about 270 MB). Confirm `hermes3:8b` is listed.
3. Ollama settings (systemd override or environment): `OLLAMA_HOST=0.0.0.0:11434`, `OLLAMA_NUM_PARALLEL=2`, `OLLAMA_KEEP_ALIVE=30m`, `OLLAMA_MAX_LOADED_MODELS=2`. Restart Ollama.
4. Firewall: allow port 11434 **only from the app server's IP** (and the admin laptop during the move). Ollama has no password, so it must not be open to the whole network.
5. Change the SSH password of the `wanwan` account. It was shared in a chat message during setup.

### Step 2: Prepare the app server, about 2 hours
1. Create a Linux VM (sizing above) on the office network with a fixed IP.
2. Install Docker Engine and the Compose plugin; add the admin user to the `docker` group.
3. Copy the project: `git clone <repository> /opt/xanderia-council`, or copy the folder from the laptop.
4. `cp .env.example .env` and set:
   - `JWT_SECRET`: a long random value (`openssl rand -hex 32`)
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD`: the first admin (change the password after the first sign-in)
   - `POSTGRES_PASSWORD`: a long random value
   - `OLLAMA_BASE_URL=http://192.168.88.179:11434`
   - `SITE_ADDRESS` and `APP_BASE_URL`: the address staff will use, e.g. `council.xanderia.local` and `https://council.xanderia.local`
   - `COOKIE_SECURE=true`
   - `MAIL_PROVIDER=outbox` to start; `smtp` (with `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`) once email is approved
   - Optional: `WHISPER_URL=http://whisper:8000` (voice) and `TELEGRAM_BOT_TOKEN` (Telegram)
5. Start it: `docker compose up -d --build`, plus `--profile voice` for voice. Migrations and the seed run automatically on first start.
6. Check **Admin → Overview → System health**: Database, Redis and Ollama must be green.

### Step 3: Address and HTTPS, about 1 hour
1. Add an internal DNS record: `council.<domain>` → the app server's IP.
2. Caddy issues a certificate from its own internal authority. Either install Caddy's root certificate on staff PCs and phones (via group policy), or give Caddy the company's own certificate. Otherwise browsers show a warning.

### Step 4: Data, about 1 hour
The laptop's database contains **test data** (TEST staff directory, test questions, a test decision). Start the server with a **clean database** rather than copying the laptop's. Then:
1. Sign in as the first admin and change the password.
2. **Admin → Staff directory → Import CSV** with the HR export (name, position, department, email, manager_email).
3. **Admin → Users**: create accounts (invite links by email, or shown on screen until email is connected); set each department lead.
4. **Admin → Action Crew & email**: allowed email domains, business hours, weekend days, and the 2026 and 2027 public holidays.
5. **Admin → Knowledge**: upload each department's SOPs and policies, plus this document and the user guide PDF (company-wide).
6. **Admin → Settings**: who may use Council mode at first, retention, the weekly digest.

If you do want to keep the laptop's data: `docker compose exec postgres pg_dump -U council council > council.sql` on the laptop, then restore it into the server's database before the first start.

### Step 5: Pilot, about 2 weeks
1. Give access to one or two departments first (for example Credit & Collections and Management).
2. Watch the heatmap, feedback (thumbs up/down) and latency in **Admin → Overview**.
3. Adjust prompts in **Admin → Personas & prompts** (use the test sandbox first).
4. Then open it to all staff.

### Step 6: Operations
- **Backups:** nightly database dump to the NAS, keeping 30 days, for example with cron at 01:00: `docker compose exec -T postgres pg_dump -U council council | gzip > /backup/council-$(date +%F).sql.gz`. Test a restore once a month. The `pgdata` volume is the only data that matters; Redis holds only queues.
- **Updates:** `git pull && docker compose up -d --build`. Database migrations run automatically.
- **Restarts:** every container restarts by itself (`restart: unless-stopped`), including after a server reboot.
- **Monitoring:** Admin → Overview (health, usage, latency). Container logs: `docker compose logs -f api worker`.
- **Security:** reachable only on the LAN or VPN; no port forwarding from the internet; the audit log records every model call; conversations are deleted after the retention period (default 12 months).

## 4. Timeline and owners

| Step | Owner | Effort |
|---|---|---|
| 1. GPU server: disk, embedding model, firewall, password change | IT | 1 hour |
| 2. App server VM and Docker | IT | 2 hours |
| 3. DNS and certificate | IT | 1 hour |
| 4. Data, users, knowledge | AI Systems team with HR | 1 day |
| 5. Pilot with 1–2 departments | Department leads | 2 weeks |
| 6. Backups and monitoring | IT | 1 hour, then ongoing |

## 5. Risks

| Risk | What to do |
|---|---|
| The GPU server is a single point of failure | Keep the Ollama provider switchable in Admin → Model routing; the laptop's Ollama can serve as an emergency fallback |
| GPU disk fills up again | Monitor disk space; keep only the models in use |
| Ollama port open to the network | Firewall 11434 to the app server only |
| Self-signed certificate warnings | Install the Caddy root certificate on staff devices, or use the company certificate |
| Test data carried into production | Start with a clean database (Step 4) |
