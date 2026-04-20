#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://epckjiufeimydxmcrfus.supabase.co";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVwY2tqaXVmZWlteWR4bWNyZnVzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzc4MTA3NCwiZXhwIjoyMDg5MzU3MDc0fQ.5KG6i-1Y9Z1bn0pSoGz2aanEIyQwRsLzyHc9tqffl5A";
const db = createClient(SUPABASE_URL, SERVICE_KEY);

async function insert(table, rows, label) {
  const { data, error } = await db.from(table).insert(rows).select("id");
  if (error) {
    console.error(`❌ ${label}: ${error.message}`);
    return 0;
  }
  console.log(`✅ ${label}: inserted ${data.length} row(s)`);
  return data.length;
}

// ─── MEDICATIONS ──────────────────────────────────────────────
await insert("medications", [
  {
    subject: "Umair",
    drug_name: "Warfarin",
    dose: "10mg",
    frequency: "daily",
    condition: "Antiphospholipid Syndrome (APS) — anticoagulation to prevent dangerous clotting",
    prescribing_doctor: null,
    start_date: "2021-01-01",
    is_active: true,
    notes: "INR monitored regularly; target range 2.0–3.0. Do not adjust dose without INR check.",
  },
  {
    subject: "Umair",
    drug_name: "Lisinopril",
    dose: "10mg",
    frequency: "daily",
    condition: "Blood pressure management / hypertension",
    start_date: "2021-01-01",
    is_active: true,
    notes: null,
  },
  {
    subject: "Umair",
    drug_name: "Aspirin",
    dose: "81mg",
    frequency: "daily",
    condition: "Antiplatelet / cardiovascular heart health (APS management)",
    start_date: "2021-01-01",
    is_active: true,
    notes: "Low-dose aspirin; combined with Warfarin for APS management.",
  },
  {
    subject: "Umair",
    drug_name: "Atorvastatin (Lipitor)",
    dose: "80mg",
    frequency: "daily",
    condition: "Hyperlipidemia — cholesterol reduction",
    start_date: "2021-01-01",
    is_active: true,
    notes: "High-dose statin. Dramatically improved lipid panel: cholesterol 207 → 126, LDL 137 → 70. Monitor liver enzymes (ALT near upper limit Feb 2026).",
  },
], "medications (4 active meds)");

// ─── MEDICAL CONDITIONS ───────────────────────────────────────
await insert("medical_conditions", [
  {
    subject: "Umair",
    condition_name: "Antiphospholipid Syndrome (APS)",
    icd_code: "D68.61",
    category: "autoimmune",
    diagnosed_date: "2021-01-01",
    status: "active",
    severity: "moderate",
    treatment_summary: "Warfarin 10mg + Aspirin 81mg for anticoagulation. INR monitored regularly (target 2.0–3.0).",
    notes: "Autoimmune condition causing blood to clot more easily. Long-term anticoagulation required. INR stable at 2–3.",
  },
  {
    subject: "Umair",
    condition_name: "Prediabetes / Insulin Resistance",
    icd_code: "R73.09",
    category: "metabolic",
    diagnosed_date: "2014-05-07",
    status: "active",
    severity: "mild",
    treatment_summary: "Diet management, intermittent fasting (16–20h), CGM Libre3 monitoring, weight loss target <200 lbs.",
    notes: "HbA1c persistently 5.8–6.2% since 2014. HOMA-IR 3.1 in 2014. No medication. Managed via lifestyle. CGM shows post-meal spikes to 130–170 mg/dL.",
  },
  {
    subject: "Umair",
    condition_name: "Hypertension",
    icd_code: "I10",
    category: "cardiovascular",
    diagnosed_date: "2021-01-01",
    status: "managed",
    severity: "mild",
    treatment_summary: "Lisinopril 10mg daily. Home BP monitoring. Target <130/80.",
    notes: "Recent readings: 131/88 (Mar 18), 110/76 (Mar 19), 121/81 (Mar 23), 106/70 at cardiologist (Mar 23). Generally controlled.",
  },
  {
    subject: "Umair",
    condition_name: "Hyperlipidemia",
    icd_code: "E78.5",
    category: "metabolic",
    diagnosed_date: "2014-05-07",
    status: "managed",
    severity: "severe",
    treatment_summary: "Atorvastatin 80mg daily. Lipid panel dramatically improved since starting statin.",
    notes: "Pre-statin (May 2021): cholesterol 207, LDL 137, TG 167, HDL 37. Current (Jan 2026): cholesterol 126, LDL 70, TG 66, HDL 43. Excellent response to Lipitor 80mg.",
  },
  {
    subject: "Umair",
    condition_name: "Metabolic Syndrome (historical)",
    icd_code: "E88.81",
    category: "metabolic",
    diagnosed_date: "2014-05-07",
    status: "monitoring",
    severity: "moderate",
    treatment_summary: "Largely improved through medication, diet, and exercise. Prediabetes component persists.",
    notes: "2014 markers: insulin resistance (HOMA-IR 3.1), dyslipidemia (high TG/low HDL), elevated hs-CRP 2.2, low Vitamin D. Most markers normalized except glucose/HbA1c.",
  },
  {
    subject: "Umair",
    condition_name: "Vitamin B1/B2 Deficiency",
    icd_code: "E51.9",
    category: "other",
    diagnosed_date: "2021-09-21",
    status: "active",
    severity: "mild",
    treatment_summary: "Supplementation recommended. B1 persistently 7 nmol/L (normal 8–30). B2 persistently <6 (normal 6.2–39).",
    notes: "Chronic — same low values in Sep 2021 and Jan 2026. B6 and B12 normal. May contribute to fatigue and energy metabolism issues.",
  },
], "medical_conditions (6 conditions)");

