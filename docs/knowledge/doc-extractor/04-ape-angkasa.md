# Document Extractor: APE and APE PC (Angkasa Penyata)

Workspaces: **APE Angkasa Penyata** (`ape`) and **APE PC** (`ape_pc`). Input: **text PDFs only**, the statements downloaded from ANGKASA. Scanned copies return 0 rows.

## What it reads

An Angkasa Penyata lists members one after another. Each member entry starts with an ID:
- `C` + number = **No. KP** (IC). The `C` is dropped in the output, e.g. `C950415016119` becomes `950415016119`.
- `J` + number = **No. Tentera** (military number). The `J` is kept, e.g. `J00001059`.

For each member, the extractor takes:
- **NAMA**: the text between the ID and the first deduction code. Policy and receipt numbers, amounts in brackets and dot leaders (". . .") are removed. Apostrophes in names such as JA'FFAR are kept.
- Every **deduction code line**: KOD, then three amounts, **JUMLAH_POKOK** (principal), **JUMLAH_FAEDAH** (profit/interest) and **JUMLAH** (total).
- **JUMLAH_TERIMAAN** (total received): the amount in square brackets, e.g. `[ 1,034.60 ]`. It is searched for in the member's entry, then further down the same page, then on the following pages, because an entry can run onto the next page.

## Which deduction codes

| Workspace | Codes picked up |
|---|---|
| APE | 4070, 4101, 4102, 4103, 4104, 4105, 4106, 4107, 4108, 4109, 0301, 9091 |
| APE PC | 4120, 4121, 4122, 4123, 4124, 4125, 4126, 4131, 4141 |

Lines with any other code are **ignored**. If a member has no matching code, no row is written for them. If you expect a customer and they are missing, check that their code is on the list for the workspace you used. Pick APE PC for the PC codes.

## Output (Excel sheet "Extracted Data")

`PDF_FILE | NAMA | NO_KP | NO_TENTERA | KOD | JUMLAH_POKOK | JUMLAH_FAEDAH | JUMLAH | JUMLAH_TERIMAAN`

- One row **per member per code**. A member with 3 codes gets 3 rows; JUMLAH_TERIMAAN repeats on each.
- NO_KP and NO_TENTERA are stored as text, so leading zeros survive.
- Amounts use the format `#,##0.00`.

## Checks

Few checks: if a PDF yields no rows, the file is flagged "No Angkasa Penyata records found" (confidence 0) and goes to review. Otherwise confidence is 1.0. There is **no** reconciliation of POKOK + FAEDAH = JUMLAH, and no totals check, so spot-check totals against the statement summary before you use the numbers.
