import { Hono } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;
const TOTP_SECRET = Deno.env.get("TOTP_SECRET"); // optional; if set, finance writes require TOTP

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── TOTP VERIFICATION (server-side, RFC 6238) ─────────────────────
// Zero dependencies — pure HMAC-SHA1 implementation.
function base32Decode(s: string): Uint8Array {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  s = s.toUpperCase().replace(/[\s=]/g, "");
  const bytes: number[] = [];
  let bits = 0, val = 0;
  for (const c of s) {
    const idx = chars.indexOf(c);
    if (idx === -1) throw new Error(`Invalid base32 char: ${c}`);
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) { bytes.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(bytes);
}

async function hotpVerify(secret: string, counter: number, code: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw", base32Decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const counterBuf = new ArrayBuffer(8);
  new DataView(counterBuf).setBigUint64(0, BigInt(counter), false);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBuf));
  const offset = sig[19] & 0x0f;
  const otp = (((sig[offset] & 0x7f) << 24) | (sig[offset+1] << 16) | (sig[offset+2] << 8) | sig[offset+3]) % 1_000_000;
  return String(otp).padStart(6, "0") === String(code).trim();
}

async function verifyTOTP(code: string): Promise<boolean> {
  if (!TOTP_SECRET) return true; // TOTP not configured — allow through
  const counter = Math.floor(Date.now() / 1000 / 30);
  // Check ±1 window for clock skew
  for (const c of [counter - 1, counter, counter + 1]) {
    if (await hotpVerify(TOTP_SECRET, c, code)) return true;
  }
  return false;
}

function totpError() {
  return {
    content: [{ type: "text" as const, text: "❌ Invalid or missing 2FA code. Open Google Authenticator, get the 6-digit Open Brain code, and pass it as totp_code." }],
    isError: true,
  };
}

// ============================================================
// TABLE REGISTRY
// To add a new table, add one entry here.
// A search_ and list_ tool will be auto-generated for it.
// ============================================================
type FilterDef = {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
};

type TableConfig = {
  description: string;
  selectFields: string;
  defaultSort: { column: string; ascending: boolean };
  searchColumns: string[];   // columns used for text search
  filters: FilterDef[];      // filterable columns exposed as tool params
  dateColumn?: string;       // if set, enables days/date_from/date_to filters
};