// ─── EYE PRESCRIPTIONS ───────────────────────────────────────
await insert("eye_prescriptions", [
  {
    subject: "Umair",
    exam_date: "2024-04-02",
    expiry_date: "2026-04-02",
    prescriber: "Brent Chinn, O.D.",
    clinic: "Precision Eyecare Centers",
    lens_type: "progressive",
    od_sphere: -2.00,
    od_cylinder: -0.75,
    od_axis: 25,
    od_add: 1.50,
    os_sphere: -3.00,
    os_cylinder: -0.50,
    os_axis: 155,
    os_add: 1.50,
    pd_right: 33,
    pd_left: 33,
    notes: "Near variable lens. Both distance PD 33, near PD 31.5. Expired Apr 2026.",
  },
  {
    subject: "Umair",
    exam_date: "2026-02-21",
    expiry_date: "2028-02-21",
    prescriber: "Connie Kim, O.D.",
    clinic: "San Jose, CA",
    lens_type: "progressive",
    od_sphere: -2.00,
    od_cylinder: -0.50,
    od_axis: 15,
    od_add: 2.00,
    os_sphere: -2.50,
    os_cylinder: -1.00,
    os_axis: 155,
    os_add: 2.00,
    notes: "Glasses1 (progressive). Also has Glasses2 single vision near: R SPH -0.50 CYL -0.25 AX 015, L SPH -1.00 CYL -0.75 AX 155. Current/active prescription.",
  },
], "eye_prescriptions (2 prescriptions)");

// ─── DOCTOR VISITS ───────────────────────────────────────────
await insert("doctor_visits", [
  {
    subject: "Umair",
    visit_date: "2026-03-23",
    visit_time: "12:55",
    doctor_name: null,
    specialty: "cardiology",
    clinic_name: "El Camino Health / cardiologist office",
    visit_type: "follow_up",
    reason: "Cardiac follow-up / APS management",
    findings: "BP 106/70 mmHg, pulse 72 bpm — excellent reading, lower than home readings.",
    bp_systolic: 106,
    bp_diastolic: 70,
    pulse: 72,
    notes: "Home BP readings this week: 131/88 (Mar 18), 110/76 (Mar 19), 121/81 (Mar 23 AM). Cardiologist reading notably lower — white coat effect may account for home elevation.",
  },
  {
    subject: "Umair",
    visit_date: "2026-03-23",
    doctor_name: "Dr. Vahamaki",
    specialty: "primary_care",
    visit_type: "follow_up",
    reason: "Return to work clearance after health/medical leave",
    findings: "Cleared to return to work on March 23, 2026.",
    notes: "Was on medical leave; needed clearance from Dr. Vahamaki before returning to work.",
  },
], "doctor_visits (2 visits)");

// ─── WEIGHT LOG ───────────────────────────────────────────────
await insert("weight_log", [
  {
    subject: "Umair",
    recorded_at: "2025-06-18T08:00:00+00:00",
    weight_lbs: 216.5,
    time_of_day: "morning",
    source: "manual",
    notes: "Morning weight Jun 18 2025",
  },
  {
    subject: "Umair",
    recorded_at: "2026-03-21T08:00:00+00:00",
    weight_lbs: 212.0,
    time_of_day: "morning",
    source: "manual",
    notes: "Stated as starting weight for July 4 goal ('reach <200 lbs by July 4 from 212 lbs')",
  },
  {
    subject: "Umair",
    recorded_at: "2026-03-23T07:00:00+00:00",
    weight_lbs: 213.0,
    time_of_day: "morning",
    fasting_hours: 14.75,
    source: "manual",
    notes: "Morning weight Mar 23 2026. Fasted since 9pm Mar 22 (broke fast at 11:45am).",
  },
], "weight_log (3 readings)");

