#!/usr/bin/env node
/**
 * Tax Document Ingester
 * Reads a PDF (W2, 1099, TurboTax summary, brokerage/bank statement),
 * extracts structured financial data via Claude, and upserts to Supabase.
 *
 * Usage:
 *   node ingest-tax-doc.js --file ~/Downloads/W2_2025.pdf --type w2
 *   node ingest-tax-doc.js --file ~/Downloads/TurboTax_2025.pdf --type turbotax
 *   node ingest-tax-doc.js --file ~/Downloads/Schwab_Dec2025.pdf --type brokerage
 *   node ingest-tax-doc.js --file ~/Downloads/Chase_Dec2025.pdf --type bank
 *   node ingest-tax-doc.js --file ~/Downloads/1099-B_2025.pdf --type 1099b
 *   node ingest-tax-doc.js --file ~/Downloads/1099-DIV_2025.pdf --type 1099div
 *   node ingest-tax-doc.js --file ~/Downloads/RSU_2025.pdf --type rsu
 *   node ingest-tax-doc.js --file ... --dry-run
 *
 * Env vars required:
 *   SUPABASE_SERVICE_ROLE_KEY
 *   OPENROUTER_API_KEY  (uses claude-sonnet for extraction)
 *
 * Supported --type values:
 *   w2          → finance_income (wages, withholding)
 *   1099b       → finance_income (stock sales, capital gains)
 *   1099div     → finance_income (dividends)
 *   1099int     → finance_income (interest)
 *   rsu         → finance_income (RSU vests)
 *   turbotax    → finance_tax_profile + finance_income summary
 *   brokerage   → finance_net_worth (account snapshot) + finance_income (if dividends/interest)
 *   bank        → finance_net_worth (checking/savings snapshot)
 *   auto        → let Claude infer the document type (default)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { promptAndVerify, hasLocalSecret } from "./lib/totp.js";
import { redactSensitiveIds, printRedactionSummary } from "./lib/redact.js";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = "https://epckjiufeimydxmcrfus.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const SKIP_2FA = args.includes("--skip-2fa");  // only for dry-run testing
const fileIdx = args.indexOf("--file");
const typeIdx = args.indexOf("--type");
const taxYearIdx = args.indexOf("--year");

if (fileIdx === -1) {
  console.error(
    "Usage: node ingest-tax-doc.js --file /path/to/doc.pdf [--type w2|1099b|1099div|1099int|rsu|turbotax|brokerage|bank|auto] [--year 2025] [--dry-run]"
  );
  process.exit(1);
}

const PDF_FILE = args[fileIdx + 1];
const DOC_TYPE = typeIdx !== -1 ? args[typeIdx + 1] : "auto";
const OVERRIDE_YEAR = taxYearIdx !== -1 ? parseInt(args[taxYearIdx + 1]) : null;

// ── DOCUMENT TYPE SCHEMAS ─────────────────────────────────────────
// Each type tells Claude exactly what fields to extract.

const TYPE_PROMPTS = {
  w2: `You are extracting data from a W-2 Wage and Tax Statement.
Extract the following fields as JSON:
{
  "tax_year": number,
  "employer_name": string,
  "wages_tips": number,           // Box 1
  "federal_income_tax_withheld": number, // Box 2
  "social_security_wages": number,       // Box 3
  "social_security_tax": number,         // Box 4
  "medicare_wages": number,              // Box 5
  "medicare_tax": number,                // Box 6
  "state_wages": number,                 // Box 16
  "state_income_tax": number,            // Box 17
  "pre_tax_benefits": number,            // Box 12 codes (401k, HSA, FSA combined)
  "401k_contributions": number,          // Box 12 Code D specifically
  "notes": string                        // any notable items (stock awards, supplemental pay)
}`,

  "1099b": `You are extracting data from a 1099-B Proceeds from Broker Transactions.
Extract as JSON:
{
  "tax_year": number,
  "broker_name": string,
  "proceeds": number,
  "cost_basis": number,
  "net_gain_loss": number,
  "short_term_gain_loss": number,
  "long_term_gain_loss": number,
  "wash_sales_disallowed": number,
  "transactions": [
    {
      "description": string,      // e.g. "100 shares GOOG"
      "proceeds": number,
      "cost_basis": number,
      "gain_loss": number,
      "holding_period": "short" | "long",
      "sale_date": "YYYY-MM-DD"
    }
  ]
}`,

  "1099div": `You are extracting data from a 1099-DIV Dividends and Distributions.
Extract as JSON:
{
  "tax_year": number,
  "payer_name": string,
  "total_ordinary_dividends": number,    // Box 1a
  "qualified_dividends": number,         // Box 1b
  "total_capital_gain_distributions": number, // Box 2a
  "nondividend_distributions": number,   // Box 3
  "federal_income_tax_withheld": number  // Box 4
}`,

  "1099int": `You are extracting data from a 1099-INT Interest Income statement.
Extract as JSON:
{
  "tax_year": number,
  "payer_name": string,
  "interest_income": number,             // Box 1
  "early_withdrawal_penalty": number,    // Box 2
  "us_savings_bond_interest": number,    // Box 3
  "federal_income_tax_withheld": number, // Box 4
  "investment_expenses": number          // Box 5
}`,

  rsu: `You are extracting RSU (Restricted Stock Unit) vest data from a brokerage or employer statement.
Extract as JSON:
{
  "tax_year": number,
  "company": string,
  "vests": [
    {
      "vest_date": "YYYY-MM-DD",
      "shares_vested": number,
      "fmv_per_share": number,    // Fair Market Value at vest
      "gross_income": number,     // shares_vested * fmv_per_share
      "shares_sold_for_tax": number,  // shares withheld for taxes
      "net_shares_deposited": number
    }
  ],
  "total_gross_income": number,
  "total_shares_vested": number
}`,

  turbotax: `You are extracting data from a TurboTax tax return summary, 1040 summary, or tax filing document.
Extract as JSON:
{
  "tax_year": number,
  "filing_status": "single" | "married_filing_jointly" | "married_filing_separately" | "head_of_household",
  "total_income": number,
  "adjustments_to_income": number,      // above-the-line deductions
  "adjusted_gross_income": number,      // AGI
  "standard_deduction": number,
  "itemized_deductions": number,        // 0 if took standard deduction
  "took_itemized": boolean,
  "taxable_income": number,
  "total_tax": number,
  "federal_income_tax": number,
  "self_employment_tax": number,
  "total_payments": number,             // withholding + estimated payments
  "refund_or_owed": number,             // positive = refund, negative = owed
  "child_tax_credit": number,
  "effective_tax_rate": number,
  "income_sources": {
    "wages_salaries": number,
    "dividends": number,
    "capital_gains": number,
    "other_income": number
  },
  "deductions_detail": {
    "mortgage_interest": number,
    "charitable_contributions": number,
    "state_local_taxes": number,        // SALT (capped at $10k)
    "medical_expenses": number,
    "other_itemized": number
  },
  "pre_tax_deductions": number          // 401k + HSA + FSA (reduces AGI)
}`,

  brokerage: `You are extracting data from a monthly brokerage account statement (e.g. Schwab, Fidelity, Vanguard, Morgan Stanley).
Extract as JSON:
{
  "statement_date": "YYYY-MM-DD",       // end of statement period
  "institution": string,
  "account_type": string,               // brokerage, IRA, Roth IRA, 401k
  "account_number_last4": string,
  "total_account_value": number,
  "cash_balance": number,
  "securities_value": number,
  "period_dividends_received": number,
  "period_interest_received": number,
  "period_realized_gains_losses": number,
  "top_holdings": [
    { "symbol": string, "shares": number, "value": number }
  ]
}`,

  bank: `You are extracting data from a monthly bank statement (checking or savings account).
Extract as JSON:
{
  "statement_date": "YYYY-MM-DD",       // end of statement period
  "institution": string,
  "account_type": "checking" | "savings" | "money_market",
  "account_number_last4": string,
  "ending_balance": number,
  "period_deposits": number,
  "period_withdrawals": number,
  "interest_earned": number
}`,

  auto: `You are a tax document analyzer. First identify the document type, then extract all relevant financial data.
Return JSON with this structure:
{
  "detected_type": "w2" | "1099b" | "1099div" | "1099int" | "rsu" | "turbotax" | "brokerage" | "bank" | "other",
  "tax_year": number,
  "institution_or_employer": string,
  "summary": string,   // 2-3 sentence plain English summary of what this document shows
  "extracted_data": { ... }  // the full structured data relevant to this document type
}`,
};

// ── PDF TEXT EXTRACTION + LOCAL REDACTION ─────────────────────────
// SSNs and EINs are stripped HERE, before text is ever sent to any LLM.
async function extractAndRedactPdfText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  const raw = data.text;

  console.log("   Running local SSN/EIN redaction (before LLM)...");
  const { text: redacted, stats } = redactSensitiveIds(raw);
  printRedactionSummary(stats);

  return redacted;
}

// ── CLAUDE EXTRACTION ─────────────────────────────────────────────
async function extractWithClaude(text, docType) {
  const systemPrompt = TYPE_PROMPTS[docType] ?? TYPE_PROMPTS.auto;

  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-4-5",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Here is the extracted text from the PDF document. Please extract the structured data as specified:\n\n${text.slice(0, 80000)}`,
        },
      ],
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Claude extraction failed: ${r.status} ${err}`);
  }

  const d = await r.json();
  return JSON.parse(d.choices[0].message.content);
}

// ── SUPABASE HELPERS ──────────────────────────────────────────────
async function upsert(table, rows, onConflict) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates",
  };

  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase upsert to ${table} failed: ${err}`);
  }
  return rows;
}

// ── WRITE HANDLERS ────────────────────────────────────────────────
// Each handler takes extracted JSON and writes to the right tables.

async function handleW2(data) {
  const taxYear = OVERRIDE_YEAR ?? data.tax_year;
  const rows = [
    {
      income_date: `${taxYear}-12-31`,
      tax_year: taxYear,
      source: data.employer_name,
      income_type: "w2",
      gross_amount: data.wages_tips,
      is_taxable: true,
      notes: [
        `Federal withheld: $${data.federal_income_tax_withheld?.toLocaleString()}`,
        `State withheld: $${data.state_income_tax?.toLocaleString()}`,
        data["401k_contributions"] ? `401k: $${data["401k_contributions"]?.toLocaleString()}` : null,
        data.notes,
      ]
        .filter(Boolean)
        .join(" | "),
    },
  ];

  console.log(`\n📋 W2 - ${data.employer_name} (${taxYear})`);
  console.log(`   Wages: $${data.wages_tips?.toLocaleString()}`);
  console.log(`   Federal withheld: $${data.federal_income_tax_withheld?.toLocaleString()}`);
  if (data["401k_contributions"]) console.log(`   401k: $${data["401k_contributions"]?.toLocaleString()}`);
  if (data.notes) console.log(`   Notes: ${data.notes}`);

  return { table: "finance_income", rows };
}

async function handle1099B(data) {
  const taxYear = OVERRIDE_YEAR ?? data.tax_year;
  const rows = [
    {
      income_date: `${taxYear}-12-31`,
      tax_year: taxYear,
      source: data.broker_name,
      income_type: "capital_gains",
      gross_amount: data.proceeds,
      net_amount: data.net_gain_loss,
      is_taxable: true,
      notes: [
        `Proceeds: $${data.proceeds?.toLocaleString()}`,
        `Cost basis: $${data.cost_basis?.toLocaleString()}`,
        `ST gain/loss: $${data.short_term_gain_loss?.toLocaleString()}`,
        `LT gain/loss: $${data.long_term_gain_loss?.toLocaleString()}`,
        data.wash_sales_disallowed ? `Wash sale disallowed: $${data.wash_sales_disallowed?.toLocaleString()}` : null,
      ]
        .filter(Boolean)
        .join(" | "),
    },
  ];

  console.log(`\n📋 1099-B - ${data.broker_name} (${taxYear})`);
  console.log(`   Proceeds: $${data.proceeds?.toLocaleString()}`);
  console.log(`   Net gain/loss: $${data.net_gain_loss?.toLocaleString()}`);
  console.log(`   Short-term: $${data.short_term_gain_loss?.toLocaleString()} | Long-term: $${data.long_term_gain_loss?.toLocaleString()}`);

  return { table: "finance_income", rows };
}

async function handle1099Div(data) {
  const taxYear = OVERRIDE_YEAR ?? data.tax_year;
  const rows = [
    {
      income_date: `${taxYear}-12-31`,
      tax_year: taxYear,
      source: data.payer_name,
      income_type: "dividend",
      gross_amount: data.total_ordinary_dividends,
      is_taxable: true,
      notes: `Qualified: $${data.qualified_dividends?.toLocaleString()} | Cap gain dist: $${data.total_capital_gain_distributions?.toLocaleString()}`,
    },
  ];

  console.log(`\n📋 1099-DIV - ${data.payer_name} (${taxYear})`);
  console.log(`   Ordinary dividends: $${data.total_ordinary_dividends?.toLocaleString()}`);
  console.log(`   Qualified: $${data.qualified_dividends?.toLocaleString()}`);

  return { table: "finance_income", rows };
}

async function handle1099Int(data) {
  const taxYear = OVERRIDE_YEAR ?? data.tax_year;
  const rows = [
    {
      income_date: `${taxYear}-12-31`,
      tax_year: taxYear,
      source: data.payer_name,
      income_type: "interest",
      gross_amount: data.interest_income,
      is_taxable: true,
      notes: `Interest income from ${data.payer_name}`,
    },
  ];

  console.log(`\n📋 1099-INT - ${data.payer_name} (${taxYear})`);
  console.log(`   Interest: $${data.interest_income?.toLocaleString()}`);

  return { table: "finance_income", rows };
}

async function handleRSU(data) {
  const taxYear = OVERRIDE_YEAR ?? data.tax_year;
  const rows = (data.vests ?? []).map((v) => ({
    income_date: v.vest_date,
    tax_year: taxYear,
    source: data.company,
    income_type: "rsu",
    gross_amount: v.gross_income,
    is_taxable: true,
    notes: `${v.shares_vested} shares @ $${v.fmv_per_share}/share | Net deposited: ${v.net_shares_deposited} shares`,
  }));

  if (!rows.length) {
    rows.push({
      income_date: `${taxYear}-12-31`,
      tax_year: taxYear,
      source: data.company,
      income_type: "rsu",
      gross_amount: data.total_gross_income,
      is_taxable: true,
      notes: `Total RSU vests: ${data.total_shares_vested} shares`,
    });
  }

  console.log(`\n📋 RSU Vests - ${data.company} (${taxYear})`);
  console.log(`   Total gross: $${data.total_gross_income?.toLocaleString()}`);
  console.log(`   Total shares: ${data.total_shares_vested}`);
  if (data.vests?.length) {
    data.vests.forEach((v) =>
      console.log(`   ${v.vest_date}: ${v.shares_vested} shares @ $${v.fmv_per_share} = $${v.gross_income?.toLocaleString()}`)
    );
  }

  return { table: "finance_income", rows };
}

async function handleTurboTax(data) {
  const taxYear = OVERRIDE_YEAR ?? data.tax_year;

  const taxProfileRow = {
    tax_year: taxYear,
    filing_status: data.filing_status ?? "married_filing_jointly",
    state: "CA",
    estimated_gross_income: data.total_income,
    pre_tax_deductions: data.pre_tax_deductions,
    estimated_agi: data.adjusted_gross_income,
    itemized_deductions: data.took_itemized ? data.itemized_deductions : null,
    standard_deduction: data.standard_deduction,
    taxable_income: data.taxable_income,
    estimated_federal_tax: data.federal_income_tax,
    effective_rate: data.effective_tax_rate,
    child_tax_credit: data.child_tax_credit,
    notes: [
      data.refund_or_owed > 0
        ? `Refund: $${data.refund_or_owed?.toLocaleString()}`
        : `Owed: $${Math.abs(data.refund_or_owed ?? 0)?.toLocaleString()}`,
      data.took_itemized ? "Itemized deductions" : "Standard deduction",
      data.deductions_detail?.charitable_contributions
        ? `Charitable: $${data.deductions_detail.charitable_contributions?.toLocaleString()}`
        : null,
    ]
      .filter(Boolean)
      .join(" | "),
    updated_at: new Date().toISOString(),
  };

  console.log(`\n📋 TurboTax Return Summary (${taxYear})`);
  console.log(`   AGI: $${data.adjusted_gross_income?.toLocaleString()}`);
  console.log(`   Taxable income: $${data.taxable_income?.toLocaleString()}`);
  console.log(`   Federal tax: $${data.federal_income_tax?.toLocaleString()}`);
  console.log(`   Effective rate: ${data.effective_tax_rate}%`);
  if (data.child_tax_credit) console.log(`   CTC: $${data.child_tax_credit?.toLocaleString()}`);
  const refundOwed = data.refund_or_owed;
  if (refundOwed > 0) console.log(`   Refund: $${refundOwed?.toLocaleString()}`);
  else if (refundOwed < 0) console.log(`   Owed: $${Math.abs(refundOwed)?.toLocaleString()}`);

  return { table: "finance_tax_profile", rows: [taxProfileRow] };
}

async function handleBrokerage(data) {
  const stmtDate = data.statement_date;
  const snapshotRow = {
    snapshot_date: stmtDate,
    brokerage: data.total_account_value,
    liquid_cash: data.cash_balance,
    notes: `${data.institution} ${data.account_type} *${data.account_number_last4} | Period dividends: $${data.period_dividends_received?.toLocaleString()}`,
  };

  console.log(`\n📋 Brokerage Statement - ${data.institution} (${stmtDate})`);
  console.log(`   Account: ${data.account_type} *${data.account_number_last4}`);
  console.log(`   Total value: $${data.total_account_value?.toLocaleString()}`);
  console.log(`   Cash: $${data.cash_balance?.toLocaleString()}`);
  if (data.period_dividends_received) console.log(`   Dividends: $${data.period_dividends_received?.toLocaleString()}`);
  if (data.top_holdings?.length) {
    console.log(`   Top holdings:`);
    data.top_holdings.slice(0, 5).forEach((h) => console.log(`     ${h.symbol}: ${h.shares} shares = $${h.value?.toLocaleString()}`));
  }

  return { table: "finance_net_worth", rows: [snapshotRow] };
}

async function handleBank(data) {
  const stmtDate = data.statement_date;
  const field = data.account_type === "savings" ? "checking_savings" : "checking_savings";
  const snapshotRow = {
    snapshot_date: stmtDate,
    [field]: data.ending_balance,
    notes: `${data.institution} ${data.account_type} *${data.account_number_last4}`,
  };

  console.log(`\n📋 Bank Statement - ${data.institution} (${stmtDate})`);
  console.log(`   Account: ${data.account_type} *${data.account_number_last4}`);
  console.log(`   Ending balance: $${data.ending_balance?.toLocaleString()}`);

  return { table: "finance_net_worth", rows: [snapshotRow] };
}

async function handleAuto(data) {
  const { detected_type, summary, extracted_data } = data;

  console.log(`\n📋 Auto-detected type: ${detected_type}`);
  console.log(`   ${summary}`);
  console.log("\n📊 Extracted data:");
  console.log(JSON.stringify(extracted_data, null, 2));

  // Dispatch to the right handler
  const handlers = {
    w2: () => handleW2({ ...extracted_data, tax_year: data.tax_year }),
    "1099b": () => handle1099B({ ...extracted_data, tax_year: data.tax_year }),
    "1099div": () => handle1099Div({ ...extracted_data, tax_year: data.tax_year }),
    "1099int": () => handle1099Int({ ...extracted_data, tax_year: data.tax_year }),
    rsu: () => handleRSU({ ...extracted_data, tax_year: data.tax_year }),
    turbotax: () => handleTurboTax({ ...extracted_data, tax_year: data.tax_year }),
    brokerage: () => handleBrokerage(extracted_data),
    bank: () => handleBank(extracted_data),
  };

  if (handlers[detected_type]) {
    return handlers[detected_type]();
  }

  console.log(`\n⚠️  Unknown document type '${detected_type}' — printed above, nothing written to Supabase.`);
  return null;
}

// ── MAIN ──────────────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_KEY && !DRY_RUN) {
    console.error("❌ Missing SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!OPENROUTER_KEY) {
    console.error("❌ Missing OPENROUTER_API_KEY");
    process.exit(1);
  }
  if (!fs.existsSync(PDF_FILE)) {
    console.error(`❌ File not found: ${PDF_FILE}`);
    process.exit(1);
  }

  // ── 2FA: require TOTP before writing ──────────────────────────
  // Skipped only in dry-run mode or with explicit --skip-2fa (for testing)
  if (!DRY_RUN && !SKIP_2FA) {
    if (!hasLocalSecret()) {
      console.error("❌ 2FA not configured. Run: node setup-totp.js");
      process.exit(1);
    }
    await promptAndVerify();
  } else if (DRY_RUN) {
    console.log("   [dry-run] Skipping 2FA verification.");
  }

  const filename = path.basename(PDF_FILE);
  console.log(`\n📂 Reading: ${filename}`);
  console.log(`   Type: ${DOC_TYPE}${OVERRIDE_YEAR ? ` | Year override: ${OVERRIDE_YEAR}` : ""}`);

  // ── PDF extraction + LOCAL redaction (SSN/EIN stripped before LLM) ──
  const text = await extractAndRedactPdfText(PDF_FILE);
  console.log(`   ${text.length} characters (after redaction)`);

  if (text.trim().length < 50) {
    console.error("❌ PDF text extraction yielded very little content. PDF may be image-based (scanned). Try a searchable PDF.");
    process.exit(1);
  }

  // Extract structured data via Claude (redacted text only)
  console.log("   Sending redacted text to Claude for extraction...");
  const extracted = await extractWithClaude(text, DOC_TYPE);

  if (DRY_RUN) {
    console.log("\n[dry-run] Extracted JSON (SSNs/EINs have been redacted):");
    console.log(JSON.stringify(extracted, null, 2));
    return;
  }

  // Route to correct handler
  const HANDLERS = {
    w2: handleW2,
    "1099b": handle1099B,
    "1099div": handle1099Div,
    "1099int": handle1099Int,
    rsu: handleRSU,
    turbotax: handleTurboTax,
    brokerage: handleBrokerage,
    bank: handleBank,
    auto: handleAuto,
  };

  const handler = HANDLERS[DOC_TYPE];
  if (!handler) {
    console.error(`❌ Unknown document type: ${DOC_TYPE}`);
    process.exit(1);
  }

  const result = await handler(extracted);

  if (!result) return;

  const { table, rows } = result;
  console.log(`\n💾 Writing ${rows.length} row(s) to ${table}...`);
  await upsert(table, rows);
  console.log(`✅ Done — ${rows.length} row(s) upserted to ${table}.`);
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
