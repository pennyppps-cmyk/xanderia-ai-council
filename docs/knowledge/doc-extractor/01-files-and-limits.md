# Document Extractor: which files it processes, and its limits

## File types per workspace

| Workspace | Accepted files |
|---|---|
| Scanned IC Extraction | PDF, JPG, JPEG, PNG, TIF, TIFF, WEBP |
| Payslip Extraction | PDF, JPG, JPEG, PNG, TIF, TIFF, WEBP |
| APE Angkasa Penyata | **PDF only** |
| APE PC | **PDF only** |
| BASE bank statements (RHB, Xanderia Berhad format, Hong Leong, Bank Rakyat) | **PDF only** |
| BKR MBSB Document Checker | **One .zip file** containing PDFs in customer folders. Files in the ZIP that are not PDFs are ignored. |

Any other file type is rejected with "Unsupported file type". A non-PDF sent to APE, APE PC or BASE is rejected with "This extractor accepts PDF files only".

## Size limits

| Limit | Value |
|---|---|
| Files per batch (IC, payslip, APE, BASE) | 1 to 1,000 |
| Size per file | 50 MB |
| BKR ZIP size | 500 MB |
| BKR: PDFs inside one ZIP | 2,000 |
| BKR: size of one PDF inside the ZIP | 100 MB |
| BKR: total unpacked size | 2,500 MB |

## How each file is read

- **Text PDFs** (created by a system, not scanned): the text is read directly with PyMuPDF. This is fast and exact.
  - Payslips: a PDF is read directly only if **every page** has at least 120 text characters. Otherwise the whole PDF is OCR'd.
  - APE, APE PC and BASE rely **only** on the PDF's own text; they do not OCR. A **scanned** Angkasa or bank statement therefore gives 0 rows ("No Angkasa Penyata records found" / "No bank statement records found"). Ask for the original downloaded PDF, not a scan or a photo.
- **Scans and images**: OCR on the GPU.
  - MyKad: PaddleOCR renders each page at 600 DPI, with automatic orientation correction and page unwarping.
  - Payslip scans: docTR on the GPU.
  - BKR: native text first; if too little readable text is found (under 80 characters, or mostly symbols), it falls back to docTR, then PaddleOCR, then Tesseract (English + Malay).
- Multi-page PDFs and multi-frame TIFFs are handled page by page.

## Where the files go

Uploads are saved on the extractor server, under `doc-extractor/data/uploads/<batch>/`, with a SHA-256 fingerprint of each file. They are **kept** for reproducibility; no automatic retention or purge is set up yet. Results are stored in the extractor's own SQLite database. BKR ZIPs are deleted once processing ends, but the Excel report stays in `data/bkr_reports/`.

Because uploads include ICs, payslips and bank statements, treat the extractor server as holding personal data (PDPA). Do not copy exports to personal drives.