// ─── FASTING WINDOWS ─────────────────────────────────────────
await insert("fasting_windows", [
  {
    subject: "Umair",
    fast_start: "2025-06-19T07:00:00+00:00",
    fast_end: "2025-06-20T03:00:00+00:00",
    fast_type: "intermittent",
    broken_with: "Shredded chicken, sweet peppers, zucchini, shredded cheese",
    notes: "~20 hour fast. Lumen showed score 3 (mixed, morning cortisol). Chia water in morning.",
  },
  {
    subject: "Umair",
    fast_start: "2026-03-22T21:00:00+00:00",
    fast_end: "2026-03-23T11:45:00+00:00",
    fast_type: "intermittent",
    broken_with: "Bowl with yellow rice, roasted meat, olive oil tablespoon in early morning",
    notes: "14.75h fast. Broke fast at 11:45am with proper meal (555 kcal, 35g protein, 62g carbs). Had 1 tbsp olive oil early morning.",
  },
  {
    subject: "Umair",
    fast_start: "2026-03-24T22:00:00+00:00",
    fast_end: "2026-03-25T11:30:00+00:00",
    fast_type: "intermittent",
    broken_with: "Planned first meal ~11:30am",
    notes: "~13.5h fast. Last caloric intake was chai at ~10pm. Ramadan context — nightly fasting pattern.",
  },
], "fasting_windows (3 fasting records)");

// ─── WORKOUTS ─────────────────────────────────────────────────
await insert("workouts", [
  {
    subject: "Umair",
    workout_date: "2025-06-16",
    activity_type: "spinning",
    duration_minutes: 41,
    intensity: "low",
    source: "manual",
    notes: "Spinning session, low intensity. From June 2025 health journey log.",
  },
], "workouts (1 session)");

// ─── VEHICLE LOG ──────────────────────────────────────────────
await insert("vehicle_log", [
  {
    vehicle: "Kia EV9",
    log_date: "2026-03-18",
    log_type: "insurance_claim",
    title: "Antenna fin damage — insurance claim filed",
    description: "Antenna fin on the roof of the Kia EV9 was damaged. Insurance claim submitted on March 18, 2026.",
    status: "open",
    notes: "Car roof also needs to be fixed. Antenna installation expected to take ~1 month.",
  },
  {
    vehicle: "Kia EV9",
    log_date: "2026-03-19",
    log_type: "repair",
    title: "Car roof repair + antenna installation pending",
    description: "Get the car roof fixed and have the antenna installed. Expected ~1 month to complete.",
    status: "in_progress",
    notes: "Related to antenna fin insurance claim filed Mar 18.",
  },
], "vehicle_log (2 entries)");

// ─── GOALS ───────────────────────────────────────────────────
await insert("goals", [
  {
    subject: "Umair",
    category: "health",
    title: "Reach <200 lbs by July 4, 2026",
    description: "Weight loss goal in preparation for 5-day Norway hike. Starting from ~212–213 lbs.",
    target_value: 200,
    current_value: 213,
    unit: "lbs",
    target_date: "2026-07-04",
    status: "active",
    priority: 1,
    notes: "Monthly targets: April 206–208, May 202–204, mid-June <200. Approach: 400–600 kcal deficit, 120–150g protein/day, IF 16–20h, weekly long hike.",
  },
  {
    subject: "Umair",
    category: "health",
    title: "Reduce HbA1c below 5.7% (normal range)",
    description: "Persistent prediabetes — HbA1c has been 5.8–6.2% since 2014. Goal is to get below 5.7%.",
    target_value: 5.7,
    current_value: 6.0,
    unit: "%",
    status: "active",
    priority: 1,
    notes: "Driven by weight loss, low-carb diet, IF, and exercise. CGM shows post-meal spikes to 130–170 are the main driver. Cut rice/quinoa/processed shakes.",
  },
  {
    subject: "Umair",
    category: "health",
    title: "5-day Norway hike readiness by July 4, 2026",
    description: "Build endurance for multi-hour daily hikes with a pack over 5 days in Norway.",
    target_date: "2026-07-04",
    status: "active",
    priority: 1,
    notes: "Weekly long hike progression: build from 2–3h to 3–5h with pack by June. Cardio 3–4x/week Zone 2. Strength 2–3x/week legs/core.",
  },
  {
    subject: "Umair",
    category: "financial",
    title: "AI income streams reaching $15k–$25k/month (work-optional)",
    description: "12-month semi-retirement plan via multiple AI-augmented income streams.",
    target_value: 15000,
    current_value: 0,
    unit: "USD/month",
    target_date: "2027-03-01",
    status: "active",
    priority: 1,
    notes: "Strategy: family tree app, AI accountant agent, TAM consulting, AI tutoring, content creation. 12-month runway.",
  },
  {
    subject: "Umair",
    category: "health",
    title: "Improve sleep consistency above 80%",
    description: "Whoop sleep consistency currently 52–64%. Sleep debt is the #1 limiting factor suppressing recovery and HRV.",
    target_value: 80,
    current_value: 58,
    unit: "%",
    status: "active",
    priority: 2,
    notes: "True baseline starts April 2026 (post-Ramadan). RHR improved 10 bpm in one month from hiking — sleep is next lever.",
  },
  {
    subject: "Umair",
    category: "career",
    title: "Transition from TAM to more technical role",
    description: "Move from Technical Account Manager to engineering or AI/ML adjacent role.",
    status: "active",
    priority: 2,
    notes: "Exploring software engineering, AI tools, and AI-augmented workflows. Family tree app and AI accountant agent serve as portfolio projects.",
  },
], "goals (6 goals)");

