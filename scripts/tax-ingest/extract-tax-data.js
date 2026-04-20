#!/usr/bin/env node
/**
 * extract-tax-data.js — pulls DAF-relevant values from tax return PDFs
 *
 * LOCAL ONLY. Zero network calls. Zero LLM. Uses pdfjs-dist (already installed).
 * Reads the PDF file, extracts text line-by-line, pattern-matches known labels,
 * and writes values into the corresponding year table in tax-data.md.
 *
 * Usage:
 *   node extract-tax-data.js --file ~/Downloads/TurboTax_2024.pdf --year 2024
 *   node extract-tax-data.js --file ~/Downloads/TurboTax_2024.pdf --year 2024 --update
 *   node extract-tax-data.js --file ~/Downloads/TurboTax_2024.pdf --year 2024 --debug
 */

import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as pdfjsLib from "./node_modules/pdfjs-dist/legacy/build/pdf.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(
  __dirname, "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
);

// ── CLI args ───────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const fileIdx = args.indexOf("--file");
const yearIdx = args.indexOf("--year");
const UPDATE  = args.includes("--update");
const DEBUG   = args.includes("--debug");

if (fileIdx === -1) {
  console.error(
    "\nUsage: node extract-tax-data.js --file /path/to/return.pdf --year 2024 [--update] [--debug]\n"
  );
  process.exit(1);
}

const inputPath = args[fileIdx + 1].replace(/^~/, process.env.HOME);
const taxYear   = yearIdx !== -1 ? args[yearIdx + 1] : null;

if (!fs.existsSync(inputPath)) {
  console.error(`\n❌  File not found: ${inputPath}\n`);
  process.exit(1);
}

// ── Field definitions ──────────────────────────────────────────────────────────
// labels: substrings / patterns searched in extracted PDF lines (case-insensitive)
// mdLabel: exact text of column 1 in the tax-data.md table row to update
// type: amount | status | yesno
//
// ORDERING MATTERS: more specific labels must come before general ones so that
// "federal income tax withheld" doesn't collide with "total tax".

