#!/usr/bin/env node
// One-time seed script: imports health data from HealthJourney.xlsx + thoughts into Supabase
// Sources: Sheet1 (Jun 16 – Jul 11 2025), Sheet2/728-89 (Jul 28 – Aug 9 2025), manual thoughts

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://epckjiufeimydxmcrfus.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVwY2tqaXVmZWlteWR4bWNyZnVzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzc4MTA3NCwiZXhwIjoyMDg5MzU3MDc0fQ.5KG6i-1Y9Z1bn0pSoGz2aanEIyQwRsLzyHc9tqffl5A";

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── helpers ──────────────────────────────────────────────────────────────────
const ts = (d, t = "12:00") => `${d}T${t}:00-07:00`; // PDT offset for 2025 data
const tsUtc = (d, t = "12:00") => `${d}T${t}:00Z`;    // UTC for 2026 data

async function insert(table, rows, label) {
  if (!rows.length) return;
  const { error } = await db.from(table).insert(rows);
  if (error) {
    console.error(`❌ ${label}:`, error.message);
  } else {
    console.log(`✅ ${label}: inserted ${rows.length} rows`);
  }
}

// ── BLOOD PRESSURE (from thoughts, March 2026) ────────────────────────────────
const bloodPressure = [
  { recorded_at: tsUtc("2026-03-18","00:00"), systolic: 131, diastolic: 88, heart_rate_bpm: 69, measurement_location: "home",           source: "monitor", notes: "Reading from March 18 2026" },
  { recorded_at: tsUtc("2026-03-19","00:00"), systolic: 110, diastolic: 76, heart_rate_bpm: 71, measurement_location: "home",           source: "monitor", notes: "Reading from March 19 2026" },
  { recorded_at: tsUtc("2026-03-23","08:45"), systolic: 121, diastolic: 81, heart_rate_bpm: 67, measurement_location: "home",           source: "monitor", notes: "Morning reading March 23 2026" },
  { recorded_at: tsUtc("2026-03-23","12:55"), systolic: 106, diastolic: 70, heart_rate_bpm: 72, measurement_location: "doctors_office", source: "monitor", notes: "Cardiologist office visit" },
];

// ── BLOOD GLUCOSE ─────────────────────────────────────────────────────────────
// A1C history (lab results from thoughts)
const a1cHistory = [
  { recorded_at: tsUtc("2021-05-03"), a1c_percent: 6.2, reading_type: "a1c_lab", source: "lab", notes: "Avg glucose ~131 mg/dL" },
  { recorded_at: tsUtc("2021-10-22"), a1c_percent: 5.8, reading_type: "a1c_lab", source: "lab", notes: "Avg glucose ~120 mg/dL" },
  { recorded_at: tsUtc("2021-12-10"), a1c_percent: 5.8, reading_type: "a1c_lab", source: "lab", notes: "Avg glucose ~120 mg/dL" },
  { recorded_at: tsUtc("2022-03-11"), a1c_percent: 6.0, reading_type: "a1c_lab", source: "lab", notes: "Avg glucose ~126 mg/dL" },
  { recorded_at: tsUtc("2023-03-10"), a1c_percent: 5.9, reading_type: "a1c_lab", source: "lab", notes: "Avg glucose ~123 mg/dL" },
  { recorded_at: tsUtc("2023-07-17"), a1c_percent: 6.1, reading_type: "a1c_lab", source: "lab", notes: "Avg glucose ~128 mg/dL" },
  { recorded_at: tsUtc("2025-01-10"), a1c_percent: 6.0, reading_type: "a1c_lab", source: "lab", notes: "Avg glucose ~126 mg/dL" },
  { recorded_at: tsUtc("2026-01-15"), a1c_percent: 6.0, reading_type: "a1c_lab", source: "lab", notes: "Avg glucose ~126 mg/dL. Persistently prediabetic range." },
];

