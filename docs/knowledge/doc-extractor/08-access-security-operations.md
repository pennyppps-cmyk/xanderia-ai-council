# Document Extractor: access, security and operations

## Accounts and permissions

- Separate accounts from the AI Council. Roles: **user** and **admin**. Admins can use everything, manage users, and see all jobs and the audit log.
- An admin grants each user a set of **features**: `ic`, `payslip`, `ape`, `ape_pc`, `base` (all banks), `bkr`, `result_edit` (correct extracted fields) and `excel_export` (download Excel).
- Users see only **their own jobs**; admins see all.
- Passwords need at least 12 characters, including a letter and a number. New or reset accounts must change the password at first login. Sessions last 8 hours.
- 10 failed logins from one computer lock it out for 15 minutes.
- Everything is **audit-logged**: logins (including failed ones), password changes, user changes, job creation (with file names and sizes), field corrections (which fields changed) and Excel downloads.

## Where it runs

| Item | Value |
|---|---|
| Server | xtracthor (192.168.88.179), Ubuntu VM on Proxmox with an NVIDIA RTX 5070 Ti (16 GB) |
| Extractor web app and API | port **8001** (uvicorn, one worker) |
| Code folder | `/home/wanwan/doc-extractor` (FastAPI backend + React frontend) |
| Data | `doc-extractor/data`: SQLite database `extractor.sqlite3`, `uploads/`, `exports/`, `bkr/`, `bkr_reports/` |
| Memory use | about 2.2-2.5 GB RAM, plus GPU memory for the OCR models |
| OCR engines | PaddleOCR 3.x (PP-OCRv5_server_rec, English) for IC; docTR (db_resnet50 + crnn_vgg16_bn) on the GPU for payslips and BKR; Tesseract (eng+msa) as a last resort for BKR |
| Other service on the same server | `gpu_server.py` on port 8000, a small GPU status and test endpoint (`/gpu`, `/test`); not the extractor |

The AI Council runs on the same server, on ports 443 and 8080, and shares the GPU with Ollama (Qwen). A very large OCR batch can slow Council answers, and the reverse is also true.

## Operating rules

- Run **one** uvicorn worker per GPU. Each extra worker loads its own copy of the models into GPU memory.
- If GPU start-up fails, the OCR restarts on the CPU. It still works but is much slower. `/api/health` shows `degraded` with the reason if OCR is not ready.
- GPU out-of-memory on one file fails only that file; the batch continues.
- Uploads and results are kept indefinitely; no retention policy is set yet. Back up `data/` and restrict access to it; it holds personal data.
- Only reach the extractor inside the office LAN or VPN. It runs plain HTTP; put it behind an authenticated HTTPS reverse proxy before exposing it more widely.

## Who to contact

Extractor accounts, missing permissions, a new bank format, new wage codes or new Angkasa codes: IT / the system owner.
