-- ============================================================
-- Migration: new_tables
-- All tables from Category 1 (MCP-registered but missing) and
-- Category 2 (new, discovered from thought analysis)
-- ============================================================

-- ── CATEGORY 1: MCP-registered tables ────────────────────────

CREATE TABLE IF NOT EXISTS lab_results (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject           text        NOT NULL DEFAULT 'Umair',
  test_date         date        NOT NULL,
  panel             text,                       -- CBC, CMP, Lipid, Liver, HbA1c, Vitamins, Advanced_Lipid
  marker            text        NOT NULL,       -- HbA1c, ALT, LDL, Hemoglobin, etc.
  value             numeric,
  unit              text,
  reference_low     numeric,
  reference_high    numeric,
  is_flagged        boolean     DEFAULT false,
  flag              text,                       -- HIGH, LOW, CRITICAL
  lab_name          text,
  notes             text,
  created_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lab_results_subject_date ON lab_results (subject, test_date DESC);
CREATE INDEX IF NOT EXISTS lab_results_marker ON lab_results (marker);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS medications (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  subject             text    NOT NULL DEFAULT 'Umair',
  drug_name           text    NOT NULL,
  dose                text,
  frequency           text,
  condition           text,                   -- reason prescribed
  prescribing_doctor  text,
  start_date          date,
  end_date            date,
  is_active           boolean DEFAULT true,
  notes               text,
  created_at          timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS diet_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject         text        NOT NULL DEFAULT 'Umair',
  meal_time       timestamptz NOT NULL,
  meal_type       text,       -- breakfast, lunch, dinner, snack, fast_break
  food_name       text        NOT NULL,
  calories        numeric,
  carbs_g         numeric,
  protein_g       numeric,
  fat_g           numeric,
  fiber_g         numeric,
  sugar_g         numeric,
  glycemic_index  integer,
  portion_size    text,
  notes           text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS diet_log_subject_time ON diet_log (subject, meal_time DESC);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance_income (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  income_date   date    NOT NULL,
  tax_year      integer NOT NULL,
  source        text    NOT NULL,             -- employer name, brokerage, etc.
  income_type   text,                         -- w2, rsu, bonus, dividend, capital_gains, rental, other
  gross_amount  numeric,
  net_amount    numeric,
  is_taxable    boolean DEFAULT true,
  notes         text,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finance_income_year ON finance_income (tax_year DESC);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance_donations (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_date       date    NOT NULL,
  tax_year            integer NOT NULL,
  charity_name        text    NOT NULL,
  donation_type       text,                   -- cash, stock, daf_contribution, daf_grant
  giving_category     text,                   -- zakat, sadaqa, general_charity
  amount              numeric,
  fair_market_value   numeric,                -- for stock donations
  cost_basis          numeric,                -- for stock donations
  is_tax_deductible   boolean DEFAULT true,
  daf_account         text,
  islamic_year        integer,                -- Hijri year e.g. 1447
  zakat_asset_type    text,                   -- cash, stock, real_estate, etc.
  notes               text,
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finance_donations_year ON finance_donations (tax_year DESC);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance_tax_profile (
  id                      uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_year                integer UNIQUE NOT NULL,
  filing_status           text    DEFAULT 'MFJ',
  state                   text    DEFAULT 'CA',
  estimated_gross_income  numeric,
  pre_tax_deductions      numeric,            -- 401k, HSA, etc.
  estimated_agi           numeric,
  itemized_deductions     numeric,
  standard_deduction      numeric,
  taxable_income          numeric,
  estimated_federal_tax   numeric,
  marginal_rate           numeric,
  effective_rate          numeric,
  child_tax_credit        numeric,
  notes                   text,
  updated_at              timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance_net_worth (
  id                  uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date       date  NOT NULL UNIQUE,
  liquid_cash         numeric,
  checking_savings    numeric,
  brokerage           numeric,
  retirement_401k     numeric,
  retirement_ira      numeric,
  home_equity         numeric,
  other_assets        numeric,
  total_assets        numeric,
  mortgage_balance    numeric,
  other_liabilities   numeric,
  total_liabilities   numeric,
  net_worth           numeric,
  notes               text
);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS family_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date  date        NOT NULL,
  event_time  time,
  title       text        NOT NULL,
  category    text,       -- medical, school, sports, religious, travel, milestone, financial
  people      text[],     -- family members involved
  location    text,
  status      text        DEFAULT 'upcoming',  -- upcoming, completed, cancelled
  notes       text,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS family_events_date ON family_events (event_date DESC);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS goals (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  subject       text    NOT NULL DEFAULT 'Umair',
  category      text    NOT NULL,             -- health, financial, family, career, education
  title         text    NOT NULL,
  description   text,
  target_value  numeric,
  current_value numeric,
  unit          text,
  target_date   date,
  status        text    DEFAULT 'active',     -- active, achieved, abandoned
  priority      integer DEFAULT 2,            -- 1=high, 2=medium, 3=low
  notes         text,
  updated_at    timestamptz DEFAULT now()
);

-- ── CATEGORY 2: New tables from thought analysis ─────────────

CREATE TABLE IF NOT EXISTS fasting_windows (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject         text        NOT NULL DEFAULT 'Umair',
  fast_start      timestamptz NOT NULL,
  fast_end        timestamptz,
  duration_hours  numeric     GENERATED ALWAYS AS (
                    ROUND(EXTRACT(EPOCH FROM (fast_end - fast_start)) / 3600.0, 1)
                  ) STORED,
  fast_type       text        DEFAULT 'intermittent',   -- intermittent, ramadan, extended, water_only
  broken_with     text,       -- first food eaten to break the fast
  notes           text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fasting_windows_start ON fasting_windows (fast_start DESC);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inr_readings (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject             text        NOT NULL DEFAULT 'Umair',
  recorded_at         timestamptz NOT NULL,
  inr_value           numeric     NOT NULL,
  target_low          numeric     DEFAULT 2.0,
  target_high         numeric     DEFAULT 3.0,
  in_range            boolean     GENERATED ALWAYS AS (
                        inr_value >= target_low AND inr_value <= target_high
                      ) STORED,
  warfarin_dose_mg    numeric,
  dose_adjusted       boolean     DEFAULT false,
  new_dose_mg         numeric,
  lab_name            text,
  ordering_doctor     text,
  notes               text,
  created_at          timestamptz DEFAULT now(),
  UNIQUE (subject, recorded_at)
);
CREATE INDEX IF NOT EXISTS inr_readings_date ON inr_readings (recorded_at DESC);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workouts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject         text        NOT NULL DEFAULT 'Umair',
  workout_date    date        NOT NULL,
  start_time      timestamptz,
  activity_type   text        NOT NULL,  -- spinning, strength, cardio, yoga, swim, run, walk, hiit, other
  duration_minutes integer,
  intensity       text,                  -- low, moderate, high
  calories_burned integer,
  hr_avg          integer,
  hr_max          integer,
  distance_km     numeric,
  location        text,
  equipment       text,
  notes           text,
  source          text        DEFAULT 'manual',  -- manual, fitbit, whoop, strava
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workouts_date ON workouts (workout_date DESC);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS weight_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject         text        NOT NULL DEFAULT 'Umair',
  recorded_at     timestamptz NOT NULL,
  weight_lbs      numeric     NOT NULL,
  weight_kg       numeric     GENERATED ALWAYS AS (ROUND(weight_lbs * 0.453592, 2)) STORED,
  body_fat_pct    numeric,
  muscle_mass_lbs numeric,
  bmi             numeric,
  fasting_hours   numeric,
  time_of_day     text,       -- morning, evening, midday
  notes           text,
  source          text        DEFAULT 'manual',  -- manual, withings, fitbit, smart_scale
  created_at      timestamptz DEFAULT now(),
  UNIQUE (subject, recorded_at)
);
CREATE INDEX IF NOT EXISTS weight_log_date ON weight_log (recorded_at DESC);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS medical_conditions (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  subject             text    NOT NULL DEFAULT 'Umair',
  condition_name      text    NOT NULL,
  icd_code            text,
  category            text,   -- autoimmune, metabolic, cardiovascular, musculoskeletal, other
  diagnosed_date      date,
  diagnosed_by        text,
  status              text    DEFAULT 'active',   -- active, resolved, managed, monitoring
  severity            text,                       -- mild, moderate, severe
  treatment_summary   text,
  notes               text,
  created_at          timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS eye_prescriptions (
  id            uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  subject       text  NOT NULL DEFAULT 'Umair',
  exam_date     date  NOT NULL,
  expiry_date   date,
  prescriber    text,
  clinic        text,
  lens_type     text,     -- single_vision, progressive, reading, distance, bifocal, contact
  -- Right eye (OD)
  od_sphere     numeric,
  od_cylinder   numeric,
  od_axis       integer,
  od_add        numeric,
  od_prism      numeric,
  -- Left eye (OS)
  os_sphere     numeric,
  os_cylinder   numeric,
  os_axis       integer,
  os_add        numeric,
  os_prism      numeric,
  -- Pupillary distance
  pd_right      numeric,
  pd_left       numeric,
  pd_binocular  numeric,
  notes         text,
  created_at    timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS doctor_visits (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject         text        NOT NULL DEFAULT 'Umair',
  visit_date      date        NOT NULL,
  visit_time      time,
  doctor_name     text,
  specialty       text,       -- cardiology, primary_care, endocrinology, ophthalmology, hematology
  clinic_name     text,
  visit_type      text,       -- routine, follow_up, urgent, telehealth, lab_only
  reason          text,
  findings        text,
  bp_systolic     integer,
  bp_diastolic    integer,
  pulse           integer,
  weight_lbs      numeric,
  next_appointment date,
  notes           text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS doctor_visits_date ON doctor_visits (visit_date DESC);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vehicle_log (
  id                      uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle                 text    NOT NULL DEFAULT 'Kia EV9',
  log_date                date    NOT NULL,
  log_type                text    NOT NULL,  -- maintenance, repair, insurance_claim, recall, service, incident
  title                   text    NOT NULL,
  description             text,
  cost_usd                numeric,
  mileage                 integer,
  vendor                  text,
  insurance_claim_number  text,
  status                  text    DEFAULT 'open',  -- open, in_progress, resolved, closed
  notes                   text,
  created_at              timestamptz DEFAULT now()
);
