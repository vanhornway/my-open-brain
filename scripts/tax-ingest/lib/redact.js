/**
 * Local SSN / Tax ID redaction — v2
 * Runs entirely in memory. Zero network calls. Zero external deps.
 * Call this BEFORE passing any PDF text to any LLM.
 *
 * Government identifiers handled:
 *
 *   SSN   Social Security Number      123-45-6789  or  123456789 (keyword-context)
 *                                     or WORD FORM: ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE
 *   ITIN  Individual Taxpayer ID      Same format as SSN (9XX-70-XXXX to 9XX-88-XXXX)
 *   ATIN  Adoption Taxpayer ID        Same format as SSN (caught by SSN pattern)
 *   EIN   Employer Identification     12-3456789
 *   PTIN  Preparer Tax ID             P12345678
 *
 * Already-masked variants (detected for logging, not changed):
 *   XXX-XX-1234  xxx-xx-1234  ***-**-1234  ###-##-1234
 *
 * Intentional non-redactions (to avoid false positives):
 *   US phone numbers      — always 3-3-4 (area-xxx-xxxx), NOT 3-2-4
 *   Dates                 — YYYY-MM-DD never matches any ID pattern
 *   ZIP+4 codes           — 5-4 format, never matches
 *   12+ digit account #s  — word-boundary and length prevent match
 *   Fewer than 9 digit-words in a row — e.g. "one or two" never triggers word-form
 *
 * Ordering note: SSN is stripped first (3-2-4), then EIN (2-7), then PTIN (P+8),
 * then keyword-context bare 9-digit SSN/ITIN, then word-form 9-digit sequences.
 * Running SSN before EIN prevents the 3-digit EIN prefix from being double-matched.
 */

// ── PATTERN DEFINITIONS ───────────────────────────────────────────

/**
 * SSN / ITIN / ATIN — formatted 3-2-4 (e.g. 123-45-6789)
 * The 3-2-4 hyphen structure is unique to these identifiers in tax documents.
 * US phone numbers are always 3-3-4; this pattern will NOT match them.
 */
const SSN_FORMATTED = /\b\d{3}-\d{2}-\d{4}\b/g;

/**
 * EIN — Employer Identification Number, formatted 2-7 (e.g. 12-3456789)
 * Run AFTER SSN to avoid any overlap (no actual overlap since 3-2-4 ≠ 2-7,
 * but ordering is explicit for clarity).
 */
const EIN_FORMATTED = /\b\d{2}-\d{7}\b/g;

/**
 * PTIN — Preparer Tax Identification Number (e.g. P01234567)
 * Always P (upper or lower) followed by exactly 8 digits.
 * Word boundary on both sides prevents partial matches.
 */
const PTIN = /\b[Pp]\d{8}\b/g;

/**
 * Bare 9-digit SSN/ITIN — only when near a label keyword.
 * Using a lookahead anchor so we capture just the 9 digits, not the label.
 *
 * Keyword set covers every label variant found on IRS forms, TurboTax, W2s, 1099s:
 *   SSN, SS#, Social Security Number, ITIN, ATIN,
 *   TIN, EIN (unformatted variant), Taxpayer ID, Tax ID,
 *   Federal Tax ID, Individual Taxpayer Identification Number
 *
 * The label and the digits may be separated by:
 *   - colon, hash, spaces, newlines (up to 40 chars between label end and digits)
 *
 * \b before the keyword prevents matching "SATIN" or "ATIN" as part of another word.
 */
