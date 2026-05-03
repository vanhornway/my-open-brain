#!/usr/bin/env node
/**
 * Strava → hiking_history sync
 *
 * Does two things:
 * 1. Confirms Umair's attendance by matching his Strava activities to hike dates
 * 2. Pulls BAD Hikers club activities to record who attended each hike
 *
 * Usage:
 *   node strava-sync.js                    # sync all hikes
 *   node strava-sync.js --dry              # preview without writing to DB
 *   node strava-sync.js --date 2026-03-28  # sync only a specific date (much faster, avoids rate limits)
 *   node strava-sync.js --date 2026-03-28 --dry
 */

import fs from "fs";
import path from "path";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import { exec } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CLIENT_ID = "128149";
const CLIENT_SECRET = "ae591e079b67ccdc9e7c6899cae89d35f464b357";
const REDIRECT_URI = "https://umair.us/strava/callback";
const TOKENS_FILE = path.join(__dirname, "strava-tokens.json");
const CLUB_ID = "1277764";

const SUPABASE_URL = "https://epckjiufeimydxmcrfus.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DRY_RUN = process.argv.includes("--dry");

// --date YYYY-MM-DD  →  only process that single date
const DATE_ARG = (() => {
  const idx = process.argv.indexOf("--date");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

// ── HELPERS ───────────────────────────────────────────────
function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); });
  });
}

function openBrowser(url) {
  exec(`open "${url}"`);
}

// ── STRAVA AUTH ───────────────────────────────────────────
function loadTokens() {
  if (fs.existsSync(TOKENS_FILE)) return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
  return null;
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

async function exchangeCode(code) {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  const data = await res.json();
  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at * 1000,
    athlete: { id: data.athlete.id, name: `${data.athlete.firstname} ${data.athlete.lastname}` },
  };
  saveTokens(tokens);
  return tokens;
}

async function refreshTokens(tokens) {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = await res.json();
  const newTokens = {
    ...tokens,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at * 1000,
  };
  saveTokens(newTokens);
  return newTokens;
}

async function getValidTokens() {
  let tokens = loadTokens();

  if (!tokens) {
    const authUrl = `https://www.strava.com/oauth/authorize?` + new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      approval_prompt: "auto",
      scope: "read,activity:read_all,profile:read_all",
    });

    console.log("\n🔐 Opening Strava authorization in your browser...");
    openBrowser(authUrl);
    console.log("\nAfter approving, copy the full redirect URL from the browser bar.\n");
    const redirected = await prompt("Paste the redirect URL here: ");
    const code = new URL(redirected).searchParams.get("code");
    if (!code) throw new Error("No code found in URL");
    tokens = await exchangeCode(code);
    console.log(`✅ Authorized as ${tokens.athlete.name}\n`);
  } else if (Date.now() > tokens.expires_at - 60_000) {
    console.log("Refreshing Strava tokens...");
    tokens = await refreshTokens(tokens);
  }

  return tokens;
}

// ── STRAVA API ────────────────────────────────────────────
async function stravaGet(accessToken, path) {
  const res = await fetch(`https://www.strava.com/api/v3${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("X-RateLimit-Limit") ?? "60") + 5;
    console.warn(`  Rate limited — waiting ${retryAfter}s...`);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return stravaGet(accessToken, path);
  }

  if (!res.ok) {
    console.warn(`  ⚠️  ${path} → ${res.status}`);
    return null;
  }
  return res.json();
}

// Fetch athlete activities — if a date is provided, only fetch a ±1 day window
async function fetchAllMyActivities(accessToken, targetDate = null) {
  const activities = [];
  let page = 1;

  let afterEpoch = null;
  let beforeEpoch = null;
  if (targetDate) {
    // window: midnight the day before → midnight the day after
    const d = new Date(targetDate + "T00:00:00Z");
    afterEpoch = Math.floor((d.getTime() - 86400000) / 1000);  // -1 day
    beforeEpoch = Math.floor((d.getTime() + 2 * 86400000) / 1000); // +2 days
  }

  while (true) {
    let url = `/athlete/activities?per_page=200&page=${page}`;
    if (afterEpoch)  url += `&after=${afterEpoch}`;
    if (beforeEpoch) url += `&before=${beforeEpoch}`;
    const page_data = await stravaGet(accessToken, url);
    if (!page_data || page_data.length === 0) break;
    activities.push(...page_data);
    if (page_data.length < 200) break;
    page++;
  }
  return activities;
}

async function fetchKudos(accessToken, activityId) {
  const data = await stravaGet(accessToken, `/activities/${activityId}/kudos?per_page=200`);
  return (data ?? []).map((a) => `${a.firstname} ${a.lastname}`.trim());
}

async function fetchPhotos(accessToken, activityId) {
  const data = await stravaGet(accessToken, `/activities/${activityId}/photos?size=600&photo_sources=true`);
  return data ?? [];
}

async function fetchActivityDetail(accessToken, activityId) {
  return await stravaGet(accessToken, `/activities/${activityId}`);
}

// ── SUPABASE ──────────────────────────────────────────────
async function getLastHikeDate() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/hiking_history?select=hike_date&order=hike_date.desc&limit=1`,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.length) return null;
  return data[0].hike_date;
}

