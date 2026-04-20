#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_FILE = path.join(__dirname, "strava-tokens.json");
const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));

async function get(path) {
  const res = await fetch(`https://www.strava.com/api/v3${path}`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!res.ok) { console.error(`${res.status} ${path}`); return null; }
  return res.json();
}

// Fetch ALL activities
let all = [];
let page = 1;
while (true) {
  const data = await get(`/athlete/activities?per_page=200&page=${page}`);
  if (!data || !data.length) break;
  all = all.concat(data);
  process.stdout.write(`\rFetched ${all.length} activities...`);
  if (data.length < 200) break;
  page++;
}

console.log(`\nTotal activities: ${all.length}`);
console.log(`Date range: ${all.at(-1)?.start_date_local?.split("T")[0]} → ${all[0]?.start_date_local?.split("T")[0]}`);

// Show types breakdown
const types = {};
for (const a of all) types[a.type] = (types[a.type] || 0) + 1;
console.log("\nActivity types:");
for (const [t, c] of Object.entries(types).sort((a,b) => b[1]-a[1])) {
  console.log(`  ${t}: ${c}`);
}

// Show all Hike/Walk on Saturdays
const HIKE_TYPES = new Set(["Hike", "Walk", "TrailRun"]);
const saturdayHikes = all.filter(a => {
  const d = new Date(a.start_date_local);
  return HIKE_TYPES.has(a.type) && d.getDay() === 6;
});

console.log(`\nSaturday hikes/walks: ${saturdayHikes.length}`);
for (const a of saturdayHikes) {
  const date = a.start_date_local.split("T")[0];
  console.log(`  ${date} | ${a.type} | ${a.name} | ${(a.distance/1000).toFixed(1)}km | HR avg: ${a.average_heartrate ?? "N/A"}`);
}