// CGM spot readings from Sheet2 (728-89)
const cgmReadings = [
  { recorded_at: ts("2025-07-28","10:50"), glucose_mg_dl: 125,   reading_type: "cgm", source: "libre3", notes: "Stable overnight, morning rise 120-130" },
  { recorded_at: ts("2025-07-30","17:08"), glucose_mg_dl: 149,   reading_type: "cgm", source: "libre3", trend: "falling", notes: "Post-afternoon spike 160-170, now trending down" },
  { recorded_at: ts("2025-07-31","17:40"), glucose_mg_dl: 106,   reading_type: "cgm", source: "libre3", trend: "falling", notes: "Post-lunch peak 130-135, now trending down" },
  { recorded_at: ts("2025-08-05","07:44"), glucose_mg_dl: 96,    reading_type: "cgm", source: "libre3", notes: "Overnight/morning stable 100-120" },
  { recorded_at: ts("2025-08-06","19:46"), glucose_mg_dl: 105,   reading_type: "cgm", source: "libre3", notes: "Very stable 100-120 all day (approximate)" },
  { recorded_at: ts("2025-08-07","13:14"), glucose_mg_dl: 107,   reading_type: "cgm", source: "libre3", notes: "Post-lunch rise started, 105-110 range (approximate)" },
  { recorded_at: ts("2025-08-08","22:50"), glucose_mg_dl: 100,   reading_type: "cgm", source: "libre3", notes: "After multiple 130-140 peaks, returned to baseline" },
  { recorded_at: ts("2025-08-09","14:29"), glucose_mg_dl: 134,   reading_type: "cgm", source: "libre3", trend: "falling", notes: "Sharp rise after first meal to 145-150, now 134 trending down" },
  // From thoughts March 2026
  { recorded_at: tsUtc("2026-03-23","11:45"), glucose_mg_dl: 100, reading_type: "cgm", source: "libre3", trend: "stable", notes: "Stable 90-105 before and after lunch, flat trend" },
];

const bloodGlucose = [...a1cHistory, ...cgmReadings];

// ── LUMEN ENTRIES ─────────────────────────────────────────────────────────────
// Measurement context key:
//   morning = first reading of day after overnight fast
//   post_meal = taken after eating
//   pre_meal = taken before eating / while fasting
//   post_workout = after exercise