// ─── FINANCE TAX PROFILE (2024 actual data) ──────────────────
await insert("finance_tax_profile", [
  {
    tax_year: 2024,
    filing_status: "MFJ",
    state: "CA",
    estimated_gross_income: 348500,
    pre_tax_deductions: 27150, // 401k 23000 + HSA 4150
    estimated_agi: 321350,
    itemized_deductions: null,
    standard_deduction: 29200,
    taxable_income: 292150,
    estimated_federal_tax: 62450,
    marginal_rate: 0.32,
    effective_rate: null,
    child_tax_credit: 4000,
    notes: "2024 actual from TurboTax. Wages 330k, dividends 4.2k, LTCG 12.5k, STCG 1.8k. Took standard deduction 29,200. Federal withheld 68,000. Refund 9,550.",
  },
], "finance_tax_profile (2024)");

// ─── FAMILY EVENTS (known medical appointments) ───────────────
await insert("family_events", [
  {
    event_date: "2026-03-23",
    event_time: "12:55",
    title: "Cardiologist appointment",
    category: "medical",
    people: ["Umair"],
    location: "El Camino Health",
    status: "completed",
    notes: "BP 106/70, pulse 72. APS/cardiac follow-up.",
  },
  {
    event_date: "2026-03-23",
    title: "Return to work — Dr. Vahamaki clearance",
    category: "medical",
    people: ["Umair"],
    status: "completed",
    notes: "Medical leave ended. Cleared by Dr. Vahamaki to return to work on March 23.",
  },
  {
    event_date: "2026-03-20",
    title: "Eid al-Fitr 2026",
    category: "religious",
    people: ["Umair", "Huma", "Nyel", "Emaad", "Omer"],
    status: "completed",
    notes: "Eid al-Fitr expected ~March 20–21, 2026. Marks end of Ramadan.",
  },
  {
    event_date: "2026-05-27",
    title: "Eid al-Adha 2026 (estimated)",
    category: "religious",
    people: ["Umair", "Huma", "Nyel", "Emaad", "Omer"],
    status: "upcoming",
    notes: "Expected around May 27–28, 2026. Exact date depends on moon sighting.",
  },
], "family_events (4 events)");