const FIELDS = [
  // ── Filing status ────────────────────────────────────────────────────────────
  {
    key: "filing_status",
    mdLabel: "Filing status",
    type: "status",
    labels: ["filing status", "married filing jointly", "married filing separately",
             "head of household", "qualifying widow", "qualifying surviving"],
  },

  // ── Income ───────────────────────────────────────────────────────────────────
  {
    key: "wages",
    mdLabel: "Wages & salary",
    type: "amount",
    labels: ["wages, salaries, tips", "wages and salaries", "wages, salaries",
             "1z wages", "1z  wages", "line 1z"],
  },
  {
    key: "business_income",
    mdLabel: "Business / self-employment income",
    type: "amount",
    labels: ["net profit or loss", "profit or (loss) from business",
             "schedule c.*net profit", "self-employment.*income",
             "business income or (loss)"],
  },
  {
    key: "ltcg",
    mdLabel: "Long-term capital gains",
    type: "amount",
    labels: ["net long-term capital gain", "long-term capital gain",
             "long term capital gain"],
  },
  {
    key: "stcg",
    mdLabel: "Short-term capital gains",
    type: "amount",
    labels: ["net short-term capital gain", "short-term capital gain",
             "short term capital gain"],
  },
  {
    key: "dividends",
    mdLabel: "Dividends (ordinary)",
    type: "amount",
    labels: ["ordinary dividends", "3b.*dividends", "line 3b"],
  },
  {
    key: "other_income",
    mdLabel: "Other income",
    type: "amount",
    // Be specific — "other income" appears in Schedule 1 aggregate lines too
    labels: ["other income from schedule", "line 8.*other income",
             "other income \\(loss\\)", "miscellaneous income"],
  },
  {
    key: "total_income",
    mdLabel: "Total income",
    type: "amount",
    labels: ["total income", "line 9.*total income", "9  total income"],
  },

  // ── Adjustments ──────────────────────────────────────────────────────────────
  {
    key: "retirement",
    mdLabel: "401k / 403b / SEP contributions",
    type: "amount",
    positive: true,  // TurboTax shows as -$23,000; we store the contribution amount
    labels: ["401(k)", "401k", "403(b)", "sep, simple", "sep-ira",
             "self-employed sep", "retirement contributions"],
  },
  {
    key: "hsa",
    mdLabel: "HSA deduction",
    type: "amount",
    positive: true,
    labels: ["hsa deduction", "health savings account deduction",
             "archer msa deduction"],
  },
  {
    key: "other_adjustments",
    mdLabel: "Other above-the-line deductions",
    type: "amount",
    labels: ["other adjustments to income", "total other adjustments",
             "educator expenses", "student loan interest deduction",
             "alimony paid"],
  },

  // ── AGI ──────────────────────────────────────────────────────────────────────
  {
    key: "agi",
    mdLabel: "**AGI**",
    type: "amount",
    labels: ["adjusted gross income", " agi ", "(agi)", "line 11.*adjusted"],
  },

  // ── Deductions (must match standard deduction BEFORE total-tax searches) ─────
  {
    key: "standard_deduction",
    mdLabel: "Standard deduction claimed",
    type: "amount",
    labels: [
      "standard deduction \\(mfj", "standard deduction \\(single",
      "standard deduction \\(hoh", "standard deduction \\(mfs",
      "standard deduction \\(qw",
      "your standard deduction is",
      "standard deduction for",
      // TurboTax summary
      "standard deduction \\(",
    ],
  },
  {
    key: "itemized_total",
    mdLabel: "Itemized deductions total",
    type: "amount",
    labels: ["total itemized deductions", "itemized deductions.*total",
             "^itemized deductions", "schedule a total", "line 17.*itemized"],
  },
  {
    key: "salt",
    mdLabel: "— State & local taxes paid (SALT)",
    type: "amount",
    labels: ["state and local taxes", "state, local.*taxes",
             "state/local tax", "salt deduction",
             "state and local income taxes"],
  },
  {
    key: "mortgage_interest",
    mdLabel: "— Mortgage interest",
    type: "amount",
    labels: ["home mortgage interest", "deductible home mortgage",
             "mortgage interest paid", "qualified home mortgage"],
  },
  {
    key: "charitable_cash",
    mdLabel: "— Charitable cash contributions",
    type: "amount",
    // Must NOT match "non-cash contributions" — "cash contributions" is a substring
    // of "non-cash contributions", so all patterns are anchored or prefixed to avoid it.
    labels: [
      "cash charitable",              // "Cash charitable contributions" (TurboTax)
      "gifts by cash or check",       // Schedule A Line 11 official label
      "contributions by cash or check",
      "cash or check",
      "^cash contributions",          // starts with "cash contributions"
    ],
  },
  {
    key: "charitable_noncash",
    mdLabel: "— Charitable non-cash contributions",
    type: "amount",
    labels: ["non-cash contributions", "noncash contributions",
             "other than by cash", "gifts other than cash",
             "gifts of property"],
  },
  {
    key: "other_itemized",
    mdLabel: "— Other itemized",
    type: "amount",
    labels: ["other itemized deductions", "unreimbursed employee",
             "casualty and theft"],
  },

  // ── Tax (IMPORTANT: "withheld" before "total tax" to avoid false match) ──────
  {
    key: "withheld",
    mdLabel: "Federal tax withheld",
    type: "amount",
    positive: true,  // shown as -$68,000 in TurboTax; store as positive
    labels: ["federal income tax withheld", "federal tax withheld",
             "total federal income tax withheld",
             "total payments.*withheld"],
  },
  {
    key: "taxable_income",
    mdLabel: "Taxable income",
    type: "amount",
    labels: ["taxable income", "line 15.*taxable"],
  },
  {
    key: "total_tax",
    mdLabel: "Total federal tax",
    type: "amount",
    labels: [
      // "total tax" standalone — avoids matching "total tax withheld"
      "^total tax\\b", "line 24.*total tax",
      // TurboTax summary: "Federal income tax   $62,450" (NOT "...withheld")
      "^federal income tax(?! withheld)",
    ],
  },
  {
    key: "child_credit",
    mdLabel: "Child / dependent tax credits",
    type: "amount",
    positive: true,  // shown as negative in TurboTax; store as positive credit amount
    labels: ["child tax credit", "child and dependent care",
             "ctc.*credit", "child tax credit \\("],
  },
  {
    key: "refund_or_owed",
    mdLabel: "Refund (+) or owed (−)",
    type: "amount",
    // positive = refund, negative = owed; preserve sign
    labels: ["amount of your refund", "your refund is",
             "overpayment.*refunded", "^refund\\b",
             "amount you owe", "balance due"],
  },
];

