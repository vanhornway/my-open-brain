#!/usr/bin/env node
/**
 * Ingest LibreView CSV export into Supabase health_metrics.
 *
 * How to export from LibreView:
 *   1. Go to LibreView.com → Reports → Export Data
 *   2. Select date range → Download CSV
 *
 * Usage:
 *   node ingest-libre3-csv.js --file ~/Downloads/GlucoseData.csv
 *   node ingest-libre3-csv.js --file ~/Downloads/GlucoseData.csv --dry-run
 *   node ingest-libre3-csv.js --file ~/Downloads/GlucoseData.csv --from 2025-01-01
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = "https://epckjiufeimydxmcrfus.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUBJECT = "Umair";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const fileIdx = args.indexOf("--file");
const fromIdx = args.indexOf("--from");

if (fileIdx === -1) {
  console.error("Usage: node ingest-libre3-csv.js --file /path/to/GlucoseData.csv [--from YYYY-MM-DD] [--dry-run]");
  process.exit(1);
}

const CSV_FILE = args[fileIdx + 1];
const FROM_DATE = fromIdx !== -1 ? new Date(args[fromIdx + 1]) : null;

// Trend arrow descriptions
const TREND_LABELS = {
  1: "rapidly_falling",
  2: "falling",
  3: "stable",
  4: "rising",
  5: "rapidly_rising",
};

// ── CSV PARSING ───────────────────────────────────────────
function parseLibreViewCSV(content) {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);

  // LibreView CSV has metadata rows at the top before the header row.
  // Find the header row — it contains "Device Timestamp" or "Timestamp"
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (
      lines[i].includes("Device Timestamp") ||
      lines[i].includes("Gerät-Zeitstempel") || // German locale
      lines[i].toLowerCase().includes("timestamp")
    ) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    throw new Error(
      "Could not find header row in CSV. Expected a row containing 'Device Timestamp'."
    );
  }

  const headers = lines[headerIdx].split(",").map((h) => h.trim().replace(/"/g, ""));
  const dataLines = lines.slice(headerIdx + 1);

  return dataLines.map((line) => {
    const values = [];
    let cur = "";
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === "," && !inQuote) { values.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    values.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
  }).filter((r) => Object.values(r).some((v) => v !== ""));
}

// ── TIMESTAMP PARSING ─────────────────────────────────────
function parseTimestamp(ts) {
  if (!ts) return null;
  ts = ts.trim();

  // MM-DD-YYYY HH:MM AM/PM  (US LibreView format with dashes and AM/PM)
  const usDashMatch = ts.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (usDashMatch) {
    let [, mo, dy, yr, hr, min, ampm] = usDashMatch;
    hr = parseInt(hr);
    if (ampm) {
      if (ampm.toUpperCase() === "PM" && hr < 12) hr += 12;
      if (ampm.toUpperCase() === "AM" && hr === 12) hr = 0;
    }
    return `${yr}-${mo.padStart(2, "0")}-${dy.padStart(2, "0")}T${String(hr).padStart(2, "0")}:${min}:00`;
  }

  // DD-MM-YYYY HH:MM  (European LibreView format)
  const euMatch = ts.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})$/);
  if (euMatch) {
    const [, dd, mm, yyyy, hh, min] = euMatch;
    return `${yyyy}-${mm}-${dd}T${hh}:${min}:00`;
  }

  // MM/DD/YYYY HH:MM AM/PM  (US format with slashes)
  const usMatch = ts.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (usMatch) {
    let [, mo, dy, yr, hr, min, ampm] = usMatch;
    hr = parseInt(hr);
    if (ampm) {
      if (ampm.toUpperCase() === "PM" && hr < 12) hr += 12;
      if (ampm.toUpperCase() === "AM" && hr === 12) hr = 0;
    }
    return `${yr}-${mo.padStart(2, "0")}-${dy.padStart(2, "0")}T${String(hr).padStart(2, "0")}:${min}:00`;
  }

  // ISO-like: 2025-01-15 10:30:00
  const isoMatch = ts.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}(:\d{2})?)$/);
  if (isoMatch) {
    return `${isoMatch[1]}T${isoMatch[2].length === 5 ? isoMatch[2] + ":00" : isoMatch[2]}`;
  }

  return null;
}

// ── RECORD TYPE MAPPING ───────────────────────────────────
// LibreView record types:
//   0 = Historic glucose (automatic 1-min scan from sensor)
//   1 = Scan glucose (manual NFC scan)
//   2 = Strip glucose (fingerstick)
//   5 = Insulin (not glucose)
//   6 = Food (not glucose)
function getGlucoseValue(row) {
  const type = parseInt(row["Record Type"] ?? row["Aufzeichnungstyp"] ?? "-1");

  // Historic (type 0)
  const historic =
    parseFloat(row["Historic Glucose mg/dL"] ?? row["Historische Glukose mg/dL"] ?? "");
  if (type === 0 && !isNaN(historic)) return { value: historic, scan_type: "historic" };

  // Scan (type 1)
  const scan =
    parseFloat(row["Scan Glucose mg/dL"] ?? row["Gescannte Glukose mg/dL"] ?? "");
  if (type === 1 && !isNaN(scan)) return { value: scan, scan_type: "scan" };

  // Strip glucose (type 2)
  const strip =
    parseFloat(row["Strip Glucose mg/dL"] ?? row["Stichprobenwert mg/dL"] ?? "");
  if (type === 2 && !isNaN(strip)) return { value: strip, scan_type: "strip" };

  return null;
}

// ── BUILD ROWS ────────────────────────────────────────────
function buildRows(records) {
  const rows = [];

  for (const r of records) {
    const tsRaw =
      r["Device Timestamp"] ??
      r["Gerät-Zeitstempel"] ??
      r["Timestamp"] ??
      "";
    const recorded_at = parseTimestamp(tsRaw);
    if (!recorded_at) continue;

    if (FROM_DATE && new Date(recorded_at) < FROM_DATE) continue;

    const glucose = getGlucoseValue(r);
    if (!glucose) continue;

    const { value, scan_type } = glucose;
    if (isNaN(value) || value <= 0) continue;

    rows.push({
      recorded_at,
      source: "libre3",
      metric_type: "glucose",
      value: Math.round(value),
      unit: "mg/dL",
      subject: SUBJECT,
      metadata: {
        scan_type,
        serial_number: r["Serial Number"] ?? r["Seriennummer"] ?? null,
        device: r["Device"] ?? r["Gerät"] ?? null,
      },
      notes: null,
    });
  }

  return rows;
}

// ── SUPABASE UPSERT ───────────────────────────────────────
async function upsertBatch(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/health_metrics`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`❌ Insert failed: ${err}`);
    return 0;
  }
  return rows.length;
}

// ── MAIN ──────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_KEY && !DRY_RUN) {
    console.error("❌ Missing SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  if (!fs.existsSync(CSV_FILE)) {
    console.error(`❌ File not found: ${CSV_FILE}`);
    process.exit(1);
  }

  console.log(`📂 Reading: ${path.basename(CSV_FILE)}`);
  const content = fs.readFileSync(CSV_FILE, "utf8");
  const records = parseLibreViewCSV(content);
  console.log(`   ${records.length} raw records parsed`);

  const rows = buildRows(records);
  if (!rows.length) {
    console.log("No glucose rows to insert (check date filter or record types).");
    return;
  }

  // Summary stats
  const dates = rows.map((r) => r.recorded_at).sort();
  const values = rows.map((r) => r.value);
  const avg = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(0);
  const tir = ((values.filter((v) => v >= 70 && v <= 180).length / values.length) * 100).toFixed(1);
  const scanTypes = rows.reduce((acc, r) => {
    const t = r.metadata.scan_type;
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  console.log(`\n📊 ${rows.length} glucose readings`);
  console.log(`   Range: ${dates[0].split("T")[0]} → ${dates.at(-1).split("T")[0]}`);
  console.log(`   Avg: ${avg} mg/dL | TIR (70–180): ${tir}%`);
  console.log(`   Low (<70): ${values.filter((v) => v < 70).length} | High (>180): ${values.filter((v) => v > 180).length}`);
  console.log(`   Types: ${Object.entries(scanTypes).map(([k, v]) => `${k}=${v}`).join(", ")}`);

  if (DRY_RUN) {
    console.log("\n[dry-run] First 3 rows:");
    rows.slice(0, 3).forEach((r) => console.log(" ", JSON.stringify(r)));
    return;
  }

  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    inserted += await upsertBatch(rows.slice(i, i + BATCH));
    process.stdout.write(`\r  Inserted ${Math.min(i + BATCH, rows.length)}/${rows.length}...`);
  }

  console.log(`\n✅ Done. ${inserted} glucose readings upserted.`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
