# Document Extractor: BKR MBSB Document Checker

Workspace: **BKR MBSB Document Checker** (`bkr`). It checks a batch of MBSB financing customer files for completeness and consistency before submission, and produces an Excel checker report.

## What to upload

**One .zip** file. Inside it, **one folder per customer**, and the folder name must contain the customer's **name and 12-digit IC**, e.g.:

```
BATCH_SEPT/
  AHMAD BIN ALI 850101-01-1234/
    Agreement.pdf
    Kemaskini.pdf
    Payment Slip.pdf
    Tawarruq 1.pdf
    Tawarruq 2.pdf
    Tawarruq 3.pdf
    BPA.pdf  (optional)
    IC.pdf / Payslip.pdf  (optional)
```

The folder name gives the **expected name and IC**. Files placed loose at the top level of the ZIP, not inside a customer folder, are listed in the inventory but not checked as a customer. Only PDFs are read. Unsafe paths inside the ZIP (such as `../` or absolute paths) cause the whole ZIP to be rejected.

## Documents it expects

**Required (6):** AGREEMENT, KEMASKINI, PAYMENT_SLIP, TAWARRUQ_1, TAWARRUQ_2, TAWARRUQ_3
**Optional:** BPA, SPEKAR, HRMIS, IC, PAYSLIP, IC_PAYSLIP (IC and payslip in one PDF)

### How each PDF is recognised

1. **By filename first.** If the name contains agreement/perjanjian, payment slip/receipt, kemaskini, bpa, spekar, hrmis, payslip/slip gaji or "tawarruq 1/2/3", and the PDF has readable text, that type is used (confidence 0.96). **Naming files clearly is the most reliable way to get a clean result.**
2. **Otherwise by content**, using weighted keywords, for example:
   - Agreement: "surat tawaran", "facility/financing agreement", "perjanjian pembiayaan"
   - BPA: "borang pengesahan angkasa", "biro perkhidmatan angkasa"
   - Kemaskini: "borang kemaskini", "pengemaskinian", "kod pelanggan"
   - Payment slip: "transaction successful", "payment receipt", "duitnow", "fund transfer"
   - Tawarruq: "sijil tawarruq", "commodity murabahah", "selling date"
   - SPEKAR, HRMIS, IC ("kad pengenalan", "warganegara"), payslip ("slip gaji", "gaji bersih")
3. A Tawarruq certificate without a number 1, 2 or 3 is given the next free slot, and is marked "sequence inferred - review" (confidence capped at 0.79).
4. Nothing recognisable gives **UNKNOWN**.

## Values extracted

| From | Value |
|---|---|
| Every document | Every IC number, and the customer name (near "customer name", "nama pelanggan", "nama pemohon", "nama penuh", "name") |
| Kemaskini | **KOD PELANGGAN / Kod Angkasa**: 1-4 letters + 3-8 digits. The Kemaskini is always OCR'd, because the code is often in a scanned box. |
| Payment slip | **Amount** (payment/transaction/transfer amount, jumlah bayaran, amaun transaksi, ...) and **transaction date/time**. If either is missing, the page is OCR'd; the filename is a last resort (e.g. "RM12,345.00" or a date in the filename). |
| Agreement | **Net disbursement amount** (net disbursement, net proceeds, amount disbursed, jumlah pengeluaran, jumlah bayaran bersih, jumlah dikreditkan, ...) |
| Tawarruq | **Value** on the Bursa certificate = financing amount (FA). Price, Volume and other numbers are ignored. Also the **Selling time / date**. |

## The checks

| Check | Rule | Result if it fails |
|---|---|---|
| Missing documents | All 6 required types present | MISSING DOCUMENT |
| Name match | At least one document's name is ≥75% similar (fuzzy) to the folder name | DATA MISMATCH ("Name mismatch in <file>") |
| IC match | The folder IC appears in at least one document | DATA MISMATCH ("IC mismatch ... expected X, found Y") |
| Amount check | **Payment slip amount = Agreement net disbursement amount**, to the sen | DATA MISMATCH ("amounts differ by RMx") |
| FA check | **Tawarruq Value = financing amount (FA)** | DATA MISMATCH |
| Date check | **Tawarruq selling date/time must be on or before the payment date/time** (the commodity sale must happen before the money is paid) | DATA MISMATCH ("Selling date ... occurs after payment date ...") |
| KOD PELANGGAN | Found on the Kemaskini | REVIEW REQUIRED if missing |
| Readability | Every document confidence ≥ 0.80, status OK, and type not UNKNOWN or unnumbered TAWARRUQ | REVIEW REQUIRED |
| Duplicates | The same document type appears twice (reported as same or different content, by file hash) | EXTRA/DUPLICATE DOCUMENT |

**Overall status, in priority order:** ERROR → DATA MISMATCH → MISSING DOCUMENT → REVIEW REQUIRED → EXTRA/DUPLICATE DOCUMENT → **PASS**.
PASS means that every required document is present, name, IC, amount, FA and date all agree, the Kod Pelanggan was found, and every document was read clearly.

## The report (BKR_MBSB_CHECKER_REPORT.xlsx)

| Sheet | Contents |
|---|---|
| CHECKER REPORT | One row per customer: name, IC, FA, Kod Pelanggan, payment date and amount, agreement amount, Tawarruq amount, selling date/time, amount / date / FA variance, "Found" YES/NO for each document, missing and duplicate lists, name/IC/amount/date checks, **Overall Status** (colour-coded) and **Remarks** in plain words |
| DOCUMENT INVENTORY | Every PDF: customer, folder, filename, detected type, pages, native text or OCR, status, confidence, remarks |
| MISSING DOCUMENTS | Customers with missing documents |
| MISMATCHES | Customers with any name, IC, amount, date or FA mismatch |
| REVIEW REQUIRED | PDFs with low confidence, unreadable text or unknown type |
| SUMMARY | Totals: customers, PDFs, PASS, missing, mismatch, review, errors, pass percentage |

Colours: PASS green, MISSING DOCUMENT and DATA MISMATCH red, REVIEW REQUIRED yellow, ERROR dark red.

## Practical notes

- Large scanned Agreements (more than 5 pages) are skipped if GPU OCR is unavailable, and marked "retained for review".
- If the server restarts during a BKR job, the job resumes automatically when the server comes back.
- BKR job progress is kept in memory. After a restart, the report file is still on the server, but the web page may no longer show the old job.