// ── Extract all text lines from PDF ───────────────────────────────────────────
async function extractLines(pdfPath) {
  const raw = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data: raw, verbosity: 0 }).promise;

  const lines = []; // { page, y, text, rawSpans }

  for (let p = 1; p <= doc.numPages; p++) {
    const page    = await doc.getPage(p);
    const content = await page.getTextContent();

    // Group text spans by Y bucket (3-point tolerance for slightly misaligned spans)
    const byY = new Map();
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const bucket = Math.round(item.transform[5] / 3) * 3;
      if (!byY.has(bucket)) byY.set(bucket, []);
      byY.get(bucket).push({ str: item.str, x: item.transform[4] });
    }

    for (const [y, spans] of byY) {
      spans.sort((a, b) => a.x - b.x);
      const text = spans.map(s => s.str).join("  ").replace(/[ \t]+/g, " ").trim();
      if (text.length > 1) lines.push({ page: p, y, text });
    }
  }

  return lines;
}

// ── Dollar amount parser ───────────────────────────────────────────────────────
// Matches well-formed tax amounts. Negative lookahead/lookbehind prevents
// matching numbers that are part of words ("401k", "1040", "P98765432").
//
// Formats handled:
//   285,000   $285,000   (285,000)   -285,000   -$285,000   285,000.00
//
// NOT matched:
//   401k   (k follows)       401(k)  (open-paren follows)
//   1040   (digit run)       P98765432  (preceded by letter)
const AMT_RE = /(?<![A-Za-z\d])(\(?-?\$?[\d]{1,3}(?:,\d{3})*(?:\.\d{1,2})?\)?)(?![A-Za-z\d(])/g;

function parseAmount(str) {
  const neg = str.startsWith("(") || str.startsWith("-");
  const cleaned = str.replace(/[$(),\s-]/g, "").replace(/,/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : (neg ? -Math.abs(n) : n);
}

function amountsInLine(text) {
  return [...text.matchAll(AMT_RE)]
    .map(m => parseAmount(m[1]))
    .filter(v => v !== null && Math.abs(v) >= 10); // ignore line/form numbers (1–9)
}

function lineMatches(text, patterns) {
  const lower = text.toLowerCase();
  for (const pat of patterns) {
    // Try regex first (handles ^anchors, .* wildcards, lookaheads)
    try {
      if (new RegExp(pat, "i").test(lower)) return true;
    } catch { /* invalid regex — fall through to literal */ }
    // ALSO try literal substring — catches cases like "401(k)" where the pattern
    // is a valid regex but means something different from the literal string
    if (lower.includes(pat.toLowerCase())) return true;
  }
  return false;
}

function parseFilingStatus(text) {
  const l = text.toLowerCase();
  if (l.includes("married filing jointly") || l.includes("joint return")) return "MFJ";
  if (l.includes("married filing separately"))                             return "MFS";
  if (l.includes("head of household"))                                     return "HOH";
  if (l.includes("qualifying widow") || l.includes("qualifying surviving")) return "QW";
  if (/\bsingle\b/.test(l))                                               return "Single";
  return null;
}

// ── Main field extraction ──────────────────────────────────────────────────────
async function extractFields(pdfPath) {
  const lines = await extractLines(pdfPath);

  if (DEBUG) {
    console.log(`\n[debug] ${lines.length} lines extracted from PDF:`);
    for (const l of lines) console.log(`  p${l.page} y=${l.y}  "${l.text}"`);
    console.log();
  }

  const results = {};

  for (const field of FIELDS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!lineMatches(line.text, field.labels)) continue;

      if (DEBUG) console.log(`[debug] "${field.key}" matched on: "${line.text}"`);

      if (field.type === "status") {
        const s = parseFilingStatus(line.text)
               ?? (i + 1 < lines.length ? parseFilingStatus(lines[i + 1].text) : null);
        if (s) { results[field.key] = s; break; }
        continue;
      }

      if (field.type === "yesno") {
        results[field.key] = "Yes";
        break;
      }

      // type === "amount": prefer last (rightmost) value on this line
      const amounts = amountsInLine(line.text);
      const store = (v) => field.positive ? Math.abs(v) : v;

      if (amounts.length > 0) {
        results[field.key] = store(amounts[amounts.length - 1]);
        if (DEBUG) console.log(`  → value: ${results[field.key]}`);
        break;
      }

      // Amount on the NEXT line (label + value split across lines)
      if (i + 1 < lines.length) {
        const nextAmounts = amountsInLine(lines[i + 1].text);
        if (nextAmounts.length > 0) {
          results[field.key] = store(nextAmounts[nextAmounts.length - 1]);
          if (DEBUG) console.log(`  → value (next line): ${results[field.key]}`);
          break;
        }
      }
    }
  }

  // Derive: did they take standard or itemize?
  if (results.standard_deduction !== undefined && results.itemized_total === undefined) {
    results.took_standard = "Yes";
  } else if (results.itemized_total !== undefined && results.standard_deduction === undefined) {
    results.took_standard = "No";
  } else if (results.standard_deduction !== undefined && results.itemized_total !== undefined) {
    results.took_standard = results.standard_deduction >= results.itemized_total ? "Yes" : "No";
  }

  return results;
}

