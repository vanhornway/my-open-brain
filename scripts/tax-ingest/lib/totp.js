/**
 * Pure Node.js TOTP implementation (RFC 6238).
 * Zero external dependencies — uses built-in crypto only.
 * Compatible with Google Authenticator.
 */

import { createHmac, randomBytes } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import readline from "readline";

const CONFIG_DIR = join(homedir(), ".config", "open-brain");
const SECRET_FILE = join(CONFIG_DIR, ".totp");

// ── BASE32 ────────────────────────────────────────────────────────
const B32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(s) {
  s = s.toUpperCase().replace(/[\s=]/g, "");
  const bytes = [];
  let bits = 0, val = 0;
  for (const c of s) {
    const idx = B32_CHARS.indexOf(c);
    if (idx === -1) throw new Error(`Invalid base32 char: ${c}`);
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((val >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function base32Encode(buf) {
  let bits = 0, val = 0, out = "";
  for (const b of buf) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_CHARS[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_CHARS[(val << (5 - bits)) & 31];
  return out;
}

// ── HOTP (counter-based OTP) ─────────────────────────────────────
function hotp(keyBuf, counter) {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", keyBuf).update(counterBuf).digest();
  const offset = hmac[19] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

// ── TOTP (time-based OTP) ─────────────────────────────────────────
export function generateSecret() {
  return base32Encode(randomBytes(20));
}

export function generateTOTP(secret, timeMs = Date.now()) {
  const counter = Math.floor(timeMs / 1000 / 30);
  return hotp(base32Decode(secret), counter);
}

/**
 * Verify a 6-digit code against a secret.
 * Accepts current window ± 1 (covers clock skew up to 30s).
 */
export function verifyTOTP(secret, code) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const key = base32Decode(secret);
  return [counter - 1, counter, counter + 1].some(
    (c) => hotp(key, c) === String(code).replace(/\s/g, "").padStart(6, "0")
  );
}

// ── SECRET STORAGE ────────────────────────────────────────────────
export function saveSecretLocally(secret) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(SECRET_FILE, secret, { encoding: "utf8", mode: 0o600 });
  // Ensure file is only readable by owner
  chmodSync(SECRET_FILE, 0o600);
}

export function loadLocalSecret() {
  if (!existsSync(SECRET_FILE)) return null;
  return readFileSync(SECRET_FILE, "utf8").trim();
}

export function hasLocalSecret() {
  return existsSync(SECRET_FILE);
}

// ── otpauth:// URI ────────────────────────────────────────────────
export function buildOtpauthURI(secret, label = "Open Brain", issuer = "Open Brain") {
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

// ── INTERACTIVE VERIFY ────────────────────────────────────────────
/**
 * Prompts the user for a TOTP code in the terminal.
 * Returns true if valid, throws if invalid after maxAttempts.
 */
export async function promptAndVerify(maxAttempts = 3) {
  const secret = loadLocalSecret();
  if (!secret) {
    throw new Error("No TOTP secret found. Run: node setup-totp.js");
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const code = await new Promise((resolve) =>
      rl.question(`🔐 Enter Google Authenticator code (attempt ${attempt}/${maxAttempts}): `, resolve)
    );

    if (verifyTOTP(secret, code)) {
      rl.close();
      console.log("   ✅ Identity verified.");
      return true;
    }

    if (attempt < maxAttempts) {
      console.log("   ❌ Invalid code. Try again.");
    }
  }

  rl.close();
  throw new Error("❌ TOTP verification failed after 3 attempts. Aborting.");
}