const luменEntries = [
  // June 16
  { recorded_at: ts("2025-06-16","18:09"), score: 1, measurement_context: "post_meal",    notes: "After snack (kiwi, almonds)" },
  { recorded_at: ts("2025-06-16","21:55"), score: 1, measurement_context: "post_meal",    notes: "Before bed" },
  // June 17
  { recorded_at: ts("2025-06-17","07:18"), score: 2, measurement_context: "morning",      notes: "Likely due to poor sleep" },
  { recorded_at: ts("2025-06-17","11:53"), score: 1, measurement_context: "post_meal",    notes: "3 hrs after breakfast" },
  { recorded_at: ts("2025-06-17","13:54"), score: 1, measurement_context: "post_meal",    notes: "1 hr after lunch" },
  { recorded_at: ts("2025-06-17","18:50"), score: 3, measurement_context: "pre_meal",     notes: "Stress/cortisol spike; dizziness at work, poor sleep" },
  { recorded_at: ts("2025-06-17","20:32"), score: 2, measurement_context: "post_meal",    notes: "1 hr after dinner (veggies + salmon)" },
  // June 18
  { recorded_at: ts("2025-06-18","07:51"), score: 5, measurement_context: "post_meal",    notes: "1 hr after breakfast; likely reaction to Premier Protein shake sweeteners" },
  { recorded_at: ts("2025-06-18","08:14"), score: 3, measurement_context: "post_meal",    notes: "Recovery from earlier spike" },
  { recorded_at: ts("2025-06-18","13:55"), score: 2, measurement_context: "post_meal",    notes: "Immediately after lunch" },
  { recorded_at: ts("2025-06-18","19:10"), score: 2, measurement_context: "post_meal",    notes: null },
  { recorded_at: ts("2025-06-18","23:17"), score: 2, measurement_context: "post_meal",    notes: null },
  // June 19
  { recorded_at: ts("2025-06-19","10:01"), score: 3, measurement_context: "morning",      notes: "After ~20hr fast. Morning cortisol spike likely." },
  { recorded_at: ts("2025-06-19","13:00"), score: 3, measurement_context: "post_meal",    notes: "~2 hrs after breakfast omelette" },
  { recorded_at: ts("2025-06-19","17:36"), score: 2, measurement_context: "post_meal",    notes: "After popcorn snack" },
  { recorded_at: ts("2025-06-19","19:57"), score: 2, measurement_context: "post_meal",    notes: "After dinner (chicken, peppers, zucchini)" },
  // June 20
  { recorded_at: ts("2025-06-20","07:11"), score: 4, measurement_context: "morning",      notes: "After overnight fast; short sleep 6h8m likely cause" },
  { recorded_at: ts("2025-06-20","08:57"), score: 2, measurement_context: "morning",      notes: "~2 hrs after waking; after black coffee + lime water. Excellent recovery." },
  { recorded_at: ts("2025-06-20","12:22"), score: 3, measurement_context: "pre_meal",     notes: "Before breaking fast; improved from morning 4 but still cortisol effect" },
  { recorded_at: ts("2025-06-20","16:55"), score: 3, measurement_context: "post_meal",    notes: "Several hrs after breakfast; lingering carb/stress effect" },
  { recorded_at: ts("2025-06-20","20:13"), score: 2, measurement_context: "post_meal",    notes: "After salmon + veggies dinner" },
  // June 21
  { recorded_at: ts("2025-06-21","15:30"), score: 4, measurement_context: "pre_meal",     notes: "Before fast break; short sleep + heat stress + prolonged fasting" },
  { recorded_at: ts("2025-06-21","22:23"), score: 3, measurement_context: "post_meal",    notes: "Before bedtime; mixed fuel after yogurt + vegetables" },
  // June 22
  { recorded_at: ts("2025-06-22","09:18"), score: 4, measurement_context: "post_meal",    notes: "After overnight fast + breakfast; elevated morning cortisol" },
  { recorded_at: ts("2025-06-22","21:35"), score: 2, measurement_context: "post_meal",    notes: "Before bedtime; excellent metabolic flexibility" },
  // June 23
  { recorded_at: ts("2025-06-23","06:16"), score: 4, measurement_context: "morning",      notes: "Short sleep 5h39m likely cause" },
  { recorded_at: ts("2025-06-23","22:31"), score: 1, measurement_context: "post_meal",    notes: "Excellent metabolic flexibility after evening meal" },
  // June 24
  { recorded_at: ts("2025-06-24","06:50"), score: 3, measurement_context: "morning",      notes: "Late night SFO pickup; only 4h sleep. Good given disruption." },
  { recorded_at: ts("2025-06-24","21:00"), score: 1, measurement_context: "post_meal",    notes: "Strong fat-burning after day's meals" },
  { recorded_at: ts("2025-06-24","23:48"), score: 3, measurement_context: "post_meal",    notes: "Final reading before bed" },
  // June 25
  { recorded_at: ts("2025-06-25","06:15"), score: 3, measurement_context: "morning",      notes: "Normal and healthy after previous night" },
  { recorded_at: ts("2025-06-25","20:25"), score: 2, measurement_context: "post_meal",    notes: "Good metabolic flexibility after lunch with lima beans" },
  // June 26
  { recorded_at: ts("2025-06-26","06:09"), score: 2, measurement_context: "morning",      notes: "Excellent morning reading; strong fat-burning after overnight fast" },
  // July 5
  { recorded_at: ts("2025-07-05","11:15"), score: 3, measurement_context: "post_workout", notes: "After morning hike (2h28m)" },
  // July 6
  { recorded_at: ts("2025-07-06","12:45"), score: 3, measurement_context: "pre_meal",     notes: "After long fast; recovery from intense hike day before" },
  // July 7
  { recorded_at: ts("2025-07-07","07:06"), score: 3, measurement_context: "morning",      notes: "Shorter sleep may be a factor" },
  { recorded_at: ts("2025-07-07","11:38"), score: 2, measurement_context: "post_meal",    notes: "After lunch (rotisserie chicken, okra, guacamole)" },
  // July 8
  { recorded_at: ts("2025-07-08","06:46"), score: 3, measurement_context: "morning",      notes: "After overnight fast; shorter sleep" },
  // July 9
  { recorded_at: ts("2025-07-09","06:00"), score: 3, measurement_context: "morning",      notes: "After overnight fast" },
  // July 10
  { recorded_at: ts("2025-07-10","08:00"), score: 3, measurement_context: "morning",      notes: "After overnight fast" },
  // July 11
  { recorded_at: ts("2025-07-11","21:56"), score: 2, measurement_context: "post_meal",    notes: "After steak + sweet peppers dinner" },
  // Sheet2 (Jul–Aug 2025)
  { recorded_at: ts("2025-07-30","07:12"), score: 2, measurement_context: "morning",      notes: null },
  { recorded_at: ts("2025-07-30","23:50"), score: 3, measurement_context: "post_meal",    notes: "Bedtime reading" },
  { recorded_at: ts("2025-07-31","08:00"), score: 3, measurement_context: "morning",      notes: null },
  { recorded_at: ts("2025-08-09","08:00"), score: 2, measurement_context: "morning",      notes: null },
  { recorded_at: ts("2025-08-09","12:00"), score: 3, measurement_context: "pre_meal",     notes: "Before first meal of day" },
  // From thoughts March 2026
  { recorded_at: tsUtc("2026-03-19","10:00"), score: 3, measurement_context: "morning",   notes: "After ~20hr fast; warm water with lime and salt beforehand. Likely cortisol/stress." },
];

// Fix variable name typo (Cyrillic м in luменEntries)
const lumenEntries = luменEntries;