const TABLE_REGISTRY: Record<string, TableConfig> = {
  hiking_history: {
    description:
      "BAD Hikers group hiking history — trail names, AllTrails links, cafe stops, seasons. Weekly Saturday hikes in the San Francisco Bay Area from Dec 2022 onwards.",
    selectFields:
      "id, hike_date, season, hike_number, hike_code, trail_name, alltrails_url, cafe_name, cafe_url, notes, attended, kudoers, kudos_count, athlete_count, hr_avg, hr_max, hr_zones, photo_count",
    defaultSort: { column: "hike_date", ascending: false },
    searchColumns: ["trail_name", "cafe_name", "notes"],
    filters: [
      {
        name: "season",
        type: "number",
        description: "Filter by season number (11=Dec2022, 12=May2023, 13=Apr2024, 14=Apr2025, 15=Mar2026+)",
      },
      {
        name: "trail_name",
        type: "string",
        description: "Filter by trail name (e.g. 'Mission Peak', 'Maguire Peak Sunol')",
      },
      {
        name: "attended",
        type: "boolean",
        description: "Filter by attendance: true = hikes Umair attended, false = hikes he missed/skipped",
      },
    ],
    dateColumn: "hike_date",
  },

  health_metrics: {
    description:
      "Health device data — glucose (Libre3 CGM), HRV/recovery/strain/sleep (Whoop), steps/calories/sleep/weight (Fitbit), blood pressure (bp_machine), metabolic score (Lumen), brain score (Mendi), body composition (withings).",
    selectFields:
      "id, recorded_at, source, metric_type, value, unit, metadata, subject, notes",
    defaultSort: { column: "recorded_at", ascending: false },
    searchColumns: ["metric_type", "source", "notes"],
    filters: [
      {
        name: "source",
        type: "string",
        description:
          "Device source: whoop, fitbit, libre3, bp_machine, lumen, mendi, withings, manual",
      },
      {
        name: "metric_type",
        type: "string",
        description:
          "Metric type: glucose (Libre3 CGM, mg/dL), hrv, recovery_score, strain, sleep_hours, sleep_score, resting_heart_rate, steps, calories_burned, systolic, diastolic, pulse, weight, body_fat_pct, muscle_mass_lbs, metabolic_score, brain_score, vo2max, spo2, respiratory_rate, morning_hr_zone_minutes (Fitbit intraday Zone2+ minutes on Saturday 6:30–10:30 AM hike window)",
      },
      {
        name: "subject",
        type: "string",
        description: "Person: Umair (default)",
      },
    ],
    dateColumn: "recorded_at",
  },

  personal_hikes: {
    description:
      "Umair's personal solo hikes and walks — Strava activities not part of the BAD Hikers group schedule. Captures individual outdoor activity on any day of the week.",
    selectFields:
      "id, activity_date, activity_name, activity_type, start_time, distance_km, elevation_m, duration_minutes, hr_avg, hr_max, hr_zones, kudos_count, kudoers, strava_activity_id, photo_count, notes",
    defaultSort: { column: "activity_date", ascending: false },
    searchColumns: ["activity_name", "activity_type", "notes"],
    filters: [
      {
        name: "activity_type",
        type: "string",
        description: "Activity type: Hike, Walk, TrailRun, Run",
      },
    ],
    dateColumn: "activity_date",
  },

  kids: {
    description:
      "Umair's three kids — Nyel (11th grade), Emaad (10th grade), Omer (4th grade). Core profiles with grade, graduation year, and notes.",
    selectFields: "id, name, nickname, grade, graduation_year, birth_year, school, notes, updated_at",
    defaultSort: { column: "grade", ascending: false },
    searchColumns: ["name", "notes"],
    filters: [
      { name: "name", type: "string", description: "Kid's name: Nyel, Emaad, or Omer" },
    ],
  },

  scout_progress: {
    description:
      "Eagle Scout progress for Nyel and Emaad — current rank, merit badges completed, camping nights, hiking miles, service hours, leadership role, Eagle project status.",
    selectFields:
      "id, kid_name, current_rank, rank_date, merit_badges_completed, eagle_required_badges_done, camping_nights, hiking_miles, service_hours, leadership_role, nylt_completed, eagle_project_status, notes, as_of_date, updated_at",
    defaultSort: { column: "kid_name", ascending: true },
    searchColumns: ["kid_name", "current_rank", "notes"],
    filters: [
      { name: "kid_name", type: "string", description: "Kid's name: Nyel or Emaad" },
    ],
  },

  scout_merit_badges: {
    description:
      "Individual merit badges completed by Nyel and Emaad. Tracks badge name, whether it's Eagle-required, completion date, and counselor.",
    selectFields:
      "id, kid_name, badge_name, is_eagle_required, completed_date, counselor, notes, created_at",
    defaultSort: { column: "completed_date", ascending: false },
    searchColumns: ["kid_name", "badge_name", "notes"],
    filters: [
      { name: "kid_name", type: "string", description: "Kid's name: Nyel or Emaad" },
      { name: "is_eagle_required", type: "boolean", description: "true = Eagle-required badge" },
    ],
    dateColumn: "completed_date",
  },

  college_prep_timeline: {
    description:
      "College prep milestone timeline for Nyel and Emaad — tasks with deadlines, phases (sophomore/junior/senior/summer), and completion status. Includes SAT dates, app deadlines, shadowing goals.",
    selectFields:
      "id, kid_name, phase, task, deadline_date, status, priority, completed_date, notes, updated_at",
    defaultSort: { column: "deadline_date", ascending: true },
    searchColumns: ["kid_name", "task", "phase", "notes"],
    filters: [
      { name: "kid_name", type: "string", description: "Kid's name: Nyel or Emaad" },
      { name: "status", type: "string", description: "Status: pending, in_progress, completed, skipped" },
      { name: "phase", type: "string", description: "Phase: sophomore, junior, senior, summer_2026, summer_2027" },
    ],
    dateColumn: "deadline_date",
  },

  college_prep_log: {
    description:
      "College prep activity log for Nyel and Emaad — shadowing hours, test scores, summer programs, volunteer work, extracurriculars, awards.",
    selectFields:
      "id, kid_name, activity_type, title, activity_date, hours, score, location, notes, created_at",
    defaultSort: { column: "activity_date", ascending: false },
    searchColumns: ["kid_name", "title", "activity_type", "notes"],
    filters: [
      { name: "kid_name", type: "string", description: "Kid's name: Nyel or Emaad" },
      {
        name: "activity_type",
        type: "string",
        description: "Type: shadowing, volunteer, extracurricular, summer_program, test_score, course, award",
      },
    ],
    dateColumn: "activity_date",
  },

  lab_results: {
    description:
      "Umair's medical lab results history — CBC, CMP, lipid panel, liver panel, HbA1c, vitamins, and more. Goes back to 2021. Each row is one marker on one test date.",
    selectFields:
      "id, subject, test_date, panel, marker, value, unit, reference_low, reference_high, is_flagged, flag, lab_name, notes, created_at",
    defaultSort: { column: "test_date", ascending: false },
    searchColumns: ["marker", "panel", "subject", "notes"],
    filters: [
      { name: "subject", type: "string", description: "Person: Umair (default)" },
      { name: "marker", type: "string", description: "Lab marker e.g. HbA1c, ALT, LDL, Hemoglobin, Vitamin B12" },
      { name: "panel", type: "string", description: "Panel: CBC, CMP, Lipid, Liver, HbA1c, Vitamins" },
      { name: "is_flagged", type: "boolean", description: "true = abnormal result (HIGH or LOW)" },
    ],
    dateColumn: "test_date",
  },

  medications: {
    description:
      "Current and past medications for Umair and family. Includes drug name, dose, frequency, condition treated, start/end dates.",
    selectFields:
      "id, subject, drug_name, dose, frequency, condition, prescribing_doctor, start_date, end_date, is_active, notes",
    defaultSort: { column: "is_active", ascending: false },
    searchColumns: ["drug_name", "condition", "subject", "notes"],
    filters: [
      { name: "subject", type: "string", description: "Person: Umair (default)" },
      { name: "is_active", type: "boolean", description: "true = currently taking" },
    ],
  },

  diet_log: {
    description:
      "Meal and food log for Umair. Used to correlate food intake with CGM glucose readings, energy, and health metrics. Each row is one food item or meal.",
    selectFields:
      "id, subject, meal_time, meal_type, food_name, calories, carbs_g, protein_g, fat_g, fiber_g, sugar_g, glycemic_index, portion_size, notes, created_at",
    defaultSort: { column: "meal_time", ascending: false },
    searchColumns: ["food_name", "meal_type", "notes"],
    filters: [
      { name: "subject", type: "string", description: "Person: Umair (default)" },
      { name: "meal_type", type: "string", description: "breakfast, lunch, dinner, snack, fast_break" },
    ],
    dateColumn: "meal_time",
  },

  meals: {
    description:
      "Meal-level food log with AI-extracted or manual macros. One row per meal (not per item). Timestamped for CGM glucose correlation. Use meal_glucose_response view for post-meal glucose reactions.",
    selectFields:
      "id, subject, meal_name, eaten_at, meal_type, calories, carbs_g, protein_g, fat_g, fiber_g, sugar_g, sodium_mg, glycemic_index, ingredients, source, notes, created_at",
    defaultSort: { column: "eaten_at", ascending: false },
    searchColumns: ["meal_name", "meal_type", "notes"],
    filters: [
      { name: "subject", type: "string", description: "Person: Umair (default)" },
      { name: "meal_type", type: "string", description: "breakfast | lunch | dinner | snack | drinks | dessert" },
      { name: "source", type: "string", description: "photo | chatgpt | gemini | claude | myfitnesspal | manual" },
    ],
    dateColumn: "eaten_at",
  },

  blood_glucose: {
    description:
      "Blood glucose readings — CGM continuous readings (Libre3), manual finger-prick tests, and A1C lab results. All timestamped for meal and activity correlation. Use estimated_a1c view for 90-day estimated A1C.",
    selectFields:
      "id, subject, recorded_at, glucose_mg_dl, a1c_percent, reading_type, source, trend, fasting, notes, created_at",
    defaultSort: { column: "recorded_at", ascending: false },

    searchColumns: ["notes", "reading_type"],
    filters: [
      { name: "subject", type: "string", description: "Person: Umair (default)" },
      { name: "reading_type", type: "string", description: "cgm | manual_prick | a1c_lab" },
      { name: "source", type: "string", description: "libre3 | dexcom | manual | lab | screenshot" },
      { name: "fasting", type: "boolean", description: "true = fasting reading" },
    ],
    dateColumn: "recorded_at",
  },

  lumen_entries: {
    description:
      "Lumen metabolic breath test scores (1–5). 1–2 = fat burning, 3 = mixed, 4–5 = carb burning. Timestamped entries for tracking metabolic flexibility over time.",
    selectFields:
      "id, subject, recorded_at, score, interpretation, measurement_context, co2_ppm, notes, created_at",
    defaultSort: { column: "recorded_at", ascending: false },
    searchColumns: ["interpretation", "measurement_context", "notes"],
    filters: [
      { name: "subject", type: "string", description: "Person: Umair (default)" },
      { name: "measurement_context", type: "string", description: "morning | pre_workout | post_workout | pre_meal | post_meal" },
      { name: "score", type: "number", description: "Lumen score 1–5" },
    ],
    dateColumn: "recorded_at",
  },

  blood_pressure: {
    description:
      "Blood pressure readings with systolic, diastolic, and heart rate. Location tracks where the reading was taken (home/doctor's office/Whoop). Source tracks how data was entered.",
    selectFields:
      "id, subject, recorded_at, systolic, diastolic, heart_rate_bpm, measurement_location, source, notes, created_at",
    defaultSort: { column: "recorded_at", ascending: false },
    searchColumns: ["notes", "measurement_location"],
    filters: [
      { name: "subject", type: "string", description: "Person: Umair (default)" },
      { name: "measurement_location", type: "string", description: "home | doctors_office | whoop" },
      { name: "source", type: "string", description: "monitor | whoop_csv | manual | screenshot" },
    ],
    dateColumn: "recorded_at",
  },

  finance_income: {
    description:
      "Income tracking by source and tax year. Includes W2 salary, RSU vests, bonuses, dividends, and other income. Used for AGI calculation and tax bracket optimization.",
    selectFields:
      "id, income_date, tax_year, source, income_type, gross_amount, net_amount, is_taxable, notes, created_at",
    defaultSort: { column: "income_date", ascending: false },
    searchColumns: ["source", "income_type", "notes"],
    filters: [
      { name: "tax_year", type: "number", description: "Tax year e.g. 2025" },
      { name: "income_type", type: "string", description: "w2, rsu, bonus, dividend, capital_gains, rental, other" },
    ],
    dateColumn: "income_date",
  },

  finance_donations: {
    description:
      "Charitable donation log with tax deduction tracking. Includes Zakat (Islamic obligatory giving, paid during Ramadan via DAF), Sadaqa (voluntary Islamic giving), and general charity. Tracks cash, stock donations, and DAF contributions/grants. Key for tax bracket optimization.",
    selectFields:
      "id, donation_date, tax_year, charity_name, donation_type, giving_category, amount, fair_market_value, cost_basis, is_tax_deductible, daf_account, islamic_year, zakat_asset_type, notes, created_at",
    defaultSort: { column: "donation_date", ascending: false },
    searchColumns: ["charity_name", "donation_type", "giving_category", "notes"],
    filters: [
      { name: "tax_year", type: "number", description: "Tax year e.g. 2025" },
      { name: "giving_category", type: "string", description: "zakat, sadaqa, general_charity" },
      { name: "donation_type", type: "string", description: "cash, stock, daf_contribution, daf_grant" },
      { name: "islamic_year", type: "number", description: "Hijri year e.g. 1446 (2025), 1447 (2026)" },
    ],
    dateColumn: "donation_date",
  },

  finance_tax_profile: {
    description:
      "Annual tax profile — estimated AGI, taxable income, brackets, effective/marginal rates, and Child Tax Credit. Updated throughout the year for real-time tax planning.",
    selectFields:
      "id, tax_year, filing_status, state, estimated_gross_income, pre_tax_deductions, estimated_agi, itemized_deductions, standard_deduction, taxable_income, estimated_federal_tax, marginal_rate, effective_rate, child_tax_credit, notes, updated_at",
    defaultSort: { column: "tax_year", ascending: false },
    searchColumns: ["notes"],
    filters: [
      { name: "tax_year", type: "number", description: "Tax year e.g. 2025" },
    ],
  },

  finance_net_worth: {
    description:
      "Monthly net worth snapshots — liquid cash, brokerage, 401k, IRA, home equity, mortgage balance, total assets/liabilities, and net worth over time.",
    selectFields:
      "id, snapshot_date, liquid_cash, checking_savings, brokerage, retirement_401k, retirement_ira, home_equity, other_assets, total_assets, mortgage_balance, other_liabilities, total_liabilities, net_worth, notes",
    defaultSort: { column: "snapshot_date", ascending: false },
    searchColumns: ["notes"],
    filters: [],
    dateColumn: "snapshot_date",
  },

  family_events: {
    description:
      "Family calendar — medical appointments, school events, milestones, travel, religious events. Covers all family members.",
    selectFields:
      "id, event_date, event_time, title, category, people, location, status, notes, created_at",
    defaultSort: { column: "event_date", ascending: false },
    searchColumns: ["title", "category", "location", "notes"],
    filters: [
      { name: "category", type: "string", description: "medical, school, sports, religious, travel, milestone, financial" },
      { name: "status", type: "string", description: "upcoming, completed, cancelled" },
    ],
    dateColumn: "event_date",
  },

  goals: {
    description:
      "Personal goals for Umair across health, financial, family, and career domains. Tracks target value, current value, deadline, and status.",
    selectFields:
      "id, subject, category, title, description, target_value, current_value, unit, target_date, status, priority, notes, updated_at",
    defaultSort: { column: "priority", ascending: true },
    searchColumns: ["title", "category", "description", "notes"],
    filters: [
      { name: "category", type: "string", description: "health, financial, family, career, education" },
      { name: "status", type: "string", description: "active, achieved, abandoned" },
    ],
    dateColumn: "target_date",
  },

  school_calendar: {
    description:
      "School break and no-school days for all three kids — Nyel & Emaad (EVHS) and Omer (Silver Oak Elementary / Evergreen School District). Covers 2025–2028. Use is_no_school=true to find days kids are off. Query both schools with overlapping dates to find when all three kids are free simultaneously.",
    selectFields:
      "id, school, people, school_year, event_type, title, start_date, end_date, is_no_school, notes",
    defaultSort: { column: "start_date", ascending: true },
    searchColumns: ["title", "school", "notes"],
    filters: [
      { name: "school", type: "string", description: "EVHS | Silver Oak Elementary" },
      { name: "school_year", type: "string", description: "2025-2026 | 2026-2027 | 2027-2028" },
      { name: "event_type", type: "string", description: "break | holiday | no_school | first_day | last_day | minimum_day | staff_dev" },
      { name: "is_no_school", type: "boolean", description: "true = kids are off school (breaks, holidays, no-school days)" },
    ],
    dateColumn: "start_date",
  },

  // ── CATEGORY 1: MCP-registered, now created ──────────────

  lab_results: {
    description: "Umair's medical lab results history — CBC, CMP, lipid panel, liver panel, HbA1c, vitamins, and more. Goes back to 2014. Each row is one marker on one test date.",
    selectFields: "id, subject, test_date, panel, marker, value, unit, reference_low, reference_high, is_flagged, flag, lab_name, notes, created_at",
    defaultSort: { column: "test_date", ascending: false },
    searchColumns: ["marker", "panel", "subject", "notes"],
    filters: [
      { name: "subject", type: "string", description: "Person: Umair (default)" },
      { name: "marker", type: "string", description: "Lab marker e.g. HbA1c, ALT, LDL, Hemoglobin, Vitamin B12" },
      { name: "panel", type: "string", description: "Panel: CBC, CMP, Lipid, Liver, HbA1c, Vitamins, Advanced_Lipid" },
      { name: "is_flagged", type: "boolean", description: "true = abnormal result (HIGH or LOW)" },
    ],
    dateColumn: "test_date",
  },

  medications: {
    description: "Current and past medications for Umair and family. Includes drug name, dose, frequency, condition treated, start/end dates. Active meds: Warfarin 10mg, Lisinopril 10mg, Aspirin 81mg, Lipitor 80mg.",
    selectFields: "id, subject, drug_name, dose, frequency, condition, prescribing_doctor, start_date, end_date, is_active, notes",
    defaultSort: { column: "is_active", ascending: false },
    searchColumns: ["drug_name", "condition", "subject", "notes"],
    filters: [
      { name: "subject", type: "string", description: "Person: Umair (default)" },
      { name: "is_active", type: "boolean", description: "true = currently taking" },
    ],
  },

  diet_log: {
    description: "Legacy food item log — individual food items with macros. Predates the meals table. Use meals for newer meal-level entries.",
    selectFields: "id, subject, meal_time, meal_type, food_name, calories, carbs_g, protein_g, fat_g, fiber_g, sugar_g, glycemic_index, portion_size, notes, created_at",
    defaultSort: { column: "meal_time", ascending: false },
    searchColumns: ["food_name", "meal_type", "notes"],
    filters: [
      { name: "subject", type: "string", description: "Person: Umair (default)" },
      { name: "meal_type", type: "string", description: "breakfast, lunch, dinner, snack, fast_break" },
    ],
    dateColumn: "meal_time",
  },

  finance_income: {
    description: "Income tracking by source and tax year. Includes W2 salary, RSU vests, bonuses, dividends, and other income. Used for AGI calculation and tax bracket optimization.",
    selectFields: "id, income_date, tax_year, source, income_type, gross_amount, net_amount, is_taxable, notes, created_at",
    defaultSort: { column: "income_date", ascending: false },
    searchColumns: ["source", "income_type", "notes"],
    filters: [
      { name: "tax_year", type: "number", description: "Tax year e.g. 2025" },
      { name: "income_type", type: "string", description: "w2, rsu, bonus, dividend, capital_gains, rental, other" },
    ],
    dateColumn: "income_date",
  },

  finance_donations: {
    description: "Charitable donation log. Includes Zakat (Islamic obligatory, paid during Ramadan via DAF), Sadaqa (voluntary), and general charity. Tracks cash, stock donations, and DAF contributions/grants. Key for tax bracket optimization.",
    selectFields: "id, donation_date, tax_year, charity_name, donation_type, giving_category, amount, fair_market_value, cost_basis, is_tax_deductible, daf_account, islamic_year, zakat_asset_type, notes, created_at",
    defaultSort: { column: "donation_date", ascending: false },
    searchColumns: ["charity_name", "donation_type", "giving_category", "notes"],
    filters: [
      { name: "tax_year", type: "number", description: "Tax year e.g. 2025" },
      { name: "giving_category", type: "string", description: "zakat, sadaqa, general_charity" },
      { name: "donation_type", type: "string", description: "cash, stock, daf_contribution, daf_grant" },
      { name: "islamic_year", type: "number", description: "Hijri year e.g. 1446 (2025), 1447 (2026)" },
    ],
    dateColumn: "donation_date",
  },

  finance_tax_profile: {
    description: "Annual tax profile — AGI, taxable income, brackets, effective/marginal rates, Child Tax Credit. Updated throughout year for real-time tax planning. Filing status MFJ (CA).",
    selectFields: "id, tax_year, filing_status, state, estimated_gross_income, pre_tax_deductions, estimated_agi, itemized_deductions, standard_deduction, taxable_income, estimated_federal_tax, marginal_rate, effective_rate, child_tax_credit, notes, updated_at",
    defaultSort: { column: "tax_year", ascending: false },
    searchColumns: ["notes"],
    filters: [
      { name: "tax_year", type: "number", description: "Tax year e.g. 2025" },
    ],
  },

  finance_net_worth: {
    description: "Monthly net worth snapshots — liquid cash, brokerage, 401k, IRA, home equity, mortgage balance, total assets/liabilities, and net worth over time.",
    selectFields: "id, snapshot_date, liquid_cash, checking_savings, brokerage, retirement_401k, retirement_ira, home_equity, other_assets, total_assets, mortgage_balance, other_liabilities, total_liabilities, net_worth, notes",
    defaultSort: { column: "snapshot_date", ascending: false },
    searchColumns: ["notes"],
    filters: [],
    dateColumn: "snapshot_date",
  },

  family_events: {
    description: "Family calendar — medical appointments, school events, milestones, travel, religious events. Covers all family members.",
    selectFields: "id, event_date, event_time, title, category, people, location, status, notes, created_at",
    defaultSort: { column: "event_date", ascending: false },
    searchColumns: ["title", "category", "location", "notes"],
    filters: [
      { name: "category", type: "string", description: "medical, school, sports, religious, travel, milestone, financial" },
      { name: "status", type: "string", description: "upcoming, completed, cancelled" },
    ],
    dateColumn: "event_date",
  },

  goals: {
    description: "Personal goals for Umair across health, financial, family, and career domains. Tracks target value, current value, deadline, and status. Key goals: <200 lbs by July 4 2026, HbA1c <5.7%, AI income $15k-$25k/month.",
    selectFields: "id, subject, category, title, description, target_value, current_value, unit, target_date, status, priority, notes, updated_at",
    defaultSort: { column: "priority", ascending: true },
    searchColumns: ["title", "category", "description", "notes"],
    filters: [
      { name: "category", type: "string", description: "health, financial, family, career, education" },
      { name: "status", type: "string", description: "active, achieved, abandoned" },
    ],
    dateColumn: "target_date",
  },

  // ── CATEGORY 2: New tables from thought analysis ──────────

  fasting_windows: {
    description: "Intermittent fasting log — start/end times, duration, fast type. Duration is auto-calculated. Umair typically fasts 16–20h daily (IF protocol), with Ramadan fasts in Feb–Mar each year.",
    selectFields: "id, subject, fast_start, fast_end, duration_hours, fast_type, broken_with, notes, created_at",
    defaultSort: { column: "fast_start", ascending: false },
    searchColumns: ["fast_type", "broken_with", "notes"],
    filters: [
      { name: "subject", type: "string", description: "Person: Umair (default)" },
      { name: "fast_type", type: "string", description: "intermittent | ramadan | extended | water_only" },
    ],
    dateColumn: "fast_start",
  },

  inr_readings: {
    description: "INR (International Normalized Ratio) readings for Warfarin anticoagulation management. Umair has Antiphospholipid Syndrome (APS) and is on Warfarin 10mg. Target INR range 2.0–3.0. in_range is auto-calculated.",
    selectFields: "id, subject, recorded_at, inr_value, target_low, target_high, in_range, warfarin_dose_mg, dose_adjusted, new_dose_mg, lab_name, ordering_doctor, notes, created_at",
    defaultSort: { column: "recorded_at", ascending: false },
    searchColumns: ["notes", "lab_name", "ordering_doctor"],
    filters: [
      { name: "subject", type: "string", description: "Person: Umair (default)" },
      { name: "in_range", type: "boolean", description: "true = INR within 2.0–3.0 target range" },
      { name: "dose_adjusted", type: "boolean", description: "true = Warfarin dose was changed at this visit" },
    ],
    dateColumn: "recorded_at",
  },

  workouts: {
    description: "Non-hike workout sessions — spinning, strength training, cardio, yoga, swimming. Complements hiking_history and personal_hikes for full activity picture.",
    selectFields: "id, subject, workout_date, start_time, activity_type, duration_minutes, intensity, calories_burned, hr_avg, hr_max, distance_km, location, equipment, notes, source, created_at",
    defaultSort: { column: "workout_date", ascending: false },
    searchColumns: ["activity_type", "notes", "location"],
    filters: [
      { name: "subject", type: "string", description: "Person: Umair (default)" },
      { name: "activity_type", type: "string", description: "spinning, strength, cardio, yoga, swim, run, walk, hiit, other" },
      { name: "intensity", type: "string", description: "low, moderate, high" },
    ],
    dateColumn: "workout_date",
  },

  weight_log: {
    description: "Daily weight readings with body composition. weight_kg is auto-calculated from lbs. Goal: reach <200 lbs by July 4 2026 from ~213 lbs (Mar 2026). Track morning weight fasted for consistency.",
    selectFields: "id, subject, recorded_at, weight_lbs, weight_kg, body_fat_pct, muscle_mass_lbs, bmi, fasting_hours, time_of_day, notes, source, created_at",
    defaultSort: { column: "recorded_at", ascending: false },
    searchColumns: ["notes", "time_of_day"],
    filters: [
      { name: "subject", type: "string", description: "Person: Umair (default)" },
      { name: "time_of_day", type: "string", description: "morning | midday | evening" },
      { name: "source", type: "string", description: "manual | withings | fitbit | smart_scale" },
    ],
    dateColumn: "recorded_at",
  },

  medical_conditions: {
    description: "Diagnoses and chronic conditions for Umair. Key conditions: Antiphospholipid Syndrome / APS (2021, autoimmune clotting disorder on Warfarin), Prediabetes (persistent since 2014, HbA1c 5.8–6.2%), Metabolic Syndrome (2014, largely improved).",
    selectFields: "id, subject, condition_name, icd_code, category, diagnosed_date, diagnosed_by, status, severity, treatment_summary, notes, created_at",
    defaultSort: { column: "diagnosed_date", ascending: false },
    searchColumns: ["condition_name", "category", "notes"],
    filters: [
      { name: "subject", type: "string", description: "Person: Umair (default)" },
      { name: "category", type: "string", description: "autoimmune, metabolic, cardiovascular, musculoskeletal, other" },
      { name: "status", type: "string", description: "active, resolved, managed, monitoring" },
    ],
    dateColumn: "diagnosed_date",
  },

  eye_prescriptions: {
    description: "Eyeglass and contact lens prescriptions for Umair. Most recent: Feb 21 2026 (progressive, from Connie Kim O.D.). Prior: Apr 2, 2024 (expired Apr 2026). Tracks sphere, cylinder, axis, add power per eye.",
    selectFields: "id, subject, exam_date, expiry_date, prescriber, clinic, lens_type, od_sphere, od_cylinder, od_axis, od_add, os_sphere, os_cylinder, os_axis, os_add, pd_right, pd_left, pd_binocular, notes, created_at",
    defaultSort: { column: "exam_date", ascending: false },
    searchColumns: ["prescriber", "clinic", "lens_type", "notes"],
    filters: [
      { name: "subject", type: "string", description: "Person: Umair (default)" },
      { name: "lens_type", type: "string", description: "single_vision, progressive, reading, distance, bifocal, contact" },
    ],
    dateColumn: "exam_date",
  },

  doctor_visits: {
    description: "Doctor and clinic visits — appointment notes, vitals taken, findings, follow-ups. Covers all specialties: cardiology (Dr. at El Camino Mar 2026), primary care (Dr. Vahamaki), ophthalmology, hematology.",
    selectFields: "id, subject, visit_date, visit_time, doctor_name, specialty, clinic_name, visit_type, reason, findings, bp_systolic, bp_diastolic, pulse, weight_lbs, next_appointment, notes, created_at",
    defaultSort: { column: "visit_date", ascending: false },
    searchColumns: ["doctor_name", "specialty", "clinic_name", "reason", "findings", "notes"],
    filters: [
      { name: "subject", type: "string", description: "Person: Umair (default)" },
      { name: "specialty", type: "string", description: "cardiology, primary_care, endocrinology, ophthalmology, hematology, other" },
      { name: "visit_type", type: "string", description: "routine, follow_up, urgent, telehealth, lab_only" },
    ],
    dateColumn: "visit_date",
  },

  vehicle_log: {
    description: "Vehicle maintenance, repairs, and insurance claims. Current vehicle: Kia EV9. Open item: antenna fin insurance claim filed Mar 18 2026.",
    selectFields: "id, vehicle, log_date, log_type, title, description, cost_usd, mileage, vendor, insurance_claim_number, status, notes, created_at",
    defaultSort: { column: "log_date", ascending: false },
    searchColumns: ["title", "description", "vendor", "notes"],
    filters: [
      { name: "vehicle", type: "string", description: "Vehicle name e.g. Kia EV9" },
      { name: "log_type", type: "string", description: "maintenance, repair, insurance_claim, recall, service, incident" },
      { name: "status", type: "string", description: "open, in_progress, resolved, closed" },
    ],
    dateColumn: "log_date",
  },

  // ── ADD NEW TABLES BELOW ──────────────────────────────────
};