const SSN_BARE_KEYWORD = /\b(?:SSN|SS#|Social\s+Security(?:\s+Number)?|ITIN|ATIN|Individual\s+Taxpayer\s+Identification(?:\s+Number)?|Taxpayer\s+Identification(?:\s+Number)?|Taxpayer\s+ID|Tax\s+ID(?:\s+Number)?|Federal\s+Tax\s+ID(?:\s+Number)?|TIN|EIN)\b[^0-9]{0,40}(\d{9})\b/gi;

/**
 * Word-form digit sequences — SSN/ITIN/EIN written as spoken English.
 *
 * Covers all real-world variants:
 *   Spaces only:    ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE
 *   With hyphens:   ONE TWO THREE - FOUR FIVE - SIX SEVEN EIGHT NINE  (3-2-4 spoken SSN)
 *   Lowercase:      one two three four five six seven eight nine
 *   Mixed case:     One Two Three Four Five Six Seven Eight Nine
 *
 * The separator between digit-words is flexible: spaces, hyphens, en-dashes,
 * em-dashes, and commas — but NO other alphabetic words allowed between them.
 * This prevents false positives like "one or two items" from matching as a pair.
 *
 * Exactly 9 consecutive digit-words = SSN/ITIN (9 digits).
 * Word boundary on both sides prevents matching substrings inside longer words.
 */
const _DW = "(?:zero|one|two|three|four|five|six|seven|eight|nine)";
const _DS = "[\\s\\-–—,]+"; // separator: spaces, hyphens, dashes, commas only
const SSN_WORD_FORM = new RegExp(`\\b${_DW}(?:${_DS}${_DW}){8}\\b`, "gi");

/**
 * Already-masked variants — detect only (do not change), log for audit.
 * Catches: XXX-XX-1234, xxx-xx-1234, ***-**-1234, ###-##-1234
 * All in the standard SSN display position (last 4 visible).
 *
 * Note: NO leading \b because * and # are non-word characters and \b would
 * fail to match before them. The trailing \b is kept (digits are word chars).
 */
const ALREADY_MASKED = /[Xx*#]{3}[-\s][Xx*#]{2}[-\s]\d{4}\b/g;

// ── PATTERN ARRAY (for bbox-based redaction in redact-pdf.js) ─────
// Each entry: { pattern: RegExp, type: string }
// Used by redact-pdf.js to scan pdfjs text items directly.
export const SENSITIVE_PATTERNS = [
  { pattern: ALREADY_MASKED,    type: "masked" },
  { pattern: SSN_FORMATTED,     type: "ssn"    },
  { pattern: EIN_FORMATTED,     type: "ein"    },
  { pattern: PTIN,              type: "ptin"   },
  { pattern: SSN_BARE_KEYWORD,  type: "ssn"    },
  { pattern: SSN_WORD_FORM,     type: "ssn"    },
];

// ── PUBLIC API ────────────────────────────────────────────────────

/**
 * Redacts all government tax identifiers from extracted PDF text.
 *
 * @param {string} rawText - text extracted from PDF (before any LLM processing)
 * @returns {{ text: string, stats: RedactStats }}
 *
 * @typedef {{ ssn: number, ein: number, ptin: number, alreadyMasked: number }} RedactStats
 */
export function redactSensitiveIds(rawText) {
  let text = rawText;
  const stats = { ssn: 0, ein: 0, ptin: 0, alreadyMasked: 0 };

  // Count already-masked BEFORE any changes so counts are accurate
  stats.alreadyMasked = (text.match(ALREADY_MASKED) ?? []).length;

  // 1. SSN / ITIN / ATIN — formatted (most common in official IRS docs)
  text = text.replace(SSN_FORMATTED, () => { stats.ssn++; return "[SSN-REDACTED]"; });

  // 2. EIN — formatted
  text = text.replace(EIN_FORMATTED, () => { stats.ein++; return "[EIN-REDACTED]"; });

  // 3. PTIN — preparer ID (e.g. P01234567)
  text = text.replace(PTIN, () => { stats.ptin++; return "[PTIN-REDACTED]"; });

  // 4. Bare 9-digit SSN/ITIN near a label keyword
  //    Regex captures group 1 = the 9 digits; we replace only that group.
  text = text.replace(SSN_BARE_KEYWORD, (match, digits) => {
    stats.ssn++;
    return match.replace(digits, "[SSN-REDACTED]");
  });

  // 5. Word-form: nine consecutive digit-words (accessibility docs, some OCR output)
  //    e.g. "ONE ONE ONE FIVE THREE TWO ONE NINE TWO"
  //    or   "one-one-one-five-three-two-one-nine-two"
  text = text.replace(SSN_WORD_FORM, () => { stats.ssn++; return "[SSN-REDACTED]"; });

  return { text, stats };
}

/**
 * Print a human-readable redaction summary to console.
 * @param {{ ssn: number, ein: number, ptin: number, alreadyMasked: number }} stats
 */
export function printRedactionSummary(stats) {
  const total = stats.ssn + stats.ein + stats.ptin;
  if (total === 0 && stats.alreadyMasked === 0) {
    console.log("   🔍 Redaction: no government IDs found.");
    return;
  }
  if (stats.ssn   > 0) console.log(`   🛡️  Redacted ${stats.ssn} SSN/ITIN(s)`);
  if (stats.ein   > 0) console.log(`   🛡️  Redacted ${stats.ein} EIN(s)`);
  if (stats.ptin  > 0) console.log(`   🛡️  Redacted ${stats.ptin} PTIN(s)`);
  if (stats.alreadyMasked > 0) console.log(`   ℹ️  ${stats.alreadyMasked} already-masked ID(s) left as-is`);
}