async function fetchHikes(targetDate = null) {
  let url = `${SUPABASE_URL}/rest/v1/hiking_history?select=id,hike_date,hike_code,trail_name,attended&order=hike_date.asc&limit=500`;
  if (targetDate) url += `&hike_date=eq.${targetDate}`;
  const res = await fetch(url,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function updateHike(id, data) {
  if (DRY_RUN) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/hiking_history?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Patch failed: ${await res.text()}`);
}

async function upsertPersonalHike(row) {
  if (DRY_RUN || !row) return;

  // Try UPDATE first (for existing strava_activity_id)
  const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/personal_hikes?strava_activity_id=eq.${row.strava_activity_id}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });

  if (!updateRes.ok) throw new Error(`Personal hike update failed: ${await updateRes.text()}`);

  // Check if any rows were updated via content-range header
  // Format: "0-0/1" means 1 row updated, "*/0" means 0 rows updated
  const contentRange = updateRes.headers.get('content-range');
  const matchedCount = contentRange ? parseInt(contentRange.split('/')[1]) : 0;

  if (matchedCount === 0) {
    // No existing record found, INSERT new one
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/personal_hikes`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
    if (!insertRes.ok) throw new Error(`Personal hike insert failed: ${await insertRes.text()}`);
  }
}

async function insertPhotos(rows) {
  if (DRY_RUN || !rows.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/hike_photos`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Photo insert failed: ${await res.text()}`);
}

// ── HR FALLBACK SIGNALS (when no Strava match) ────────────
// Priority: WHOOP day data → Fitbit intraday HR

// Fetch all WHOOP metrics for a given date in one call
async function fetchWhoopDaySignal(date) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/health_metrics?select=metric_type,value&source=eq.whoop&recorded_at=eq.${date}T00:00:00`,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  if (!rows.length) return null;

  const metrics = Object.fromEntries(rows.map((r) => [r.metric_type, r.value]));

  const strain        = metrics["strain"] ?? null;
  const calories      = metrics["calories_active"] ?? null;
  const zone3         = metrics["hr_zone_3"] ?? 0;
  const zone4         = metrics["hr_zone_4"] ?? 0;
  const zone5         = metrics["hr_zone_5"] ?? 0;
  const aerobicPct    = zone3 + zone4 + zone5;

  // Hike-like signal: meaningful day strain AND aerobic HR time OR high calories
  const strainSignal   = strain != null && strain >= 12;
  const aerobicSignal  = aerobicPct >= 25;
  const calorieSignal  = calories != null && calories >= 600;

  if (strainSignal && (aerobicSignal || calorieSignal)) {
    return {
      source: "whoop",
      strain,
      aerobic_pct: aerobicPct,
      calories,
      confident: strainSignal && aerobicSignal, // both signals = higher confidence
    };
  }
  return null;
}

// Fitbit intraday HR fallback (requires sync.js --intraday to have been run)
async function fetchFitbitMorningHRSignal(date) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/health_metrics?select=value,metadata&metric_type=eq.morning_hr_zone_minutes&source=eq.fitbit&recorded_at=eq.${date}T06:30:00`,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  if (!rows.length) return null;

  const zone2Min      = rows[0].value;
  const sustainedBlock = rows[0].metadata?.sustained_block_minutes ?? 0;

  if (zone2Min >= 75 && sustainedBlock >= 45) {
    return { source: "fitbit", zone2_plus_minutes: zone2Min, sustained_block_minutes: sustainedBlock };
  }
  return null;
}

// ── MATCHING ──────────────────────────────────────────────
// Activity types that count as hiking
const HIKE_TYPES = new Set(["Hike", "Walk", "TrailRun", "Run"]);

function activityDate(activity) {
  return activity.start_date_local?.split("T")[0] ?? activity.start_date?.split("T")[0];
}

