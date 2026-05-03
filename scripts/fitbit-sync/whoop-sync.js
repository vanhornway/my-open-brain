#!/usr/bin/env node
/**
 * Whoop → Supabase daily health metrics sync
 * Fetches physiological cycles, sleeps, and workouts from Whoop API
 *
 * Usage:
 *   node whoop-sync.js                 # fetch last 7 days
 *   node whoop-sync.js --from 2026-01-01
 *   node whoop-sync.js --from 2026-01-01 --to 2026-12-31
 *   node whoop-sync.js --dry           # preview without writing
 */

import fs from "fs";
import path from "path";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import { exec } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CONFIG ────────────────────────────────────────────────
const CLIENT_ID = "748a9680-8e24-425f-a1f0-db40eef194d5";
const CLIENT_SECRET = "6c9f9b958d9582dc141a3e3b205a55b54e38725ee57a729ab9dcc9d6f816cd85";
const REDIRECT_URI = "http://localhost:3000/callback";
const TOKENS_FILE = path.join(__dirname, "whoop-tokens.json");

const SUPABASE_URL = "https://epckjiufeimydxmcrfus.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUBJECT = "Umair";

// ── ARG PARSING ───────────────────────────────────────────
const args = process.argv.slice(2);
const fromIdx = args.indexOf("--from");
const toIdx = args.indexOf("--to");
const DRY_RUN = args.includes("--dry");

const today = new Date();
const sevenDaysAgo = new Date(today);
sevenDaysAgo.setDate(today.getDate() - 7);

function isoDate(d) {
  return d.toISOString().split("T")[0];
}

const fromDate = fromIdx !== -1 ? args[fromIdx + 1] : isoDate(sevenDaysAgo);
const toDate = toIdx !== -1 ? args[toIdx + 1] : isoDate(today);

// ── HELPERS ───────────────────────────────────────────────
function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); });
  });
}

