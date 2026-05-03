#!/usr/bin/env node
/**
 * Fitbit → Supabase daily metrics sync
 * Uses bulk time-series endpoints — ~20 API calls total regardless of date range.
 *
 * Usage:
 *   node sync.js                              # last 2 days
 *   node sync.js --from 2022-01-01            # backfill from date
 *   node sync.js --from 2022-01-01 --to 2024-12-31
 *   node sync.js --intraday                   # also fetch Saturday intraday HR (hike window analysis)
 *   node sync.js --from 2025-04-01 --intraday # backfill with intraday HR
 */

import fs from "fs";
import path from "path";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import { exec } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CONFIG ────────────────────────────────────────────────
const CLIENT_ID = "23V8VW";
const CLIENT_SECRET = "8770365b8a811d0816694257641016cc";
const REDIRECT_URI = "https://umair.us/fitbit/callback";
const TOKENS_FILE = path.join(__dirname, "tokens.json");

const SUPABASE_URL = "https://epckjiufeimydxmcrfus.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUBJECT = "Umair";

// ── ARG PARSING ───────────────────────────────────────────
const args = process.argv.slice(2);
const fromIdx = args.indexOf("--from");
const toIdx = args.indexOf("--to");

const today = new Date();
const defaultFrom = new Date(today);
defaultFrom.setDate(today.getDate() - 2);

let fromDate = fromIdx !== -1 ? args[fromIdx + 1] : null;
const toDate = toIdx !== -1 ? args[toIdx + 1] : isoDate(today);
const INTRADAY = args.includes("--intraday");

// ── HELPERS ───────────────────────────────────────────────
function isoDate(d) {
  return d.toISOString().split("T")[0];
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${m}/${d}/${y}`;
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

function openBrowser(url) {
  exec(`open "${url}"`);
}

// Split a date range into chunks of maxDays
function chunkDateRange(from, to, maxDays) {
  const chunks = [];
  let cur = new Date(from);
  const end = new Date(to);
  while (cur <= end) {
    const chunkEnd = new Date(cur);
    chunkEnd.setDate(chunkEnd.getDate() + maxDays - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    chunks.push([isoDate(cur), isoDate(chunkEnd)]);
    cur.setDate(cur.getDate() + maxDays);
  }
  return chunks;
}

// ── TOKEN MANAGEMENT ──────────────────────────────────────
function loadTokens() {
  if (fs.existsSync(TOKENS_FILE)) return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
  return null;
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

async function exchangeCode(code) {
  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://api.fitbit.com/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, grant_type: "authorization_code", redirect_uri: REDIRECT_URI, code }).toString(),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  const data = await res.json();
  const tokens = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 };
  saveTokens(tokens);
  return tokens;
}

async function refreshTokens(tokens) {
  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://api.fitbit.com/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }).toString(),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = await res.json();
  const newTokens = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 };
  saveTokens(newTokens);
  return newTokens;
}

async function getValidTokens() {
  let tokens = loadTokens();

  if (!tokens) {
    const authUrl = `https://www.fitbit.com/oauth2/authorize?` + new URLSearchParams({
      response_type: "code", client_id: CLIENT_ID, redirect_uri: REDIRECT_URI,
      scope: "activity heartrate sleep weight oxygen_saturation respiratory_rate cardio_fitness temperature",
      expires_in: "604800",
    });
    console.log("\n🔐 Opening Fitbit authorization in your browser...");
    openBrowser(authUrl);
    console.log("\nAfter approving, copy the full redirect URL from the browser bar.\n");
    const redirected = await prompt("Paste the redirect URL here: ");
    const code = new URL(redirected).searchParams.get("code");
    if (!code) throw new Error("No code found in URL");
    tokens = await exchangeCode(code);
    console.log("✅ Authorized.\n");
  } else if (Date.now() > tokens.expires_at - 60_000) {
    console.log("Refreshing tokens...");
    tokens = await refreshTokens(tokens);
  }

  return tokens;
}

