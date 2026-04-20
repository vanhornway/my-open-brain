#!/usr/bin/env node
/**
 * Ingest Whoop CSV exports into Supabase health_metrics table.
 * Processes: physiological_cycles.csv, sleeps.csv, workouts.csv
 *
 * Usage:
 *   node ingest-whoop.js
 *   node ingest-whoop.js --folder /path/to/whoop/data
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = "https://epckjiufeimydxmcrfus.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUBJECT = "Umair";
const DEFAULT_FOLDER = "/Users/mumair/Downloads/my_whoop_data_2026_03_22";

const args = process.argv.slice(2);
const folderIdx = args.indexOf("--folder");
const FOLDER = folderIdx !== -1 ? args[folderIdx + 1] : DEFAULT_FOLDER;

// ── HELPERS ───────────────────────────────────────────────
function parseFloat2(val) {
  if (val == null || val === "" || val === "null") return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function localDate(datetimeStr) {
  // e.g. "2026-03-20 00:30:44" → "2026-03-20"
  if (!datetimeStr) return null;
  return datetimeStr.split(" ")[0].split("T")[0];
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${m}/${d}/${y}`;
}

function parseCSV(content) {
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
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

function makeRow(date, metric_type, value, unit, extra = {}) {
  if (value === null || value === undefined || isNaN(value)) return null;
  return {
    recorded_at: `${date}T00:00:00`,
    source: "whoop",
    metric_type,
    value,
    unit,
    subject: SUBJECT,
    metadata: { date_label: formatDate(date), ...extra },
    notes: null,
  };
}

// ── PARSERS ───────────────────────────────────────────────
function parseCycles(rows) {
  const metrics = [];
  for (const r of rows) {
    const date = localDate(r["Cycle start time"]);
    if (!date) continue;

    const add = (type, val, unit, extra) => {
      const row = makeRow(date, type, parseFloat2(val), unit, extra);
      if (row) metrics.push(row);
    };

    add("recovery_score",      r["Recovery score %"],          "%");
    add("resting_heart_rate",  r["Resting heart rate (bpm)"],  "bpm");
    add("hrv",                 r["Heart rate variability (ms)"],"ms");
    add("skin_temperature",    r["Skin temp (celsius)"],        "°C");
    add("spo2",                r["Blood oxygen %"],             "%");
    add("strain",              r["Day Strain"],                 "score");
    add("calories_active",     r["Energy burned (cal)"],        "kcal");
    add("respiratory_rate",    r["Respiratory rate (rpm)"],     "brpm");
  }
  return metrics;
}

function parseSleeps(rows) {
  const metrics = [];
  for (const r of rows) {
    // Use wake date as the sleep record date
    const date = localDate(r["Wake onset"] || r["Cycle start time"]);
    if (!date) continue;

    // Skip naps — only process main sleep
    if (r["Nap"]?.toLowerCase() === "true") continue;

    const add = (type, val, unit) => {
      const row = makeRow(date, type, parseFloat2(val), unit);
      if (row) metrics.push(row);
    };

    const asleepMin = parseFloat2(r["Asleep duration (min)"]);
    if (asleepMin != null) {
      metrics.push(makeRow(date, "sleep_hours", +(asleepMin / 60).toFixed(2), "hours"));
    }

    add("sleep_score",          r["Sleep performance %"],       "%");
    add("respiratory_rate",     r["Respiratory rate (rpm)"],    "brpm");
    add("time_in_bed_minutes",  r["In bed duration (min)"],     "min");
    add("light_sleep_minutes",  r["Light sleep duration (min)"],"min");
    add("deep_sleep_minutes",   r["Deep (SWS) duration (min)"], "min");
    add("rem_minutes",          r["REM duration (min)"],        "min");
    add("sleep_debt_minutes",   r["Sleep debt (min)"],          "min");
    add("sleep_consistency",    r["Sleep consistency %"],       "%");
  }
  return metrics.filter(Boolean);
}

function parseWorkouts(rows) {
  const metrics = [];
  for (const r of rows) {
    const date = localDate(r["Workout start time"]);
    if (!date) continue;

    const activity = r["Activity name"] ?? "";
    const extra = { activity };

    const add = (type, val, unit) => {
      const row = makeRow(date, type, parseFloat2(val), unit, extra);
      if (row) metrics.push(row);
    };

    add("strain",          r["Activity Strain"],   "score");
    add("calories_active", r["Energy burned (cal)"],"kcal");

    // HR zones as % of workout time
    add("hr_zone_1", r["HR Zone 1 %"], "%");
    add("hr_zone_2", r["HR Zone 2 %"], "%");
    add("hr_zone_3", r["HR Zone 3 %"], "%");
    add("hr_zone_4", r["HR Zone 4 %"], "%");
    add("hr_zone_5", r["HR Zone 5 %"], "%");
  }
  return metrics.filter(Boolean);
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
    console.error(`❌ Insert failed: ${err}`);
  }
}

// ── MAIN ──────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ Missing SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const files = {
    cycles:   "physiological_cycles.csv",
    sleeps:   "sleeps.csv",
    workouts: "workouts.csv",
  };

  let totalMetrics = 0;

  for (const [key, filename] of Object.entries(files)) {
    const filePath = path.join(FOLDER, filename);
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  ${filename} not found, skipping`);
      continue;
    }

    const rows = parseCSV(fs.readFileSync(filePath, "utf8"));
    let metrics = [];

    if (key === "cycles")   metrics = parseCycles(rows);
    if (key === "sleeps")   metrics = parseSleeps(rows);
    if (key === "workouts") metrics = parseWorkouts(rows);

    if (!metrics.length) {
      console.log(`  ${filename} — no data`);
      continue;
    }

    const BATCH = 500;
    for (let i = 0; i < metrics.length; i += BATCH) {
      await upsertBatch(metrics.slice(i, i + BATCH));
    }

    console.log(`✅ ${filename} — ${metrics.length} metrics from ${rows.length} records`);
    totalMetrics += metrics.length;
  }

  console.log(`\nDone. Total metrics inserted: ${totalMetrics}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
