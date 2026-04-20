-- ============================================================
-- Full Schema v2
-- Lab results, medications, diet, finances, family, goals
-- ============================================================

-- Unique index on health_metrics to enable upsert from MCP tools
CREATE UNIQUE INDEX IF NOT EXISTS health_metrics_unique
ON health_metrics (recorded_at, source, metric_type);

-- ============================================================
-- LAB RESULTS
-- ============================================================
CREATE TABLE IF NOT EXISTS lab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL DEFAULT 'Umair',
  test_date date NOT NULL,
  panel text,
  marker text NOT NULL,
  value numeric NOT NULL,
  unit text,
  reference_low numeric,
  reference_high numeric,
  is_flagged boolean DEFAULT false,
  flag text,
  lab_name text,
  ordering_doctor text,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (subject, test_date, marker)
);

-- ============================================================
-- MEDICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL DEFAULT 'Umair',
  drug_name text NOT NULL,
  dose text,
  frequency text,
  condition text,
  prescribing_doctor text,
  start_date date,
  end_date date,
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- DIET LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS diet_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL DEFAULT 'Umair',
  meal_time timestamptz NOT NULL,
  meal_type text,
  food_name text NOT NULL,
  calories int,
  carbs_g numeric,
  protein_g numeric,
  fat_g numeric,
  fiber_g numeric,
  sugar_g numeric,
  glycemic_index int,
  portion_size text,
  source text DEFAULT 'manual',
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- FINANCE: INCOME
-- ============================================================
CREATE TABLE IF NOT EXISTS finance_income (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  income_date date NOT NULL,
  tax_year int NOT NULL,
  source text NOT NULL,
  income_type text,
  gross_amount numeric NOT NULL,
  net_amount numeric,
  is_taxable boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- FINANCE: DONATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS finance_donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_date date NOT NULL,
  tax_year int NOT NULL,
  charity_name text NOT NULL,
  donation_type text,
  amount numeric NOT NULL,
  fair_market_value numeric,
  cost_basis numeric,
  is_tax_deductible boolean DEFAULT true,
  daf_account text,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- FINANCE: TAX PROFILE
-- ============================================================
CREATE TABLE IF NOT EXISTS finance_tax_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_year int NOT NULL UNIQUE,
  filing_status text DEFAULT 'married_filing_jointly',
  state text DEFAULT 'CA',
  estimated_gross_income numeric,
  pre_tax_deductions numeric,
  estimated_agi numeric,
  itemized_deductions numeric,
  standard_deduction numeric DEFAULT 30000,
  taxable_income numeric,
  estimated_federal_tax numeric,
  estimated_state_tax numeric,
  effective_rate numeric,
  marginal_rate numeric,
  child_tax_credit numeric,
  notes text,
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- FINANCE: NET WORTH SNAPSHOTS
-- ============================================================
CREATE TABLE IF NOT EXISTS finance_net_worth (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL UNIQUE,
  liquid_cash numeric,
  checking_savings numeric,
  brokerage numeric,
  retirement_401k numeric,
  retirement_ira numeric,
  home_equity numeric,
  other_assets numeric,
  total_assets numeric,
  mortgage_balance numeric,
  other_liabilities numeric,
  total_liabilities numeric,
  net_worth numeric,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- FAMILY EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS family_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date date NOT NULL,
  event_time time,
  title text NOT NULL,
  category text,
  people text[],
  location text,
  status text DEFAULT 'upcoming',
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- GOALS
-- ============================================================
CREATE TABLE IF NOT EXISTS goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text DEFAULT 'Umair',
  category text,
  title text NOT NULL,
  description text,
  target_value numeric,
  current_value numeric,
  unit text,
  target_date date,
  status text DEFAULT 'active',
  priority text DEFAULT 'normal',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- SEED: Medications (from medical records in thoughts)
-- ============================================================
INSERT INTO medications (subject, drug_name, dose, frequency, condition, is_active) VALUES
('Umair', 'Warfarin', '10mg', 'daily', 'Antiphospholipid Syndrome (APS) - blood clotting disorder', true),
('Umair', 'Lisinopril', '10mg', 'daily', 'Blood pressure / heart', true),
('Umair', 'Aspirin', '81mg', 'daily', 'Blood thinner / heart health', true),
('Umair', 'Lipitor', '80mg', 'daily', 'High cholesterol (statin)', true);

-- ============================================================
-- SEED: Lab results - HbA1c history
-- ============================================================
INSERT INTO lab_results (subject, test_date, panel, marker, value, unit, reference_low, reference_high, is_flagged, flag) VALUES
('Umair', '2021-05-03', 'HbA1c', 'HbA1c', 6.2, '%', 4.0, 5.6, true, 'HIGH'),
('Umair', '2021-10-22', 'HbA1c', 'HbA1c', 5.8, '%', 4.0, 5.6, true, 'HIGH'),
('Umair', '2021-12-10', 'HbA1c', 'HbA1c', 5.8, '%', 4.0, 5.6, true, 'HIGH'),
('Umair', '2022-03-11', 'HbA1c', 'HbA1c', 6.0, '%', 4.0, 5.6, true, 'HIGH'),
('Umair', '2023-03-10', 'HbA1c', 'HbA1c', 5.9, '%', 4.0, 5.6, true, 'HIGH'),
('Umair', '2023-07-17', 'HbA1c', 'HbA1c', 6.1, '%', 4.0, 5.6, true, 'HIGH'),
('Umair', '2025-01-10', 'HbA1c', 'HbA1c', 6.0, '%', 4.0, 5.6, true, 'HIGH'),
('Umair', '2026-01-15', 'HbA1c', 'HbA1c', 6.0, '%', 4.0, 5.6, true, 'HIGH');

-- ============================================================
-- SEED: Lab results - Lipid panel history
-- ============================================================
INSERT INTO lab_results (subject, test_date, panel, marker, value, unit, reference_high, is_flagged, flag) VALUES
('Umair', '2021-05-03', 'Lipid', 'Total Cholesterol', 207, 'mg/dL', 200, true, 'HIGH'),
('Umair', '2021-05-03', 'Lipid', 'Triglycerides', 167, 'mg/dL', 150, true, 'HIGH'),
('Umair', '2021-05-03', 'Lipid', 'LDL', 137, 'mg/dL', 100, true, 'HIGH'),
('Umair', '2021-10-22', 'Lipid', 'Total Cholesterol', 86, 'mg/dL', 200, false, null),
('Umair', '2021-10-22', 'Lipid', 'LDL', 38, 'mg/dL', 100, false, null),
('Umair', '2021-12-10', 'Lipid', 'Total Cholesterol', 118, 'mg/dL', 200, false, null),
('Umair', '2021-12-10', 'Lipid', 'LDL', 64, 'mg/dL', 100, false, null),
('Umair', '2022-03-11', 'Lipid', 'Total Cholesterol', 137, 'mg/dL', 200, false, null),
('Umair', '2022-03-11', 'Lipid', 'LDL', 73, 'mg/dL', 100, false, null),
('Umair', '2023-03-10', 'Lipid', 'Total Cholesterol', 112, 'mg/dL', 200, false, null),
('Umair', '2023-03-10', 'Lipid', 'LDL', 53, 'mg/dL', 100, false, null),
('Umair', '2024-05-31', 'Lipid', 'Total Cholesterol', 127, 'mg/dL', 200, false, null),
('Umair', '2024-05-31', 'Lipid', 'LDL', 57, 'mg/dL', 100, false, null),
('Umair', '2025-01-10', 'Lipid', 'Total Cholesterol', 130, 'mg/dL', 200, false, null),
('Umair', '2025-01-10', 'Lipid', 'LDL', 69, 'mg/dL', 100, false, null),
('Umair', '2026-01-15', 'Lipid', 'Total Cholesterol', 126, 'mg/dL', 200, false, null),
('Umair', '2026-01-15', 'Lipid', 'LDL', 70, 'mg/dL', 100, false, null);

INSERT INTO lab_results (subject, test_date, panel, marker, value, unit, reference_low, is_flagged, flag) VALUES
('Umair', '2021-05-03', 'Lipid', 'HDL', 37, 'mg/dL', 40, true, 'LOW'),
('Umair', '2021-10-22', 'Lipid', 'HDL', 38, 'mg/dL', 40, true, 'LOW'),
('Umair', '2021-12-10', 'Lipid', 'HDL', 45, 'mg/dL', 40, false, null),
('Umair', '2022-03-11', 'Lipid', 'HDL', 49, 'mg/dL', 40, false, null),
('Umair', '2023-03-10', 'Lipid', 'HDL', 39, 'mg/dL', 40, true, 'LOW'),
('Umair', '2024-05-31', 'Lipid', 'HDL', 50, 'mg/dL', 40, false, null),
('Umair', '2025-01-10', 'Lipid', 'HDL', 42, 'mg/dL', 40, false, null),
('Umair', '2026-01-15', 'Lipid', 'HDL', 43, 'mg/dL', 40, false, null);

-- ============================================================
-- SEED: Lab results - Liver panel history
-- ============================================================
INSERT INTO lab_results (subject, test_date, panel, marker, value, unit, reference_high, is_flagged, flag) VALUES
('Umair', '2021-07-17', 'Liver', 'ALT', 52, 'U/L', 60, false, null),
('Umair', '2023-03-10', 'Liver', 'ALT', 59, 'U/L', 60, false, null),
('Umair', '2023-07-17', 'Liver', 'ALT', 52, 'U/L', 60, false, null),
('Umair', '2025-01-10', 'Liver', 'ALT', 62, 'U/L', 60, true, 'HIGH'),
('Umair', '2025-01-10', 'Liver', 'AST', 60, 'U/L', 40, true, 'HIGH'),
('Umair', '2025-03-14', 'Liver', 'ALT', 44, 'U/L', 60, false, null),
('Umair', '2025-03-14', 'Liver', 'AST', 32, 'U/L', 40, false, null),
('Umair', '2026-01-15', 'Liver', 'ALT', 43, 'U/L', 60, false, null),
('Umair', '2026-01-15', 'Liver', 'AST', 26, 'U/L', 40, false, null),
('Umair', '2026-02-20', 'Liver', 'ALT', 58, 'U/L', 60, false, null),
('Umair', '2026-02-20', 'Liver', 'AST', 34, 'U/L', 40, false, null),
('Umair', '2026-02-20', 'Liver', 'Alkaline Phosphatase', 99, 'U/L', 120, false, null),
('Umair', '2026-02-20', 'Liver', 'Albumin', 4.0, 'g/dL', 5.0, false, null),
('Umair', '2026-02-20', 'Liver', 'Bilirubin Total', 0.4, 'mg/dL', 1.2, false, null);

-- ============================================================
-- SEED: Lab results - Vitamin B history
-- ============================================================
INSERT INTO lab_results (subject, test_date, panel, marker, value, unit, reference_low, reference_high, is_flagged, flag) VALUES
('Umair', '2021-09-21', 'Vitamins', 'Vitamin B1 Thiamine', 7, 'nmol/L', 8, 30, true, 'LOW'),
('Umair', '2021-09-21', 'Vitamins', 'Vitamin B2 Riboflavin', 5, 'nmol/L', 6.2, 39, true, 'LOW'),
('Umair', '2021-09-21', 'Vitamins', 'Vitamin B6', 20.7, 'ng/mL', 2.1, 21.7, false, null),
('Umair', '2021-09-21', 'Vitamins', 'Vitamin B12', 760, 'pg/mL', 211, 911, false, null),
('Umair', '2026-01-15', 'Vitamins', 'Vitamin B1 Thiamine', 7, 'nmol/L', 8, 30, true, 'LOW'),
('Umair', '2026-01-15', 'Vitamins', 'Vitamin B2 Riboflavin', 5.8, 'nmol/L', 6.2, 39, true, 'LOW'),
('Umair', '2026-01-15', 'Vitamins', 'Vitamin B6', 16.8, 'ng/mL', 2.1, 21.7, false, null),
('Umair', '2026-01-15', 'Vitamins', 'Vitamin B12', 540, 'pg/mL', 211, 911, false, null);

-- ============================================================
-- SEED: Goals (health + financial)
-- ============================================================
INSERT INTO goals (subject, category, title, target_value, unit, status, priority, notes) VALUES
('Umair', 'health', 'Reduce HbA1c below 5.7 (pre-diabetic range)', 5.7, '%', 'active', 'high', 'Persistently at 6.0% since 2021. CGM + diet tracking to identify spikes.'),
('Umair', 'health', 'Improve HDL cholesterol above 50', 50, 'mg/dL', 'active', 'normal', 'HDL has been borderline low. Exercise and diet.'),
('Umair', 'health', 'Maintain ALT below 40 (safe Lipitor range)', 40, 'U/L', 'active', 'high', 'ALT near upper limit repeatedly on Lipitor 80mg. Monitor closely.'),
('Umair', 'financial', 'Max 401k contributions', 23500, '$', 'active', 'high', 'Reduces AGI for tax bracket optimization.'),
('Umair', 'financial', 'Recover Child Tax Credit via donations/deductions', 6000, '$', 'active', 'high', 'AGI over $400k phases out $6k CTC. Donate to reduce AGI below threshold.');

-- ============================================================
-- FINANCE DONATIONS: Add Zakat/Sadaqa tracking
-- ============================================================

-- giving_category: distinguishes zakat (obligation), sadaqa (voluntary),
-- and general_charity (secular/other)
ALTER TABLE finance_donations
  ADD COLUMN IF NOT EXISTS giving_category text DEFAULT 'general_charity',
  ADD COLUMN IF NOT EXISTS islamic_year int,
  ADD COLUMN IF NOT EXISTS ramadan_approximate_date date,
  ADD COLUMN IF NOT EXISTS zakat_asset_type text;

-- giving_category values: zakat, sadaqa, general_charity
-- islamic_year: Hijri year e.g. 1446 (2025), 1447 (2026)
-- zakat_asset_type: savings, investments, gold, business (for Zakat breakdown)
-- ramadan_approximate_date: first day of Ramadan for that year (shifts ~10 days/year)

-- Known Ramadan start dates for reference:
-- 1445 AH = 2024-03-11
-- 1446 AH = 2025-03-01
-- 1447 AH = 2026-02-18
-- 1448 AH = 2027-02-08