// ── FITBIT API ────────────────────────────────────────────
async function fitbit(accessToken, path) {
  const res = await fetch(`https://api.fitbit.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60") + 5;
    console.log(`\n  Rate limited — waiting ${retryAfter}s...`);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return fitbit(accessToken, path);
  }

  if (!res.ok) {
    console.warn(`  ⚠️  ${path} → ${res.status}`);
    return null;
  }
  return res.json();
}

// ── BULK FETCHERS (time-series) ───────────────────────────
// Returns map of { "YYYY-MM-DD": value }

async function fetchActivitySeries(token, resource, from, to) {
  // Max 1 year per request
  const result = {};
  for (const [start, end] of chunkDateRange(from, to, 365)) {
    const data = await fitbit(token, `/1/user/-/activities/${resource}/date/${start}/${end}.json`);
    const key = `activities-${resource}`;
    for (const entry of data?.[key] ?? []) {
      result[entry.dateTime] = parseFloat(entry.value);
    }
  }
  return result;
}

async function fetchRestingHeartRate(token, from, to) {
  const result = {};
  for (const [start, end] of chunkDateRange(from, to, 365)) {
    const data = await fitbit(token, `/1/user/-/activities/heart/date/${start}/${end}.json`);
    for (const entry of data?.["activities-heart"] ?? []) {
      const rhr = entry.value?.restingHeartRate;
      if (rhr != null) result[entry.dateTime] = rhr;
    }
  }
  return result;
}

async function fetchHRZones(token, from, to) {
  // Returns map of { "YYYY-MM-DD": { out_of_range, fat_burn, cardio, peak } } in minutes
  const result = {};
  for (const [start, end] of chunkDateRange(from, to, 365)) {
    const data = await fitbit(token, `/1/user/-/activities/heart/date/${start}/${end}.json`);
    for (const entry of data?.["activities-heart"] ?? []) {
      const zones = entry.value?.heartRateZones;
      if (!zones?.length) continue;
      const byName = Object.fromEntries(zones.map((z) => [z.name, z.minutes]));
      result[entry.dateTime] = {
        out_of_range: byName["Out of Range"] ?? null,
        fat_burn:     byName["Fat Burn"]     ?? null,
        cardio:       byName["Cardio"]       ?? null,
        peak:         byName["Peak"]         ?? null,
      };
    }
  }
  return result;
}

async function fetchSleep(token, from, to) {
  const hoursMap = {};
  const scoreMap = {};
  // Max 100 days per request
  for (const [start, end] of chunkDateRange(from, to, 100)) {
    const data = await fitbit(token, `/1.2/user/-/sleep/date/${start}/${end}.json`);
    for (const entry of data?.sleep ?? []) {
      const date = entry.dateOfSleep;
      if (!hoursMap[date]) hoursMap[date] = 0;
      hoursMap[date] += entry.minutesAsleep / 60;
      if (entry.efficiency != null) scoreMap[date] = entry.efficiency;
    }
  }
  // Round hours
  for (const d of Object.keys(hoursMap)) hoursMap[d] = +hoursMap[d].toFixed(2);
  return { hoursMap, scoreMap };
}

async function fetchWeight(token, from, to) {
  const result = {};
  // Max 31 days per request
  for (const [start, end] of chunkDateRange(from, to, 31)) {
    const data = await fitbit(token, `/1/user/-/body/log/weight/date/${start}/${end}.json`);
    const byDate = {};
    for (const entry of data?.weight ?? []) {
      if (!byDate[entry.date]) byDate[entry.date] = [];
      byDate[entry.date].push(entry.weight);
    }
    for (const [date, vals] of Object.entries(byDate)) {
      result[date] = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
    }
  }
  return result;
}

async function fetchBodyFat(token, from, to) {
  const result = {};
  for (const [start, end] of chunkDateRange(from, to, 31)) {
    const data = await fitbit(token, `/1/user/-/body/log/fat/date/${start}/${end}.json`);
    const byDate = {};
    for (const entry of data?.fat ?? []) {
      if (!byDate[entry.date]) byDate[entry.date] = [];
      byDate[entry.date].push(entry.fat);
    }
    for (const [date, vals] of Object.entries(byDate)) {
      result[date] = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
    }
  }
  return result;
}

async function fetchSpO2(token, from, to) {
  const result = {};
  for (const [start, end] of chunkDateRange(from, to, 30)) {
    const data = await fitbit(token, `/1/user/-/spo2/date/${start}/${end}.json`);
    for (const entry of data ?? []) {
      if (entry.value?.avg != null) result[entry.dateTime] = +entry.value.avg.toFixed(1);
    }
  }
  return result;
}

async function fetchHRV(token, from, to) {
  const result = {};
  for (const [start, end] of chunkDateRange(from, to, 30)) {
    const data = await fitbit(token, `/1/user/-/hrv/date/${start}/${end}.json`);
    for (const entry of data?.hrv ?? []) {
      if (entry.value?.dailyRmssd != null) result[entry.dateTime] = +entry.value.dailyRmssd.toFixed(1);
    }
  }
  return result;
}

async function fetchBreathingRate(token, from, to) {
  const result = {};
  for (const [start, end] of chunkDateRange(from, to, 30)) {
    const data = await fitbit(token, `/1/user/-/br/date/${start}/${end}.json`);
    for (const entry of data?.br ?? []) {
      if (entry.value?.breathingRate != null) result[entry.dateTime] = +entry.value.breathingRate.toFixed(1);
    }
  }
  return result;
}

async function fetchVO2Max(token, from, to) {
  const result = {};
  for (const [start, end] of chunkDateRange(from, to, 365)) {
    const data = await fitbit(token, `/1/user/-/cardioscore/date/${start}/${end}.json`);
    for (const entry of data?.cardioScore ?? []) {
      if (entry.value?.vo2Max != null) result[entry.dateTime] = parseFloat(entry.value.vo2Max);
    }
  }
  return result;
}

// ── INTRADAY HR — SATURDAY HIKE WINDOW ───────────────────
// Fetches minute-level HR for every Saturday in range.
// Analyzes 6:30–10:30 AM window for Zone 2+ sustained activity.
// Returns map of { "YYYY-MM-DD": { zone2_plus_minutes, sustained_block_minutes, first_rise_time } }
async function fetchIntradayHRSaturdays(token, from, to) {
  const result = {};
  let cur = new Date(from + "T12:00:00");
  const end = new Date(to + "T12:00:00");

  while (cur <= end) {
    if (cur.getDay() === 6) {
      const date = isoDate(cur);
      process.stdout.write(`  ${date}...`);
      const data = await fitbit(token, `/1/user/-/activities/heart/date/${date}/1d/1min.json`);
      const dataset = data?.["activities-heart-intraday"]?.dataset ?? [];

      if (dataset.length > 0) {
        // 6:30 AM = 390 mins, 10:30 AM = 630 mins
        const morning = dataset.filter(pt => {
          const [h, m] = pt.time.split(":").map(Number);
          const totalMins = h * 60 + m;
          return totalMins >= 390 && totalMins <= 630;
        });

        const ZONE2_THRESHOLD = 120; // ~Zone 2+ (~120+ bpm)
        const GAP_TOLERANCE = 8;     // minutes of sub-threshold allowed within a sustained block

        let zone2PlusMinutes = 0;
        let maxSustainedBlock = 0;
        let currentBlock = 0;
        let gapCount = 0;
        let firstRiseTime = null;

        for (const pt of morning) {
          if (pt.value >= ZONE2_THRESHOLD) {
            zone2PlusMinutes++;
            currentBlock += 1 + gapCount;
            gapCount = 0;
            if (!firstRiseTime) firstRiseTime = pt.time;
            if (currentBlock > maxSustainedBlock) maxSustainedBlock = currentBlock;
          } else {
            gapCount++;
            if (gapCount > GAP_TOLERANCE) {
              currentBlock = 0;
              gapCount = 0;
            }
          }
        }

        result[date] = { zone2_plus_minutes: zone2PlusMinutes, sustained_block_minutes: maxSustainedBlock, first_rise_time: firstRiseTime };
        console.log(` Zone2+: ${zone2PlusMinutes}min, sustained: ${maxSustainedBlock}min${firstRiseTime ? `, first rise: ${firstRiseTime}` : ""}`);
      } else {
        console.log(` no HR data`);
      }
    }
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

// ── SUPABASE ──────────────────────────────────────────────
async function getLastFitbitDate() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/health_metrics?select=recorded_at&source=eq.fitbit&order=recorded_at.desc&limit=1`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.length) return null;

  const lastDate = new Date(data[0].recorded_at);
  lastDate.setDate(lastDate.getDate() - 1);
  return isoDate(lastDate);
}

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
    console.error(`❌ Supabase insert failed: ${err}`);
  }
}

