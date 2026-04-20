#!/usr/bin/env node
/**
 * Demo: shows exactly what the terminal output looks like when you
 * run ingest-tax-doc.js against a real tax document.
 *
 * Simulates the full pipeline (redaction → Claude extraction → write)
 * using hardcoded sample text so no real PDF or API keys are needed.
 *
 * Run: node demo-output.js
 */

import { redactSensitiveIds, printRedactionSummary } from "./lib/redact.js";

// ── Simulated raw PDF text (what pdf-parse returns from a real W2) ─
const SAMPLE_DOCS = {
  w2: {
    label: "W2_Google_2025.pdf",
    type: "w2",
    rawText: `
      2025 W-2 Wage and Tax Statement

      a  Employee's social security number
         123-45-6789

      b  Employer identification number (EIN)
         61-1234567

      c  Employer's name, address, and ZIP code
         Google LLC
         1600 Amphitheatre Pkwy
         Mountain View, CA 94043

      d  Control number
         2025-W2-00182

      e  Employee's name
         Umair Ahmed

      f  Employee's address
         123 Oak Street, San Jose CA 95101

      1  Wages, tips, other compensation     2  Federal income tax withheld
         285,000.00                              62,450.00

      3  Social security wages               4  Social security tax withheld
         160,200.00                              9,932.40

      5  Medicare wages and tips             6  Medicare tax withheld
         285,000.00                              4,132.50

      12a Code D  (401k contributions)
          23,500.00

      12b Code W  (HSA employer contribution)
          1,500.00

      15  State   Employer's state ID number
          CA      123-4567-8

      16  State wages, tips, etc.            17  State income tax
          285,000.00                              28,500.00
    `,
    // What Claude returns after seeing the redacted text
    claudeExtracted: {
      tax_year: 2025,
      employer_name: "Google LLC",
      wages_tips: 285000,
      federal_income_tax_withheld: 62450,
      social_security_wages: 160200,
      social_security_tax: 9932.40,
      medicare_wages: 285000,
      medicare_tax: 4132.50,
      state_wages: 285000,
      state_income_tax: 28500,
      "401k_contributions": 23500,
      pre_tax_benefits: 25000,
      notes: "HSA employer contribution $1,500 in Box 12W",
    },
  },

  turbotax: {
    label: "TurboTax_Federal_2025.pdf",
    type: "turbotax",
    rawText: `
      TurboTax — 2025 Federal Tax Return Summary
      Form 1040 — U.S. Individual Income Tax Return

      Your name: Umair Ahmed
      Your SSN:  123-45-6789
      Spouse's name: [Spouse Name]
      Spouse's SSN:  987-65-4321

      Filing status: Married Filing Jointly

      ─────────────────────────────────────────
      INCOME
      ─────────────────────────────────────────
      Wages and salaries                   $285,000
      Taxable interest                       $1,240
      Ordinary dividends                     $3,450
      Qualified dividends                    $3,100
      Capital gain distributions               $820
      Total income                         $290,510

      ─────────────────────────────────────────
      ADJUSTMENTS
      ─────────────────────────────────────────
      401(k) contributions                 -$23,500
      HSA deduction                         -$4,150
      Adjusted Gross Income (AGI)          $262,860

      ─────────────────────────────────────────
      DEDUCTIONS
      ─────────────────────────────────────────
      Standard deduction (MFJ)             $30,000
      Taxable income                       $232,860

      ─────────────────────────────────────────
      TAX COMPUTATION
      ─────────────────────────────────────────
      Federal income tax                    $49,814
      Self-employment tax                        $0
      Total tax                             $49,814

      Child Tax Credit (3 children)         -$6,000
      Total payments (withheld)            -$62,450
      Refund                                $18,636

      Effective tax rate                      16.9%
      Marginal tax rate                         24%

      Preparer: Self-prepared
      PTIN: P98765432
    `,
    claudeExtracted: {
      tax_year: 2025,
      filing_status: "married_filing_jointly",
      total_income: 290510,
      adjustments_to_income: 27650,
      adjusted_gross_income: 262860,
      standard_deduction: 30000,
      itemized_deductions: 0,
      took_itemized: false,
      taxable_income: 232860,
      total_tax: 49814,
      federal_income_tax: 49814,
      self_employment_tax: 0,
      total_payments: 62450,
      refund_or_owed: 18636,
      child_tax_credit: 6000,
      effective_tax_rate: 16.9,
      income_sources: {
        wages_salaries: 285000,
        dividends: 3450,
        capital_gains: 820,
        other_income: 1240,
      },
      deductions_detail: {
        mortgage_interest: 0,
        charitable_contributions: 0,
        state_local_taxes: 0,
        medical_expenses: 0,
        other_itemized: 0,
      },
      pre_tax_deductions: 27650,
    },
  },

  "1099nec": {
    label: "1099-NEC_Consulting_2025.pdf",
    type: "auto",
    rawText: `
      CORRECTED (if checked)

      PAYER'S name, street address, city, state, ZIP code
      Acme Consulting LLC
      500 Innovation Drive, Austin TX 78701

      PAYER'S TIN         RECIPIENT'S TIN
      98-7654321          234-56-7890

      RECIPIENT'S name
      Umair Ahmed
      123 Oak Street
      San Jose CA 95101

      Account number: REF-2025-0042

      1  Nonemployee compensation
         $45,000.00

      4  Federal income tax withheld
         $0.00

      Paid preparer use only
      Self-prepared / PTIN: P12345678
    `,
    claudeExtracted: {
      detected_type: "1099b",
      tax_year: 2025,
      institution_or_employer: "Acme Consulting LLC",
      summary: "1099-NEC showing $45,000 in nonemployee compensation from Acme Consulting LLC. No federal income tax was withheld. Preparer PTIN P12345678.",
      extracted_data: {
        payer_name: "Acme Consulting LLC",
        nonemployee_compensation: 45000,
        federal_tax_withheld: 0,
      },
    },
  },
};

