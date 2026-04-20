#!/usr/bin/env node
/**
 * Comprehensive test suite for lib/redact.js
 * Tests every identifier type, every edge case, and every false-positive risk.
 * No test framework required — pure Node.js assert.
 *
 * Run: node test-redact.js
 */

import assert from "assert";
import { redactSensitiveIds } from "./lib/redact.js";

// ── TINY TEST HARNESS ─────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌  ${name}`);
    console.log(`       Expected: ${e.expected}`);
    console.log(`       Received: ${e.actual}`);
    failures.push({ name, error: e });
    failed++;
  }
}

function section(title) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

// Helper: assert a string IS redacted (does not appear in output)
function assertRedacted(input, forbidden, msg) {
  const { text } = redactSensitiveIds(input);
  assert.ok(
    !text.includes(forbidden),
    `"${forbidden}" should be redacted but was found in: "${text}"`
  );
}

// Helper: assert output contains a specific replacement token
function assertContains(input, expected, msg) {
  const { text } = redactSensitiveIds(input);
  assert.ok(
    text.includes(expected),
    `Expected "${expected}" in output but got: "${text}"`
  );
}

// Helper: assert stat count
function assertStats(input, expectedStats) {
  const { stats } = redactSensitiveIds(input);
  for (const [key, val] of Object.entries(expectedStats)) {
    assert.strictEqual(stats[key], val, `stats.${key}: expected ${val}, got ${stats[key]}`);
  }
}