// ── MEALS ─────────────────────────────────────────────────────────────────────
// Sheet1: Jun 16 – Jul 11 2025 (calories only, no macro breakdown)
// Sheet2: Jul 28 – Aug 9 2025 (full macros)
// Thoughts: March 2026

const meals = [
  // ── Sheet1: June 16 ──
  { eaten_at: ts("2025-06-16","08:00"), meal_type: "breakfast", meal_name: "2 boiled eggs, half avocado",                                       source: "manual" },
  { eaten_at: ts("2025-06-16","13:00"), meal_type: "lunch",     meal_name: "Half a plate chicken, 1/4 roti",                                    source: "manual" },
  { eaten_at: ts("2025-06-16","15:30"), meal_type: "snack",     meal_name: "Half a kiwi, handful of almonds",                                   source: "manual" },
  // ── June 17 ──
  { eaten_at: ts("2025-06-17","08:00"), meal_type: "breakfast", meal_name: "2 boiled eggs, half avocado, 2 pieces hard Gouda",                  source: "manual" },
  { eaten_at: ts("2025-06-17","11:50"), meal_type: "lunch",     meal_name: "158g Keema Mutter, 100g yogurt, bowl mixed berries",                source: "manual" },
  { eaten_at: ts("2025-06-17","19:00"), meal_type: "dinner",    meal_name: "Char-broiled veggies (Brussels sprouts, peppers, mushrooms), salmon fillet", calories: 240, protein_g: 33, source: "manual" },
  // ── June 18 ──
  { eaten_at: ts("2025-06-18","08:00"), meal_type: "breakfast", meal_name: "2 boiled eggs, Premier Protein Chocolate Shake",                    source: "manual" },
  { eaten_at: ts("2025-06-18","13:00"), meal_type: "lunch",     meal_name: "Mixed cooked vegetables, 5 tbsp keema, 3 tbsp yogurt, Gouda",       source: "manual" },
  // ── June 19 ──
  { eaten_at: ts("2025-06-19","08:00"), meal_type: "breakfast", meal_name: "Omelette: 2 eggs, mushrooms, red bell pepper, spinach, tomato, hard cheese, butter", calories: 433, source: "manual" },
  { eaten_at: ts("2025-06-19","15:00"), meal_type: "snack",     meal_name: "5 handfuls popcorn",                                               calories: 150, carbs_g: 30, source: "manual" },
  { eaten_at: ts("2025-06-19","17:00"), meal_type: "drinks",    meal_name: "Warm water with chia seeds",                                        calories: 20,  fiber_g: 3.5, source: "manual" },
  { eaten_at: ts("2025-06-19","18:30"), meal_type: "dinner",    meal_name: "Shredded chicken, sweet peppers, zucchini, shredded cheese, butter", calories: 524, source: "manual" },
  // ── June 20 ──
  { eaten_at: ts("2025-06-20","15:00"), meal_type: "snack",     meal_name: "8 almonds",                                                         calories: 56,  source: "manual" },
  { eaten_at: ts("2025-06-20","18:00"), meal_type: "dinner",    meal_name: "Salmon fillet, half zucchini, mushrooms, tomatoes, sweet peppers (baked)", calories: 388, source: "manual" },
  // ── June 21 ──
  { eaten_at: ts("2025-06-21","15:41"), meal_type: "snack",     meal_name: "Salmon fillet, butter, mixed vegetables (peppers, zucchini, mushrooms, spinach, tomatoes)", calories: 512, source: "manual" },
  { eaten_at: ts("2025-06-21","16:00"), meal_type: "snack",     meal_name: "1 oz Gouda cheese",                                                 calories: 105, source: "manual" },
  { eaten_at: ts("2025-06-21","16:30"), meal_type: "snack",     meal_name: "2 sweet peppers",                                                   calories: 50,  source: "manual" },
  { eaten_at: ts("2025-06-21","17:30"), meal_type: "snack",     meal_name: "2 cups Flame Grilled Provençale Vegetables, 3/4 cup 0% Greek Yogurt", calories: 270, source: "manual" },
  // ── June 22 ──
  { eaten_at: ts("2025-06-22","09:00"), meal_type: "breakfast", meal_name: "2 boiled eggs, half avocado",                                       calories: 260, source: "manual" },
  { eaten_at: ts("2025-06-22","12:00"), meal_type: "snack",     meal_name: "1/6 cup pumpkin seeds",                                             calories: 107, source: "manual" },
  { eaten_at: ts("2025-06-22","13:30"), meal_type: "lunch",     meal_name: "Shakshuka: 2 eggs, mushrooms, sweet peppers, tomatoes, zucchini, olive oil, pasta sauce, garlic sauce, cheddar", calories: 715, source: "manual" },
  // ── June 23 ──
  { eaten_at: ts("2025-06-23","08:00"), meal_type: "breakfast", meal_name: "Smoked salmon, avocado, boiled egg, spinach, tomato, mixed berries, Greek yogurt", calories: 375, source: "manual" },
  { eaten_at: ts("2025-06-23","12:30"), meal_type: "lunch",     meal_name: "Roasted chicken, feta, hummus, cucumber salad, greens, roasted chickpeas", calories: 375, source: "manual" },
  { eaten_at: ts("2025-06-23","18:30"), meal_type: "dinner",    meal_name: "0% Greek yogurt, mixed charcoal veggies (Brussels sprouts), salmon, toum sauce", calories: 290, source: "manual" },
  // ── June 24 ──
  { eaten_at: ts("2025-06-24","08:15"), meal_type: "breakfast", meal_name: "Smoked salmon, avocado, boiled egg, spinach, tomato, mixed berries (1 cup), Greek yogurt", calories: 415, source: "manual" },
  { eaten_at: ts("2025-06-24","12:00"), meal_type: "lunch",     meal_name: "Lamb keema, raita",                                                  calories: 390, source: "manual" },
  { eaten_at: ts("2025-06-24","15:00"), meal_type: "snack",     meal_name: "2 Sargento Pepper Jack Cheese Sticks",                              calories: 180, source: "manual" },
  // ── June 25 ──
  { eaten_at: ts("2025-06-25","07:50"), meal_type: "breakfast", meal_name: "Smoked salmon, scrambled eggs (2), cottage cheese, spinach, sun-dried tomatoes, egg whites, cucumber, tomato", calories: 420, source: "manual" },
  { eaten_at: ts("2025-06-25","12:50"), meal_type: "lunch",     meal_name: "Lamb, lima beans, olives, hummus, salad, feta, squash",             calories: 620, source: "manual" },
  // ── June 26 ──
  { eaten_at: ts("2025-06-26","07:40"), meal_type: "breakfast", meal_name: "Smoked salmon, scrambled eggs (2), cottage cheese, egg whites, steamed broccoli, cucumber, tomato", calories: 400, source: "manual" },
  { eaten_at: ts("2025-06-26","12:30"), meal_type: "lunch",     meal_name: "Chicken korma, lamb keema, cucumber, rocket salad",                 calories: 700, source: "manual" },
  { eaten_at: ts("2025-06-26","18:00"), meal_type: "dinner",    meal_name: "Chicken broth",                                                      calories: 30,  source: "manual" },
  { eaten_at: ts("2025-06-26","19:45"), meal_type: "dinner",    meal_name: "Beef keema with 0% Greek yogurt",                                   calories: 390, source: "manual" },
  { eaten_at: ts("2025-06-26","20:15"), meal_type: "dessert",   meal_name: "Cappuccino cake slice (Paris Baguette)",                             calories: 500, source: "manual" },
  // ── June 27 ──
  { eaten_at: ts("2025-06-27","07:00"), meal_type: "breakfast", meal_name: "2 boiled eggs",                                                      calories: 150, source: "manual" },
  { eaten_at: ts("2025-06-27","12:30"), meal_type: "lunch",     meal_name: "Protein shake, 1 slice bread, 2 tbsp chicken mayo mix",             calories: 370, source: "manual" },
  { eaten_at: ts("2025-06-27","19:30"), meal_type: "dinner",    meal_name: "Chicken and kebab with rice, hummus, salad, sauce, extra chicken",  calories: 1000, source: "manual" },
  // ── June 28 ──
  { eaten_at: ts("2025-06-28","06:25"), meal_type: "breakfast", meal_name: "Hotel scrambled eggs, slivered almonds, raisins, oatmeal",          calories: 690, source: "manual" },
  { eaten_at: ts("2025-06-28","14:00"), meal_type: "lunch",     meal_name: "Turkey sandwich with cheese on 2 slices white bread",               calories: 395, source: "manual" },
  // ── June 29 ──
  { eaten_at: ts("2025-06-29","08:00"), meal_type: "breakfast", meal_name: "2 Burger King Egg and Cheese Biscuits",                              calories: 750, source: "manual", notes: "CGM peak ~120-125 mg/dL" },
  { eaten_at: ts("2025-06-29","13:00"), meal_type: "lunch",     meal_name: "Veggie Fried Rice",                                                  calories: 500, source: "manual", notes: "CGM peak ~120 mg/dL" },
  { eaten_at: ts("2025-06-29","21:00"), meal_type: "dinner",    meal_name: "Caesar salad, spaghetti, 3 meatballs",                               calories: 675, source: "manual", notes: "CGM peak ~110-120 mg/dL" },
  // ── June 30 ──
  { eaten_at: ts("2025-06-30","13:50"), meal_type: "lunch",     meal_name: "3 meatballs, spaghetti, chicken spread & cheese on toast, baby carrots, cherries", calories: 620, source: "manual", notes: "CGM peak ~110-115 mg/dL" },
  { eaten_at: ts("2025-06-30","19:30"), meal_type: "dinner",    meal_name: "Chicken biryani",                                                     calories: 750, source: "manual", notes: "CGM peak ~100-105 mg/dL — outstanding response" },
  // ── July 1 ──
  { eaten_at: ts("2025-07-01","10:00"), meal_type: "breakfast", meal_name: "Scrambled egg on half toast, 2 parathas, 4oz keema",                 calories: 820, source: "manual", notes: "CGM peak ~120-125 mg/dL" },
  { eaten_at: ts("2025-07-01","16:00"), meal_type: "lunch",     meal_name: "Beef pastrami sandwich",                                             calories: 500, source: "manual", notes: "CGM peak ~110-115 mg/dL" },
  { eaten_at: ts("2025-07-01","17:30"), meal_type: "snack",     meal_name: "Watermelon and apricot",                                             calories: 75,  source: "manual" },
  { eaten_at: ts("2025-07-01","20:30"), meal_type: "dinner",    meal_name: "6oz zucchini, 1 paratha",                                            calories: 235, source: "manual", notes: "CGM peak ~95-100 mg/dL — excellent response" },
  // ── July 2 ──
  { eaten_at: ts("2025-07-02","08:30"), meal_type: "breakfast", meal_name: "2 scrambled eggs, toast with butter, small cheesecake slice, coffee", calories: 630, source: "manual", notes: "CGM peak ~100-105 mg/dL" },
  { eaten_at: ts("2025-07-02","10:30"), meal_type: "snack",     meal_name: "Half Helado strawberry ice cream, half cannoli, Krinkle Cut chips", calories: 1000, source: "manual", notes: "CGM peak ~130-135 mg/dL — expected spike, good recovery" },
  { eaten_at: ts("2025-07-02","13:00"), meal_type: "lunch",     meal_name: "Burger in lettuce wrap",                                             calories: 425, source: "manual" },
  // ── July 3 ──
  { eaten_at: ts("2025-07-03","08:00"), meal_type: "snack",     meal_name: "Zucchini & carrot cake",                                            source: "manual", notes: "CGM peak ~130 mg/dL" },
  { eaten_at: ts("2025-07-03","14:00"), meal_type: "snack",     meal_name: "Watermelon",                                                        source: "manual", notes: "CGM peak ~105-110 mg/dL" },
  { eaten_at: ts("2025-07-03","18:00"), meal_type: "dinner",    meal_name: "Beef ribs, cake, flan",                                             source: "manual", notes: "CGM peak ~130-135 mg/dL — well-managed despite high sugar/carb" },
  // ── July 5 ──
  { eaten_at: ts("2025-07-05","09:30"), meal_type: "breakfast", meal_name: "Quinoa, 2 fried eggs, avocado, roasted cherry tomatoes, mushrooms", calories: 540, source: "manual", notes: "CGM peak ~110-115 mg/dL. After 2h28m hike." },
  { eaten_at: ts("2025-07-05","18:15"), meal_type: "snack",     meal_name: "Bowl of Doritos",                                                   calories: 375, source: "manual", notes: "CGM peak ~115-120 mg/dL" },
  // ── July 6 ──
  { eaten_at: ts("2025-07-06","13:00"), meal_type: "lunch",     meal_name: "2 boiled eggs, 1.5 cups veggie pulao, 2oz beef, yogurt, garlic sauce, mini naan", calories: 985, source: "manual" },
  // ── July 7 ──
  { eaten_at: ts("2025-07-07","11:30"), meal_type: "lunch",     meal_name: "Rotisserie chicken, okra, guacamole, salad, small apricots, white beans, red sauce, dark sauce", calories: 765, source: "manual" },
  { eaten_at: ts("2025-07-07","18:30"), meal_type: "dinner",    meal_name: "Chicken tinga, pinto beans, cooked vegetables (zucchini, bell peppers, onions), guacamole, crumbled egg", calories: 680, source: "manual" },
  // ── July 8 ──
  { eaten_at: ts("2025-07-08","20:00"), meal_type: "dinner",    meal_name: "1 boiled egg, 1 cup Greek yogurt",                                  calories: 200, source: "manual" },
  // ── July 9 ──
  { eaten_at: ts("2025-07-09","12:30"), meal_type: "lunch",     meal_name: "3 meatballs, lettuce salad, hummus, olives, cherry tomatoes, pumpkin seeds, fried chickpeas, mushrooms", calories: 500, source: "manual" },
  { eaten_at: ts("2025-07-09","15:00"), meal_type: "snack",     meal_name: "Apple",                                                             calories: 95,  source: "manual" },
  { eaten_at: ts("2025-07-09","18:30"), meal_type: "dinner",    meal_name: "Grilled fish with sauce, black-eyed peas, chopped hard-boiled egg, pickled red onions, cucumbers, macaroni salad", calories: 700, source: "manual" },
  // ── July 11 ──
  { eaten_at: ts("2025-07-11","18:30"), meal_type: "dinner",    meal_name: "8 oz beef steak (cooked in beef fat), 8 sweet peppers",             calories: 825, source: "manual" },

  // ── Sheet2: July 28 – August 9 2025 (full macros) ──
  { eaten_at: ts("2025-07-28","12:30"), meal_type: "lunch",     meal_name: "Regular salad with lamb",                                            calories: 565,  protein_g: 39,   fat_g: 33,   carbs_g: 23,   source: "manual" },
  { eaten_at: ts("2025-07-28","19:00"), meal_type: "snack",     meal_name: "4 single-serving cheese pieces",                                    calories: 320,  protein_g: 28,   fat_g: 24,   carbs_g: 4,    source: "manual" },
  { eaten_at: ts("2025-07-28","19:05"), meal_type: "snack",     meal_name: "2 oz cashews",                                                      calories: 310,  protein_g: 10,   fat_g: 26,   carbs_g: 18,   source: "manual" },
  { eaten_at: ts("2025-07-29","11:45"), meal_type: "lunch",     meal_name: "Regular salad with lamb",                                            calories: 565,  protein_g: 39,   fat_g: 33,   carbs_g: 23,   source: "manual" },
  { eaten_at: ts("2025-07-30","08:15"), meal_type: "breakfast", meal_name: "2 boiled eggs, small avocado, 4 cherries, 3 small strawberries",     calories: 336,  protein_g: 15,   fat_g: 25.3, carbs_g: 14.7, source: "manual" },
  { eaten_at: ts("2025-07-30","09:00"), meal_type: "drinks",    meal_name: "Mud water alternative coffee with MCT oil",                          calories: 25,   protein_g: 0,    fat_g: 2,    carbs_g: 0,    source: "manual" },
  { eaten_at: ts("2025-07-30","14:00"), meal_type: "snack",     meal_name: "Half an apple, 1 strawberry, half cup blueberries",                  calories: 94,   protein_g: 0.8,  fat_g: 0.4,  carbs_g: 24.5, source: "manual" },
  { eaten_at: ts("2025-07-30","14:15"), meal_type: "snack",     meal_name: "2 shilajit gummies",                                                 calories: 20,   protein_g: 0,    fat_g: 0,    carbs_g: 4,    source: "manual" },
  { eaten_at: ts("2025-07-30","17:15"), meal_type: "dinner",    meal_name: "Blended vegetable soup",                                             calories: 125,  protein_g: 5,    fat_g: 5,    carbs_g: 15,   source: "manual" },
  { eaten_at: ts("2025-07-30","18:00"), meal_type: "snack",     meal_name: "2 oz pumpkin seeds, 8 almonds",                                      calories: 376,  protein_g: 18,   fat_g: 33,   carbs_g: 12,   source: "manual" },
  { eaten_at: ts("2025-07-30","20:40"), meal_type: "dinner",    meal_name: "Pan-fried cod fillet, 1 cup pulao",                                  calories: 430,  protein_g: 35,   fat_g: 11,   carbs_g: 45,   source: "manual" },
  { eaten_at: ts("2025-07-31","12:30"), meal_type: "lunch",     meal_name: "Regular salad with lima beans and steamed shrimp",                   calories: 455,  protein_g: 43,   fat_g: 9,    carbs_g: 50,   source: "manual" },
  { eaten_at: ts("2025-08-03","19:00"), meal_type: "dinner",    meal_name: "6 oz beef kababs",                                                   calories: 450,  protein_g: 45,   fat_g: 28,   carbs_g: 5,    source: "manual" },
  { eaten_at: ts("2025-08-03","19:05"), meal_type: "dinner",    meal_name: "Veggie broth with sauteed mushrooms and butter",                     calories: 100,  protein_g: 3,    fat_g: 6,    carbs_g: 8,    source: "manual" },
  { eaten_at: ts("2025-08-03","19:10"), meal_type: "dinner",    meal_name: "3 oz pumpkin seeds",                                                 calories: 480,  protein_g: 24,   fat_g: 42,   carbs_g: 15,   source: "manual" },
  { eaten_at: ts("2025-08-04","12:30"), meal_type: "lunch",     meal_name: "5 oz chicken thigh, 2 tbsp okra, 2 tbsp chickpeas",                  calories: 372,  protein_g: 32.9, fat_g: 20.5, carbs_g: 9.5,  source: "manual" },
  { eaten_at: ts("2025-08-06","12:30"), meal_type: "lunch",     meal_name: "Regular salad with 3 meatballs",                                     calories: 445,  protein_g: 29,   fat_g: 26,   carbs_g: 28,   source: "manual" },
  { eaten_at: ts("2025-08-06","21:00"), meal_type: "dinner",    meal_name: "2 oz lamb chops, 10 almonds",                                        calories: 220,  protein_g: 17.5, fat_g: 16,   carbs_g: 3,    source: "manual" },
  { eaten_at: ts("2025-08-07","12:00"), meal_type: "lunch",     meal_name: "Regular salad with 3 meatballs and 1 cheese stick",                  calories: 525,  protein_g: 36,   fat_g: 32,   carbs_g: 29,   source: "manual" },
  { eaten_at: ts("2025-08-08","06:45"), meal_type: "breakfast", meal_name: "3 shilajit gummies",                                                 calories: 30,   protein_g: 0,    fat_g: 0,    carbs_g: 6,    source: "manual" },
  { eaten_at: ts("2025-08-08","09:15"), meal_type: "breakfast", meal_name: "3 oz smoked salmon, 2 scrambled eggs, avocado, Greek yogurt, mixed berries (1/2 cup)", calories: 371, protein_g: 33.1, fat_g: 19.5, carbs_g: 13.8, source: "manual" },
  { eaten_at: ts("2025-08-08","12:45"), meal_type: "lunch",     meal_name: "Regular salad with 2 meatballs",                                     calories: 361,  protein_g: 22,   fat_g: 20,   carbs_g: 26,   source: "manual" },
  { eaten_at: ts("2025-08-08","17:00"), meal_type: "snack",     meal_name: "3 cheese sticks",                                                    calories: 240,  protein_g: 21,   fat_g: 18,   carbs_g: 3,    source: "manual" },
  { eaten_at: ts("2025-08-08","17:05"), meal_type: "snack",     meal_name: "3 rings of pineapple",                                               calories: 126,  protein_g: 1.5,  fat_g: 0.3,  carbs_g: 33,   source: "manual" },
  { eaten_at: ts("2025-08-09","12:20"), meal_type: "lunch",     meal_name: "Protein shake, 2 glasses Brazilian lemonade, 5 oz steak",            calories: 820,  protein_g: 70,   fat_g: 30,   carbs_g: 65,   source: "manual" },

  // ── Thoughts: March 2026 ──
  { eaten_at: tsUtc("2026-03-23","11:45"), meal_type: "lunch",  meal_name: "Rice bowl: yellow rice, roasted lamb, mixed greens, cucumbers, tomatoes, chickpeas, olives, seeds, creamy dressing", calories: 555, protein_g: 35, fat_g: 32, carbs_g: 30, source: "claude", notes: "CGM: stable 90-105 mg/dL, current 100, flat trend" },
  { eaten_at: tsUtc("2026-03-24","12:00"), meal_type: "lunch",  meal_name: "Same as 3/23 lunch + pear and apple",                                source: "claude" },
  { eaten_at: tsUtc("2026-03-24","16:15"), meal_type: "lunch",  meal_name: "Keema, deep-fried paratha, yogurt, large banana",                    calories: 725, carbs_g: 103, protein_g: 68, fat_g: 70, source: "claude", notes: "CGM spike to 140-150 then rapid drop to 76 — reactive hypoglycemia pattern" },
  { eaten_at: tsUtc("2026-03-24","21:00"), meal_type: "dinner", meal_name: "Chicken shawarma, lentil soup, freekeh",                              source: "claude", notes: "Caused mild overnight glucose rise ~140 mg/dL at 3 AM (likely delayed digestion + dawn phenomenon)" },
];

// ── RUN ───────────────────────────────────────────────────────────────────────
await insert("blood_pressure", bloodPressure, "Blood Pressure (4 readings)");
await insert("blood_glucose", bloodGlucose, `Blood Glucose (${bloodGlucose.length} rows: ${a1cHistory.length} A1C + ${cgmReadings.length} CGM)`);
await insert("lumen_entries", lumenEntries, `Lumen Entries (${lumenEntries.length} readings)`);
await insert("meals", meals, `Meals (${meals.length} rows)`);

console.log("\nDone.");