// ── Simulate the pipeline for each doc ───────────────────────────
function simulatePipeline(doc) {
  const border = "═".repeat(62);
  console.log(`\n${border}`);
  console.log(`  $ node ingest-tax-doc.js --file ~/Downloads/${doc.label} --type ${doc.type} --dry-run`);
  console.log(border);

  // Step 1: 2FA (dry-run skips it)
  console.log("\n   [dry-run] Skipping 2FA verification.");

  // Step 2: Reading file
  console.log(`\n📂 Reading: ${doc.label}`);
  console.log(`   Type: ${doc.type}`);

  // Step 3: Redaction
  console.log("   Running local SSN/EIN redaction (before LLM)...");
  const { text: redacted, stats } = redactSensitiveIds(doc.rawText);
  printRedactionSummary(stats);
  console.log(`   ${redacted.length} characters (after redaction)`);

  // Step 4: Show what text is sent to Claude (excerpt)
  console.log("\n   ── Text sent to Claude (first 400 chars, post-redaction) ──");
  const excerpt = redacted.trim().slice(0, 400).replace(/\n/g, "\n   ");
  console.log(`   ${excerpt}`);
  if (redacted.length > 400) console.log("   [... truncated ...]");

  // Step 5: Claude response
  console.log("\n   Sending redacted text to Claude for extraction...");
  console.log("\n[dry-run] Extracted JSON (SSNs/EINs have been redacted):");
  console.log(JSON.stringify(doc.claudeExtracted, null, 2));

  // Step 6: What WOULD be written to Supabase (if not dry-run)
  console.log("\n   ── If you re-run WITHOUT --dry-run ──────────────────────");
  if (doc.type === "w2") {
    console.log("   🔐 Enter Google Authenticator code (attempt 1/3): ______");
    console.log("   ✅ Identity verified.");
    console.log(`\n📋 W2 - ${doc.claudeExtracted.employer_name} (${doc.claudeExtracted.tax_year})`);
    console.log(`   Wages: $${doc.claudeExtracted.wages_tips?.toLocaleString()}`);
    console.log(`   Federal withheld: $${doc.claudeExtracted.federal_income_tax_withheld?.toLocaleString()}`);
    console.log(`   401k: $${doc.claudeExtracted["401k_contributions"]?.toLocaleString()}`);
    console.log(`   Notes: ${doc.claudeExtracted.notes}`);
    console.log("\n💾 Writing 1 row(s) to finance_income...");
    console.log("✅ Done — 1 row(s) upserted to finance_income.");
  } else if (doc.type === "turbotax") {
    console.log("   🔐 Enter Google Authenticator code (attempt 1/3): ______");
    console.log("   ✅ Identity verified.");
    const d = doc.claudeExtracted;
    console.log(`\n📋 TurboTax Return Summary (${d.tax_year})`);
    console.log(`   AGI: $${d.adjusted_gross_income?.toLocaleString()}`);
    console.log(`   Taxable income: $${d.taxable_income?.toLocaleString()}`);
    console.log(`   Federal tax: $${d.federal_income_tax?.toLocaleString()}`);
    console.log(`   Effective rate: ${d.effective_tax_rate}%`);
    console.log(`   CTC: $${d.child_tax_credit?.toLocaleString()}`);
    console.log(`   Refund: $${d.refund_or_owed?.toLocaleString()}`);
    console.log("\n💾 Writing 1 row(s) to finance_tax_profile...");
    console.log("✅ Done — 1 row(s) upserted to finance_tax_profile.");
  } else {
    console.log("   (auto mode — dispatches to the right handler after type detection)");
  }
}

// ── Run all three demos ───────────────────────────────────────────
for (const doc of Object.values(SAMPLE_DOCS)) {
  simulatePipeline(doc);
}

console.log("\n");
