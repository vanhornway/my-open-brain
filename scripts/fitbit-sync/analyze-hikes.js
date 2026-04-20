#!/usr/bin/env node
/**
 * Cross-references hiking history with Fitbit step data to determine
 * which hikes Umair actually participated in.
 *
 * Logic:
 * - Fetch all hike dates + step counts for those days
 * - Calculate a rolling personal baseline (median steps on non-hike days)
 * - Flag hike days where steps are significantly above baseline (≥1.5x)
 * - Output a confidence score for each hike
 */

const SUPABASE_URL = "https://epckjiufeimydxmcrfus.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function query(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase error: ${await res.text()}`);
  return res.json();
}

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${m}/${d}/${y}`;
}

async function main() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ Missing SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  console.log("Fetching hiking history...");
  const hikes = await query(
    "hiking_history?select=hike_date,season,hike_number,hike_code,trail_name&order=hike_date.asc&limit=500"
  );

  console.log("Fetching all step data...");
  // Fetch all step records (paginate if needed)
  let allSteps = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const page = await query(
      `health_metrics?select=recorded_at,value&metric_type=eq.steps&source=eq.fitbit&order=recorded_at.asc&limit=${pageSize}&offset=${offset}`
    );
    allSteps = allSteps.concat(page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  console.log(`Loaded ${hikes.length} hikes and ${allSteps.length} step records.\n`);

  // Build step lookup: date string → steps
  const stepsByDate = {};
  for (const row of allSteps) {
    const date = row.recorded_at.split("T")[0];
    stepsByDate[date] = row.value;
  }

  // Build set of hike dates for baseline exclusion
  const hikeDates = new Set(hikes.map((h) => h.hike_date));

  // Baseline: median steps on non-hike Saturdays (or all non-hike days)
  const nonHikeSteps = allSteps
    .filter((r) => {
      const date = r.recorded_at.split("T")[0];
      return !hikeDates.has(date);
    })
    .map((r) => r.value);

  const baselineMedian = median(nonHikeSteps);
  const baselineP75 = nonHikeSteps.sort((a, b) => a - b)[Math.floor(nonHikeSteps.length * 0.75)];

  console.log(`Baseline (non-hike days):`);
  console.log(`  Median steps : ${Math.round(baselineMedian).toLocaleString()}`);
  console.log(`  75th pct     : ${Math.round(baselineP75).toLocaleString()}`);
  console.log(`  Hike threshold (1.5× median): ${Math.round(baselineMedian * 1.5).toLocaleString()}\n`);

  // Threshold: steps must be ≥ 1.5× baseline median to be "likely participated"
  const THRESHOLD = baselineMedian * 1.5;

  // Analyze each hike
  const results = hikes.map((hike) => {
    const steps = stepsByDate[hike.hike_date];
    let status, confidence;

    if (steps == null) {
      status = "NO DATA";
      confidence = null;
    } else if (steps >= baselineMedian * 2.0) {
      status = "✅ VERY LIKELY";
      confidence = "high";
    } else if (steps >= THRESHOLD) {
      status = "✅ LIKELY";
      confidence = "medium";
    } else if (steps >= baselineMedian * 1.2) {
      status = "⚠️  MAYBE";
      confidence = "low";
    } else {
      status = "❌ SKIPPED";
      confidence = "skip";
    }

    return { ...hike, steps, status, confidence };
  });

  // Print results by season
  const seasons = [...new Set(results.map((r) => r.season))].sort((a, b) => b - a);

  for (const season of seasons) {
    const seasonHikes = results.filter((r) => r.season === season);
    const participated = seasonHikes.filter((r) => r.confidence === "high" || r.confidence === "medium").length;
    const total = seasonHikes.length;

    console.log(`\n═══ Season ${season} (${participated}/${total} likely attended) ═══`);
    console.log(`${"Date".padEnd(12)} ${"Steps".padStart(8)}  ${"Status".padEnd(16)} Trail`);
    console.log("─".repeat(80));

    for (const h of seasonHikes) {
      const stepsStr = h.steps != null ? Math.round(h.steps).toLocaleString().padStart(8) : "   N/A  ";
      console.log(`${formatDate(h.hike_date).padEnd(12)} ${stepsStr}  ${h.status.padEnd(16)} ${h.trail_name}`);
    }
  }

  // Summary
  const participated = results.filter((r) => r.confidence === "high" || r.confidence === "medium");
  const skipped = results.filter((r) => r.confidence === "skip");
  const noData = results.filter((r) => r.confidence === null);
  const maybe = results.filter((r) => r.confidence === "low");

  console.log(`\n${"═".repeat(80)}`);
  console.log(`SUMMARY (${results.length} total hikes logged)`);
  console.log(`  ✅ Likely attended : ${participated.length}`);
  console.log(`  ⚠️  Maybe          : ${maybe.length}`);
  console.log(`  ❌ Likely skipped  : ${skipped.length}`);
  console.log(`  📭 No Fitbit data  : ${noData.length}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
