# Document Extractor: BASE bank statements

Workspace: **BASE** ("Extract transactions from supported Malaysian bank statement PDFs"). Choose the bank format before uploading. Input: **text PDFs only**, downloaded e-statements. Scans or photos give 0 rows.

## Supported formats and output columns

| Option | Statement it expects | Excel columns |
|---|---|---|
| `base_rhb`: RHB | RHB Islamic Bank e-statement (e.g. Commodity Murabahah Current Account-i) | PDF_FILE, ACCOUNT_NAME, ACCOUNT_NUMBER, Statement Period, Tarikh, DESCRIPTION, CHEQUE, Debit, Credit, Baki |
| `base_xanderia`: Xanderia Berhad format (listed as Maybank in the README) | Statement with entry date, value date and +/− signed amounts | ACCOUNT_NUMBER, ENTRY DATE, VALUE DATE, TRANSACTION DESCRIPTION, Deposit, Withdrawal, Balance |
| `base_hongleong`: Hong Leong | Hong Leong Bank statement; amounts are placed in the Deposit, Withdrawal or Balance column by their position on the page | A/C No / No Akaun, Statement Period / Tempoh Penyataan, Date, Transaction, Description, Deposit, Withdrawal, Balance |
| `base_bankrakyat`: Bank Rakyat | Bank Rakyat statement with transaction codes | PDF_FILE, No. Akaun, Statement Period, Tarikh, Kod Transaksi, Keterangan, Debit, Kredit, Baki |

## How rows are built

- Page headers, footers, "Member of PIDM" notices, summaries and column titles are removed.
- A description that runs over several lines is joined into one cell.
- RHB and Bank Rakyat: when the statement does not say which column an amount belongs to, it is treated as a **debit** if the description contains " DR", CHRG, FEE or CHARGE, and as a credit otherwise. Check these on unusual statements.
- The Excel keeps the bank's own column formats and widths, and freezes the header row.

## Checks

The only automatic check is "No bank statement records found": 0 rows sends the file to review. There is no automatic running-balance reconciliation. For credit assessments, check the opening balance, total credits, total debits and closing balance against the statement summary, and look for salary credits, returned or bounced items and large irregular transfers.

## Not supported

Other banks (CIMB, Public Bank, AmBank, BSN, Bank Islam, and so on) and scanned statements are not supported. Uploading them under the wrong bank gives empty or wrong rows.
