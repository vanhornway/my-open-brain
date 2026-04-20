#!/usr/bin/env node
/**
 * One-time TOTP setup for Open Brain.
 * Generates a secret, shows the otpauth:// URI to scan with Google Authenticator,
 * verifies a test code, then saves the secret locally and to Supabase.
 *
 * Usage:
 *   node setup-totp.js
 *   node setup-totp.js --rotate    (generate a new secret, replacing the old one)
 *   node setup-totp.js --test      (just verify a code against existing secret)
 */

import readline from "readline";
import { execSync } from "child_process";
import {
  generateSecret,
  verifyTOTP,
  saveSecretLocally,
  loadLocalSecret,
  hasLocalSecret,
  buildOtpauthURI,
} from "./lib/totp.js";

const args = process.argv.slice(2);
const ROTATE = args.includes("--rotate");
const TEST_ONLY = args.includes("--test");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = "https://epckjiufeimydxmcrfus.supabase.co";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

// ── PRINT QR-FRIENDLY URI ─────────────────────────────────────────
function printSetupInstructions(secret, uri) {
  console.log("\n" + "═".repeat(60));
  console.log("  OPEN BRAIN — 2FA SETUP");
  console.log("═".repeat(60));
  console.log("\n📱 Add to Google Authenticator:");
  console.log("\n  Option A — Manual entry:");
  console.log(`    Account:  Open Brain`);
  console.log(`    Key:      ${secret}`);
  console.log(`    Type:     Time-based`);
  console.log("\n  Option B — Copy this URI into Authenticator:");
  console.log(`\n  ${uri}\n`);
  console.log("  (In Google Authenticator: + → Enter a setup key → paste key above)");
  console.log("\n" + "═".repeat(60) + "\n");
}

// ── SAVE SECRET TO SUPABASE ───────────────────────────────────────
async function saveToSupabase(secret) {
  if (!SUPABASE_KEY) {
    console.log("   ⚠️  SUPABASE_SERVICE_ROLE_KEY not set — skipping Supabase secret storage.");
    console.log("      To enable MCP TOTP verification, run:");
    console.log(`      supabase secrets set TOTP_SECRET=${secret} --project-ref epckjiufeimydxmcrfus`);
    return;
  }

  try {
    // Store TOTP_SECRET via Supabase Management API
    // This sets it as an edge function secret (env var available in index.ts)
    const res = await fetch(
      `https://api.supabase.com/v1/projects/epckjiufeimydxmcrfus/secrets`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([{ name: "TOTP_SECRET", value: secret }]),
      }
    );

    if (res.ok) {
      console.log("   ✅ TOTP_SECRET saved to Supabase edge function secrets.");
      console.log("      Redeploy open-brain-mcp to activate MCP 2FA.");
    } else {
      const err = await res.text();
      console.log(`   ⚠️  Could not save to Supabase automatically: ${err}`);
      console.log("      Run manually:");
      console.log(`      supabase secrets set TOTP_SECRET=${secret} --project-ref epckjiufeimydxmcrfus`);
    }
  } catch (e) {
    console.log(`   ⚠️  Supabase secret save failed: ${e.message}`);
    console.log(`      supabase secrets set TOTP_SECRET=${secret} --project-ref epckjiufeimydxmcrfus`);
  }
}

// ── MAIN ──────────────────────────────────────────────────────────
async function main() {
  // TEST ONLY — just verify against existing secret
  if (TEST_ONLY) {
    if (!hasLocalSecret()) {
      console.error("❌ No TOTP secret found. Run setup-totp.js first.");
      process.exit(1);
    }
    const secret = loadLocalSecret();
    const code = await ask("Enter your current Google Authenticator code: ");
    if (verifyTOTP(secret, code)) {
      console.log("✅ Code is valid.");
    } else {
      console.log("❌ Invalid code.");
    }
    rl.close();
    return;
  }

  // CHECK EXISTING
  if (hasLocalSecret() && !ROTATE) {
    console.log("\n⚠️  A TOTP secret already exists at ~/.config/open-brain/.totp");
    const overwrite = await ask("   Overwrite it? (yes/no): ");
    if (overwrite.trim().toLowerCase() !== "yes") {
      console.log("Aborted. Use --test to verify your existing code.");
      rl.close();
      return;
    }
  }

  // GENERATE
  const secret = generateSecret();
  const uri = buildOtpauthURI(secret, "Open Brain (Umair)", "Open Brain");
  printSetupInstructions(secret, uri);

  // VERIFY BEFORE SAVING
  console.log("Before saving, verify the code works:");
  let verified = false;
  for (let i = 1; i <= 3; i++) {
    const code = await ask(`  Enter the 6-digit code shown in Google Authenticator (attempt ${i}/3): `);
    if (verifyTOTP(secret, code)) {
      verified = true;
      break;
    }
    console.log("  ❌ Invalid. Wait for the next code and try again.");
  }

  if (!verified) {
    console.error("\n❌ Could not verify the code. Setup aborted — secret NOT saved.");
    console.error("   Make sure you added the key to Google Authenticator and try again.");
    rl.close();
    process.exit(1);
  }

  console.log("\n✅ Code verified!\n");

  // SAVE LOCALLY
  saveSecretLocally(secret);
  console.log("✅ Secret saved to ~/.config/open-brain/.totp (mode 600 — owner read-only)");

  // SAVE TO SUPABASE
  console.log("   Saving to Supabase edge function secrets...");
  await saveToSupabase(secret);

  console.log("\n🎉 TOTP setup complete.");
  console.log("   • Local scripts will now require a 2FA code before writing to Supabase.");
  console.log("   • Redeploy open-brain-mcp for MCP tools to enforce 2FA:");
  console.log("     supabase functions deploy open-brain-mcp --no-verify-jwt\n");

  rl.close();
}

main().catch((e) => {
  console.error("Error:", e.message);
  rl.close();
  process.exit(1);
});
