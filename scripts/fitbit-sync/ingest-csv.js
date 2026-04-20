#!/usr/bin/env node
/**
 * Ingest Fitbit takeout CSV exports into Supabase health_metrics table.
 *
 * Usage:
 *   node ingest-csv.js                          # ingest all files in default folder
 *   node ingest-csv.js --folder /path/to/folder # ingest from specific folder
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = "https://epckjiufeimydxmcrfus.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUBJECT = "Umair";
const DEFAULT_FOLDER = "/Users/mumair/Downloads/antigravity data";

// ── ARG PARSING ───────────────────────────────────────────
const args = process.argv.slice(2);
const folderIdx = args.indexOf("--folder");
const FOLDER = folderIdx !== -1 ? args[folderIdx + 1] : DEFAULT_FOLDER;

// ── HELPERS ───────────────────────────────────────────────
function formatDate(dateStr) {
  // YYYY-MM-DD → MM/DD/YYYY
  const [y, m, d] = dateStr.split("-");
  return `${m}/${d}/${y}`;
}

function parseFloat2(val) {
  if (val == null || val === "" || val === "null") return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function parseCSV(content) {
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    // Handle commas inside quoted fields
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
  });
}

// ── ROW → METRICS ─────────────────────────────────────────
function rowToMetrics(row) {
  const date = row["date"];
  if (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/)) return [];

  const label = formatDate(date);
  const metrics = [];

  const add = (metric_type, rawVal, unit) => {
    const value = parseFloat2(rawVal);
    if (value !== null) {
      metrics.push({
        recorded_at: `${date}T00:00:00`,
        source: "fitbit",
        metric_type,
        value,
        unit,
        subject: SUBJECT,
        metadata: { date_label: label },
        notes: null,
      });
    }
  };

  add("steps",                row["Total Steps"],          "steps");
  add("resting_heart_rate",   row["Resting Heart Rate"],   "bpm");
  add("sleep_score",          row["Sleep Score"],          "%");
  add("deep_sleep_minutes",   row["Deep Sleep (minutes)"], "min");
  add("sleep_duration_score", row["Sleep Duration Score"], "score");
  add("sleep_restlessness",   row["Restlessness Score"],   "score");
  add("hrv",                  row["HRV (RMSSD)"],          "ms");
  add("active_minutes",       row["Active Zone Minutes"],  "min");
  add("spo2",                 row["SpO2 (%)"],             "%");
  add("stress_score",         row["Stress Score"],         "score");
  add("recovery_score",       row["Daily Readiness Score"],"score");
  add("skin_temperature",     row["Nightly Temperature"],  "°C");

  return metrics;
}

// ── SUPABASE UPSERT ───────────────────────────────────────
async function upsertBatch(rows) {
  if (!rows.length) return;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/health_metrics`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`  ❌ Insert failed: ${err}`);
  }
}

// ── MAIN ──────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ Missing SUPABASE_SERVICE_ROLE_KEY. Run: export SUPABASE_SERVICE_ROLE_KEY=...");
    process.exit(1);
  }

  const files = fs
    .readdirSync(FOLDER)
    .filter((f) => f.startsWith("fitbit_export_") && f.endsWith(".csv"))
    .sort();

  if (!files.length) {
    console.error(`❌ No fitbit_export_*.csv files found in ${FOLDER}`);
    process.exit(1);
  }

  console.log(`Found ${files.length} files in ${FOLDER}\n`);

  let totalRows = 0;

  for (const file of files) {
    const filePath = path.join(FOLDER, file);
    const content = fs.readFileSync(filePath, "utf8");
    const rows = parseCSV(content);
    const metrics = rows.flatMap(rowToMetrics);

    if (!metrics.length) {
      console.log(`  ${file} — no data, skipping`);
      continue;
    }

    // Insert in batches of 500
    const BATCH = 500;
    for (let i = 0; i < metrics.length; i += BATCH) {
      await upsertBatch(metrics.slice(i, i + BATCH));
    }

    console.log(`✅ ${file} — ${metrics.length} metrics from ${rows.length} days`);
    totalRows += metrics.length;
  }

  console.log(`\nDone. Total metrics inserted: ${totalRows}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
