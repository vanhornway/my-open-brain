-- ── HEALTH TRACKING TABLES ──────────────────────────────────────────────────
-- meals, blood_glucose, lumen_entries, blood_pressure
-- All tables timestamped; designed for CGM correlation queries.

-- ── MEALS ────────────────────────────────────────────────────────────────────
-- Meal-level log (one row per meal, not per food item like diet_log).
-- Macros can be AI-extracted from food photos or entered manually.

CREATE TABLE IF NOT EXISTS meals (
  id             bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject        text          NOT NULL DEFAULT 'Umair',
  meal_name      text          NOT NULL,
  eaten_at       timestamptz   NOT NULL,
  meal_type      text          NOT NULL                          -- breakfast | lunch | dinner | snack | drinks | dessert
    CHECK (meal_type IN ('breakfast','lunch','dinner','snack','drinks','dessert')),
  calories       numeric(7,1),
  carbs_g        numeric(6,1),
  protein_g      numeric(6,1),
  fat_g          numeric(6,1),
  fiber_g        numeric(5,1),
  sugar_g        numeric(6,1),
  sodium_mg      numeric(7,1),
  glycemic_index int,
  ingredients    jsonb,         -- e.g. [{"name":"oats","amount":"80g"},...]
  source         text          DEFAULT 'manual'
    CHECK (source IN ('photo','chatgpt','gemini','claude','myfitnesspal','manual')),
  notes          text,
  created_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meals_eaten_at_idx  ON meals (eaten_at DESC);
CREATE INDEX IF NOT EXISTS meals_subject_idx   ON meals (subject);
CREATE INDEX IF NOT EXISTS meals_meal_type_idx ON meals (meal_type);


-- ── BLOOD GLUCOSE ─────────────────────────────────────────────────────────────
-- Stores CGM readings, manual prick tests, and A1C results.
-- Estimated A1C view calculated from rolling 90-day CGM average.

CREATE TABLE IF NOT EXISTS blood_glucose (
  id             bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject        text          NOT NULL DEFAULT 'Umair',
  recorded_at    timestamptz   NOT NULL,
  glucose_mg_dl  numeric(5,1),                                  -- NULL for A1C-only rows
  a1c_percent    numeric(4,2),                                  -- NULL for spot readings
  reading_type   text          NOT NULL DEFAULT 'cgm'
    CHECK (reading_type IN ('cgm','manual_prick','a1c_lab')),
  source         text          DEFAULT 'manual'
    CHECK (source IN ('libre3','dexcom','manual','lab','screenshot')),
  trend          text                                           -- rising_fast | rising | stable | falling | falling_fast
    CHECK (trend IN ('rising_fast','rising','stable','falling','falling_fast') OR trend IS NULL),
  fasting        boolean       DEFAULT false,
  notes          text,
  created_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS blood_glucose_unique
  ON blood_glucose (subject, recorded_at, reading_type);

CREATE INDEX IF NOT EXISTS blood_glucose_recorded_at_idx ON blood_glucose (recorded_at DESC);
CREATE INDEX IF NOT EXISTS blood_glucose_subject_idx     ON blood_glucose (subject);

-- Estimated A1C from rolling 90-day CGM average
-- Formula: (avg_mg_dl + 46.7) / 28.7  (Nathan 2008 / ADA)
CREATE OR REPLACE VIEW estimated_a1c AS
SELECT
  subject,
  round(avg(glucose_mg_dl), 1)                         AS avg_glucose_90d,
  round(((avg(glucose_mg_dl) + 46.7) / 28.7)::numeric, 2) AS estimated_a1c,
  count(*)                                              AS reading_count,
  min(recorded_at)                                      AS window_start,
  max(recorded_at)                                      AS window_end
FROM blood_glucose
WHERE reading_type IN ('cgm','manual_prick')
  AND glucose_mg_dl IS NOT NULL
  AND recorded_at >= now() - interval '90 days'
GROUP BY subject;


-- ── LUMEN ENTRIES ─────────────────────────────────────────────────────────────
-- Daily or per-session Lumen metabolic breath scores (1–5 scale).
-- 1–2 = fat burn, 3 = mixed, 4–5 = carb burn.

CREATE TABLE IF NOT EXISTS lumen_entries (
  id                   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject              text        NOT NULL DEFAULT 'Umair',
  recorded_at          timestamptz NOT NULL,
  score                int         NOT NULL CHECK (score BETWEEN 1 AND 5),
  interpretation       text        GENERATED ALWAYS AS (
    CASE
      WHEN score <= 2 THEN 'fat_burn'
      WHEN score  = 3 THEN 'mixed'
      ELSE                 'carb_burn'
    END
  ) STORED,
  measurement_context  text        DEFAULT 'morning'
    CHECK (measurement_context IN ('morning','pre_workout','post_workout','pre_meal','post_meal')),
  co2_ppm              int,        -- raw CO2 reading if available
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lumen_entries_unique
  ON lumen_entries (subject, recorded_at);

CREATE INDEX IF NOT EXISTS lumen_entries_recorded_at_idx ON lumen_entries (recorded_at DESC);


-- ── BLOOD PRESSURE ────────────────────────────────────────────────────────────
-- Systolic / diastolic / heart rate readings.
-- Location defaults to home; source tracks whether it came from a device, Whoop CSV, or was typed in.

CREATE TABLE IF NOT EXISTS blood_pressure (
  id                   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject              text        NOT NULL DEFAULT 'Umair',
  recorded_at          timestamptz NOT NULL,
  systolic             int         NOT NULL,
  diastolic            int         NOT NULL,
  heart_rate_bpm       int,
  measurement_location text        NOT NULL DEFAULT 'home'
    CHECK (measurement_location IN ('home','doctors_office','whoop')),
  source               text        NOT NULL DEFAULT 'monitor'
    CHECK (source IN ('monitor','whoop_csv','manual','screenshot')),
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blood_pressure_recorded_at_idx ON blood_pressure (recorded_at DESC);
CREATE INDEX IF NOT EXISTS blood_pressure_subject_idx     ON blood_pressure (subject);


-- ── CORRELATION VIEW: meals → glucose reaction ────────────────────────────────
-- For each meal, shows the peak and average glucose in the 2-hour post-meal window.

CREATE OR REPLACE VIEW meal_glucose_response AS
SELECT
  m.id                                        AS meal_id,
  m.subject,
  m.eaten_at,
  m.meal_name,
  m.meal_type,
  m.calories,
  m.carbs_g,
  m.glycemic_index,
  round(max(bg.glucose_mg_dl)::numeric, 1)   AS peak_glucose,
  round(avg(bg.glucose_mg_dl)::numeric, 1)   AS avg_glucose_2h,
  round(max(bg.glucose_mg_dl)::numeric - min(bg.glucose_mg_dl)::numeric, 1) AS glucose_rise,
  count(bg.id)                               AS cgm_readings_in_window
FROM meals m
LEFT JOIN blood_glucose bg
       ON bg.subject       = m.subject
      AND bg.reading_type IN ('cgm','manual_prick')
      AND bg.recorded_at  >= m.eaten_at
      AND bg.recorded_at  <  m.eaten_at + interval '2 hours'
GROUP BY
  m.id, m.subject, m.eaten_at, m.meal_name, m.meal_type,
  m.calories, m.carbs_g, m.glycemic_index;
