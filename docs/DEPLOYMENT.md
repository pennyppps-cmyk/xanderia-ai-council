# Xanderia AI Council: how it is deployed, and how to move it to a server

Written for Xanderia IT and the AI Systems team. Last updated 25 September 2026.

## 1. How it runs today

Since 25 September 2026 the whole Council runs on the GPU server **xtracthor** (192.168.88.179), next to Ollama, at **https://192.168.88.179** (office network or VPN).

| Part | Where | Notes |
|---|---|---|
| Web, API, worker, PostgreSQL + pgvector, Redis | Docker Compose in `/home/wanwan/xanderia-council` on xtracthor | Web on port 443; plain HTTP on 8080 (nginx already uses port 80) |
| AI models (hermes3:8b, nomic-embed-text) | Ollama on the same machine (`http://host.docker.internal:11434` from the containers) | RTX 5070 Ti, 16 GB GPU memory |
| Backups | `~/xanderia-council/backup.sh`, cron at 01:00 Malaysia time, `~/backups`, 30 days kept | Copy them off the server regularly (NAS) |
| Voice (Whisper) | Not enabled on the server (RAM is tight) | Can be added with `--profile voice` after a RAM upgrade |
| Source code | Private GitHub repository `andrew-bot-1994/xanderia-ai-council` | No `.env` or passwords in it |

Andrew's laptop copy remains as a spare and a development environment.

**Updating the server:** on the laptop, commit and push; then on xtracthor copy the new code (for example `git archive HEAD | ssh wanwan@192.168.88.179 'tar -x -C ~/xanderia-council'`) and run `docker compose up -d --build`. Database migrations run automatically.

**GPU server history (25 September 2026):** after a reboot for a kernel update, Ollama started before the NVIDIA driver was ready, ran on the CPU and was killed for lack of memory (oom-kill). Fixed with the systemd drop-in `10-wait-for-gpu.conf` (waits for the GPU; `OLLAMA_NUM_PARALLEL=2`, `OLLAMA_KEEP_ALIVE=30m`, `OLLAMA_CONTEXT_LENGTH=16384`) and `nvidia-persistenced`.

**Risk of one machine:** the AI, the app and the database share one 11 GB VM. Raise its RAM to 16 GB, and move the app to its own VM (section 2) before company-wide use.

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
0. Make Ollama wait for the GPU at boot: add a systemd drop-in `/etc/systemd/system/ollama.service.d/10-wait-for-gpu.conf` with `After=nvidia-persistenced.service` and an `ExecStartPre` that waits until `nvidia-smi -L` succeeds; enable `nvidia-persistenced`. After any reboot, `/api/ps` must show `size_vram` equal to the model size. Consider raising the VM's RAM from 11 GB to 16 GB; the doc-extractor app also uses about 2.5 GB.
1. Free disk space. The disk was 100% full: remove unused models (`ollama list`, `ollama rm <name>`), old logs and old Docker images.
2. Embedding model: `nomic-embed-text` is installed (25 September 2026). Confirm `hermes3:8b` and `nomic-embed-text` are listed.
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