// ── MAIN ──────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ Missing SUPABASE_SERVICE_ROLE_KEY. Run: export SUPABASE_SERVICE_ROLE_KEY=...");
    process.exit(1);
  }

  if (!fromDate) {
    console.log("📍 Checking Supabase for last Fitbit data...");
    const lastDate = await getLastFitbitDate();
    if (lastDate) {
      fromDate = lastDate;
      console.log(`   Found data up to ${lastDate}, continuing from there\n`);
    } else {
      fromDate = isoDate(defaultFrom);
      console.log(`   No prior data found, defaulting to last 2 days\n`);
    }
  }

  const tokens = await getValidTokens();
  const t = tokens.access_token;

  console.log(`Fetching Fitbit data from ${fromDate} → ${toDate}\n`);

  // Fetch all metrics in bulk
  console.log("Fetching steps...");         const steps        = await fetchActivitySeries(t, "steps",    fromDate, toDate);
  console.log("Fetching calories...");      const calories     = await fetchActivitySeries(t, "calories", fromDate, toDate);
  console.log("Fetching distance...");      const distance     = await fetchActivitySeries(t, "distance", fromDate, toDate);
  console.log("Fetching floors...");        const floors       = await fetchActivitySeries(t, "floors",   fromDate, toDate);
  console.log("Fetching active minutes..."); const activeMin   = await fetchActivitySeries(t, "minutesFairlyActive", fromDate, toDate);
  console.log("Fetching resting HR...");    const rhr          = await fetchRestingHeartRate(t, fromDate, toDate);
  console.log("Fetching HR zones...");      const hrZones      = await fetchHRZones(t, fromDate, toDate);
  console.log("Fetching sleep...");         const { hoursMap, scoreMap } = await fetchSleep(t, fromDate, toDate);
  console.log("Fetching weight...");        const weight       = await fetchWeight(t, fromDate, toDate);
  console.log("Fetching body fat...");      const bodyFat      = await fetchBodyFat(t, fromDate, toDate);
  console.log("Fetching SpO2...");          const spo2         = await fetchSpO2(t, fromDate, toDate);
  console.log("Fetching HRV...");           const hrv          = await fetchHRV(t, fromDate, toDate);
  console.log("Fetching breathing rate..."); const br          = await fetchBreathingRate(t, fromDate, toDate);
  console.log("Fetching VO2 Max...");       const vo2          = await fetchVO2Max(t, fromDate, toDate);

  // Optional: intraday HR for Saturdays (hike attendance window)
  let intradayHR = {};
  if (INTRADAY) {
    console.log("\nFetching Saturday intraday HR (6:30–10:30 AM hike window)...");
    intradayHR = await fetchIntradayHRSaturdays(t, fromDate, toDate);
    console.log(`  Analyzed ${Object.keys(intradayHR).length} Saturday(s)\n`);
  }

  // Collect all unique dates
  const allDates = new Set([
    ...Object.keys(steps), ...Object.keys(calories), ...Object.keys(distance),
    ...Object.keys(floors), ...Object.keys(activeMin), ...Object.keys(rhr),
    ...Object.keys(hoursMap), ...Object.keys(scoreMap), ...Object.keys(weight),
    ...Object.keys(bodyFat), ...Object.keys(spo2), ...Object.keys(hrv),
    ...Object.keys(br), ...Object.keys(vo2), ...Object.keys(hrZones),
  ]);

  console.log(`\nBuilding rows for ${allDates.size} days...\n`);

  const rows = [];
  for (const date of [...allDates].sort()) {
    const label = formatDate(date);
    const add = (metric_type, value, unit) => {
      if (value != null && !isNaN(value)) {
        rows.push({ recorded_at: `${date}T00:00:00`, source: "fitbit", metric_type, value, unit, subject: SUBJECT, metadata: { date_label: label }, notes: null });
      }
    };

    add("steps",               steps[date],     "steps");
    add("calories_burned",     calories[date],  "kcal");
    add("distance_km",         distance[date],  "km");
    add("floors",              floors[date],    "floors");
    add("active_minutes",      activeMin[date], "min");
    add("resting_heart_rate",  rhr[date],       "bpm");
    add("sleep_hours",         hoursMap[date],  "hours");
    add("sleep_score",         scoreMap[date],  "%" );
    add("weight",              weight[date],    "lbs");
    add("body_fat_pct",        bodyFat[date],   "%");
    add("spo2",                spo2[date],      "%");
    add("hrv",                 hrv[date],       "ms");
    add("respiratory_rate",    br[date],        "brpm");
    add("vo2max",              vo2[date],       "ml/kg/min");
    add("hr_zone_out_of_range", hrZones[date]?.out_of_range, "min");
    add("hr_zone_fat_burn",     hrZones[date]?.fat_burn,     "min");
    add("hr_zone_cardio",       hrZones[date]?.cardio,       "min");
    add("hr_zone_peak",         hrZones[date]?.peak,         "min");

    // Intraday HR morning signal (Saturdays only, if --intraday was passed)
    if (intradayHR[date]) {
      const hr = intradayHR[date];
      rows.push({
        recorded_at: `${date}T06:30:00`,
        source: "fitbit",
        metric_type: "morning_hr_zone_minutes",
        value: hr.zone2_plus_minutes,
        unit: "min",
        subject: SUBJECT,
        metadata: {
          date_label: label,
          sustained_block_minutes: hr.sustained_block_minutes,
          first_rise_time: hr.first_rise_time,
          window: "06:30-10:30",
          zone2_threshold_bpm: 120,
        },
        notes: null,
      });
    }
  }

  // Insert in batches of 500
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await upsertBatch(batch);
    console.log(`✅ Inserted rows ${i + 1}–${Math.min(i + BATCH, rows.length)} of ${rows.length}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