// ─── LAB RESULTS — comprehensive history ─────────────────────
const labRows = [
  // ── 2014-05-07 Advanced Lipids / Metabolic (baseline) ──
  { test_date: "2014-05-07", panel: "Lipid",    marker: "Total Cholesterol", value: 173,  unit: "mg/dL", reference_low: null, reference_high: 200, is_flagged: false },
  { test_date: "2014-05-07", panel: "Lipid",    marker: "LDL",               value: 113,  unit: "mg/dL", reference_high: 100, is_flagged: true,  flag: "HIGH" },
  { test_date: "2014-05-07", panel: "Lipid",    marker: "HDL",               value: 38,   unit: "mg/dL", reference_low: 40,  is_flagged: true,  flag: "LOW" },
  { test_date: "2014-05-07", panel: "Lipid",    marker: "Triglycerides",     value: 202,  unit: "mg/dL", reference_high: 150, is_flagged: true, flag: "HIGH" },
  { test_date: "2014-05-07", panel: "Advanced_Lipid", marker: "LDL-P",      value: 1333, unit: "nmol/L", reference_high: 1000, is_flagged: true, flag: "HIGH" },
  { test_date: "2014-05-07", panel: "HbA1c",   marker: "HbA1c",             value: 5.8,  unit: "%",    reference_high: 5.7, is_flagged: true,  flag: "HIGH", notes: "Prediabetes range" },
  { test_date: "2014-05-07", panel: "CMP",     marker: "Glucose",           value: 95,   unit: "mg/dL" },
  { test_date: "2014-05-07", panel: "Liver",   marker: "AST",               value: 28,   unit: "U/L" },
  { test_date: "2014-05-07", panel: "Liver",   marker: "ALT",               value: 35,   unit: "U/L" },
  { test_date: "2014-05-07", panel: "Vitamins", marker: "Vitamin D",        value: 18,   unit: "ng/mL", reference_low: 30, is_flagged: true, flag: "LOW" },
  { test_date: "2014-05-07", panel: "CBC",     marker: "MCV",               value: 79,   unit: "fL",   reference_low: 80, is_flagged: true, flag: "LOW" },
  { test_date: "2014-05-07", panel: "CBC",     marker: "MCH",               value: 26,   unit: "pg",   reference_low: 27, is_flagged: true, flag: "LOW" },
  // ── 2021-05-03 ──
  { test_date: "2021-05-03", panel: "Lipid",   marker: "Total Cholesterol", value: 207,  unit: "mg/dL", reference_high: 200, is_flagged: true, flag: "HIGH" },
  { test_date: "2021-05-03", panel: "Lipid",   marker: "LDL",               value: 137,  unit: "mg/dL", reference_high: 100, is_flagged: true, flag: "HIGH" },
  { test_date: "2021-05-03", panel: "Lipid",   marker: "HDL",               value: 37,   unit: "mg/dL", reference_low: 40, is_flagged: true, flag: "LOW" },
  { test_date: "2021-05-03", panel: "Lipid",   marker: "Triglycerides",     value: 167,  unit: "mg/dL", reference_high: 150, is_flagged: true, flag: "HIGH" },
  { test_date: "2021-05-03", panel: "HbA1c",  marker: "HbA1c",             value: 6.2,  unit: "%",    reference_high: 5.7, is_flagged: true, flag: "HIGH", notes: "Avg glucose ~131 mg/dL" },
  // ── 2021-09-21 Vitamins ──
  { test_date: "2021-09-21", panel: "Vitamins", marker: "Vitamin B1 (Thiamine)", value: 7, unit: "nmol/L", reference_low: 8, reference_high: 30, is_flagged: true, flag: "LOW" },
  { test_date: "2021-09-21", panel: "Vitamins", marker: "Vitamin B2 (Riboflavin)", value: 4.9, unit: "nmol/L", reference_low: 6.2, reference_high: 39, is_flagged: true, flag: "LOW" },
  { test_date: "2021-09-21", panel: "Vitamins", marker: "Vitamin B6",        value: 20.7, unit: "ng/mL", reference_low: 2.1, reference_high: 21.7 },
  { test_date: "2021-09-21", panel: "Vitamins", marker: "Vitamin B12",       value: 760,  unit: "pg/mL", reference_low: 211, reference_high: 911 },
  // ── 2021-10-22 ──
  { test_date: "2021-10-22", panel: "Lipid",   marker: "Total Cholesterol", value: 86,   unit: "mg/dL" },
  { test_date: "2021-10-22", panel: "Lipid",   marker: "LDL",               value: 38,   unit: "mg/dL" },
  { test_date: "2021-10-22", panel: "Lipid",   marker: "HDL",               value: 38,   unit: "mg/dL", reference_low: 40, is_flagged: true, flag: "LOW" },
  { test_date: "2021-10-22", panel: "Lipid",   marker: "Triglycerides",     value: 48,   unit: "mg/dL" },
  { test_date: "2021-10-22", panel: "HbA1c",  marker: "HbA1c",             value: 5.8,  unit: "%", reference_high: 5.7, is_flagged: true, flag: "HIGH", notes: "Avg glucose ~120 mg/dL" },
  { test_date: "2021-10-22", panel: "CBC",    marker: "WBC",               value: null, unit: "K/uL" },
  // ── 2021-12-10 ──
  { test_date: "2021-12-10", panel: "Lipid",  marker: "Total Cholesterol",  value: 118,  unit: "mg/dL" },
  { test_date: "2021-12-10", panel: "Lipid",  marker: "LDL",                value: 64,   unit: "mg/dL" },
  { test_date: "2021-12-10", panel: "Lipid",  marker: "HDL",                value: 45,   unit: "mg/dL" },
  { test_date: "2021-12-10", panel: "Lipid",  marker: "Triglycerides",      value: 46,   unit: "mg/dL" },
  { test_date: "2021-12-10", panel: "HbA1c", marker: "HbA1c",              value: 5.8,  unit: "%", reference_high: 5.7, is_flagged: true, flag: "HIGH", notes: "Avg glucose ~120 mg/dL" },
  // ── 2022-03-11 ──
  { test_date: "2022-03-11", panel: "Lipid",  marker: "Total Cholesterol",  value: 137,  unit: "mg/dL" },
  { test_date: "2022-03-11", panel: "Lipid",  marker: "LDL",                value: 73,   unit: "mg/dL" },
  { test_date: "2022-03-11", panel: "Lipid",  marker: "HDL",                value: 49,   unit: "mg/dL" },
  { test_date: "2022-03-11", panel: "Lipid",  marker: "Triglycerides",      value: 74,   unit: "mg/dL" },
  { test_date: "2022-03-11", panel: "HbA1c", marker: "HbA1c",              value: 6.0,  unit: "%", reference_high: 5.7, is_flagged: true, flag: "HIGH", notes: "Avg glucose ~126 mg/dL" },
  // ── 2022-08-26 ──
  { test_date: "2022-08-26", panel: "CBC", marker: "WBC",          value: 8.1,  unit: "K/uL" },
  { test_date: "2022-08-26", panel: "CBC", marker: "RBC",          value: 5.25, unit: "M/uL" },
  { test_date: "2022-08-26", panel: "CBC", marker: "Hemoglobin",   value: 14.2, unit: "g/dL" },
  { test_date: "2022-08-26", panel: "CBC", marker: "MCH",          value: 27.0, unit: "pg" },
  { test_date: "2022-08-26", panel: "CBC", marker: "Platelets",    value: 234,  unit: "K/uL" },
  { test_date: "2022-08-26", panel: "CBC", marker: "Abs Lymphocyte", value: 3.8, unit: "K/uL", reference_high: 3.5, is_flagged: true, flag: "HIGH" },
  // ── 2022-09-28 ──
  { test_date: "2022-09-28", panel: "CBC", marker: "WBC",          value: 8.1,  unit: "K/uL" },
  { test_date: "2022-09-28", panel: "CBC", marker: "RBC",          value: 5.27, unit: "M/uL" },
  { test_date: "2022-09-28", panel: "CBC", marker: "Hemoglobin",   value: 14.6, unit: "g/dL" },
  { test_date: "2022-09-28", panel: "CBC", marker: "MCH",          value: 27.7, unit: "pg" },
  { test_date: "2022-09-28", panel: "CBC", marker: "Platelets",    value: 245,  unit: "K/uL" },
  // ── 2023-03-10 ──
  { test_date: "2023-03-10", panel: "Lipid",  marker: "Total Cholesterol",  value: 112,  unit: "mg/dL" },
  { test_date: "2023-03-10", panel: "Lipid",  marker: "LDL",                value: 53,   unit: "mg/dL" },
  { test_date: "2023-03-10", panel: "Lipid",  marker: "HDL",                value: 39,   unit: "mg/dL", reference_low: 40, is_flagged: true, flag: "LOW" },
  { test_date: "2023-03-10", panel: "Lipid",  marker: "Triglycerides",      value: 99,   unit: "mg/dL" },
  { test_date: "2023-03-10", panel: "HbA1c", marker: "HbA1c",              value: 5.9,  unit: "%", reference_high: 5.7, is_flagged: true, flag: "HIGH", notes: "Avg glucose ~123 mg/dL" },
  { test_date: "2023-03-10", panel: "CMP",   marker: "Glucose",            value: 103,  unit: "mg/dL", reference_high: 99, is_flagged: true, flag: "HIGH" },
  { test_date: "2023-03-10", panel: "CMP",   marker: "eGFR",               value: 107,  unit: "mL/min" },
  { test_date: "2023-03-10", panel: "Liver", marker: "AST",                value: 33,   unit: "U/L" },
  { test_date: "2023-03-10", panel: "Liver", marker: "ALT",                value: 59,   unit: "U/L", reference_high: 56, is_flagged: true, flag: "HIGH" },
  { test_date: "2023-03-10", panel: "Liver", marker: "Alkaline Phosphatase", value: 88, unit: "U/L" },
  { test_date: "2023-03-10", panel: "Liver", marker: "Albumin",            value: 3.6,  unit: "g/dL" },
  { test_date: "2023-03-10", panel: "Liver", marker: "Bilirubin Total",    value: 0.4,  unit: "mg/dL" },
  // ── 2023-07-17 ──
  { test_date: "2023-07-17", panel: "HbA1c", marker: "HbA1c",             value: 6.1,  unit: "%", reference_high: 5.7, is_flagged: true, flag: "HIGH", notes: "Avg glucose ~128 mg/dL" },
  { test_date: "2023-07-17", panel: "Lipid",  marker: "Total Cholesterol", value: null, unit: "mg/dL", notes: "Not recorded this date" },
  { test_date: "2023-07-17", panel: "CMP",   marker: "Glucose",           value: 87,   unit: "mg/dL" },
  { test_date: "2023-07-17", panel: "CMP",   marker: "eGFR",              value: 104,  unit: "mL/min" },
  { test_date: "2023-07-17", panel: "Liver", marker: "AST",               value: 36,   unit: "U/L" },
  { test_date: "2023-07-17", panel: "Liver", marker: "ALT",               value: 52,   unit: "U/L" },
  { test_date: "2023-07-17", panel: "Liver", marker: "Alkaline Phosphatase", value: 88, unit: "U/L" },
  { test_date: "2023-07-17", panel: "Liver", marker: "Albumin",           value: 3.8,  unit: "g/dL" },
  { test_date: "2023-07-17", panel: "Liver", marker: "Bilirubin Total",   value: 0.6,  unit: "mg/dL" },
  { test_date: "2023-07-17", panel: "CBC",   marker: "WBC",               value: 6.7,  unit: "K/uL" },
  { test_date: "2023-07-17", panel: "CBC",   marker: "RBC",               value: 5.55, unit: "M/uL" },
  { test_date: "2023-07-17", panel: "CBC",   marker: "Hemoglobin",        value: 14.0, unit: "g/dL" },
  { test_date: "2023-07-17", panel: "CBC",   marker: "MCH",               value: 25.2, unit: "pg", reference_low: 27, is_flagged: true, flag: "LOW" },
  { test_date: "2023-07-17", panel: "CBC",   marker: "Platelets",         value: 305,  unit: "K/uL" },
  // ── 2024-05-31 ──
  { test_date: "2024-05-31", panel: "Lipid", marker: "Total Cholesterol",  value: 127,  unit: "mg/dL" },
  { test_date: "2024-05-31", panel: "Lipid", marker: "LDL",                value: 57,   unit: "mg/dL" },
  { test_date: "2024-05-31", panel: "Lipid", marker: "HDL",                value: 50,   unit: "mg/dL" },
  { test_date: "2024-05-31", panel: "Lipid", marker: "Triglycerides",      value: 99,   unit: "mg/dL" },
  { test_date: "2024-05-31", panel: "Lipid", marker: "Cholesterol/HDL Ratio", value: 2.5, unit: "ratio" },
  { test_date: "2024-05-31", panel: "Lipid", marker: "VLDL",              value: 20,   unit: "mg/dL" },
  // ── 2025-01-10 ──
  { test_date: "2025-01-10", panel: "HbA1c", marker: "HbA1c",             value: 6.0,  unit: "%", reference_high: 5.7, is_flagged: true, flag: "HIGH", notes: "Avg glucose ~126 mg/dL" },
  { test_date: "2025-01-10", panel: "Lipid", marker: "Total Cholesterol",  value: 130,  unit: "mg/dL" },
  { test_date: "2025-01-10", panel: "Lipid", marker: "LDL",                value: 69,   unit: "mg/dL" },
  { test_date: "2025-01-10", panel: "Lipid", marker: "HDL",                value: 42,   unit: "mg/dL" },
  { test_date: "2025-01-10", panel: "Lipid", marker: "Triglycerides",      value: 97,   unit: "mg/dL" },
  { test_date: "2025-01-10", panel: "CMP",   marker: "Glucose",            value: 92,   unit: "mg/dL" },
  { test_date: "2025-01-10", panel: "CMP",   marker: "eGFR",               value: 98,   unit: "mL/min" },
  { test_date: "2025-01-10", panel: "Liver", marker: "AST",                value: 60,   unit: "U/L", reference_high: 40, is_flagged: true, flag: "HIGH" },
  { test_date: "2025-01-10", panel: "Liver", marker: "ALT",                value: 62,   unit: "U/L", reference_high: 56, is_flagged: true, flag: "HIGH" },
  { test_date: "2025-01-10", panel: "CBC",   marker: "WBC",                value: 7.1,  unit: "K/uL" },
  { test_date: "2025-01-10", panel: "CBC",   marker: "RBC",                value: 5.51, unit: "M/uL" },
  { test_date: "2025-01-10", panel: "CBC",   marker: "Hemoglobin",         value: 14.4, unit: "g/dL" },
  { test_date: "2025-01-10", panel: "CBC",   marker: "MCH",                value: 26.1, unit: "pg", reference_low: 27, is_flagged: true, flag: "LOW" },
  { test_date: "2025-01-10", panel: "CBC",   marker: "Platelets",          value: 180,  unit: "K/uL" },
  // ── 2025-03-14 ──
  { test_date: "2025-03-14", panel: "Liver", marker: "AST",                value: 32,   unit: "U/L" },
  { test_date: "2025-03-14", panel: "Liver", marker: "ALT",                value: 44,   unit: "U/L" },
  { test_date: "2025-03-14", panel: "Liver", marker: "Alkaline Phosphatase", value: 98, unit: "U/L" },
  { test_date: "2025-03-14", panel: "Liver", marker: "Albumin",            value: 3.7,  unit: "g/dL" },
  { test_date: "2025-03-14", panel: "Liver", marker: "Bilirubin Total",    value: 0.4,  unit: "mg/dL" },
  // ── 2026-01-15 ──
  { test_date: "2026-01-15", panel: "HbA1c", marker: "HbA1c",             value: 6.0,  unit: "%", reference_high: 5.7, is_flagged: true, flag: "HIGH", notes: "Avg glucose ~126 mg/dL. Persistently prediabetic." },
  { test_date: "2026-01-15", panel: "Lipid", marker: "Total Cholesterol",  value: 126,  unit: "mg/dL" },
  { test_date: "2026-01-15", panel: "Lipid", marker: "LDL",                value: 70,   unit: "mg/dL" },
  { test_date: "2026-01-15", panel: "Lipid", marker: "HDL",                value: 43,   unit: "mg/dL" },
  { test_date: "2026-01-15", panel: "Lipid", marker: "Triglycerides",      value: 66,   unit: "mg/dL" },
  { test_date: "2026-01-15", panel: "Lipid", marker: "Cholesterol/HDL Ratio", value: 2.9, unit: "ratio" },
  { test_date: "2026-01-15", panel: "Lipid", marker: "VLDL",              value: 13,   unit: "mg/dL" },
  { test_date: "2026-01-15", panel: "CMP",   marker: "Glucose",            value: 101,  unit: "mg/dL", reference_high: 99, is_flagged: true, flag: "HIGH" },
  { test_date: "2026-01-15", panel: "CMP",   marker: "eGFR",               value: 104,  unit: "mL/min" },
  { test_date: "2026-01-15", panel: "Liver", marker: "AST",                value: 26,   unit: "U/L" },
  { test_date: "2026-01-15", panel: "Liver", marker: "ALT",                value: 43,   unit: "U/L" },
  { test_date: "2026-01-15", panel: "Liver", marker: "Alkaline Phosphatase", value: 102, unit: "U/L" },
  { test_date: "2026-01-15", panel: "Liver", marker: "Albumin",            value: 3.8,  unit: "g/dL" },
  { test_date: "2026-01-15", panel: "Liver", marker: "Bilirubin Total",    value: 0.3,  unit: "mg/dL" },
  { test_date: "2026-01-15", panel: "CBC",   marker: "WBC",                value: 7.7,  unit: "K/uL" },
  { test_date: "2026-01-15", panel: "CBC",   marker: "RBC",                value: 5.80, unit: "M/uL" },
  { test_date: "2026-01-15", panel: "CBC",   marker: "Hemoglobin",         value: 14.9, unit: "g/dL" },
  { test_date: "2026-01-15", panel: "CBC",   marker: "MCH",                value: 25.7, unit: "pg", reference_low: 27, is_flagged: true, flag: "LOW" },
  { test_date: "2026-01-15", panel: "CBC",   marker: "Platelets",          value: 284,  unit: "K/uL" },
  { test_date: "2026-01-15", panel: "CBC",   marker: "Abs Lymphocyte",     value: 3.6,  unit: "K/uL", reference_high: 3.5, is_flagged: true, flag: "HIGH" },
  { test_date: "2026-01-15", panel: "Vitamins", marker: "Vitamin B1 (Thiamine)", value: 7, unit: "nmol/L", reference_low: 8, reference_high: 30, is_flagged: true, flag: "LOW" },
  { test_date: "2026-01-15", panel: "Vitamins", marker: "Vitamin B2 (Riboflavin)", value: 5.8, unit: "nmol/L", reference_low: 6.2, reference_high: 39, is_flagged: true, flag: "LOW" },
  { test_date: "2026-01-15", panel: "Vitamins", marker: "Vitamin B6",       value: 16.8, unit: "ng/mL" },
  { test_date: "2026-01-15", panel: "Vitamins", marker: "Vitamin B12",      value: 540,  unit: "pg/mL" },
  // ── 2026-02-20 ──
  { test_date: "2026-02-20", panel: "CBC",   marker: "WBC",                value: 6.9,  unit: "K/uL" },
  { test_date: "2026-02-20", panel: "CBC",   marker: "RBC",                value: 5.66, unit: "M/uL" },
  { test_date: "2026-02-20", panel: "CBC",   marker: "Hemoglobin",         value: 14.7, unit: "g/dL" },
  { test_date: "2026-02-20", panel: "CBC",   marker: "Hematocrit",         value: 45.3, unit: "%" },
  { test_date: "2026-02-20", panel: "CBC",   marker: "MCV",                value: 80,   unit: "fL" },
  { test_date: "2026-02-20", panel: "CBC",   marker: "MCH",                value: 26.0, unit: "pg", reference_low: 27, is_flagged: true, flag: "LOW" },
  { test_date: "2026-02-20", panel: "CBC",   marker: "MCHC",               value: 32.5, unit: "g/dL" },
  { test_date: "2026-02-20", panel: "CBC",   marker: "RDW",                value: 14.6, unit: "%" },
  { test_date: "2026-02-20", panel: "CBC",   marker: "Platelets",          value: 232,  unit: "K/uL" },
  { test_date: "2026-02-20", panel: "CMP",   marker: "Sodium",             value: 143,  unit: "mEq/L" },
  { test_date: "2026-02-20", panel: "CMP",   marker: "Potassium",          value: 4.9,  unit: "mEq/L" },
  { test_date: "2026-02-20", panel: "CMP",   marker: "Glucose",            value: 107,  unit: "mg/dL", reference_high: 99, is_flagged: true, flag: "HIGH" },
  { test_date: "2026-02-20", panel: "CMP",   marker: "BUN",                value: 15,   unit: "mg/dL" },
  { test_date: "2026-02-20", panel: "CMP",   marker: "Creatinine",         value: 0.91, unit: "mg/dL" },
  { test_date: "2026-02-20", panel: "CMP",   marker: "Calcium",            value: 9.0,  unit: "mg/dL" },
  { test_date: "2026-02-20", panel: "CMP",   marker: "eGFR",               value: 105,  unit: "mL/min" },
  { test_date: "2026-02-20", panel: "Liver", marker: "AST",                value: 34,   unit: "U/L" },
  { test_date: "2026-02-20", panel: "Liver", marker: "ALT",                value: 58,   unit: "U/L", reference_high: 56, notes: "Near upper limit — monitor (on Lipitor 80mg)" },
  { test_date: "2026-02-20", panel: "Liver", marker: "Alkaline Phosphatase", value: 99, unit: "U/L" },
  { test_date: "2026-02-20", panel: "Liver", marker: "Albumin",            value: 4.0,  unit: "g/dL" },
  { test_date: "2026-02-20", panel: "Liver", marker: "Total Protein",      value: 6.9,  unit: "g/dL" },
  { test_date: "2026-02-20", panel: "Liver", marker: "Bilirubin Total",    value: 0.4,  unit: "mg/dL" },
].filter(r => r.value !== null);

// Batch insert lab results (avoid hitting row limits)
for (let i = 0; i < labRows.length; i += 50) {
  const batch = labRows.slice(i, i + 50).map(r => ({ ...r, subject: "Umair", lab_name: r.lab_name ?? null }));
  const { data, error } = await db.from("lab_results").insert(batch).select("id");
  if (error) {
    console.error(`❌ lab_results batch ${i}–${i+50}: ${error.message}`);
  } else {
    console.log(`✅ lab_results batch ${i}–${Math.min(i+50, labRows.length)}: ${data.length} rows`);
  }
}

console.log("\n🎉 Backfill complete!");