// ── Format amount for MD ───────────────────────────────────────────────────────
function fmt(val) {
  if (val === null || val === undefined) return null;
  const abs = Math.abs(Math.round(val));
  const s   = abs.toLocaleString("en-US");
  return val < 0 ? `(${s})` : s;
}

// ── Update tax-data.md ─────────────────────────────────────────────────────────
const MD_PATH = path.join(__dirname, "tax-data.md");

function updateMd(year, results) {
  if (!fs.existsSync(MD_PATH)) {
    console.error(`\n❌  tax-data.md not found at ${MD_PATH}\n`);
    process.exit(1);
  }

  let md = fs.readFileSync(MD_PATH, "utf8");

  // Find the year section: ## 2024 ... (up to next ## or end)
  const sectionRe = new RegExp(`(## ${year}\\s*\\n)([\\s\\S]*?)(?=\\n##\\s|$)`);
  const match     = sectionRe.exec(md);
  if (!match) {
    console.error(`\n❌  No "## ${year}" section found in tax-data.md.\n    Copy the template at the bottom of that file and add it first.\n`);
    process.exit(1);
  }

  let section = match[2];

  // All updatable fields (includes derived took_standard)
  const updates = [
    ...FIELDS.map(f => ({ mdLabel: f.mdLabel, key: f.key, type: f.type })),
    { mdLabel: "Took standard deduction?", key: "took_standard", type: "yesno" },
  ];

  let count = 0;

  for (const { mdLabel, key, type } of updates) {
    const val = results[key];
    if (val === undefined || val === null) continue;

    const display = (type === "amount") ? fmt(val) : String(val);
    if (!display) continue;

    // Escape the label for use in regex (handles *, (, ), etc.)
    const esc = mdLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Row pattern: | label | ... | old_value |
    // We update only the 3rd pipe-delimited cell (the Amount column)
    const rowRe  = new RegExp(`(\\|[^|]*${esc}[^|]*\\|[^|]*\\|)([^|]*)(\\|)`, "g");
    const newRow = section.replace(rowRe, (_m, prefix, _old, suffix) => {
      count++;
      return `${prefix} ${display} ${suffix}`;
    });

    if (newRow !== section) {
      section = newRow;
    } else if (DEBUG) {
      console.log(`[debug] no MD row matched for: "${mdLabel}"`);
    }
  }

  // If took_standard = Yes, mark Schedule A fields as — (not applicable)
  if (results.took_standard === "Yes") {
    const naLabels = [
      "Itemized deductions total",
      "— State & local taxes paid \\(SALT\\)",
      "— Mortgage interest",
      "— Charitable cash contributions",
      "— Charitable non-cash contributions",
      "— Other itemized",
    ];
    for (const lbl of naLabels) {
      const esc    = lbl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rowRe  = new RegExp(`(\\|[^|]*${esc}[^|]*\\|[^|]*\\|)([^|]*)(\\|)`, "g");
      // Only overwrite if cell is currently empty or has default '—'
      section = section.replace(rowRe, (_m, prefix, old, suffix) => {
        const cur = old.trim();
        if (cur === "" || cur === "—") {
          return `${prefix} — ${suffix}`;
        }
        return _m; // already has a real value, leave it
      });
    }
  }

  const newMd = md.slice(0, match.index + match[1].length)
              + section
              + md.slice(match.index + match[1].length + match[2].length);

  fs.writeFileSync(MD_PATH, newMd, "utf8");
  return count;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📋 extract-tax-data   (local only — no network)`);
  console.log(`   File : ${inputPath}`);
  if (taxYear) console.log(`   Year : ${taxYear}`);
  console.log();

  const results = await extractFields(inputPath).catch(err => {
    console.error(`❌  Extraction error: ${err.message}`);
    process.exit(1);
  });

  // ── Print results ────────────────────────────────────────────────────────────
  const COL = 44;
  let found = 0;

  console.log("   Field" + " ".repeat(COL - 5) + "Value");
  console.log("   " + "─".repeat(COL + 18));

  const printOrder = [
    ...FIELDS.map(f => f.key),
    "took_standard",
  ];
  const fieldMap = Object.fromEntries(FIELDS.map(f => [f.key, f]));

  for (const key of printOrder) {
    const val = results[key];
    if (val === undefined) continue;
    found++;

    const label = key === "took_standard"
      ? "Took standard deduction?"
      : (fieldMap[key]?.mdLabel ?? key);

    const display = (typeof val === "number") ? `$${fmt(val)}` : val;
    console.log(`   ${label.padEnd(COL)} ${display}`);
  }

  if (found === 0) {
    console.log("   (no fields matched)");
    console.log("   Try --debug to see all extracted lines from the PDF.");
  } else {
    console.log(`\n   ${found} field(s) matched out of ${FIELDS.length} defined.`);
  }

  if (!UPDATE) {
    console.log("\n   ℹ️   Run with --update to write these into tax-data.md\n");
    return;
  }

  if (!taxYear) {
    console.error("\n❌  --update requires --year  (e.g. --year 2024)\n");
    process.exit(1);
  }

  const written = updateMd(taxYear, results);
  console.log(`\n✅  Wrote ${written} field(s) into tax-data.md for ${taxYear}\n`);
}

main().catch(err => {
  console.error(`\n❌  ${err.message}\n`);
  process.exit(1);
});
