# Document Extractor: warnings, review and troubleshooting (FAQ)

## Why did my file go to "review"?

A file goes to review when **any warning** was raised, or its **confidence is below 80%**. The warning list on the result tells you which check failed. Open the original document, compare it with the extracted fields, correct them if needed and save. Saving marks the file completed. Only users with the "result edit" permission can save corrections.

## Common warnings and what to do

| Warning | Likely cause | What to do |
|---|---|---|
| IC number was not found (IC) | Blurred, cropped or glare-covered scan | Rescan flat at 300 DPI or more, with no glare, or type the IC in |
| IC number contains an invalid date (IC) | One digit misread | Compare with the card and correct it |
| Name requires review / Address requires review (IC) | Card layout or OCR broke the order | Type it in from the card |
| Unrecognized wage type codes require review (payslip) | A code is not in the SURAT WAGE TYPE register, or OCR misread a digit | Check the code on the slip. If it is real and new, tell IT so it can be added to the register |
| Gross pay minus deductions does not match net pay (payslip) | An amount was misread | Correct the amounts from the slip |
| Earnings/Deductions line items do not match the stated total (payslip) | A line item was missed or misread | Add or fix the line item |
| Net salary percentage does not match... (payslip) | % Peratus Gaji Bersih misread | Correct it (it should equal net ÷ gross × 100) |
| No Angkasa Penyata records found (APE) | Scanned PDF, or the codes belong to the other workspace | Use the original ANGKASA PDF; try APE PC for codes 4120-4141 |
| No bank statement records found (BASE) | Scanned PDF, or the wrong bank selected | Use the downloaded e-statement and pick the right bank |
| Overall confidence is below 80% | Poor scan quality | Check every field |

## Error messages when uploading

| Message | Meaning |
|---|---|
| Unsupported file type: .xxx | Only PDF, JPG, JPEG, PNG, TIF, TIFF and WEBP are accepted (only ZIP for BKR) |
| This extractor accepts PDF files only | APE, APE PC and BASE take PDFs only |
| <file> exceeds 50 MB | Split or compress the file |
| Upload 1 to 1000 files | Too many files in one batch |
| OCR engine unavailable | The GPU OCR did not start. Tell IT. APE, APE PC and BASE still work because they do not need OCR |
| Too many login attempts | 10 failed logins from one computer lock it out for 15 minutes |
| Access to BKR is disabled | Your account does not have the BKR permission; ask an extractor admin |

## A file "failed"

The file could not be processed at all: a corrupt or password-protected PDF, a PDF with no pages, or the GPU running out of memory on a very large scan. The other files in the batch are not affected. Try again with a clean copy; for a huge scan, split it.

## Scan quality tips

- 300 DPI, colour or greyscale, flat, no shadows or glare, the whole page in the frame.
- Prefer the original digital PDF (payslip from the HRMIS/JANM portal, ANGKASA statement, bank e-statement) over a scan or a phone photo. Digital PDFs are read exactly.
- For BKR, name the files by type (Agreement, Kemaskini, Payment Slip, Tawarruq 1/2/3, BPA).
