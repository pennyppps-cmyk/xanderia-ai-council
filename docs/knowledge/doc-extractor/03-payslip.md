# Document Extractor: payslip extraction, and what it checks

Workspace: **Payslip Extraction** (`payslip`). Built mainly for **Malaysian government payslips** issued by JANM (Jabatan Akauntan Negara Malaysia) and Kerajaan Malaysia. It also understands Sabah state payslips and general English payslips (Employee Name, Gross Pay, Net Pay, and so on).

## Fields extracted

| Field | Payslip label it looks for |
|---|---|
| employee_name | Nama / Nama Pekerja / Employee Name |
| employee_id | No. Gaji / No. Pekerja / Employee ID |
| ic_number | No. K/P, No KP/Polis/Tentera, or any 12-digit IC |
| pay_period | Bulan (e.g. `07/2026`) / Pay Period / "UNTUK BULAN JULAI, 2026" |
| basic_salary | Code 0001 Gaji Pokok / Basic Salary |
| gross_pay | Jumlah Pendapatan / Gross Pay / Total Earnings |
| total_deductions | Jumlah Potongan / Total Deductions |
| net_pay | Gaji Bersih / Net Pay / Take Home |
| taxable_income | Pendapatan Bercukai / Taxable Income |
| net_salary_percent | % Peratus Gaji Bersih |
| verification_code | The 8-character code next to "KOD QR" / "QR CODE" |
| earnings | Line items under **Pendapatan**: code, description, amount |
| deductions | Line items under **Potongan**: code, description, amount |
| unclassified_items | Line items whose code is in neither list (see below) |

## Important behaviours

- **Latest month wins.** If a PDF holds several months, every page is read and the page with the **latest pay period** is kept.
- **Wage-code classification.** Each line item's 4-digit code is checked against the official register (SURAT WAGE TYPE): about 440 **Pendapatan** (earning) codes, mostly 0001-3999, and about 620 **Potongan** (deduction) codes, mostly 4003-6034. OCR slips in codes are fixed first (O→0, I/L→1, S→5). Exceptions: code 2002 counts as a deduction; Z002 and Z003 are deductions.
- **Several layouts are handled**: the JANM two-column layout (Pendapatan left, Potongan right, matched by position on the page), JANM text in forward or reverse order, rotated or scanned JANM pages, the Sabah "JUMLAH JUMLAH ... GAJI BERSIH" block, and generic payslips.
- **OCR repairs.** `1.052.43` is read as `1,052.43`. If the cents of Pendapatan Bercukai are damaged, they are recovered only when exactly one combination of the earnings adds up to the visible ringgit amount. For scanned JANM slips where labels are lost, gross, deductions and net are chosen as the largest set of amounts where gross − deductions = net.

## Checks and warnings

| Warning | Rule |
|---|---|
| Unrecognized wage type codes require review | A line item code is not in the Pendapatan or Potongan register. |
| Employee name requires review | No name found. |
| Net pay was not found / Gross pay was not found / Total deductions were not found | The label or amount was missing. |
| Gross pay minus deductions does not match net pay | \|gross − deductions − net\| > RM0.05 |
| Earnings line items do not match the stated total | The earnings items do not add up to Jumlah Pendapatan (±RM0.05). |
| Deductions line items do not match the stated total | The deduction items do not add up to Jumlah Potongan (±RM0.05). |
| Net salary percentage is outside 0-100 | The % value is impossible. |
| Net salary percentage does not match net pay divided by gross pay | \|% − net/gross×100\| > 0.15 |
| Overall confidence is below 80% | See the score below. |

**Confidence** = 55% average OCR confidence + 45% share of the core fields found (name, pay period, gross, net). Text PDFs read directly score 0.99 for OCR. Below 0.80, or any warning, sends the record to **review**.

## Excel output ("Report" sheet)

For each payslip, a block titled **Payslip Extraction Result**:
- Jenis Payslip ("Upload in SpaaS"), Bulan, Nama, No. Gaji, No. K/P (without dashes)
- A **Pendapatan** table: Kod, Pendapatan, Amaun (RM)
- Jumlah Pendapatan, Pendapatan Bercukai
- A **Potongan** table: Kod, Potongan, Amaun (RM)
- Jumlah Potongan, Gaji Bersih, % Peratus Gaji Bersih, QR CODE

The layout matches what Collections and Credit key into SpaaS.

## How this relates to the AI Council

The Council's own **Tools > Payslip** tool (the payslip and deduction calculators) is separate. The extractor turns the PDF into numbers; the Council tools do the affordability and deduction maths. For a loan or financing check, the key figures are gross pay, total deductions, net pay and % Peratus Gaji Bersih. Government rules usually require take-home pay to stay above a minimum share of gross, commonly 40%; confirm the current rule with Credit.
