#!/usr/bin/env node
/**
 * Ingest LibreView Libre3 CGM glucose data into Supabase health_metrics.
 * Uses the LibreLink Up API (same backend as the LLU mobile app).
 *
 * First run: authenticates and stores token in libre3-tokens.json
 * Subsequent runs: uses cached token, re-authenticates if expired
 *
 * Usage:
 *   LIBRE3_EMAIL=x LIBRE3_PASSWORD=y node ingest-libre3.js
 *   node ingest-libre3.js --from 2025-06-01   (only upsert readings on/after this date)
 *   node ingest-libre3.js --dry-run           (print rows, don't insert)
 *
 * Fetches up to 14 days of readings from the current/last sensor via the graph
 * endpoint, plus older readings via the logbook endpoint.
 *
 * For data older than ~14 days, export a CSV from LibreView.com and use
 * ingest-libre3-csv.js (TODO).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CONFIG ────────────────────────────────────────────────
const SUPABASE_URL = "https://epckjiufeimydxmcrfus.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUBJECT = "Umair";

const TOKENS_FILE = path.join(__dirname, "libre3-tokens.json");

// LibreLink Up API — base URL (will redirect to regional endpoint on first login)
const LLU_BASE = "https://api.libreview.io";

// Required headers for LLU API (mimics the Android app)
const LLU_HEADERS = {
  "Content-Type": "application/json",
  product: "llu.android",
  version: "4.16.0",
  "Accept-Encoding": "gzip",
  "cache-control": "no-cache",
};

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const fromIdx = args.indexOf("--from");
const FROM_DATE = fromIdx !== -1 ? new Date(args[fromIdx + 1]) : null;

// Trend arrow codes → human-readable
const TREND_LABELS = {
  1: "rapidly_falling",
  2: "falling",
  3: "stable",
  4: "rising",
  5: "rapidly_rising",
};

// ── TOKEN MANAGEMENT ─────────────────────────────────────
function loadTokens() {
  if (fs.existsSync(TOKENS_FILE)) {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
  }
  return null;
}

function saveTokens(data) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2));
}

function lluHeaders(token, accountId) {
  return {
    ...LLU_HEADERS,
    Authorization: `Bearer ${token}`,
    ...(accountId ? { "account-id": accountId } : {}),
  };
}

function isTokenExpired(tokens) {
  if (!tokens?.expires) return true;
  // Refresh 5 minutes before expiry
  return Date.now() >= tokens.expires - 5 * 60 * 1000;
}

// ── LLU API HELPERS ───────────────────────────────────────
async function lluPost(url, body, extraHeaders = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { ...LLU_HEADERS, ...extraHeaders },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function lluGet(url, token, accountId) {
  const res = await fetch(url, {
    method: "GET",
    headers: lluHeaders(token, accountId),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLU GET ${url} → ${res.status}: ${text}`);
  }
  return res.json();
}

// ── AUTHENTICATION ────────────────────────────────────────
async function authenticate(email, password) {
  console.log("🔑 Authenticating with LibreView...");

  const { status, data } = await lluPost(`${LLU_BASE}/llu/auth/login`, {
    email,
    password,
  });

  if (status !== 200 || data.status !== 0) {
    throw new Error(
      `Auth failed: ${JSON.stringify(data.error || data.message || data)}`
    );
  }

  // Handle region redirect (API returns redirect:true with a region code)
  if (data.data?.redirect === true) {
    const region = data.data.region;
    const regionalBase = `https://api-${region}.libreview.io`;
    console.log(`  ↳ Redirecting to region: ${region} (${regionalBase})`);

    const { status: s2, data: d2 } = await lluPost(
      `${regionalBase}/llu/auth/login`,
      { email, password }
    );

    if (s2 !== 200 || d2.status !== 0) {
      throw new Error(`Regional auth failed: ${JSON.stringify(d2.error || d2)}`);
    }

    return { base: regionalBase, authTicket: d2.data.authTicket, accountId: d2.data.user?.id };
  }

  return { base: LLU_BASE, authTicket: data.data.authTicket, accountId: data.data.user?.id };
}

async function getValidToken() {
  const email = process.env.LIBRE3_EMAIL;
  const password = process.env.LIBRE3_PASSWORD;

  let tokens = loadTokens();

  if (tokens && !isTokenExpired(tokens)) {
    return tokens;
  }

  if (!email || !password) {
    throw new Error(
      "Token expired or missing. Set LIBRE3_EMAIL and LIBRE3_PASSWORD env vars."
    );
  }

  const { base, authTicket, accountId } = await authenticate(email, password);
  tokens = {
    base,
    token: authTicket.token,
    accountId,
    // expires is a unix timestamp in seconds from LLU
    expires: authTicket.expires
      ? authTicket.expires * 1000
      : Date.now() + authTicket.duration * 1000,
  };

  saveTokens(tokens);
  console.log("  ✅ Token saved to libre3-tokens.json");
  return tokens;
}

// ── FETCH CONNECTIONS ─────────────────────────────────────
async function getConnections(tokens) {
  const res = await lluGet(`${tokens.base}/llu/connections`, tokens.token, tokens.accountId);
  if (!res.data?.length) {
    throw new Error("No LibreLink Up connections found on this account.");
  }
  return res.data;
}

// ── FETCH GLUCOSE READINGS ────────────────────────────────
async function fetchGraph(tokens, patientId) {
  // Returns ~14 days of 1-minute readings from the current sensor
  const res = await lluGet(
    `${tokens.base}/llu/connections/${patientId}/graph`,
    tokens.token, tokens.accountId
  );
  return res.data?.graphData ?? [];
}

async function fetchLogbook(tokens, patientId) {
  // Returns older readings from previous sensor periods
  try {
    const res = await lluGet(
      `${tokens.base}/llu/connections/${patientId}/logbook`,
      tokens.token, tokens.accountId
    );
    return res.data ?? [];
  } catch (err) {
    console.warn(`  ⚠️  Logbook fetch failed (${err.message}) — skipping`);
    return [];
  }
}

// ── PARSE READINGS ────────────────────────────────────────
function parseTimestamp(ts) {
  // LLU timestamps come in various formats:
  // "1/15/2025 10:30:00 AM"  → need ISO
  // "2025-01-15T10:30:00"    → already ISO
  if (!ts) return null;

  if (ts.includes("T")) {
    // Already ISO-ish
    return new Date(ts).toISOString();
  }

  // MM/DD/YYYY HH:MM:SS AM/PM
  const m = ts.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i
  );
  if (!m) return null;

  let [, mo, dy, yr, hr, min, sec, ampm] = m;
  hr = parseInt(hr);
  if (ampm) {
    if (ampm.toUpperCase() === "PM" && hr < 12) hr += 12;
    if (ampm.toUpperCase() === "AM" && hr === 12) hr = 0;
  }

  return new Date(
    `${yr}-${mo.padStart(2, "0")}-${dy.padStart(2, "0")}T${String(hr).padStart(2, "0")}:${min}:${sec}`
  ).toISOString();
}

function readingsToRows(readings) {
  const rows = [];

  for (const r of readings) {
    const recorded_at = parseTimestamp(r.Timestamp || r.FactoryTimestamp);
    if (!recorded_at) continue;

    const value = r.ValueInMgPerDl ?? r.Value;
    if (value == null || isNaN(value)) continue;

    // Apply --from filter
    if (FROM_DATE && new Date(recorded_at) < FROM_DATE) continue;

    rows.push({
      recorded_at,
      source: "libre3",
      metric_type: "glucose",
      value: Math.round(value),
      unit: "mg/dL",
      subject: SUBJECT,
      metadata: {
        trend: TREND_LABELS[r.TrendArrow] ?? null,
        trend_arrow: r.TrendArrow ?? null,
        is_high: r.isHigh ?? false,
        is_low: r.isLow ?? false,
        measurement_color: r.MeasurementColor ?? null,
      },
      notes: null,
    });
  }

  return rows;
}

// ── SUPABASE UPSERT ───────────────────────────────────────
async function upsertBatch(rows) {
  if (!rows.length) return 0;

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
    console.error(`❌ Supabase insert failed: ${err}`);
    return 0;
  }

  return rows.length;
}

// ── MAIN ──────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_KEY) {
    console.error("❌ Missing SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const tokens = await getValidToken();

  // Get patient ID from connections (first connection = self for personal accounts)
  const connections = await getConnections(tokens);
  const patientId = connections[0].patientId;
  const sensorSerial = connections[0].sensor?.sn ?? "unknown";
  console.log(`📡 Patient: ${connections[0].firstName ?? patientId} | Sensor: ${sensorSerial}`);

  // Fetch readings from both graph (recent) and logbook (older)
  console.log("📥 Fetching graph data (last ~14 days)...");
  const graphReadings = await fetchGraph(tokens, patientId);
  console.log(`  → ${graphReadings.length} readings`);

  console.log("📥 Fetching logbook data (older readings)...");
  const logbookReadings = await fetchLogbook(tokens, patientId);
  console.log(`  → ${logbookReadings.length} readings`);

  // Deduplicate by timestamp
  const seen = new Set();
  const allReadings = [...graphReadings, ...logbookReadings].filter((r) => {
    const ts = r.Timestamp || r.FactoryTimestamp;
    if (seen.has(ts)) return false;
    seen.add(ts);
    return true;
  });

  const rows = readingsToRows(allReadings);

  if (!rows.length) {
    console.log("\nNo glucose readings to insert (after date filter).");
    return;
  }

  // Date range summary
  const dates = rows.map((r) => r.recorded_at).sort();
  console.log(`\n📊 ${rows.length} readings | ${dates[0].split("T")[0]} → ${dates.at(-1).split("T")[0]}`);

  // Stats
  const values = rows.map((r) => r.value);
  const avg = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(0);
  const inRange = values.filter((v) => v >= 70 && v <= 180).length;
  const tir = ((inRange / values.length) * 100).toFixed(1);
  console.log(`   avg: ${avg} mg/dL | time-in-range (70–180): ${tir}%`);
  console.log(`   low (<70): ${values.filter((v) => v < 70).length} | high (>180): ${values.filter((v) => v > 180).length}`);

  if (DRY_RUN) {
    console.log("\n[dry-run] First 3 rows:");
    rows.slice(0, 3).forEach((r) => console.log(" ", JSON.stringify(r)));
    return;
  }

  // Upsert in batches of 500
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
