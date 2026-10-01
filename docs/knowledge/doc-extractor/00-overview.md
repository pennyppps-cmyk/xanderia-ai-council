# Document Extractor: overview

The Document Extractor (also called the Document Extraction System, "doc-extractor" or "the extractor") is Xanderia's in-house tool for reading PDFs and scans and turning them into Excel. It runs on our own GPU server (xtracthor, 192.168.88.179) inside the office network. Documents and personal data never leave that server.

- Web address (office LAN or VPN): http://192.168.88.179:8001
- Sign in with an extractor account. This is a different login from the AI Council. An extractor admin creates the accounts.
- Main technology: PaddleOCR (PP-OCRv5 server recognition model) and docTR on the RTX 5070 Ti GPU. Where a PDF already contains text, the extractor reads that text directly, which is faster and more accurate than OCR.

## The six workspaces

| Workspace (as shown in the app) | Internal code | What you upload | What you get |
|---|---|---|---|
| Scanned IC Extraction | `ic` | MyKad scans (PDF, JPG, PNG, TIFF, WEBP) | Name, IC number, date of birth, gender, citizenship, address |
| Payslip Extraction | `payslip` | Payslips, mainly government (JANM) payslips; PDF or image | Employee details, earnings and deductions with wage codes, gross, total deductions, net, % net salary, QR verification code |
| APE Angkasa Penyata | `ape` | Angkasa Penyata statement PDFs | One row per person per deduction code: name, No. KP / No. Tentera, code, principal, profit, total, total received |
| APE PC | `ape_pc` | Angkasa PC statement PDFs | Same layout as APE, for a different set of deduction codes |
| BASE (bank statements) | `base_rhb`, `base_xanderia`, `base_hongleong`, `base_bankrakyat` | Bank statement PDFs | Every transaction line in Excel |
| BKR MBSB Document Checker | `bkr` | One ZIP of customer folders | A checker report showing, for each customer, PASS / MISSING DOCUMENT / DATA MISMATCH / REVIEW REQUIRED / ERROR |

## How a job works (every workspace except BKR)

1. Choose a workspace and drop in one or more files (up to 1,000 per batch, 50 MB each).
2. The extractor creates a **job** and works through the files one at a time in the background. Progress shows live: completed, needs review, failed, remaining.
3. Each file ends as **completed**, **review** or **failed**:
   - *Completed*: every check passed and confidence is at least 80%.
   - *Review*: a value was read, but a check raised a warning, or confidence was below 80%. A person must look at it.
   - *Failed*: the file could not be read at all (corrupt PDF, no pages, OCR crash). The rest of the batch carries on.
4. Users with the "result edit" permission can correct fields on screen. A saved correction marks the file *completed* and clears its warnings. The change is audit-logged, including which fields changed.
5. Download the Excel. Each workspace has its own Excel layout (see the topic pages).

BKR works differently: you upload one ZIP, it checks each customer folder, and it produces a multi-sheet report (see "BKR MBSB Document Checker").

## Related topics

- Files the extractor accepts, and its limits
- MyKad / IC extraction: what it checks
- Payslip extraction: what it checks
- APE and APE PC (Angkasa Penyata)
- BASE bank statements
- BKR MBSB Document Checker
- Warnings, review and troubleshooting
- Access, security and operations
- Payslip wage-type codes (Pendapatan / Potongan)

## Asking the AI Council about a payslip, bank statement or IC

You can attach a payslip, bank statement, Angkasa statement or MyKad to a Council question (up to 3 files, 10 MB each). The Council sends it to the Document Extractor first. Scans and phone photos (.jpg, .png) work as well. The file chip shows **"Checked: payslip"** (or bank statement, MyKad, and so on) when that worked. The advisors then answer from the extractor's checked figures (gross, deductions, net, % net, wage codes; for bank statements, money in and out per month, lowest balance, regular credits and returned or bounced items), and they tell you about any extractor warnings. Example questions: "What is this customer's net pay and % gaji bersih, and can they afford RM450 more a month?", "Is salary credited every month in this statement?", "Any bounced or returned items?", "Which Angkasa deductions does this member have?"