function openBrowser(url) {
  // Try macOS first, then Linux, then just print the URL
  if (process.platform === "darwin") {
    exec(`open "${url}"`);
  } else if (process.platform === "linux") {
    exec(`xdg-open "${url}"`, (err) => {
      if (err) console.log(`\n📋 Copy this URL into your browser:\n${url}\n`);
    });
  } else {
    console.log(`\n📋 Copy this URL into your browser:\n${url}\n`);
  }
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
  const res = await fetch("https://api.prod.whoop.com/oauth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  const data = await res.json();
  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

async function refreshTokens(tokens) {
  const res = await fetch("https://api.prod.whoop.com/oauth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = await res.json();
  const newTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  saveTokens(newTokens);
  return newTokens;
}

async function getValidTokens() {
  let tokens = loadTokens();

  if (!tokens) {
    // Generate random state for OAuth security (must be 8+ chars)
    const state = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    const authUrl = `https://api.prod.whoop.com/oauth/oauth2/auth?` + new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "read:cycles read:sleep read:workout offline",
      state: state,
    });

    console.log("\n🔐 Opening Whoop authorization in your browser...");
    openBrowser(authUrl);
    console.log("\nAfter approving, copy the full redirect URL from the browser bar.\n");
    const redirected = await prompt("Paste the redirect URL here: ");
    const code = new URL(redirected).searchParams.get("code");
    if (!code) throw new Error("No code found in URL");
    tokens = await exchangeCode(code);
    console.log(`✅ Authorized\n`);
  } else if (Date.now() > tokens.expires_at - 60_000) {
    console.log("Refreshing Whoop tokens...");
    tokens = await refreshTokens(tokens);
  }

  return tokens;
}

// ── WHOOP API ─────────────────────────────────────────────
async function whoopGet(accessToken, path) {
  const res = await fetch(`https://api.prod.whoop.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("X-RateLimit-Reset") ?? "60");
    console.warn(`  Rate limited — waiting ${retryAfter}s...`);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return whoopGet(accessToken, path);
  }

  if (!res.ok) {
    const errText = await res.text();
    console.warn(`  ⚠️  ${path} → ${res.status}`);
    if (errText) console.warn(`     Error: ${errText.substring(0, 200)}`);
    return null;
  }
  return res.json();
}

// ── SUPABASE ──────────────────────────────────────────────
async function upsertHealthMetrics(rows) {
  if (DRY_RUN || !rows.length) return;

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
  if (!res.ok) throw new Error(`Insert failed: ${await res.text()}`);
}

// ── PARSING ───────────────────────────────────────────────
function parseDate(isoString) {
  return isoString.split("T")[0];
}

function parseCycles(cycles) {
  const rows = [];
  for (const cycle of cycles) {
    const date = parseDate(cycle.start);
    if (!date) continue;

    const add = (type, val, unit) => {
      if (val !== null && val !== undefined && !isNaN(val)) {
        rows.push({
          recorded_at: `${date}T00:00:00`,
          source: "whoop",
          metric_type: type,
          value: val,
          unit,
          subject: SUBJECT,
          metadata: { cycle_id: cycle.id },
        });
      }
    };

    add("recovery_score", cycle.score?.recovery, "%");
    add("resting_heart_rate", cycle.score?.resting_heart_rate, "bpm");
    add("hrv", cycle.score?.heart_rate_variability, "ms");
    add("spo2", cycle.score?.spo2, "%");
    add("skin_temperature", cycle.score?.skin_temperature, "°C");
    add("strain", cycle.score?.strain, "score");
    add("calories_active", cycle.score?.kilojoule, "kJ");
    add("respiratory_rate", cycle.score?.respiratory_rate, "brpm");
  }
  return rows;
}

function parseSleeps(sleeps) {
  const rows = [];
  for (const sleep of sleeps) {
    const date = parseDate(sleep.start);
    if (!date) continue;

    const add = (type, val, unit) => {
      if (val !== null && val !== undefined && !isNaN(val)) {
        rows.push({
          recorded_at: `${date}T00:00:00`,
          source: "whoop",
          metric_type: type,
          value: val,
          unit,
          subject: SUBJECT,
          metadata: { sleep_id: sleep.id },
        });
      }
    };

    const duration = sleep.score ? (sleep.score.sleep_duration_ms ?? 0) / 3600000 : 0;
    add("sleep_hours", duration, "hours");
    add("sleep_score", sleep.score?.sleep_score, "%");
    add("sleep_efficiency", sleep.score?.sleep_efficiency, "%");
  }
  return rows;
}

function parseWorkouts(workouts) {
  const rows = [];
  for (const workout of workouts) {
    const date = parseDate(workout.start);
    if (!date) continue;

    const add = (type, val, unit) => {
      if (val !== null && val !== undefined && !isNaN(val)) {
        rows.push({
          recorded_at: `${date}T00:00:00`,
          source: "whoop",
          metric_type: type,
          value: val,
          unit,
          subject: SUBJECT,
          metadata: { workout_id: workout.id, sport_id: workout.sport_id },
        });
      }
    };

    // Store workout data with names that match allowed metric_type constraint
    add("strain", workout.score?.strain, "score");
    add("calories_active", workout.score?.kilojoule, "kJ");
    // Note: avg/max heart rate from workouts not added as they may conflict with daily metrics
  }
  return rows;
}

// ── MAIN ──────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ Missing SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  if (DRY_RUN) console.log("🔍 DRY RUN — no changes will be written\n");

  console.log(`📅 Fetching Whoop data from ${fromDate} → ${toDate}\n`);

  const tokens = await getValidTokens();

  console.log("Fetching physiological cycles...");
  const cycles = await whoopGet(tokens.access_token, `/developer/v2/cycle?start=${fromDate}T00:00:00Z&end=${toDate}T23:59:59Z&limit=25`);
  console.log(`  Found ${cycles?.records?.length ?? 0} cycles\n`);

  console.log("Fetching sleep data...");
  const sleeps = await whoopGet(tokens.access_token, `/developer/v2/activity/sleep?start=${fromDate}T00:00:00Z&end=${toDate}T23:59:59Z&limit=25`);
  console.log(`  Found ${sleeps?.records?.length ?? 0} sleeps\n`);

  console.log("Fetching workouts...");
  const workouts = await whoopGet(tokens.access_token, `/developer/v2/activity/workout?start=${fromDate}T00:00:00Z&end=${toDate}T23:59:59Z&limit=25`);
  console.log(`  Found ${workouts?.records?.length ?? 0} workouts\n`);

  // Parse all data
  const rows = [];
  if (cycles?.records) rows.push(...parseCycles(cycles.records));
  if (sleeps?.records) rows.push(...parseSleeps(sleeps.records));
  if (workouts?.records) rows.push(...parseWorkouts(workouts.records));

  console.log(`Building ${rows.length} metric rows...`);
  await upsertHealthMetrics(rows);

  if (!DRY_RUN) {
    console.log(`✅ Inserted ${rows.length} health metrics\n`);
  } else {
    console.log(`\n  (DRY RUN — nothing was written)`);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