// ── MAIN ──────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ Missing SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  if (DRY_RUN) console.log("🔍 DRY RUN — no changes will be written\n");

  let dateToFetch = DATE_ARG;
  if (!dateToFetch) {
    console.log("📍 Checking Supabase for last hike date...");
    const lastDate = await getLastHikeDate();
    if (lastDate) {
      dateToFetch = lastDate;
      console.log(`   Found hikes up to ${lastDate}, checking from there\n`);
    } else {
      const today = new Date();
      const twoDaysAgo = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);
      dateToFetch = twoDaysAgo.toISOString().split('T')[0];
      console.log(`   No prior hikes found, defaulting to last 2 days (from ${dateToFetch})\n`);
    }
  } else {
    console.log(`📅 Date filter: ${DATE_ARG}\n`);
  }

  const tokens = await getValidTokens();

  console.log("Fetching your Strava activities...");
  const myActivities = await fetchAllMyActivities(tokens.access_token, dateToFetch);
  console.log(`  Found ${myActivities.length} activities\n`);

  // Build date → my activities map
  const myByDate = {};
  for (const act of myActivities) {
    const date = activityDate(act);
    if (!myByDate[date]) myByDate[date] = [];
    myByDate[date].push(act);
  }

  console.log("Fetching hikes from Supabase...");
  const hikes = await fetchHikes(dateToFetch);
  console.log(`  Found ${hikes.length} hikes\n`);

  let confirmedByStrava = 0;
  let confirmedByHRZone = 0;
  let lowHRSkipped = 0;
  let withKudos = 0;
  let totalPhotos = 0;
  let personalHikesRecorded = 0;

  // Track which Strava activity IDs get matched to group hikes
  const matchedActivityIds = new Set();

  for (const hike of hikes) {
    const date = hike.hike_date;
    const myDayActivities = myByDate[date] ?? [];
    const hikeActivity = myDayActivities.find((a) => HIKE_TYPES.has(a.type));
    const updates = {};

    if (hikeActivity) {
      matchedActivityIds.add(hikeActivity.id);

      // Fetch kudos, photos and detail in parallel
      const [kudoers, photos, detail] = await Promise.all([
        fetchKudos(tokens.access_token, hikeActivity.id),
        fetchPhotos(tokens.access_token, hikeActivity.id),
        fetchActivityDetail(tokens.access_token, hikeActivity.id),
      ]);

      const hrAvg = detail?.average_heartrate ? Math.round(detail.average_heartrate) : null;
      const hrMax = detail?.max_heartrate ? Math.round(detail.max_heartrate) : null;
      const hrConfirmed = hrAvg != null && hrAvg > 110;

      // Attendance: HR > 110 bpm required — kudos alone is not sufficient
      // (kudos can come from friends on unrelated activities or false date matches)
      if (hrConfirmed) {
        if (hike.attended !== true) {
          updates.attended = true;
          confirmedByStrava++;
        }
        const kudoStr = kudoers.length ? ` | 👍 ${kudoers.slice(0, 3).join(", ")}${kudoers.length > 3 ? "..." : ""}` : "";
        const groupStr = hikeActivity?.athlete_count > 1 ? ` | 👥 ${hikeActivity.athlete_count} people` : "";
        const photoStr = photos.length ? ` | 📷 ${photos.length} photos` : "";
        console.log(`✅ ${date} ${hike.trail_name} (HR ${hrAvg}/${hrMax})${groupStr}${kudoStr}${photoStr}`);
      } else {
        console.log(`  ⚠️  ${date} ${hike.trail_name} — Strava match but HR ${hrAvg ?? "missing"} bpm (threshold >110), not auto-marking`);
        lowHRSkipped++;
      }

      // Always store HR data if present
      if (hrAvg) {
        updates.hr_avg = hrAvg;
        updates.hr_max = hrMax;
      }

      // HR zones
      if (detail?.zones?.heart_rate?.zones?.length) {
        updates.hr_zones = detail.zones.heart_rate.zones.map((z) => ({
          name: z.name ?? z.custom_zones ? "Custom" : `Zone ${z.index + 1}`,
          min: z.min,
          max: z.max,
          seconds: z.time,
          minutes: Math.round(z.time / 60),
        }));
      }

      // Kudos
      if (kudoers.length > 0) {
        updates.kudoers = kudoers.sort();
        updates.kudos_count = kudoers.length;
        updates.athlete_count = hikeActivity.athlete_count ?? null;
        withKudos++;
      }

      // Photos
      if (photos.length > 0) {
        const photoRows = photos.map((p) => ({
          hike_id: hike.id,
          hike_date: hike.hike_date,
          hike_code: hike.hike_code,
          strava_activity_id: hikeActivity.id,
          photo_id: p.unique_id ?? p.id ?? null,
          url_thumbnail: p.urls?.["100"] ?? null,
          url_medium: p.urls?.["600"] ?? null,
          url_large: p.urls?.["original"] ?? p.urls?.["5000"] ?? null,
          caption: p.caption ?? null,
          location: p.location ? { lat: p.location[0], lng: p.location[1] } : null,
          taken_at: p.created_at ?? null,
        }));
        await insertPhotos(photoRows);
        updates.photo_count = photos.length;
        totalPhotos += photos.length;
      }

      await new Promise((r) => setTimeout(r, 300));

    } else if (hike.attended == null) {
      // No Strava match — check health signal as fallback (Tier 2)
      // Priority: WHOOP day data first, then Fitbit intraday HR

      const whoopSignal = await fetchWhoopDaySignal(date);

      if (whoopSignal) {
        updates.attended = true;
        confirmedByHRZone++;
        console.log(`📈 ${date} ${hike.trail_name} — WHOOP: strain ${whoopSignal.strain}, aerobic ${whoopSignal.aerobic_pct.toFixed(0)}%, calories ${whoopSignal.calories ?? "N/A"} (no Strava)`);
      } else {
        // Fall back to Fitbit intraday HR (requires sync.js --intraday)
        const fitbitSignal = await fetchFitbitMorningHRSignal(date);
        if (fitbitSignal) {
          updates.attended = true;
          confirmedByHRZone++;
          console.log(`📈 ${date} ${hike.trail_name} — Fitbit HR: ${fitbitSignal.zone2_plus_minutes}min Zone2+, ${fitbitSignal.sustained_block_minutes}min sustained (no Strava)`);
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await updateHike(hike.id, updates);
    }
  }

  // ── PERSONAL HIKES ────────────────────────────────────────
  // Any hiking/walking activity not matched to a group hike = personal
  console.log("\nProcessing personal hikes/walks...");
  const personalActivities = myActivities.filter(
    (a) => HIKE_TYPES.has(a.type) && !matchedActivityIds.has(a.id)
  );
  console.log(`  Found ${personalActivities.length} unmatched hiking activities\n`);

  for (const act of personalActivities) {
    const date = activityDate(act);
    const [kudoers, detail] = await Promise.all([
      fetchKudos(tokens.access_token, act.id),
      fetchActivityDetail(tokens.access_token, act.id),
    ]);

    const hrAvg = detail?.average_heartrate ? Math.round(detail.average_heartrate) : null;
    const hrMax = detail?.max_heartrate ? Math.round(detail.max_heartrate) : null;
    const distKm = act.distance ? +(act.distance / 1000).toFixed(2) : null;
    const elevM = act.total_elevation_gain ?? null;
    const durationMin = act.elapsed_time ? Math.round(act.elapsed_time / 60) : null;
    const startTime = act.start_date_local ?? null;

    let hrZones = null;
    if (detail?.zones?.heart_rate?.zones?.length) {
      hrZones = detail.zones.heart_rate.zones.map((z) => ({
        name: z.name ?? `Zone ${z.index + 1}`,
        min: z.min,
        max: z.max,
        seconds: z.time,
        minutes: Math.round(z.time / 60),
      }));
    }

    await upsertPersonalHike({
      activity_date: date,
      activity_name: act.name,
      activity_type: act.type,
      start_time: startTime,
      distance_km: distKm,
      elevation_m: elevM,
      duration_minutes: durationMin,
      hr_avg: hrAvg,
      hr_max: hrMax,
      hr_zones: hrZones,
      kudos_count: kudoers.length || null,
      kudoers: kudoers.length ? kudoers.sort() : null,
      strava_activity_id: act.id,
    });

    console.log(`🥾 ${date} ${act.name} (${act.type}) | ${distKm ?? "?"}km | HR ${hrAvg ?? "N/A"}/${hrMax ?? "N/A"}`);
    personalHikesRecorded++;
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\nDone.`);
  console.log(`  ✅ Confirmed via Strava (HR > 110 bpm)      : ${confirmedByStrava}`);
  console.log(`  📈 Confirmed via WHOOP/Fitbit HR fallback   : ${confirmedByHRZone}`);
  console.log(`  ⚠️  Strava match skipped (HR too low)        : ${lowHRSkipped}`);
  console.log(`  👍 Hikes with kudos data                    : ${withKudos}`);
  console.log(`  📷 Total photos pulled                      : ${totalPhotos}`);

  if (DRY_RUN) console.log("\n  (DRY RUN — nothing was written)");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
