# Tax Data — DAF Optimization

No SSNs, EINs, or account numbers here. Only the dollar amounts and categorical
fields needed to calculate optimal Donor-Advised Fund (DAF) contributions.

The algorithm uses these inputs to:
- Find how much to contribute to your DAF each year to maximize deductions
- Model the "bunching" strategy (give multiple years at once to clear the standard deduction threshold)
- Calculate tax savings at your marginal rate
- Identify whether donating appreciated stock beats a cash contribution

---

## How to fill this in

Pull these numbers directly from the forms listed. Amounts are whole dollars (no cents needed).
Filing status options: `Single` | `MFJ` | `MFS` | `HOH`
Leave a field `—` if it genuinely does not apply (e.g. no mortgage).

---

## 2024

| Field | Form / Line | Amount |
|---|---|---|
| Filing status | 1040 top | MFJ |
| **INCOME** | | |
| Wages & salary | 1040 Line 1z | 330,000 |
| Business / self-employment income | Schedule C Line 31 | |
| Long-term capital gains | Schedule D Line 16 | 12,500 |
| Short-term capital gains | Schedule D Line 7 | 1,800 |
| Dividends (ordinary) | 1040 Line 3b | 4,200 |
| Other income | 1040 Line 8 | |
| Total income | 1040 Line 9 | 348,500 |
| **ADJUSTMENTS** | | |
| 401k / 403b / SEP contributions | W-2 Box 12 Code D (or Schedule 1 Line 16) | 23,000 |
| HSA deduction | Schedule 1 Line 13 | 4,150 |
| Other above-the-line deductions | Schedule 1 Line 26 | |
| **AGI** | 1040 Line 11 | 321,350 |
| **DEDUCTIONS** | | |
| Took standard deduction? | 1040 Line 12 | Yes |
| Standard deduction claimed | 1040 Line 12a | 29,200 |
| Itemized deductions total | Schedule A Line 17 | — |
| — State & local taxes paid (SALT) | Schedule A Line 5d | — |
| — Mortgage interest | Schedule A Line 8a | — |
| — Charitable cash contributions | Schedule A Line 11 | — |
| — Charitable non-cash contributions | Schedule A Line 12 | — |
| — Other itemized | Schedule A Line 16 | — |
| **TAX** | | |
| Taxable income | 1040 Line 15 | 292,150 |
| Total federal tax | 1040 Line 24 | 62,450 |
| Child / dependent tax credits | 1040 Line 19 | 4,000 |
| Federal tax withheld | 1040 Line 25a | 68,000 |
| Refund (+) or owed (−) | 1040 Line 35a / 37 | 9,550 |
| **APPRECIATED ASSETS (for stock donations)** | | |
| Approx. unrealized long-term gains in brokerage | Personal estimate | |

---

## 2023

| Field | Form / Line | Amount |
|---|---|---|
| Filing status | 1040 top | MFJ |
| **INCOME** | | |
| Wages & salary | 1040 Line 1z | |
| Business / self-employment income | Schedule C Line 31 | |
| Long-term capital gains | Schedule D Line 16 | |
| Short-term capital gains | Schedule D Line 7 | |
| Dividends (ordinary) | 1040 Line 3b | |
| Other income | 1040 Line 8 | |
| Total income | 1040 Line 9 | |
| **ADJUSTMENTS** | | |
| 401k / 403b / SEP contributions | W-2 Box 12 Code D (or Schedule 1 Line 16) | |
| HSA deduction | Schedule 1 Line 13 | |
| Other above-the-line deductions | Schedule 1 Line 26 | |
| **AGI** | 1040 Line 11 | |
| **DEDUCTIONS** | | |
| Took standard deduction? | 1040 Line 12 | Yes |
| Standard deduction claimed | 1040 Line 12a | |
| Itemized deductions total | Schedule A Line 17 | — |
| — State & local taxes paid (SALT) | Schedule A Line 5d | — |
| — Mortgage interest | Schedule A Line 8a | — |
| — Charitable cash contributions | Schedule A Line 11 | — |
| — Charitable non-cash contributions | Schedule A Line 12 | — |
| — Other itemized | Schedule A Line 16 | — |
| **TAX** | | |
| Taxable income | 1040 Line 15 | |
| Total federal tax | 1040 Line 24 | |
| Child / dependent tax credits | 1040 Line 19 | |
| Federal tax withheld | 1040 Line 25a | |
| Refund (+) or owed (−) | 1040 Line 35a / 37 | |
| **APPRECIATED ASSETS (for stock donations)** | | |
| Approx. unrealized long-term gains in brokerage | Personal estimate | |

---

## Add a new year

Copy the block below and paste it above the oldest year:

```
## YYYY

| Field | Form / Line | Amount |
|---|---|---|
| Filing status | 1040 top | MFJ |
| **INCOME** | | |
| Wages & salary | 1040 Line 1z | |
| Business / self-employment income | Schedule C Line 31 | |
| Long-term capital gains | Schedule D Line 16 | |
| Short-term capital gains | Schedule D Line 7 | |
| Dividends (ordinary) | 1040 Line 3b | |
| Other income | 1040 Line 8 | |
| Total income | 1040 Line 9 | |
| **ADJUSTMENTS** | | |
| 401k / 403b / SEP contributions | W-2 Box 12 Code D (or Schedule 1 Line 16) | |
| HSA deduction | Schedule 1 Line 13 | |
| Other above-the-line deductions | Schedule 1 Line 26 | |
| **AGI** | 1040 Line 11 | |
| **DEDUCTIONS** | | |
| Took standard deduction? | 1040 Line 12 | Yes |
| Standard deduction claimed | 1040 Line 12a | |
| Itemized deductions total | Schedule A Line 17 | — |
| — State & local taxes paid (SALT) | Schedule A Line 5d | — |
| — Mortgage interest | Schedule A Line 8a | — |
| — Charitable cash contributions | Schedule A Line 11 | — |
| — Charitable non-cash contributions | Schedule A Line 12 | — |
| — Other itemized | Schedule A Line 16 | — |
| **TAX** | | |
| Taxable income | 1040 Line 15 | |
| Total federal tax | 1040 Line 24 | |
| Child / dependent tax credits | 1040 Line 19 | |
| Federal tax withheld | 1040 Line 25a | |
| Refund (+) or owed (−) | 1040 Line 35a / 37 | |
| **APPRECIATED ASSETS (for stock donations)** | | |
| Approx. unrealized long-term gains in brokerage | Personal estimate | |
```