// ============================================================
// TYPES
// ============================================================
type ThoughtRow = {
  id?: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  similarity?: number;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

// ============================================================
// OPENROUTER HELPERS
// ============================================================
async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });

  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter embeddings failed: ${r.status} ${msg}`);
  }

  const d = await r.json();
  return d.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`,
        },
        { role: "user", content: text },
      ],
    }),
  });

  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter metadata extraction failed: ${r.status} ${msg}`);
  }

  const d = await r.json();

  try {
    return JSON.parse(d.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}

// ============================================================
// MCP SERVER
// ============================================================
const server = new McpServer({
  name: "open-brain",
  version: "2.0.0",
});

// ── THOUGHTS TOOLS ────────────────────────────────────────

server.registerTool(
  "search_thoughts",
  {
    title: "Search Thoughts",
    description:
      "Search captured thoughts by meaning. Use this when the user asks about a topic, person, or idea they've previously captured.",
    inputSchema: z.object({
      query: z.string().describe("What to search for"),
      limit: z.number().optional(),
      threshold: z.number().optional(),
    }),
  },
  async ({ query, limit, threshold }) => {
    try {
      const qEmb = await getEmbedding(query);

      const { data, error } = await supabase.rpc("match_thoughts", {
        query_embedding: qEmb,
        match_threshold: threshold,
        match_count: limit,
        filter: {},
      });

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Search error: ${error.message}` }],
          isError: true,
        };
      }

      if (!data || data.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No thoughts found matching "${query}".` }],
        };
      }

      const results = data.map((t: ThoughtRow, i: number) => {
        const m = t.metadata || {};
        const topics = asStringArray(m.topics);
        const people = asStringArray(m.people);
        const actions = asStringArray(m.action_items);

        const parts = [
          `--- Result ${i + 1} (${(((t.similarity ?? 0) * 100)).toFixed(1)}% match) ---`,
          `Captured: ${new Date(t.created_at).toLocaleDateString()}`,
          `Type: ${typeof m.type === "string" ? m.type : "unknown"}`,
        ];

        if (topics.length) parts.push(`Topics: ${topics.join(", ")}`);
        if (people.length) parts.push(`People: ${people.join(", ")}`);
        if (actions.length) parts.push(`Actions: ${actions.join("; ")}`);
        parts.push(`\n${t.content}`);

        return parts.join("\n");
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${data.length} thought(s):\n\n${results.join("\n\n")}`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "list_thoughts",
  {
    title: "List Recent Thoughts",
    description:
      "List recently captured thoughts with optional filters by type, topic, person, or time range.",
    inputSchema: z.object({
      limit: z.number().optional(),
      type: z
        .string()
        .optional()
        .describe("Filter by type: observation, task, idea, reference, person_note"),
      topic: z.string().optional().describe("Filter by topic tag"),
      person: z.string().optional().describe("Filter by person mentioned"),
      days: z.number().optional().describe("Only thoughts from the last N days"),
    }),
  },
  async ({ limit, type, topic, person, days }) => {
    try {
      let q = supabase
        .from("thoughts")
        .select("content, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (type) q = q.contains("metadata", { type });
      if (topic) q = q.contains("metadata", { topics: [topic] });
      if (person) q = q.contains("metadata", { people: [person] });
      if (days) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        q = q.gte("created_at", since.toISOString());
      }

      const { data, error } = await q;

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }

      if (!data || !data.length) {
        return {
          content: [{ type: "text" as const, text: "No thoughts found." }],
        };
      }

      const results = data.map((t: ThoughtRow, i: number) => {
        const m = t.metadata || {};
        const tags = asStringArray(m.topics).join(", ");
        const typeLabel = typeof m.type === "string" ? m.type : "??";

        return `${i + 1}. [${new Date(t.created_at).toLocaleDateString()}] (${typeLabel}${tags ? " - " + tags : ""})\n   ${t.content}`;
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `${data.length} recent thought(s):\n\n${results.join("\n\n")}`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "thought_stats",
  {
    title: "Thought Statistics",
    description: "Get a summary of all captured thoughts: totals, types, top topics, and people.",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const { count, error: countError } = await supabase
        .from("thoughts")
        .select("*", { count: "exact", head: true });

      if (countError) {
        return {
          content: [{ type: "text" as const, text: `Error: ${countError.message}` }],
          isError: true,
        };
      }

      const { data, error } = await supabase
        .from("thoughts")
        .select("metadata, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }

      const rows = data ?? [];
      const types: Record<string, number> = {};
      const topics: Record<string, number> = {};
      const people: Record<string, number> = {};

      for (const row of rows) {
        const m = (row.metadata ?? {}) as Record<string, unknown>;

        const type = typeof m.type === "string" ? m.type : "unknown";
        types[type] = (types[type] || 0) + 1;

        for (const topic of asStringArray(m.topics)) {
          topics[topic] = (topics[topic] || 0) + 1;
        }

        for (const person of asStringArray(m.people)) {
          people[person] = (people[person] || 0) + 1;
        }
      }

      const sortDesc = (obj: Record<string, number>) =>
        Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 10);

      const lines: string[] = [];
      lines.push(`Total thoughts: ${count ?? rows.length}`);

      if (rows.length > 0) {
        const newest = rows[0]?.created_at;
        const oldest = rows[rows.length - 1]?.created_at;
        if (oldest) lines.push(`Earliest: ${new Date(oldest).toLocaleDateString()}`);
        if (newest) lines.push(`Latest: ${new Date(newest).toLocaleDateString()}`);
      }

      const sortedTypes = sortDesc(types);
      if (sortedTypes.length) {
        lines.push("", "By type:");
        for (const [k, v] of sortedTypes) lines.push(`  ${k}: ${v}`);
      }

      const sortedTopics = sortDesc(topics);
      if (sortedTopics.length) {
        lines.push("", "Top topics:");
        for (const [k, v] of sortedTopics) lines.push(`  ${k}: ${v}`);
      }

      const sortedPeople = sortDesc(people);
      if (sortedPeople.length) {
        lines.push("", "People mentioned:");
        for (const [k, v] of sortedPeople) lines.push(`  ${k}: ${v}`);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "capture_thought",
  {
    title: "Capture Thought",
    description:
      "Save a new thought to the Open Brain. Generates an embedding and extracts metadata automatically. Use this when the user wants to save something to their brain directly from any AI client — notes, insights, decisions, or migrated content from other systems.",
    inputSchema: z.object({
      content: z
        .string()
        .describe(
          "The thought to capture — a clear, standalone statement that will make sense when retrieved later by any AI"
        ),
    }),
  },
  async ({ content }) => {
    try {
      // Run embedding and metadata in parallel, but treat both as optional
      // so a transient OpenRouter outage doesn't block the write entirely.
      const [embeddingResult, metadataResult] = await Promise.allSettled([
        getEmbedding(content),
        extractMetadata(content),
      ]);

      const embedding =
        embeddingResult.status === "fulfilled" ? embeddingResult.value : null;
      const metadata =
        metadataResult.status === "fulfilled"
          ? metadataResult.value
          : { topics: ["uncategorized"], type: "observation" };

      const warnings: string[] = [];
      if (embeddingResult.status === "rejected") {
        warnings.push("embedding unavailable (OpenRouter down) — thought saved but won't appear in semantic search");
      }
      if (metadataResult.status === "rejected") {
        warnings.push("metadata extraction failed — using defaults");
      }

      const { error } = await supabase.from("thoughts").insert({
        content,
        ...(embedding ? { embedding } : {}),
        metadata: { ...metadata, source: "mcp" },
      });

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Failed to capture: ${error.message}` }],
          isError: true,
        };
      }

      const meta = metadata as Record<string, unknown>;
      const topics = asStringArray(meta.topics);
      const people = asStringArray(meta.people);
      const actions = asStringArray(meta.action_items);

      let confirmation = `Captured as ${typeof meta.type === "string" ? meta.type : "thought"}`;
      if (topics.length) confirmation += ` — ${topics.join(", ")}`;
      if (people.length) confirmation += ` | People: ${people.join(", ")}`;
      if (actions.length) confirmation += ` | Actions: ${actions.join("; ")}`;
      if (warnings.length) confirmation += `\n⚠️ ${warnings.join("; ")}`;

      return {
        content: [{ type: "text" as const, text: confirmation }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "log_health_metrics",
  {
    title: "Log Health Metrics",
    description:
      "Write health metric readings to Open Brain. Use this to record glucose readings from a CGM screenshot, manual blood pressure, weight, or any health data the user provides. Accepts one or multiple readings at once. Sources: libre3, whoop, fitbit, bp_machine, lumen, mendi, withings, manual. Metric types: glucose (mg/dL), resting_heart_rate (bpm), hrv (ms), systolic/diastolic/pulse (mmHg), weight (lbs), body_fat_pct (%), steps, sleep_hours, recovery_score, strain, spo2, vo2max, respiratory_rate.",
    inputSchema: z.object({
      readings: z
        .array(
          z.object({
            recorded_at: z
              .string()
              .describe("ISO datetime or date YYYY-MM-DD (time defaults to midnight)"),
            source: z
              .string()
              .describe("Device/source: libre3, whoop, fitbit, bp_machine, manual, etc."),
            metric_type: z
              .string()
              .describe("e.g. glucose, resting_heart_rate, hrv, weight, systolic"),
            value: z.number().describe("Numeric reading"),
            unit: z
              .string()
              .describe("Unit: mg/dL, bpm, ms, lbs, %, steps, hours, mmHg, etc."),
            notes: z.string().optional().describe("Optional free-text note"),
            metadata: z
              .record(z.unknown())
              .optional()
              .describe("Optional extra fields e.g. trend, is_high, is_low"),
          })
        )
        .min(1)
        .describe("One or more readings to upsert"),
    }),
  },
  async ({ readings }) => {
    try {
      const rows = readings.map((r) => ({
        recorded_at: r.recorded_at.includes("T")
          ? r.recorded_at
          : `${r.recorded_at}T00:00:00`,
        source: r.source,
        metric_type: r.metric_type,
        value: r.value,
        unit: r.unit,
        subject: "Umair",
        notes: r.notes ?? null,
        metadata: r.metadata ?? {},
      }));

      const BATCH = 500;
      const errors: string[] = [];

      for (let i = 0; i < rows.length; i += BATCH) {
        const { error } = await supabase
          .from("health_metrics")
          .upsert(rows.slice(i, i + BATCH), {
            onConflict: "recorded_at,source,metric_type",
            ignoreDuplicates: false,
          });

        if (error) errors.push(error.message);
      }

      if (errors.length) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Partial failure: ${errors.join("; ")}`,
            },
          ],
          isError: true,
        };
      }

      const summary = readings
        .slice(0, 5)
        .map((r) => `${r.recorded_at} ${r.metric_type}=${r.value}${r.unit}`)
        .join(", ");

      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Logged ${readings.length} reading(s): ${summary}${readings.length > 5 ? "..." : ""}`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [
          { type: "text" as const, text: `Error: ${(err as Error).message}` },
        ],
        isError: true,
      };
    }
  }
);

// ── KIDS / SCOUTS / COLLEGE PREP WRITE TOOLS ─────────────

server.registerTool(
  "update_scout_progress",
  {
    title: "Update Scout Progress",
    description:
      "Update Eagle Scout progress for Nyel or Emaad. Use this when rank advances, merit badges are earned, camping/service/hiking stats are updated, or Eagle project status changes. All fields are optional — only provided fields are updated.",
    inputSchema: z.object({
      kid_name: z.string().describe("Kid's name: Nyel or Emaad"),
      current_rank: z
        .string()
        .optional()
        .describe("New rank: Scout, Tenderfoot, 2nd Class, 1st Class, Star, Life, Eagle"),
      rank_date: z.string().optional().describe("Date rank was achieved YYYY-MM-DD"),
      merit_badges_completed: z.number().optional().describe("Total merit badges completed"),
      eagle_required_badges_done: z.number().optional().describe("Eagle-required badges completed"),
      camping_nights: z.number().optional().describe("Total camping nights"),
      hiking_miles: z.number().optional().describe("Total hiking miles"),
      service_hours: z.number().optional().describe("Total service hours"),
      leadership_role: z.string().optional().describe("Current leadership role e.g. SPL, ASPL, Quartermaster"),
      nylt_completed: z.boolean().optional().describe("Whether NYLT training is completed"),
      eagle_project_status: z
        .string()
        .optional()
        .describe("Eagle project status: not_started, planning, approved, in_progress, completed"),
      notes: z.string().optional().describe("Any additional notes"),
    }),
  },
  async (params) => {
    try {
      const { kid_name, ...updates } = params;
      const updateData: Record<string, unknown> = {
        ...updates,
        as_of_date: new Date().toISOString().split("T")[0],
        updated_at: new Date().toISOString(),
      };
      // Remove undefined fields
      Object.keys(updateData).forEach((k) => updateData[k] === undefined && delete updateData[k]);

      const { error } = await supabase
        .from("scout_progress")
        .upsert({ kid_name, ...updateData }, { onConflict: "kid_name" });

      if (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }

      const changed = Object.entries(updates)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      return { content: [{ type: "text" as const, text: `✅ ${kid_name} scout progress updated: ${changed}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "log_merit_badge",
  {
    title: "Log Merit Badge",
    description:
      "Record a completed merit badge for Nyel or Emaad. Can also be used to log a badge that's in-progress by omitting the completed_date.",
    inputSchema: z.object({
      kid_name: z.string().describe("Kid's name: Nyel or Emaad"),
      badge_name: z.string().describe("Badge name e.g. 'First Aid', 'Citizenship in the Nation'"),
      is_eagle_required: z.boolean().optional().describe("Is this an Eagle-required badge?"),
      completed_date: z.string().optional().describe("Completion date YYYY-MM-DD (omit if still in progress)"),
      counselor: z.string().optional().describe("Merit badge counselor name"),
      notes: z.string().optional(),
    }),
  },
  async ({ kid_name, badge_name, is_eagle_required, completed_date, counselor, notes }) => {
    try {
      const { error } = await supabase.from("scout_merit_badges").upsert(
        { kid_name, badge_name, is_eagle_required: is_eagle_required ?? false, completed_date: completed_date ?? null, counselor: counselor ?? null, notes: notes ?? null },
        { onConflict: "kid_name,badge_name" }
      );

      if (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }

      return {
        content: [{
          type: "text" as const,
          text: `✅ ${kid_name}: "${badge_name}" badge logged${completed_date ? ` (completed ${completed_date})` : " (in progress)"}${is_eagle_required ? " — Eagle required" : ""}`,
        }],
      };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "update_college_milestone",
  {
    title: "Update College Prep Milestone",
    description:
      "Mark a college prep milestone as completed, in-progress, or skipped for Nyel or Emaad. Also use this to add new milestones not already in the timeline.",
    inputSchema: z.object({
      kid_name: z.string().describe("Kid's name: Nyel or Emaad"),
      task: z.string().describe("Milestone task description (should match existing task or be new)"),
      status: z
        .string()
        .describe("New status: pending, in_progress, completed, skipped"),
      phase: z.string().optional().describe("Phase: sophomore, junior, senior, summer_2026, summer_2027"),
      deadline_date: z.string().optional().describe("Deadline date YYYY-MM-DD"),
      completed_date: z.string().optional().describe("Actual completion date YYYY-MM-DD"),
      priority: z.string().optional().describe("Priority: high, normal, low"),
      notes: z.string().optional(),
    }),
  },
  async ({ kid_name, task, status, phase, deadline_date, completed_date, priority, notes }) => {
    try {
      // Try to find existing milestone by kid_name + task
      const { data: existing } = await supabase
        .from("college_prep_timeline")
        .select("id")
        .eq("kid_name", kid_name)
        .ilike("task", `%${task}%`)
        .limit(1)
        .single();

      const payload: Record<string, unknown> = {
        kid_name,
        task,
        status,
        updated_at: new Date().toISOString(),
        ...(phase && { phase }),
        ...(deadline_date && { deadline_date }),
        ...(completed_date && { completed_date }),
        ...(priority && { priority }),
        ...(notes && { notes }),
      };

      let error;
      if (existing?.id) {
        ({ error } = await supabase
          .from("college_prep_timeline")
          .update(payload)
          .eq("id", existing.id));
      } else {
        ({ error } = await supabase.from("college_prep_timeline").insert(payload));
      }

      if (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }

      return {
        content: [{
          type: "text" as const,
          text: `✅ ${kid_name}: "${task}" → ${status}${completed_date ? ` on ${completed_date}` : ""}`,
        }],
      };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "log_college_activity",
  {
    title: "Log College Prep Activity",
    description:
      "Log a college prep activity for Nyel or Emaad — dental/medical shadowing hours, volunteer work, test scores, extracurriculars, summer programs, courses, or awards. Each entry is a new log record.",
    inputSchema: z.object({
      kid_name: z.string().describe("Kid's name: Nyel or Emaad"),
      activity_type: z
        .string()
        .describe("Type: shadowing, volunteer, extracurricular, summer_program, test_score, course, award"),
      title: z.string().describe("Activity title e.g. 'Dental shadowing at Dr. Smith', 'SAT exam', 'Science Olympiad'"),
      activity_date: z.string().optional().describe("Date YYYY-MM-DD"),
      hours: z.number().optional().describe("Hours logged (for shadowing/volunteer)"),
      score: z.string().optional().describe("Score or result e.g. '1350', '34', 'Gold medal'"),
      location: z.string().optional().describe("Location or school"),
      notes: z.string().optional(),
    }),
  },
  async ({ kid_name, activity_type, title, activity_date, hours, score, location, notes }) => {
    try {
      const { error } = await supabase.from("college_prep_log").insert({
        kid_name,
        activity_type,
        title,
        activity_date: activity_date ?? null,
        hours: hours ?? null,
        score: score ?? null,
        location: location ?? null,
        notes: notes ?? null,
      });

      if (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }

      const details = [
        hours ? `${hours}hrs` : null,
        score ? `score: ${score}` : null,
        location || null,
      ].filter(Boolean).join(", ");

      return {
        content: [{
          type: "text" as const,
          text: `✅ ${kid_name}: logged ${activity_type} — "${title}"${details ? ` (${details})` : ""}${activity_date ? ` on ${activity_date}` : ""}`,
        }],
      };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "log_lab_results",
  {
    title: "Log Lab Results",
    description:
      "Record medical lab results for Umair or family. Use when the user shares lab work, blood test results, or medical panels. Accepts one or multiple markers at once. Examples: HbA1c, ALT, LDL, Hemoglobin, Vitamin B12, Creatinine.",
    inputSchema: z.object({
      results: z.array(z.object({
        subject: z.string().optional(),
        test_date: z.string().describe("Test date YYYY-MM-DD"),
        panel: z.string().optional().describe("Panel name: CBC, CMP, Lipid, Liver, HbA1c, Vitamins"),
        marker: z.string().describe("Lab marker name e.g. HbA1c, ALT, LDL, Hemoglobin"),
        value: z.number().describe("Numeric result value"),
        unit: z.string().optional().describe("Unit e.g. %, mg/dL, g/dL, U/L, nmol/L"),
        reference_low: z.number().optional(),
        reference_high: z.number().optional(),
        is_flagged: z.boolean().optional().describe("true if lab flagged as HIGH or LOW"),
        flag: z.string().optional().describe("HIGH, LOW, or null"),
        lab_name: z.string().optional(),
        notes: z.string().optional(),
      })).min(1),
    }),
  },
  async ({ results }) => {
    try {
      const rows = results.map((r) => ({
        subject: r.subject ?? "Umair",
        test_date: r.test_date,
        panel: r.panel ?? null,
        marker: r.marker,
        value: r.value,
        unit: r.unit ?? null,
        reference_low: r.reference_low ?? null,
        reference_high: r.reference_high ?? null,
        is_flagged: r.is_flagged ?? false,
        flag: r.flag ?? null,
        lab_name: r.lab_name ?? null,
        notes: r.notes ?? null,
      }));

      const { error } = await supabase
        .from("lab_results")
        .upsert(rows, { onConflict: "subject,test_date,marker", ignoreDuplicates: false });

      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };

      const summary = results.slice(0, 5).map((r) => `${r.marker}=${r.value}${r.unit ?? ""}`).join(", ");
      return { content: [{ type: "text" as const, text: `✅ Logged ${results.length} lab result(s) for ${results[0].test_date}: ${summary}${results.length > 5 ? "..." : ""}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "log_meal",
  {
    title: "Log Meal",
    description:
      "Log a meal or food item to the diet log. Use when the user describes what they ate, shares a meal photo, or logs food manually. Each call logs one food item — call multiple times for a full meal. Critical for correlating glucose readings with food intake.",
    inputSchema: z.object({
      meal_time: z.string().describe("Datetime YYYY-MM-DDTHH:MM or date YYYY-MM-DD"),
      meal_type: z.string().describe("breakfast, lunch, dinner, snack, fast_break"),
      food_name: z.string().describe("Food name e.g. 'Oatmeal with berries', 'Chicken rice bowl'"),
      calories: z.number().optional(),
      carbs_g: z.number().optional(),
      protein_g: z.number().optional(),
      fat_g: z.number().optional(),
      fiber_g: z.number().optional(),
      sugar_g: z.number().optional(),
      glycemic_index: z.number().optional().describe("Glycemic index 0-100"),
      portion_size: z.string().optional().describe("e.g. '1 cup', '200g', 'large plate'"),
      subject: z.string().optional(),
      notes: z.string().optional(),
    }),
  },
  async ({ meal_time, meal_type, food_name, calories, carbs_g, protein_g, fat_g, fiber_g, sugar_g, glycemic_index, portion_size, subject, notes }) => {
    try {
      const meal_time_iso = meal_time.includes("T") ? meal_time : `${meal_time}T12:00:00`;
      const { error } = await supabase.from("diet_log").insert({
        subject: subject ?? "Umair",
        meal_time: meal_time_iso,
        meal_type,
        food_name,
        calories: calories ?? null,
        carbs_g: carbs_g ?? null,
        protein_g: protein_g ?? null,
        fat_g: fat_g ?? null,
        fiber_g: fiber_g ?? null,
        sugar_g: sugar_g ?? null,
        glycemic_index: glycemic_index ?? null,
        portion_size: portion_size ?? null,
        notes: notes ?? null,
        source: "chatgpt",
      });

      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };

      const macros = [
        calories ? `${calories}kcal` : null,
        carbs_g ? `carbs ${carbs_g}g` : null,
        protein_g ? `protein ${protein_g}g` : null,
      ].filter(Boolean).join(", ");

      return { content: [{ type: "text" as const, text: `✅ Logged ${meal_type}: ${food_name}${macros ? ` (${macros})` : ""}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "log_income",
  {
    title: "Log Income",
    description: "Log an income entry for tax tracking. Use for W2 salary, RSU vests, bonuses, dividends, or any other income source. Requires a 6-digit Google Authenticator code (totp_code) for security.",
    inputSchema: z.object({
      totp_code: z.string().describe("6-digit code from Google Authenticator (Open Brain entry)"),
      income_date: z.string().describe("Date YYYY-MM-DD"),
      tax_year: z.number().describe("Tax year e.g. 2025"),
      source: z.string().describe("Source e.g. 'Google W2', 'Google RSU', 'Bonus Q1', 'Dividends'"),
      income_type: z.string().describe("w2, rsu, bonus, dividend, capital_gains, rental, other"),
      gross_amount: z.number().describe("Gross amount before tax"),
      net_amount: z.number().optional().describe("Net amount after withholding if known"),
      is_taxable: z.boolean().optional(),
      notes: z.string().optional(),
    }),
  },
  async ({ totp_code, income_date, tax_year, source, income_type, gross_amount, net_amount, is_taxable, notes }) => {
    if (!await verifyTOTP(totp_code)) return totpError();
    try {
      const { error } = await supabase.from("finance_income").insert({
        income_date, tax_year, source, income_type, gross_amount,
        net_amount: net_amount ?? null,
        is_taxable: is_taxable ?? true,
        notes: notes ?? null,
      });
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: "text" as const, text: `✅ Logged income: ${source} $${gross_amount.toLocaleString()} (${income_type}) for tax year ${tax_year}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "log_donation",
  {
    title: "Log Charitable Donation",
    description:
      "Log a charitable donation for tax deduction tracking. Supports Zakat (Islamic obligatory giving, 2.5% of qualifying wealth, paid during Ramadan), Sadaqa (voluntary Islamic giving), and general charity. Use giving_category to distinguish. DAF contributions (stock redirected to DAF) and DAF grants (DAF paying out to charities) are tracked separately via donation_type. Key for tax bracket optimization — bunching donations reduces AGI below the $400k Child Tax Credit phase-out threshold.",
    inputSchema: z.object({
      totp_code: z.string().describe("6-digit code from Google Authenticator (Open Brain entry)"),
      donation_date: z.string().describe("Date YYYY-MM-DD"),
      tax_year: z.number().describe("Tax year e.g. 2025"),
      charity_name: z.string().describe("Charity, mosque, or DAF account name"),
      donation_type: z.string().describe("cash, stock, daf_contribution, daf_grant"),
      giving_category: z.string().describe("zakat, sadaqa, or general_charity"),
      amount: z.number().describe("Cash value of donation or FMV of stock"),
      fair_market_value: z.number().optional().describe("For stock donations: FMV at time of donation"),
      cost_basis: z.number().optional().describe("For stock donations: original cost basis (avoids capital gains)"),
      daf_account: z.string().optional().describe("DAF account name e.g. 'Fidelity Charitable'"),
      islamic_year: z.number().optional().describe("Hijri year e.g. 1446 (2025), 1447 (2026) — use for Zakat"),
      zakat_asset_type: z.string().optional().describe("For Zakat: savings, investments, gold, business"),
      is_tax_deductible: z.boolean().optional(),
      notes: z.string().optional(),
    }),
  },
  async ({ totp_code, donation_date, tax_year, charity_name, donation_type, giving_category, amount, fair_market_value, cost_basis, daf_account, islamic_year, zakat_asset_type, is_tax_deductible, notes }) => {
    if (!await verifyTOTP(totp_code)) return totpError();
    try {
      const { error } = await supabase.from("finance_donations").insert({
        donation_date, tax_year, charity_name, donation_type,
        giving_category: giving_category ?? "general_charity",
        amount,
        fair_market_value: fair_market_value ?? null,
        cost_basis: cost_basis ?? null,
        daf_account: daf_account ?? null,
        islamic_year: islamic_year ?? null,
        zakat_asset_type: zakat_asset_type ?? null,
        is_tax_deductible: is_tax_deductible ?? true,
        notes: notes ?? null,
      });
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };

      const label = giving_category === "zakat" ? "Zakat" : giving_category === "sadaqa" ? "Sadaqa" : "Donation";
      const islamicNote = islamic_year ? ` (${islamic_year} AH)` : "";
      return { content: [{ type: "text" as const, text: `✅ ${label} logged: $${amount.toLocaleString()} to ${charity_name} via ${donation_type}${islamicNote} — tax year ${tax_year}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "log_net_worth",
  {
    title: "Log Net Worth Snapshot",
    description: "Record a monthly net worth snapshot with breakdown of assets and liabilities. Requires a 6-digit Google Authenticator code (totp_code) for security.",
    inputSchema: z.object({
      totp_code: z.string().describe("6-digit code from Google Authenticator (Open Brain entry)"),
      snapshot_date: z.string().describe("Date YYYY-MM-DD (use first of month)"),
      liquid_cash: z.number().optional(),
      checking_savings: z.number().optional(),
      brokerage: z.number().optional(),
      retirement_401k: z.number().optional(),
      retirement_ira: z.number().optional(),
      home_equity: z.number().optional(),
      other_assets: z.number().optional(),
      mortgage_balance: z.number().optional(),
      other_liabilities: z.number().optional(),
      notes: z.string().optional(),
    }),
  },
  async (params) => {
    if (!await verifyTOTP(params.totp_code)) return totpError();
    try {
      const { totp_code: _t, snapshot_date, notes, ...assets } = params;
      const total_assets = (assets.liquid_cash ?? 0) + (assets.checking_savings ?? 0) + (assets.brokerage ?? 0) + (assets.retirement_401k ?? 0) + (assets.retirement_ira ?? 0) + (assets.home_equity ?? 0) + (assets.other_assets ?? 0);
      const total_liabilities = (assets.mortgage_balance ?? 0) + (assets.other_liabilities ?? 0);
      const net_worth = total_assets - total_liabilities;

      const { error } = await supabase.from("finance_net_worth").upsert({
        snapshot_date, ...assets, total_assets, total_liabilities, net_worth, notes: notes ?? null,
      }, { onConflict: "snapshot_date" });

      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: "text" as const, text: `✅ Net worth snapshot: $${net_worth.toLocaleString()} (assets $${total_assets.toLocaleString()} - liabilities $${total_liabilities.toLocaleString()})` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "log_family_event",
  {
    title: "Log Family Event",
    description: "Log a family calendar event — medical appointments, school events, milestones, travel, religious events.",
    inputSchema: z.object({
      event_date: z.string().describe("Date YYYY-MM-DD"),
      title: z.string().describe("Event title"),
      category: z.string().describe("medical, school, sports, religious, travel, milestone, financial"),
      people: z.array(z.string()).optional().describe("Family members involved e.g. ['Nyel', 'Emaad']"),
      event_time: z.string().optional().describe("Time HH:MM"),
      location: z.string().optional(),
      status: z.string().optional(),
      notes: z.string().optional(),
    }),
  },
  async ({ event_date, title, category, people, event_time, location, status, notes }) => {
    try {
      const { error } = await supabase.from("family_events").insert({
        event_date, title, category,
        people: people ?? null,
        event_time: event_time ?? null,
        location: location ?? null,
        status: status ?? "upcoming",
        notes: notes ?? null,
      });
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: "text" as const, text: `✅ Event logged: "${title}" on ${event_date}${people?.length ? ` (${people.join(", ")})` : ""}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "update_goal",
  {
    title: "Update Goal",
    description: "Create or update a personal goal — health targets (HbA1c, weight, HRV), financial targets (net worth, savings rate), family goals, career goals.",
    inputSchema: z.object({
      title: z.string().describe("Goal title e.g. 'Reduce HbA1c below 5.7', 'Max 401k contributions'"),
      category: z.string().describe("health, financial, family, career, education"),
      status: z.string().optional().describe("active, achieved, abandoned"),
      target_value: z.number().optional(),
      current_value: z.number().optional(),
      unit: z.string().optional().describe("Unit e.g. %, $, bpm, lbs"),
      target_date: z.string().optional().describe("Target date YYYY-MM-DD"),
      priority: z.string().optional(),
      subject: z.string().optional(),
      description: z.string().optional(),
      notes: z.string().optional(),
    }),
  },
  async ({ title, category, status, target_value, current_value, unit, target_date, priority, subject, description, notes }) => {
    try {
      const { data: existing } = await supabase
        .from("goals").select("id").eq("subject", subject ?? "Umair").ilike("title", `%${title}%`).limit(1).single();

      const payload = {
        subject: subject ?? "Umair", title, category,
        status: status ?? "active",
        target_value: target_value ?? null,
        current_value: current_value ?? null,
        unit: unit ?? null,
        target_date: target_date ?? null,
        priority: priority ?? "normal",
        description: description ?? null,
        notes: notes ?? null,
        updated_at: new Date().toISOString(),
      };

      const { error } = existing?.id
        ? await supabase.from("goals").update(payload).eq("id", existing.id)
        : await supabase.from("goals").insert(payload);

      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: "text" as const, text: `✅ Goal ${existing?.id ? "updated" : "created"}: "${title}" — ${status ?? "active"}${target_value ? ` (target: ${target_value}${unit ?? ""})` : ""}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "calculate_tax_bracket",
  {
    title: "Calculate Tax Bracket & Optimization",
    description:
      "Calculate current tax bracket, marginal rate, and optimization opportunities. Shows how much to donate to drop below Child Tax Credit phase-out ($400k MFJ) or next bracket threshold. Call this when the user asks about taxes, bracket, donations, or tax planning.",
    inputSchema: z.object({
      tax_year: z.number().describe("Tax year e.g. 2025"),
    }),
  },
  async ({ tax_year }) => {
    try {
      // Fetch tax profile
      const { data: profile } = await supabase
        .from("finance_tax_profile").select("*").eq("tax_year", tax_year).single();

      // Sum income for the year
      const { data: incomeRows } = await supabase
        .from("finance_income").select("gross_amount, is_taxable").eq("tax_year", tax_year);

      // Sum donations for the year — broken out by giving category
      const { data: donationRows } = await supabase
        .from("finance_donations").select("amount, is_tax_deductible, giving_category, donation_type").eq("tax_year", tax_year);

      const totalGross = (incomeRows ?? []).filter((r: Record<string, unknown>) => r.is_taxable).reduce((s: number, r: Record<string, unknown>) => s + (r.gross_amount as number), 0);
      const allDonations = donationRows ?? [] as Record<string, unknown>[];
      const deductible = allDonations.filter((r: Record<string, unknown>) => r.is_tax_deductible);
      const totalDonations = deductible.reduce((s: number, r: Record<string, unknown>) => s + (r.amount as number), 0);
      const zakatTotal = deductible.filter((r: Record<string, unknown>) => r.giving_category === "zakat").reduce((s: number, r: Record<string, unknown>) => s + (r.amount as number), 0);
      const sadaqaTotal = deductible.filter((r: Record<string, unknown>) => r.giving_category === "sadaqa").reduce((s: number, r: Record<string, unknown>) => s + (r.amount as number), 0);
      const generalTotal = deductible.filter((r: Record<string, unknown>) => r.giving_category === "general_charity" || !r.giving_category).reduce((s: number, r: Record<string, unknown>) => s + (r.amount as number), 0);
      const dafContributions = deductible.filter((r: Record<string, unknown>) => r.donation_type === "daf_contribution").reduce((s: number, r: Record<string, unknown>) => s + (r.amount as number), 0);

      const agi = profile?.estimated_agi ?? (totalGross - (profile?.pre_tax_deductions ?? 0));
      const standardDeduction = 30000; // 2025 MFJ
      const itemized = profile?.itemized_deductions ?? totalDonations;
      const deduction = Math.max(itemized, standardDeduction);
      const taxableIncome = Math.max(0, agi - deduction);

      // 2025 MFJ brackets
      const brackets = [
        { rate: 0.10, min: 0, max: 23200 },
        { rate: 0.12, min: 23200, max: 94300 },
        { rate: 0.22, min: 94300, max: 201050 },
        { rate: 0.24, min: 201050, max: 383900 },
        { rate: 0.32, min: 383900, max: 487450 },
        { rate: 0.35, min: 487450, max: 731200 },
        { rate: 0.37, min: 731200, max: Infinity },
      ];

      const currentBracket = brackets.find((b) => taxableIncome >= b.min && taxableIncome < b.max) ?? brackets[brackets.length - 1];
      const nextBracket = brackets[brackets.indexOf(currentBracket) + 1];

      // Child Tax Credit phase-out (AGI basis, not taxable income)
      const ctcPhaseoutStart = 400000;
      const ctcPerChild = 2000;
      const numChildren = 3;
      const maxCTC = ctcPerChild * numChildren; // $6,000
      const ctcPhaseoutAmount = Math.max(0, Math.ceil((agi - ctcPhaseoutStart) / 1000) * 50);
      const actualCTC = Math.max(0, maxCTC - ctcPhaseoutAmount);
      const lostCTC = maxCTC - actualCTC;

      // How much donation needed to recover CTC
      const donationToRecoverCTC = agi > ctcPhaseoutStart ? agi - ctcPhaseoutStart : 0;
      const donationToNextBracket = nextBracket ? taxableIncome - currentBracket.min : 0;

      const lines = [
        `Tax Year ${tax_year} (Married Filing Jointly)`,
        ``,
        `Income & AGI:`,
        `  Gross income tracked: $${totalGross.toLocaleString()}`,
        `  Pre-tax deductions: $${(profile?.pre_tax_deductions ?? 0).toLocaleString()}`,
        `  Estimated AGI: $${agi.toLocaleString()}`,
        `  Deduction used: $${deduction.toLocaleString()} (${itemized > standardDeduction ? "itemized" : "standard"})`,
        `  Taxable income: $${taxableIncome.toLocaleString()}`,
        ``,
        `Tax Bracket:`,
        `  Current bracket: ${(currentBracket.rate * 100).toFixed(0)}% ($${currentBracket.min.toLocaleString()} - ${currentBracket.max === Infinity ? "+" : "$" + currentBracket.max.toLocaleString()})`,
        nextBracket ? `  Distance to next bracket (${(nextBracket.rate * 100).toFixed(0)}%): $${(currentBracket.max - taxableIncome).toLocaleString()} of taxable income` : "",
        ``,
        `Child Tax Credit (3 kids, max $${maxCTC.toLocaleString()}):`,
        `  AGI phase-out threshold: $400,000`,
        `  Your AGI: $${agi.toLocaleString()}`,
        `  CTC received: $${actualCTC.toLocaleString()} (lost: $${lostCTC.toLocaleString()})`,
        lostCTC > 0 ? `  To recover full CTC: reduce AGI by $${donationToRecoverCTC.toLocaleString()} via donations/deductions` : "  Full CTC received!",
        ``,
        `Charitable Giving (tax year ${tax_year}):`,
        `  Total deductible donations: $${totalDonations.toLocaleString()}`,
        zakatTotal > 0 ? `    Zakat: $${zakatTotal.toLocaleString()}` : "",
        sadaqaTotal > 0 ? `    Sadaqa: $${sadaqaTotal.toLocaleString()}` : "",
        generalTotal > 0 ? `    General charity: $${generalTotal.toLocaleString()}` : "",
        dafContributions > 0 ? `    DAF contributions (deductible in year given): $${dafContributions.toLocaleString()}` : "",
        ``,
        `Optimization:`,
        lostCTC > 0 ? `  Donate $${donationToRecoverCTC.toLocaleString()} more to recover $${lostCTC.toLocaleString()} CTC` : "  Full CTC received!",
        `  Ramadan ${tax_year}: redirect stock gains to DAF for Zakat — avoid cap gains + get full FMV deduction`,
        `  DAF strategy: contribute appreciated stock now, grant to charities/mosques over time`,
        `  Note: DAF grants to mosques are deductible if mosque is 501(c)(3)`,
      ].filter((l) => l !== "");

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ── AUTO-GENERATED TOOLS FROM TABLE REGISTRY ─────────────

for (const [tableName, config] of Object.entries(TABLE_REGISTRY)) {
  const listSchema: Record<string, z.ZodTypeAny> = {
    limit: z.number().optional(),
  };
  if (config.dateColumn) {
    listSchema.days      = z.number().optional().describe(`Only records from the last N days`);
    listSchema.date_from = z.string().optional().describe("Start date YYYY-MM-DD");
    listSchema.date_to   = z.string().optional().describe("End date YYYY-MM-DD");
  }

  for (const f of config.filters) {
    listSchema[f.name] =
      f.type === "number"
        ? z.number().optional().describe(f.description)
        : f.type === "boolean"
        ? z.boolean().optional().describe(f.description)
        : z.string().optional().describe(f.description);
  }

  // SEARCH tool
  server.registerTool(
    `search_${tableName}`,
    {
      title: `Search ${tableName.replace(/_/g, " ")}`,
      description: `Search ${config.description}`,
      inputSchema: z.object({
        query: z.string().describe(`Text to search for in ${config.searchColumns.join(", ")}`),
        limit: z.number().optional(),
      }),
    },
    async ({ query, limit }: { query: string; limit?: number }) => {
      try {
        const effectiveLimit = limit ?? 20;

        const orFilter = config.searchColumns
          .map((col) => `${col}.ilike.%${query}%`)
          .join(",");

        const { data, error } = await supabase
          .from(tableName)
          .select(config.selectFields)
          .or(orFilter)
          .order(config.defaultSort.column, { ascending: config.defaultSort.ascending })
          .limit(effectiveLimit);

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Search error: ${error.message}` }],
            isError: true,
          };
        }

        if (!data || data.length === 0) {
          return {
            content: [
              { type: "text" as const, text: `No ${tableName} records found matching "${query}".` },
            ],
          };
        }

        const rows = data.map((row: Record<string, unknown>, i: number) => {
          const fields = config.selectFields
            .split(",")
            .map((f) => f.trim())
            .filter((f) => f !== "id");
          const parts = fields.map((f) => `${f}: ${row[f] ?? ""}`);
          return `${i + 1}. ${parts.join(" | ")}`;
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${data.length} record(s) in ${tableName}:\n\n${rows.join("\n")}`,
            },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // LIST tool
  server.registerTool(
    `list_${tableName}`,
    {
      title: `List ${tableName.replace(/_/g, " ")}`,
      description: `List records from ${config.description}`,
      inputSchema: z.object(listSchema),
    },
    async (params: Record<string, unknown>) => {
      try {
        const limit = typeof params.limit === "number" ? params.limit : 20;

        let q = supabase
          .from(tableName)
          .select(config.selectFields)
          .order(config.defaultSort.column, { ascending: config.defaultSort.ascending })
          .limit(limit);

        // Apply registered filters — coerce types to avoid string/int/bool mismatch
        for (const f of config.filters) {
          if (params[f.name] !== undefined && params[f.name] !== null) {
            const val =
              f.type === "number"
                ? Number(params[f.name])
                : f.type === "boolean"
                ? Boolean(params[f.name])
                : params[f.name];
            q = q.eq(f.name, val);
          }
        }

        // Apply date filters
        if (config.dateColumn) {
          if (typeof params.days === "number") {
            const since = new Date();
            since.setDate(since.getDate() - params.days);
            q = q.gte(config.dateColumn, since.toISOString().split("T")[0]);
          }
          if (typeof params.date_from === "string") {
            q = q.gte(config.dateColumn, params.date_from);
          }
          if (typeof params.date_to === "string") {
            q = q.lte(config.dateColumn, params.date_to);
          }
        }

        const { data, error } = await q;

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Error: ${error.message}` }],
            isError: true,
          };
        }

        if (!data || data.length === 0) {
          return {
            content: [{ type: "text" as const, text: `No records found in ${tableName}.` }],
          };
        }

        const fields = config.selectFields
          .split(",")
          .map((f) => f.trim())
          .filter((f) => f !== "id");

        const rows = data.map((row: Record<string, unknown>, i: number) => {
          const parts = fields.map((f) => `${f}: ${row[f] ?? ""}`);
          return `${i + 1}. ${parts.join(" | ")}`;
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `${data.length} record(s) from ${tableName}:\n\n${rows.join("\n")}`,
            },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );
}

// ── HONO APP ──────────────────────────────────────────────
const app = new Hono();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

app.options("*", (c) => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
});

app.all("*", async (c) => {
  // Accept key via Authorization header, ?key= or ?apikey= query param
  const url = new URL(c.req.url);
  const queryKey = url.searchParams.get("key") ?? url.searchParams.get("apikey");
  const authHeader = c.req.header("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "") || queryKey || "";

  if (token !== MCP_ACCESS_KEY && token !== SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  const response = await transport.handleRequest(c);
  // Attach CORS headers to every response
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    response.headers.set(k, v);
  }
  return response;
});

Deno.serve(app.fetch);
