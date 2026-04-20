#!/usr/bin/env node
/**
 * redact-pdf.js — local-only PDF redaction. Zero network calls. Zero API keys.
 *
 * Approach: IN-PLACE TEXT REMOVAL
 *   Keeps the original PDF structure intact (fonts, layout, images, formatting).
 *   Replaces sensitive identifier values with blank spaces in the content streams.
 *   Draws white rectangles over the sensitive positions as a visual blank.
 *   Result: a proper text-based PDF where SSN/EIN/PTIN fields appear empty.
 *
 * Handles:
 *   - Formatted SSNs:  123-45-6789  (hex-encoded or literal strings)
 *   - EINs:            12-3456789
 *   - PTINs:           P12345678
 *   - IRS split-field: 3 separate boxes (011, 00, 2222) on IRS 1040/W-2 forms
 *   - Already-masked:  xxx-xx-1234
 *   - Word-form:       ONE TWO THREE ...
 *
 * Usage:
 *   node redact-pdf.js --file ~/Downloads/W2_2025.pdf
 *   node redact-pdf.js --file ~/Downloads/TurboTax.pdf --out ~/Desktop/
 *   node redact-pdf.js --file ~/Downloads/W2_2025.pdf --debug
 *
 * No LLM. No OpenRouter. No Supabase. No internet connection required.
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import * as pdfjsLib from "./node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument, PDFName, rgb } from "./node_modules/pdf-lib/dist/pdf-lib.esm.js";
import { SENSITIVE_PATTERNS } from "./lib/redact.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(
  __dirname, "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
);

// ── ARGS ──────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const fileIdx = args.indexOf("--file");
const outIdx  = args.indexOf("--out");
const DEBUG   = args.includes("--debug");

if (fileIdx === -1) {
  console.error(
    "\nUsage: node redact-pdf.js --file /path/to/document.pdf [--out /output/dir/] [--debug]\n"
  );
  process.exit(1);
}

const inputPath     = args[fileIdx + 1];
const outDir        = outIdx !== -1 ? args[outIdx + 1] : path.dirname(inputPath);

if (!fs.existsSync(inputPath)) {
  console.error(`\n❌ File not found: ${inputPath}\n`);
  process.exit(1);
}

const inputFilename  = path.basename(inputPath);
const outputFilename = `redact-${inputFilename.replace(/\.pdf$/i, "")}.pdf`;
const outputPath     = path.join(outDir, outputFilename);

// ── SECURE MEMORY WIPE ────────────────────────────────────────────
function wipeBuffer(buf) {
  if (buf && Buffer.isBuffer(buf)) buf.fill(0);
}

// ── PROPORTIONAL BBOX FOR SUB-SPAN MATCH ─────────────────────────
function subspanBox(span, startChar, endChar) {
  const len    = span.str.length || 1;
  const MARGIN = span.w * 0.10;
  const x = span.x + (startChar / len) * span.w - MARGIN;
  const w = ((endChar - startChar) / len) * span.w + MARGIN * 2;
  return { x, y: span.y, w: Math.max(w, 4), h: span.h || span.fs || 10 };
}

// ── STEP 1: FIND SENSITIVE ITEMS ─────────────────────────────────
// Returns:
//   pageMap:        Map<pageIndex, [{x,y,w,h}]>  — bbox of each sensitive item
//   sensitiveStrings: Set<string>                 — exact values to blank in streams
async function findSensitiveItems(pdfBytes) {
  const task = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes), verbosity: 0 });
  const doc  = await task.promise;

  const stats          = { ssn: 0, ein: 0, ptin: 0, alreadyMasked: 0 };
  const pageMap        = new Map();
  const sensitiveStrings = new Set();

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page    = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const boxes   = [];

    const spans = content.items
      .filter(item => item.str && item.str.trim() !== "")
      .map(item => ({
        str: item.str,
        x:   item.transform[4],
        y:   item.transform[5],
        w:   item.width,
        h:   item.height || Math.abs(item.transform[3]),
        fs:  Math.abs(item.transform[3]),
      }));

    if (DEBUG) {
      console.log(`\n  [debug] Page ${pageNum} — ${spans.length} spans`);
      for (const s of spans) {
        console.log(`    (${s.x.toFixed(1)},${s.y.toFixed(1)}) w=${s.w.toFixed(1)} h=${s.h.toFixed(1)} "${s.str}"`);
      }
    }

    // Concatenate with \x00 sentinels to prevent cross-span matches
    let fullText = "";
    const charSpan  = [];
    const spanStart = [];
    for (let si = 0; si < spans.length; si++) {
      spanStart.push(fullText.length);
      for (let ci = 0; ci < spans[si].str.length; ci++) charSpan.push(si);
      fullText += spans[si].str;
      charSpan.push(-1);
      fullText += "\x00";
    }

    const covered = new Set();

    // Run all sensitive patterns
    for (const { pattern, type } of SENSITIVE_PATTERNS) {
      const re = new RegExp(
        pattern.source,
        pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"
      );
      let m;
      while ((m = re.exec(fullText)) !== null) {
        const matchStart = m.index;
        const matchEnd   = m.index + m[0].length - 1;
        const rangeKey   = `${matchStart}-${matchEnd}`;
        if (covered.has(rangeKey)) continue;
        covered.add(rangeKey);

        const firstSpan = charSpan[matchStart];
        const lastSpan  = charSpan[Math.min(matchEnd, charSpan.length - 1)];
        if (firstSpan === -1 || lastSpan === -1) continue;

        const matchedId = (m[1] !== undefined) ? m[1].trim() : m[0].trim();
        if (matchedId) sensitiveStrings.add(matchedId);

        if (DEBUG) {
          console.log(`  [debug] Match type=${type} "${m[0].trim()}" spans[${firstSpan}..${lastSpan}]`);
        }

        if (firstSpan === lastSpan) {
          const span       = spans[firstSpan];
          const charOffset = matchStart - spanStart[firstSpan];
          const boxStart   = (m[1] !== undefined)
            ? charOffset + m[0].indexOf(m[1])
            : charOffset;
          boxes.push(subspanBox(span, boxStart, boxStart + matchedId.length));
        } else {
          for (let si = firstSpan; si <= lastSpan; si++) {
            if (si < 0 || si >= spans.length) continue;
            const span = spans[si];
            if (si === firstSpan) {
              boxes.push(subspanBox(span, matchStart - spanStart[si], span.str.length));
            } else if (si === lastSpan) {
              boxes.push(subspanBox(span, 0, matchEnd - spanStart[si] + 1));
            } else {
              boxes.push(subspanBox(span, 0, span.str.length));
            }
          }
        }

        if (type === "ssn")         stats.ssn++;
        else if (type === "ein")    stats.ein++;
        else if (type === "ptin")   stats.ptin++;
        else if (type === "masked") stats.alreadyMasked++;
      }
    }

    // Split-field SSN (IRS 1040/W-2): three adjacent spans [3-digit][2-digit][4-digit]
    {
      const byY = new Map();
      for (let si = 0; si < spans.length; si++) {
        const bucket = Math.round(spans[si].y / 2) * 2;
        if (!byY.has(bucket)) byY.set(bucket, []);
        byY.get(bucket).push(si);
      }
      for (const indices of byY.values()) {
        indices.sort((a, b) => spans[a].x - spans[b].x);
        for (let i = 0; i + 2 < indices.length; i++) {
          const s0 = spans[indices[i]];
          const s1 = spans[indices[i + 1]];
          const s2 = spans[indices[i + 2]];
          if (!/^\d{3}$/.test(s0.str) || !/^\d{2}$/.test(s1.str) || !/^\d{4}$/.test(s2.str)) continue;
          if (s2.x + s2.w - s0.x > 120) continue;
          const boxKey = `${s0.x.toFixed(0)},${s0.y.toFixed(0)}`;
          if (covered.has(boxKey)) continue;
          covered.add(boxKey);
          if (DEBUG) console.log(`  [debug] Split-field SSN "${s0.str}-${s1.str}-${s2.str}" at (${s0.x.toFixed(1)},${s0.y.toFixed(1)})`);
          stats.ssn++;
          boxes.push({ x: s0.x - 2, y: s0.y, w: (s2.x + s2.w) - s0.x + 4, h: Math.max(s0.h, s1.h, s2.h) });
          // Add the combined 9-digit string for TJ array detection
          sensitiveStrings.add(s0.str + s1.str + s2.str);
          // Also add individual components (≥3 chars only to avoid over-matching)
          if (s0.str.length >= 3) sensitiveStrings.add(s0.str);
          if (s2.str.length >= 3) sensitiveStrings.add(s2.str);
        }
      }
    }

    if (boxes.length > 0) pageMap.set(pageNum - 1, boxes);
  }

  return { pageMap, sensitiveStrings, stats };
}

// ── CIDFONT SUPPORT: Parse ToUnicode CMap from raw PDF bytes ─────
// Returns a Map<glyphHexNorm, unicodeChar> covering all bfchar and bfrange
// sections in every embedded CMap in the document.
// CMap streams may be FlateDecode-compressed, so we decompress each stream
// before searching, rather than searching the raw bytes directly.
function buildForwardGlyphMap(pdfBytes) {
  const rawBuf = Buffer.from(pdfBytes);
  const map = new Map(); // "0014" → "1"

  function addGlyph(hexStr, unicodeHex) {
    let char;
    try {
      const cp = parseInt(unicodeHex, 16);
      char = String.fromCodePoint(cp);
    } catch { return; }
    // Store with normalized 2-digit and 4-digit hex keys for lookup
    const norm2 = parseInt(hexStr, 16).toString(16).toUpperCase().padStart(2, "0");
    const norm4 = parseInt(hexStr, 16).toString(16).toUpperCase().padStart(4, "0");
    map.set(norm2, char);
    map.set(norm4, char);
  }

  function parseCMapText(text) {
    // beginbfchar...endbfchar
    const bfcharRe = /beginbfchar([\s\S]*?)endbfchar/g;
    let m;
    while ((m = bfcharRe.exec(text)) !== null) {
      const entryRe = /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g;
      let em;
      while ((em = entryRe.exec(m[1])) !== null) addGlyph(em[1], em[2]);
    }
    // beginbfrange...endbfrange
    const bfrangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = bfrangeRe.exec(text)) !== null) {
      const rangeRe = /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g;
      let rm;
      while ((rm = rangeRe.exec(m[1])) !== null) {
        const startG = parseInt(rm[1], 16);
        const endG   = parseInt(rm[2], 16);
        const startU = parseInt(rm[3], 16);
        const hexLen = rm[1].length;
        for (let g = startG; g <= endG; g++) {
          const gHex = g.toString(16).padStart(hexLen, "0");
          const uHex = (startU + (g - startG)).toString(16).padStart(4, "0");
          addGlyph(gHex, uHex);
        }
      }
    }
  }

  // Scan all streams in the PDF (both `stream\r\n` and `stream\n`)
  // Try to decompress each; parse CMap text from the result.
  const streamMarkers = ["stream\r\n", "stream\n"];
  for (const marker of streamMarkers) {
    const markerBuf = Buffer.from(marker);
    let searchPos = 0;
    while (searchPos < rawBuf.length) {
      const idx = rawBuf.indexOf(markerBuf, searchPos);
      if (idx === -1) break;
      const dataStart = idx + markerBuf.length;
      const endIdx = rawBuf.indexOf("endstream", dataStart);
      if (endIdx === -1) break;

      const streamData = rawBuf.slice(dataStart, endIdx);
      // Try decompressed first, then raw
      let texts = [];
      try { texts.push(zlib.inflateSync(streamData).toString("latin1")); } catch {}
      texts.push(streamData.toString("latin1"));

      for (const text of texts) {
        if (text.includes("beginbfchar") || text.includes("beginbfrange")) {
          parseCMapText(text);
        }
      }

      searchPos = endIdx + 9;
    }
  }

  return map;
}

// ── CIDFont BT block scrubber ─────────────────────────────────────
// Decodes a BT…ET block's <hex> Tj operations using the glyph map,
// runs the same sensitive-string / pattern matching used for other streams,
// and removes (blanks) the Tj operations that produce sensitive characters.
function scrubCIDFontBTBlock(blockContent, sensitiveStrings, forwardGlyphMap) {
  // Collect all individual-glyph Tj ops: <hexid> Tj
  // Also handle multi-char Tj: <0014001500160010> Tj (2-byte chunks)
  const tjOps = []; // { start, end, chars: string }
  const glyphTjRe = /<([0-9a-fA-F]+)>\s*Tj/gi;
  let gm;
  while ((gm = glyphTjRe.exec(blockContent)) !== null) {
    const hexStr = gm[1].toUpperCase();
    // CIDFont uses 2-byte glyph IDs; split into 2-byte (4-hex-digit) chunks
    let chars = "";
    const chunkSize = hexStr.length >= 4 ? 4 : hexStr.length;
    for (let ci = 0; ci < hexStr.length; ci += chunkSize) {
      const chunk = hexStr.slice(ci, ci + chunkSize).padStart(4, "0");
      const norm2 = parseInt(chunk, 16).toString(16).toUpperCase().padStart(2, "0");
      chars += forwardGlyphMap.get(chunk) ?? forwardGlyphMap.get(norm2) ?? "\x00";
    }
    tjOps.push({ start: gm.index, end: gm.index + gm[0].length, chars });
  }

  if (tjOps.length === 0) return { content: blockContent, modified: false };

  // Build decoded text and per-character index → tjOp index mapping
  const decodedChars = []; // array of { char, opIdx }
  for (let oi = 0; oi < tjOps.length; oi++) {
    for (const ch of tjOps[oi].chars) {
      decodedChars.push({ char: ch, opIdx: oi });
    }
  }
  const decoded = decodedChars.map(c => c.char).join("");

  if (DEBUG && decoded.trim()) {
    console.log(`  [debug] CIDFont BT decoded: "${decoded.replace(/\x00/g, "·").slice(0, 80)}"`);
  }

  // Find char positions to blank (character indices in decoded)
  const toBlankCharIdx = new Set();

  // Direct string matching
  const longStrings = [...sensitiveStrings].filter(s => s.length >= 3);
  for (const s of longStrings) {
    let pos = 0;
    while ((pos = decoded.indexOf(s, pos)) !== -1) {
      for (let i = pos; i < pos + s.length; i++) toBlankCharIdx.add(i);
      pos++;
    }
  }

  // Regex pattern matching (SSN_FORMATTED, EIN, PTIN, keyword-SSN, etc.)
  for (const { pattern } of SENSITIVE_PATTERNS) {
    const re = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"
    );
    let pm;
    while ((pm = re.exec(decoded)) !== null) {
      // If the pattern has a capture group (keyword-context SSN), blank only the capture
      const hitStart = (pm[1] !== undefined)
        ? decoded.indexOf(pm[1], pm.index)
        : pm.index;
      const hitLen   = (pm[1] !== undefined) ? pm[1].length : pm[0].length;
      for (let i = hitStart; i < hitStart + hitLen; i++) toBlankCharIdx.add(i);
    }
  }

  if (toBlankCharIdx.size === 0) return { content: blockContent, modified: false };

  // Convert char indices → op indices to remove
  const toRemoveOpIdx = new Set();
  for (const ci of toBlankCharIdx) {
    toRemoveOpIdx.add(decodedChars[ci].opIdx);
  }

  // Remove marked Tj ops in reverse order (to preserve string indices)
  let result = blockContent;
  const sortedOps = [...toRemoveOpIdx].sort((a, b) => b - a);
  for (const oi of sortedOps) {
    const op = tjOps[oi];
    result = result.slice(0, op.start) + result.slice(op.end);
  }

  return { content: result, modified: true };
}

// ── STEP 2: SCRUB CONTENT STREAMS ────────────────────────────────
// Replaces sensitive text with spaces inside PDF content streams.
// Handles both hex-encoded strings <hexbytes> and literal strings (text).
// For TJ arrays, detects matches by concatenating all literals in the array.
// Pass D handles CIDFont PDFs (TurboTax, IRS digital forms) where each
// character is stored as an individual <hexGlyphId> Tj operator.
function scrubContentStreams(pdfDoc, sensitiveStrings, forwardGlyphMap) {
  if (sensitiveStrings.size === 0) return;

  // Build efficient lookup: strings ≥3 chars for TJ concatenation matching
  const longStrings = [...sensitiveStrings].filter(s => s.length >= 3);

  const context = pdfDoc.context;

  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (obj.constructor.name !== "PDFRawStream") continue;

    const filter  = obj.dict.get(PDFName.of("Filter"));
    const isFlate = filter?.toString() === "/FlateDecode";

    let content;
    try {
      content = isFlate
        ? zlib.inflateSync(Buffer.from(obj.contents)).toString("latin1")
        : Buffer.from(obj.contents).toString("latin1");
    } catch { continue; }

    if (!content.includes("BT") && !content.includes("Tj")) continue;

    let modified = false;
    let newContent = content;

    // ── A: Hex strings <hexbytes> ─────────────────────────────────
    for (const text of sensitiveStrings) {
      const hexTarget  = Buffer.from(text, "latin1").toString("hex");
      const hexReplace = "20".repeat(text.length);
      const after = newContent.replace(/<([0-9a-fA-F]+)>/gi, (match, hex) => {
        const out = hex.replace(new RegExp(hexTarget, "gi"), hexReplace);
        if (out !== hex) modified = true;
        return `<${out}>`;
      });
      newContent = after;
    }

    // ── B: TJ arrays [ ... (lit) num (lit) ... ]TJ ───────────────
    // Concatenate all literals in each TJ array; if it contains a sensitive
    // string, replace every literal in that array with equal-length spaces.
    newContent = newContent.replace(/\[([^\]]*)\]\s*TJ/g, (match, inner) => {
      // Extract literal strings from this TJ array
      const literals = [];
      let litRe = /\(([^)]*)\)/g, lm;
      while ((lm = litRe.exec(inner)) !== null) {
        literals.push({ full: lm[0], text: lm[1], index: lm.index });
      }
      if (literals.length === 0) return match;

      const concatenated = literals.map(l => l.text).join("");

      // Check if concatenated text contains any sensitive string
      const hasSensitive = longStrings.some(s => concatenated.includes(s));
      if (!hasSensitive) return match;

      modified = true;
      if (DEBUG) console.log(`  [debug] Blanking TJ array containing: "${concatenated.slice(0, 60)}"`);

      // Replace each literal with equal-length spaces
      let newInner = inner;
      // Process in reverse order to preserve indices
      for (const lit of [...literals].reverse()) {
        const blank = "(" + " ".repeat(lit.text.length) + ")";
        newInner = newInner.slice(0, lit.index) + blank + newInner.slice(lit.index + lit.full.length);
      }
      return `[${newInner}]TJ`;
    });

    // ── C: Single-string Tj operator (text)Tj ─────────────────────
    for (const text of longStrings) {
      const esc = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re  = new RegExp(`\\(([^)]*)${esc}([^)]*)\\)\\s*Tj`, "g");
      const after = newContent.replace(re, (match, pre, post) => {
        modified = true;
        const blank = " ".repeat(pre.length + text.length + post.length);
        return `(${blank})Tj`;
      });
      newContent = after;
    }

    // ── D: CIDFont individual-glyph Tj (TurboTax, eFiled IRS forms) ──
    // Each char stored as <hexGlyphId> Tj. Decode via ToUnicode CMap,
    // then blank Tj ops that produce sensitive characters.
    if (forwardGlyphMap.size > 0 && /<[0-9a-fA-F]+>\s*Tj/i.test(newContent)) {
      // Find all BT...ET blocks
      const btBlocks = [];
      // Use indexOf loop instead of regex to avoid backtracking on large streams
      let searchPos = 0;
      while (searchPos < newContent.length) {
        const btIdx = newContent.indexOf("BT", searchPos);
        if (btIdx === -1) break;
        // Ensure BT is a standalone operator (not inside a string)
        const charBefore = btIdx > 0 ? newContent[btIdx - 1] : "\n";
        if (!/[\s\n\r]/.test(charBefore)) { searchPos = btIdx + 1; continue; }
        const etIdx = newContent.indexOf("ET", btIdx + 2);
        if (etIdx === -1) break;
        const charAfterET = newContent[etIdx + 2];
        if (charAfterET && !/[\s\n\r]/.test(charAfterET)) { searchPos = etIdx + 1; continue; }
        btBlocks.push({ btIdx, etIdx });
        searchPos = etIdx + 2;
      }

      // Process blocks in reverse order to preserve string indices
      for (let bi = btBlocks.length - 1; bi >= 0; bi--) {
        const { btIdx, etIdx } = btBlocks[bi];
        const innerStart = btIdx + 2;
        const innerEnd   = etIdx;
        const inner = newContent.slice(innerStart, innerEnd);

        if (!/<[0-9a-fA-F]+>\s*Tj/i.test(inner)) continue;

        const { content: newInner, modified: blockMod } =
          scrubCIDFontBTBlock(inner, sensitiveStrings, forwardGlyphMap);

        if (blockMod) {
          modified = true;
          newContent = newContent.slice(0, innerStart) + newInner + newContent.slice(innerEnd);
          if (DEBUG) console.log(`  [debug] CIDFont: blanked Tj ops in BT block at offset ${btIdx}`);
        }
      }
    }

    if (modified) {
      const newBytes      = Buffer.from(newContent, "latin1");
      const newCompressed = isFlate ? zlib.deflateSync(newBytes) : newBytes;
      obj.contents = newCompressed;
      obj.dict.set(PDFName.of("Length"), context.obj(newCompressed.length));
    }
  }
}

// ── STEP 3: DRAW WHITE RECTANGLES (VISUAL BLANK) ─────────────────
function applyWhiteBoxes(pdfDoc, pageMap) {
  const pages = pdfDoc.getPages();
  const WHITE = rgb(1, 1, 1);

  for (const [pageIdx, boxes] of pageMap) {
    const page = pages[pageIdx];
    for (const box of boxes) {
      if (!isFinite(box.x) || !isFinite(box.y) || box.w <= 0 || box.w > 600) continue;
      page.drawRectangle({
        x:      box.x,
        y:      box.y,
        width:  box.w,
        height: box.h,
        color:  WHITE,
      });
    }
  }
}

// ── MAIN ──────────────────────────────────────────────────────────
async function main() {
  const { printRedactionSummary } = await import("./lib/redact.js");

  console.log(`\n🔒 redact-pdf — local only, no network`);
  console.log(`   Input:  ${inputFilename}`);
  console.log(`   Output: ${outputFilename}\n`);

  let rawPdfBuffer = fs.readFileSync(inputPath);
  console.log(`📄 Read ${(rawPdfBuffer.length / 1024).toFixed(1)} KB`);

  // Detect sensitive items via pdfjs
  console.log(`\n🛡️  Scanning for government identifiers...`);
  let pageMap, sensitiveStrings, stats;
  try {
    ({ pageMap, sensitiveStrings, stats } = await findSensitiveItems(rawPdfBuffer));
  } catch (err) {
    console.error(`❌ PDF scanning failed: ${err.message}`);
    wipeBuffer(rawPdfBuffer);
    process.exit(1);
  }

  printRedactionSummary(stats);
  if (stats.ssn + stats.ein + stats.ptin + stats.alreadyMasked === 0) {
    console.log(`   (no government identifiers found)`);
  }

  // Apply redaction
  console.log(`\n📝 Blanking sensitive fields...`);

  // Build CIDFont glyph map from raw bytes (before pdf-lib parses the doc)
  const forwardGlyphMap = buildForwardGlyphMap(rawPdfBuffer);
  if (DEBUG && forwardGlyphMap.size > 0) {
    console.log(`  [debug] CIDFont glyph map: ${forwardGlyphMap.size} entries`);
  }

  let outBuffer;
  try {
    const pdfDoc = await PDFDocument.load(rawPdfBuffer);

    // 1. Scrub text from content streams (ASCII, literal, and CIDFont)
    scrubContentStreams(pdfDoc, sensitiveStrings, forwardGlyphMap);

    // 2. White rectangles over positions (visual blank for any encoding we couldn't scrub)
    applyWhiteBoxes(pdfDoc, pageMap);

    outBuffer = Buffer.from(await pdfDoc.save());
  } catch (err) {
    console.error(`❌ PDF processing failed: ${err.message}`);
    wipeBuffer(rawPdfBuffer);
    process.exit(1);
  }

  wipeBuffer(rawPdfBuffer);
  rawPdfBuffer = null;

  fs.writeFileSync(outputPath, outBuffer);
  wipeBuffer(outBuffer);
  outBuffer = null;

  const outputSizeKB = (fs.statSync(outputPath).size / 1024).toFixed(1);
  console.log(`\n✅ Redacted PDF saved: ${outputPath}`);
  console.log(`   Size: ${outputSizeKB} KB`);
  console.log(`   Format preserved — SSN/EIN/PTIN fields are blank.\n`);
}

main().catch(err => {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
});
