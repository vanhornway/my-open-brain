#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_FILE = path.join(__dirname, "strava-tokens.json");
const CLUB_ID = "1277764";

const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));

async function get(path) {
  const res = await fetch(`https://www.strava.com/api/v3${path}`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  console.log(`\n→ GET ${path}`);
  console.log(`  Status: ${res.status}`);
  const data = await res.json();
  return data;
}

// Check club details
const club = await get(`/clubs/${CLUB_ID}`);
console.log("Club:", JSON.stringify(club, null, 2));

// Check first page of club activities
const activities = await get(`/clubs/${CLUB_ID}/activities?per_page=5&page=1`);
console.log("\nClub activities sample:", JSON.stringify(activities, null, 2));

// Check my own recent activities
const mine = await get(`/athlete/activities?per_page=3&page=1`);
console.log("\nMy activities sample:", JSON.stringify(mine, null, 2));
