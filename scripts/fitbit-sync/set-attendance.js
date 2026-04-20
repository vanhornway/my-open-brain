#!/usr/bin/env node
/**
 * Manually override attendance for one or more hikes.
 *
 * Usage:
 *   node set-attendance.js --codes S14H1,S14H2,S14H3 --attended
 *   node set-attendance.js --codes S14H12,S14H15 --skipped
 *   node set-attendance.js --codes S13H22 --unknown   # resets to null
 */

const SUPABASE_URL = "https://epckjiufeimydxmcrfus.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}

const codesRaw = getArg("--codes");
const isAttended = args.includes("--attended");
const isSkipped = args.includes("--skipped");
const isUnknown = args.includes("--unknown");

if (!codesRaw || (!isAttended && !isSkipped && !isUnknown)) {
  console.log(`
Usage:
  node set-attendance.js --codes <codes> --attended
  node set-attendance.js --codes <codes> --skipped
  node set-attendance.js --codes <codes> --unknown

Examples:
  node set-attendance.js --codes S14H12,S14H15 --skipped
  node set-attendance.js --codes S13H22 --attended
  node set-attendance.js --codes S14H5 --unknown

Flags:
  --attended   Mark as attended (true)
  --skipped    Mark as not attended (false)
  --unknown    Reset to unknown (null)
`);
  process.exit(0);
}

const codes = codesRaw.split(",").map((c) => c.trim().toUpperCase().replace(/\s+/g, ""));
const attendedValue = isAttended ? true : isSkipped ? false : null;
const label = isAttended ? "✅ attended" : isSkipped ? "❌ skipped" : "❓ unknown";

async function main() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ Missing SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  for (const code of codes) {
    // hike_code format in DB can be "S14 H1" or "S14H1" — normalize both
    const spaced = code.replace(/H/, " H");

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/hiking_history?or=(hike_code.eq.${encodeURIComponent(code)},hike_code.eq.${encodeURIComponent(spaced)})&select=id,hike_code,hike_date,trail_name`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!res.ok) {
      console.error(`❌ ${code} — query failed: ${await res.text()}`);
      continue;
    }

    const rows = await res.json();

    if (!rows.length) {
      console.error(`⚠️  ${code} — not found in hiking_history`);
      continue;
    }

    const hike = rows[0];

    const patch = await fetch(
      `${SUPABASE_URL}/rest/v1/hiking_history?id=eq.${hike.id}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ attended: attendedValue }),
      }
    );

    if (!patch.ok) {
      console.error(`❌ ${code} — update failed: ${await patch.text()}`);
    } else {
      console.log(`${label}  ${hike.hike_code} | ${hike.hike_date} | ${hike.trail_name}`);
    }
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
