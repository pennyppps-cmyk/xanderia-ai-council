# Document Extractor: MyKad / IC extraction, and what it checks

Workspace: **Scanned IC Extraction** (`ic`). Input: MyKad scans as PDF or image.

## Fields extracted

| Field | How it is found |
|---|---|
| IC number | The first 12-digit number in the pattern YYMMDD-PB-###G, with or without dashes or spaces. Output as `YYMMDD-PB-####`. |
| Date of birth | Worked out from the IC's first 6 digits. A 2-digit year above the current year is read as 19xx, otherwise 20xx. |
| Gender | Printed text first (LELAKI/MALE or PEREMPUAN/FEMALE). If none is found, the last IC digit decides: **odd = Male, even = Female**. |
| Name | The lines straight after the IC number (up to 3 lines), skipping card wording such as MALAYSIA, KAD PENGENALAN, WARGANEGARA or religion. It stops at the first line that looks like an address. It also repairs OCR joins, e.g. `MUHAMMADALI` becomes `MUHAMMAD ALI` and `ALIBIN` becomes `ALI BIN`. |
| Address | The block after the name. It starts at a line beginning with NO / LOT / PT / BLOK / JALAN / JLN / LORONG / TAMAN / KAMPUNG / KG / BANDAR / PERSIARAN / FELDA or a 5-digit postcode, and ends at the state line (the 13 states plus Kuala Lumpur). Lines are joined with commas, and joined words are split (e.g. `KUALAPILAH` becomes `KUALA PILAH`). |
| Citizenship | "Malaysian" if WARGANEGARA or MALAYSIA appears on the card. |

## Checks and warnings

| Warning | Meaning |
|---|---|
| IC number was not found | No 12-digit IC pattern was read. The scan is usually too blurred, cropped or covered by glare. |
| IC number contains an invalid date | The first 6 digits are not a real date (e.g. month 13), so the IC was misread or is not genuine. |
| Name requires review | No name lines were found after the IC number. |
| Address requires review | No address block was found. |
| Overall confidence is below 80% | See the score below. |

**Confidence** = 70% average OCR confidence of the words + 30% completeness (share of the 6 fields filled). Below 0.80, the record goes to **review**.

## Excel output

One row per file: Filename, Status, Confidence, then name, ic_number, date_of_birth, gender, citizenship, address, then Warnings and Error. The header is frozen and filters are on.

## Tips

- Scan both sides separately if needed; the front carries all the fields above.
- The address on a MyKad can be out of date; confirm it against the customer's latest record.
- The extractor does not check whether the card is genuine. It only checks that the IC number contains a valid date.