// Helper: assert no redaction happened
function assertUnchanged(input) {
  const { text } = redactSensitiveIds(input);
  assert.strictEqual(text, input, `Input should be unchanged but got: "${text}"`);
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 1: SSN — FORMATTED (3-2-4)
// ═══════════════════════════════════════════════════════════════════
section("SSN — Formatted (123-45-6789)");

test("standard SSN", () => {
  assertRedacted("SSN: 123-45-6789", "123-45-6789");
  assertContains("SSN: 123-45-6789", "[SSN-REDACTED]");
});

test("SSN at start of line", () => {
  assertRedacted("123-45-6789 is the taxpayer SSN", "123-45-6789");
});

test("SSN at end of line", () => {
  assertRedacted("Your Social Security Number is 123-45-6789", "123-45-6789");
});

test("SSN surrounded by punctuation (parens)", () => {
  assertRedacted("Your SSN (123-45-6789) must match", "123-45-6789");
});

test("SSN after colon and space", () => {
  assertRedacted("Social Security Number: 123-45-6789", "123-45-6789");
});

test("SSN in W2-style label line", () => {
  const w2 = "a Employee's social security number\n123-45-6789";
  assertRedacted(w2, "123-45-6789");
});

test("SSN with period after (end of sentence)", () => {
  assertRedacted("The SSN is 123-45-6789.", "123-45-6789");
});

test("SSN with comma after", () => {
  assertRedacted("SSN 123-45-6789, name John Smith", "123-45-6789");
});

test("SSN with em-dash label", () => {
  // TurboTax sometimes uses em-dash: "Your SSN — 123-45-6789"
  assertRedacted("Your SSN — 123-45-6789", "123-45-6789");
});

test("multiple SSNs in same document", () => {
  const doc = "Primary SSN: 123-45-6789\nSpouse SSN: 987-65-4321";
  assertRedacted(doc, "123-45-6789");
  assertRedacted(doc, "987-65-4321");
  assertStats(doc, { ssn: 2 });
});

test("SSN count is accurate", () => {
  assertStats("SSN: 123-45-6789", { ssn: 1, ein: 0, ptin: 0 });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 2: ITIN (Individual Taxpayer Identification Number)
// Same 3-2-4 format as SSN, always starts with 9
// ═══════════════════════════════════════════════════════════════════
section("ITIN — starts with 9, same format as SSN");

test("standard ITIN (9XX-7X-XXXX)", () => {
  assertRedacted("ITIN: 912-70-1234", "912-70-1234");
  assertContains("ITIN: 912-70-1234", "[SSN-REDACTED]");
});

test("ITIN with label 'Individual Taxpayer Identification Number'", () => {
  assertRedacted("Individual Taxpayer Identification Number: 988-70-5678", "988-70-5678");
});

test("ITIN at end of 1040 line", () => {
  assertRedacted("Your ITIN\n978-88-4321", "978-88-4321");
});

test("ITIN bare 9-digit with keyword", () => {
  assertRedacted("ITIN: 978884321", "978884321");
  assertContains("ITIN: 978884321", "[SSN-REDACTED]");
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 3: EIN (Employer Identification Number)
// ═══════════════════════════════════════════════════════════════════
section("EIN — Employer Identification Number (12-3456789)");

test("standard EIN", () => {
  assertRedacted("EIN: 12-3456789", "12-3456789");
  assertContains("EIN: 12-3456789", "[EIN-REDACTED]");
});

test("EIN with full label", () => {
  assertRedacted("Employer Identification Number: 45-6789012", "45-6789012");
});

test("EIN on W2 box b", () => {
  assertRedacted("b Employer identification number\n12-3456789", "12-3456789");
});

test("EIN on 1099 payer field", () => {
  assertRedacted("PAYER'S federal identification number 98-7654321", "98-7654321");
});

test("EIN in brokerage statement header", () => {
  assertRedacted("Tax ID / EIN: 26-1234567", "26-1234567");
});

test("EIN count is accurate", () => {
  assertStats("EIN: 12-3456789", { ssn: 0, ein: 1, ptin: 0 });
});

test("multiple EINs (two employers on same doc)", () => {
  const doc = "Employer 1 EIN: 12-3456789\nEmployer 2 EIN: 98-7654321";
  assertRedacted(doc, "12-3456789");
  assertRedacted(doc, "98-7654321");
  assertStats(doc, { ein: 2 });
});

test("EIN NOT matched when embedded in longer number", () => {
  // 12-34567890 has 8 digits after dash — should NOT match EIN (7 digits after dash)
  const { text } = redactSensitiveIds("Reference: 12-34567890");
  assert.ok(!text.includes("[EIN-REDACTED]"), `Should not redact 8-digit suffix: got "${text}"`);
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 4: PTIN (Preparer Tax Identification Number)
// ═══════════════════════════════════════════════════════════════════
section("PTIN — Preparer Tax ID (P01234567)");

test("standard PTIN uppercase P", () => {
  assertRedacted("PTIN: P01234567", "P01234567");
  assertContains("PTIN: P01234567", "[PTIN-REDACTED]");
});

test("PTIN lowercase p", () => {
  assertRedacted("Preparer PTIN: p12345678", "p12345678");
  assertContains("Preparer PTIN: p12345678", "[PTIN-REDACTED]");
});

test("PTIN on 1040 preparer line", () => {
  const form = "Preparer's PTIN\nP98765432\nFirm name: H&R Block";
  assertRedacted(form, "P98765432");
});

test("PTIN on 1099-NEC preparer field", () => {
  assertRedacted("Paid preparer use only — PTIN P11223344", "P11223344");
});

test("PTIN count is accurate", () => {
  assertStats("PTIN: P01234567", { ssn: 0, ein: 0, ptin: 1 });
});

test("P followed by 7 digits is NOT a PTIN (too short)", () => {
  const { text } = redactSensitiveIds("Code P1234567 applies");
  assert.ok(!text.includes("[PTIN-REDACTED]"), `7-digit P number should not be redacted: got "${text}"`);
});

test("P followed by 9 digits is NOT a PTIN (too long)", () => {
  const { text } = redactSensitiveIds("Ref P123456789 is valid");
  assert.ok(!text.includes("[PTIN-REDACTED]"), `9-digit P number should not be redacted: got "${text}"`);
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 5: BARE 9-DIGIT SSN/ITIN (keyword-context)
// ═══════════════════════════════════════════════════════════════════
section("Bare 9-digit SSN with keyword context");

test("SSN keyword then bare 9 digits", () => {
  assertRedacted("SSN: 123456789", "123456789");
});

test("Social Security Number keyword", () => {
  assertRedacted("Social Security Number: 234567890", "234567890");
});

test("Social Security (no 'Number')", () => {
  assertRedacted("Social Security: 234567890", "234567890");
});

test("Taxpayer ID keyword", () => {
  assertRedacted("Taxpayer ID: 345678901", "345678901");
});

test("Tax ID keyword", () => {
  assertRedacted("Tax ID: 456789012", "456789012");
});

test("TIN keyword with word boundary (not inside another word)", () => {
  assertRedacted("TIN: 567890123", "567890123");
});

test("keyword then newline then digits", () => {
  assertRedacted("Social Security Number\n123456789", "123456789");
});

test("keyword then multiple spaces then digits", () => {
  assertRedacted("SSN     123456789", "123456789");
});

test("keyword with colon and spaces", () => {
  assertRedacted("Tax ID Number:   987654321", "987654321");
});

test("Federal Tax ID keyword", () => {
  assertRedacted("Federal Tax ID Number: 876543210", "876543210");
});

test("Individual Taxpayer Identification Number (full)", () => {
  assertRedacted("Individual Taxpayer Identification Number: 912345678", "912345678");
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 6: ALREADY-MASKED variants (detect, do not change)
// ═══════════════════════════════════════════════════════════════════
section("Already-masked IDs — detect and count, do not alter");

test("XXX-XX-1234 (capital X)", () => {
  assertStats("SSN: XXX-XX-1234", { alreadyMasked: 1 });
  // Value should be unchanged
  assertContains("SSN: XXX-XX-1234", "XXX-XX-1234");
});

test("xxx-xx-1234 (lowercase x)", () => {
  assertStats("SSN: xxx-xx-1234", { alreadyMasked: 1 });
});

test("***-**-1234 (asterisks)", () => {
  assertStats("SSN: ***-**-1234", { alreadyMasked: 1 });
});

test("###-##-1234 (hash marks)", () => {
  assertStats("SSN: ###-##-1234", { alreadyMasked: 1 });
});

test("already-masked value is not double-redacted", () => {
  const { text } = redactSensitiveIds("SSN: XXX-XX-1234");
  assert.strictEqual(text, "SSN: XXX-XX-1234", "Already-masked SSN should be left unchanged");
});

test("count of already-masked + new SSN", () => {
  const doc = "Primary: 123-45-6789\nSpouse: XXX-XX-1234";
  assertStats(doc, { ssn: 1, alreadyMasked: 1 });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 7: FALSE POSITIVES — things that must NOT be redacted
// ═══════════════════════════════════════════════════════════════════
section("False positives — must NOT be redacted");

test("US phone number (3-3-4 format)", () => {
  assertUnchanged("Call 415-555-1234 for support");
});

test("US phone number with area code parentheses", () => {
  assertUnchanged("(415) 555-1234");
});

test("US phone number (800 number)", () => {
  assertUnchanged("1-800-555-1234");
});

test("ISO date 2025-01-15", () => {
  assertUnchanged("Filed on 2025-01-15");
});

test("Date MM/DD/YYYY", () => {
  assertUnchanged("Due date: 04/15/2026");
});

test("ZIP+4 code", () => {
  assertUnchanged("San Jose CA 94087-1234");
});

test("Dollar amount with commas", () => {
  assertUnchanged("Gross income: $1,234,567.89");
});

test("12-digit account number (too long for EIN)", () => {
  assertUnchanged("Account #: 123456789012");
});

test("16-digit credit card number", () => {
  assertUnchanged("Card: 1234-5678-9012-3456");
});

test("word containing 'TIN' is not a trigger (SATIN)", () => {
  assertUnchanged("The fabric is SATIN 123456789");
});

test("word containing 'TIN' is not a trigger (ATIN as part of word)", () => {
  assertUnchanged("Platinum 123456789 club member");
});

test("9-digit number WITHOUT any keyword context is NOT redacted", () => {
  // Bare 9-digit numbers with no nearby SSN keyword should be left alone
  // (routing numbers, account numbers, reference numbers, etc.)
  assertUnchanged("Routing: 021000021");
  assertUnchanged("Reference number 987654321");
  assertUnchanged("Customer ID 123456789");
});

test("EIN-looking reference number with 3-digit prefix is NOT redacted", () => {
  // 123-4567890 has 7 digits after dash but 3-digit prefix → not EIN pattern
  assertUnchanged("Ref 123-4567890");
});

test("8-digit number after hyphen is NOT an EIN", () => {
  assertUnchanged("Code 12-34567890");
});

test("P followed by letters is not a PTIN", () => {
  assertUnchanged("Plan P-GOLD offers benefits");
});

test("Percentage like 12.3%", () => {
  assertUnchanged("Tax rate: 12.3%");
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 8: REAL DOCUMENT SAMPLES
// These simulate actual extracted PDF text from each document type.
// ═══════════════════════════════════════════════════════════════════
section("Real document samples — W2");

test("W2: complete form text block", () => {
  const w2 = `
    VOID  CORRECTED
    a Employee's social security number
    123-45-6789
    b Employer identification number
    45-6789012
    c Employer's name, address, and ZIP code
    Google LLC
    1600 Amphitheatre Pkwy
    Mountain View, CA 94043
    1 Wages, tips, other compensation  2 Federal income tax withheld
    285000.00                           62000.00
    12a See instructions for box 12
    Code D  23500.00
    e Employee's first name and initial  Last name
    Umair Ahmed
  `;
  assertRedacted(w2, "123-45-6789");
  assertRedacted(w2, "45-6789012");
  assertContains(w2, "[SSN-REDACTED]");
  assertContains(w2, "[EIN-REDACTED]");
  // Non-sensitive numbers preserved
  assertContains(w2, "285000.00");
  assertContains(w2, "23500.00");
  assertStats(w2, { ssn: 1, ein: 1, ptin: 0 });
});

section("Real document samples — 1099-NEC");

test("1099-NEC with payer EIN, recipient SSN, and preparer PTIN", () => {
  const form1099 = `
    PAYER'S name: Acme Corp
    PAYER'S TIN: 98-7654321
    RECIPIENT'S TIN: 234-56-7890
    Nonemployee compensation: $45,000.00
    Paid preparer use only
    PTIN: P12345678
    Firm name: CPA Partners LLC
  `;
  assertRedacted(form1099, "98-7654321");
  assertRedacted(form1099, "234-56-7890");
  assertRedacted(form1099, "P12345678");
  assertContains(form1099, "45,000.00"); // dollar amount unchanged
  assertStats(form1099, { ssn: 1, ein: 1, ptin: 1 });
});

section("Real document samples — TurboTax summary");

test("TurboTax 1040 summary page", () => {
  const turbotax = `
    2025 Federal Tax Return
    Filing Status: Married Filing Jointly
    Your Social Security Number: 123-45-6789
    Spouse's Social Security Number: 987-65-4321
    Adjusted Gross Income: $412,000
    Taxable Income: $372,000
    Total Tax: $98,450
    Effective Rate: 23.9%
    Child Tax Credit: $2,000
  `;
  assertRedacted(turbotax, "123-45-6789");
  assertRedacted(turbotax, "987-65-4321");
  assertContains(turbotax, "$412,000"); // financial data preserved
  assertContains(turbotax, "$98,450");
  assertStats(turbotax, { ssn: 2, ein: 0, ptin: 0 });
});

section("Real document samples — 1099-B Brokerage");

test("1099-B with brokerage EIN and account holder SSN", () => {
  const form1099b = `
    PAYER: Charles Schwab & Co., Inc.
    Federal ID Number: 94-1693128
    Account Number: 7291-0482 (last 4: 0482)
    Recipient SSN: 345-67-8901
    2025 Form 1099-B
    Short-term transactions:
      100 GOOG @ $195.50 proceeds $19,550.00
    Long-term transactions:
      50 NVDA @ $870.00 proceeds $43,500.00
    Total proceeds: $63,050.00
  `;
  assertRedacted(form1099b, "94-1693128");
  assertRedacted(form1099b, "345-67-8901");
  assertContains(form1099b, "$63,050.00");
  assertContains(form1099b, "$19,550.00");
  assertStats(form1099b, { ssn: 1, ein: 1 });
});

section("Real document samples — 1099-DIV");

test("1099-DIV with payer EIN and recipient SSN/ITIN", () => {
  const form1099div = `
    Fidelity Investments
    EIN: 04-1737945
    Your SSN/ITIN: 456-78-9012
    Ordinary dividends: $3,450.00
    Qualified dividends: $3,100.00
    Total capital gain distributions: $820.00
  `;
  assertRedacted(form1099div, "04-1737945");
  assertRedacted(form1099div, "456-78-9012");
  assertContains(form1099div, "$3,450.00");
  assertStats(form1099div, { ssn: 1, ein: 1 });
});

section("Real document samples — Bank statement");

test("Bank statement (no SSN expected, no false positives)", () => {
  const bankStmt = `
    Chase Bank — Statement Period: 12/01/2025 – 12/31/2025
    Account Type: Checking
    Account Number: ****7823
    Routing Number: 021000021

    Beginning Balance:  $25,431.82
    Total Deposits:     $18,500.00
    Total Withdrawals:  $14,320.55
    Ending Balance:     $29,611.27

    Transactions:
    12/03  Payroll Direct Deposit      +$9,250.00
    12/15  Mortgage Payment            -$4,850.00
    12/28  Transfer to Savings         -$2,000.00
  `;
  // No SSNs in a bank statement — nothing should be redacted
  assertStats(bankStmt, { ssn: 0, ein: 0, ptin: 0 });
  // Routing number should NOT be redacted (no keyword context)
  assertContains(bankStmt, "021000021");
  // Account balance should be preserved
  assertContains(bankStmt, "$29,611.27");
});

section("Real document samples — Brokerage monthly statement");

test("Schwab monthly statement with EIN but no personal SSN", () => {
  const brokerage = `
    Charles Schwab & Co., Inc.
    Tax ID: 94-1693128
    Account: ****4521
    Statement Period: December 2025

    Portfolio Value:    $847,320.50
    Cash Balance:        $12,445.00
    Securities Value:   $834,875.50

    Holdings:
    GOOGL   150 shares  @ $195.50   $29,325.00
    NVDA    100 shares  @ $870.00   $87,000.00
    VTI     500 shares  @ $295.00  $147,500.00

    Income this period:
    Dividends received:   $1,240.00
    Interest received:       $85.00
  `;
  assertRedacted(brokerage, "94-1693128");
  assertContains(brokerage, "$847,320.50");
  assertContains(brokerage, "150 shares");
  assertStats(brokerage, { ssn: 0, ein: 1, ptin: 0 });
});

section("Real document samples — Combined W2 + partially masked (privacy-filtered doc)");

test("Privacy-filtered W2 with already-masked + new EIN", () => {
  const privacyDoc = `
    a Employee's social security number
    XXX-XX-6789
    b Employer identification number
    45-6789012
    Employer: Alphabet Inc.
    Wages: $285,000.00
  `;
  // Already-masked SSN stays as-is
  assertContains(privacyDoc, "XXX-XX-6789");
  // EIN is redacted
  assertRedacted(privacyDoc, "45-6789012");
  assertStats(privacyDoc, { ssn: 0, ein: 1, alreadyMasked: 1 });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 9: WORD-FORM DIGIT SEQUENCES
// SSN/ITIN written as spoken English words
// ═══════════════════════════════════════════════════════════════════
section("Word-form digit sequences (ONE TWO THREE...)");

test("9 digit-words space-separated ALL CAPS", () => {
  assertRedacted("ONE ONE ONE FIVE THREE TWO ONE NINE TWO", "ONE ONE ONE FIVE THREE TWO ONE NINE TWO");
  assertContains("ONE ONE ONE FIVE THREE TWO ONE NINE TWO", "[SSN-REDACTED]");
});

test("9 digit-words space-separated lowercase", () => {
  assertRedacted("one one one five three two one nine two", "one one one five three two one nine two");
  assertContains("one one one five three two one nine two", "[SSN-REDACTED]");
});

test("9 digit-words mixed case", () => {
  assertRedacted("One One One Five Three Two One Nine Two", "One One One Five Three Two One Nine Two");
});

test("SSN 3-2-4 spoken format with hyphens", () => {
  // How an agent or document might read it: "ONE ONE ONE - FIVE THREE - TWO ONE NINE TWO"
  const spoken = "ONE ONE ONE - FIVE THREE - TWO ONE NINE TWO";
  assertRedacted(spoken, "ONE ONE ONE - FIVE THREE - TWO ONE NINE TWO");
  assertContains(spoken, "[SSN-REDACTED]");
});

test("word-form with en-dashes as separator", () => {
  assertRedacted("ONE–TWO–THREE–FOUR–FIVE–SIX–SEVEN–EIGHT–NINE", "ONE");
  assertContains("ONE–TWO–THREE–FOUR–FIVE–SIX–SEVEN–EIGHT–NINE", "[SSN-REDACTED]");
});

test("word-form after SSN keyword label", () => {
  const doc = "Social Security Number: ONE ONE ONE FIVE THREE TWO ONE NINE TWO";
  assertRedacted(doc, "ONE ONE ONE FIVE THREE TWO ONE NINE TWO");
  assertContains(doc, "[SSN-REDACTED]");
});

test("word-form on its own line (W2 accessibility format)", () => {
  const doc = "Employee social security number\nONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE";
  assertRedacted(doc, "ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE");
});

test("word-form ITIN starting with NINE", () => {
  // ITIN always starts with 9
  assertRedacted("ITIN: NINE ONE TWO SEVEN ZERO ONE TWO THREE FOUR", "NINE ONE TWO SEVEN ZERO ONE TWO THREE FOUR");
});

test("word-form surrounded by other text", () => {
  const doc = "The taxpayer SSN is ONE ONE ONE FIVE THREE TWO ONE NINE TWO as shown above.";
  assertRedacted(doc, "ONE ONE ONE FIVE THREE TWO ONE NINE TWO");
  assertContains(doc, "The taxpayer SSN is");
  assertContains(doc, "as shown above.");
});

test("word-form stat is counted as ssn", () => {
  assertStats("ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE", { ssn: 1 });
});

test("word-form with ZERO digit", () => {
  assertRedacted("ZERO ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT", "ZERO ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT");
});

// ── Word-form FALSE POSITIVES ─────────────────────────────────────

test("only 8 digit-words does NOT match (too short for SSN)", () => {
  // 8 digit-words = only 8 digits, not a valid SSN
  assertUnchanged("ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT");
});

test("only 7 digit-words does NOT match", () => {
  assertUnchanged("ONE TWO THREE FOUR FIVE SIX SEVEN");
});

test("digit-words interrupted by a non-digit word do NOT match", () => {
  // "one or two" — "or" breaks the sequence
  assertUnchanged("one or two items priced at three to five dollars");
});

test("digit-words interrupted by regular words do NOT match", () => {
  // Even if there happen to be 9+ digit words spread across a sentence
  assertUnchanged("one item and two more and three four five six seven eight nine items");
});

test("10 digit-words — only the first 9 are redacted, text still redacted", () => {
  // A 10-digit sequence — still contains a 9-digit SSN, should be caught
  const doc = "ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE ZERO";
  const { text } = redactSensitiveIds(doc);
  assert.ok(text.includes("[SSN-REDACTED]"), `10-word sequence should contain a redaction: got "${text}"`);
});

test("word-form EIN (2+7 = 9 words) also caught", () => {
  // We can't distinguish word-form EIN from SSN — both 9 digits — so both are redacted
  assertRedacted("FIVE FOUR ONE TWO THREE FOUR FIVE SIX SEVEN", "FIVE FOUR ONE TWO THREE FOUR FIVE SIX SEVEN");
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 11: EDGE CASES & REGRESSION GUARDS
// ═══════════════════════════════════════════════════════════════════
section("Edge cases");

test("empty string", () => {
  const { text, stats } = redactSensitiveIds("");
  assert.strictEqual(text, "");
  assert.deepStrictEqual(stats, { ssn: 0, ein: 0, ptin: 0, alreadyMasked: 0 });
});

test("no identifiers present", () => {
  const clean = "Total income $285,000\nFederal tax withheld $62,000\nEffective rate 21.75%";
  assertStats(clean, { ssn: 0, ein: 0, ptin: 0 });
  assertUnchanged(clean);
});

test("same SSN repeated multiple times is counted correctly", () => {
  const doc = "Primary: 123-45-6789\nVerification: 123-45-6789\nConfirm: 123-45-6789";
  assertStats(doc, { ssn: 3 });
  const { text } = redactSensitiveIds(doc);
  assert.ok(!text.includes("123-45-6789"), "All instances should be redacted");
});

test("SSN and EIN on same line", () => {
  const doc = "SSN 123-45-6789 EIN 12-3456789";
  assertRedacted(doc, "123-45-6789");
  assertRedacted(doc, "12-3456789");
  assertStats(doc, { ssn: 1, ein: 1 });
});

test("all three identifier types in one document", () => {
  const mixed = `
    Taxpayer SSN: 123-45-6789
    Employer EIN: 45-6789012
    Preparer PTIN: P98765432
  `;
  assertRedacted(mixed, "123-45-6789");
  assertRedacted(mixed, "45-6789012");
  assertRedacted(mixed, "P98765432");
  assertStats(mixed, { ssn: 1, ein: 1, ptin: 1 });
});

test("non-ASCII content (e.g. Unicode em-dash) does not break redaction", () => {
  const doc = "SSN\u2014123-45-6789"; // em-dash between SSN and number
  assertRedacted(doc, "123-45-6789");
});

test("Windows-style line endings (CRLF)", () => {
  const doc = "Employee SSN\r\n123-45-6789\r\n";
  assertRedacted(doc, "123-45-6789");
});

test("tabs between keyword and value", () => {
  assertRedacted("SSN\t123-45-6789", "123-45-6789");
});

// ═══════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(60)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log("═".repeat(60));

if (failed > 0) {
  console.log("\nFailed tests:");
  failures.forEach(({ name }) => console.log(`  ❌  ${name}`));
  process.exit(1);
} else {
  console.log("\n  All tests passed.\n");
}
