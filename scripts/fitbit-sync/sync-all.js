#!/usr/bin/env node
/**
 * Master sync script: runs Fitbit → Strava → Whoop in sequence
 *
 * Each script queries Supabase for the last recorded date and starts from there.
 * Perfect for cron automation on Sunday morning to capture Saturday hike data.
 *
 * Usage:
 *   node sync-all.js                # run all three scripts
 *   node sync-all.js --intraday     # also fetch Fitbit intraday HR for Saturdays
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function runScript(scriptName, scriptArgs = []) {
  return new Promise((resolve, reject) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 Running ${scriptName}...`);
    console.log(`${'='.repeat(60)}\n`);

    const child = spawn("node", [path.join(__dirname, scriptName), ...scriptArgs], {
      stdio: "inherit",
      cwd: __dirname,
    });

    child.on("close", (code) => {
      if (code !== 0) {
        console.error(`\n❌ ${scriptName} exited with code ${code}`);
        reject(new Error(`${scriptName} failed`));
      } else {
        console.log(`\n✅ ${scriptName} completed successfully`);
        resolve();
      }
    });

    child.on("error", (err) => {
      console.error(`\n❌ Failed to run ${scriptName}:`, err.message);
      reject(err);
    });
  });
}

async function main() {
  const startTime = new Date();
  console.log(`📅 Starting sync run at ${startTime.toISOString()}`);
  console.log("Sequence: Fitbit → Strava → Whoop\n");

  try {
    // Run Fitbit sync (pass through --intraday if provided)
    await runScript("sync.js", args);

    // Small delay between scripts
    await new Promise((r) => setTimeout(r, 2000));

    // Run Strava sync
    await runScript("strava-sync.js");

    // Small delay between scripts
    await new Promise((r) => setTimeout(r, 2000));

    // Run Whoop sync
    await runScript("whoop-sync.js");

    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000 / 60).toFixed(2);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✨ All sync complete! (${duration} minutes)`);
    console.log(`${'='.repeat(60)}\n`);
  } catch (err) {
    console.error(`\n${'='.repeat(60)}`);
    console.error(`❌ Sync failed: ${err.message}`);
    console.error(`${'='.repeat(60)}\n`);
    process.exit(1);
  }
}

main();
