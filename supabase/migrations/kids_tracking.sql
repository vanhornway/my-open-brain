-- ============================================================
-- Kids Tracking Schema
-- Scouts + College Prep for Nyel, Emaad, Omer
-- ============================================================

-- Core kids profiles
CREATE TABLE IF NOT EXISTS kids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  nickname text,
  grade int,
  school text,
  graduation_year int,
  birth_year int,
  notes text,
  updated_at timestamptz DEFAULT now()
);

-- Scout progress (one row per kid, upserted as stats change)
CREATE TABLE IF NOT EXISTS scout_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kid_name text NOT NULL UNIQUE REFERENCES kids(name),
  current_rank text,         -- Scout, Tenderfoot, 2nd Class, 1st Class, Star, Life, Eagle
  rank_date date,            -- date current rank was achieved
  merit_badges_completed int DEFAULT 0,
  eagle_required_badges_done int DEFAULT 0,
  camping_nights int DEFAULT 0,
  hiking_miles numeric DEFAULT 0,
  service_hours numeric DEFAULT 0,
  leadership_role text,
  nylt_completed boolean DEFAULT false,
  eagle_project_status text DEFAULT 'not_started', -- not_started, planning, approved, in_progress, completed
  notes text,
  as_of_date date DEFAULT current_date,
  updated_at timestamptz DEFAULT now()
);

-- Individual merit badges per kid
CREATE TABLE IF NOT EXISTS scout_merit_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kid_name text NOT NULL REFERENCES kids(name),
  badge_name text NOT NULL,
  is_eagle_required boolean DEFAULT false,
  completed_date date,
  counselor text,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(kid_name, badge_name)
);

-- College prep milestone timeline
CREATE TABLE IF NOT EXISTS college_prep_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kid_name text NOT NULL REFERENCES kids(name),
  phase text,                -- e.g. "sophomore", "junior", "summer_2026", "senior"
  task text NOT NULL,
  deadline_date date,
  status text DEFAULT 'pending',   -- pending, in_progress, completed, skipped
  priority text DEFAULT 'normal',  -- high, normal, low
  completed_date date,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- College prep activity log (shadowing, test scores, programs, etc.)
CREATE TABLE IF NOT EXISTS college_prep_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kid_name text NOT NULL REFERENCES kids(name),
  activity_type text NOT NULL,  -- shadowing, volunteer, extracurricular, summer_program, test_score, course, award
  title text NOT NULL,
  activity_date date,
  hours numeric,
  score text,         -- for test scores: "1350 SAT", "34 ACT"
  location text,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- SEED: Kids profiles
-- ============================================================
INSERT INTO kids (name, grade, graduation_year, notes) VALUES
  ('Nyel', 11, 2027, 'Eagle Scout path - Life rank. Final stretch: Eagle project + remaining requirements.'),
  ('Emaad', 10, 2028, 'Eagle Scout path - Star rank. College focus: dentistry. SAT target 1350+.'),
  ('Omer', 4, 2034, 'Elementary school. Scout participation TBD.')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- SEED: Scout progress (from thoughts data)
-- ============================================================
INSERT INTO scout_progress (
  kid_name, current_rank, rank_date, merit_badges_completed,
  camping_nights, hiking_miles, service_hours,
  leadership_role, nylt_completed, eagle_project_status,
  notes, as_of_date
) VALUES (
  'Nyel', 'Life', '2026-03-01', 20,
  35, 28.8, 30.5,
  'Assistant SPL', true, 'not_started',
  'Advanced from Star to Life ~Mar 2026. Needs Eagle project approval and remaining merit badges.',
  '2026-03-22'
),
(
  'Emaad', 'Star', '2026-03-01', NULL,
  31, NULL, 12.5,
  'Quartermaster', false, 'not_started',
  'Advanced from First Class to Star ~Mar 2026. Mid-stage: focus on merit badges, service, leadership tenure.',
  '2026-03-22'
)
ON CONFLICT (kid_name) DO NOTHING;

-- ============================================================
-- SEED: Emaad college prep timeline (from thoughts data)
-- ============================================================
INSERT INTO college_prep_timeline (kid_name, phase, task, deadline_date, status, priority) VALUES
('Emaad', 'sophomore', 'Enroll in AP Biology or Honors Chemistry', '2026-06-01', 'pending', 'high'),
('Emaad', 'sophomore', 'Start dental office shadowing in San Jose', '2026-06-01', 'pending', 'high'),
('Emaad', 'sophomore', 'Identify sustained extracurricular activity', '2026-06-01', 'pending', 'normal'),
('Emaad', 'summer_2026', 'Continue dental shadowing - target 60+ hrs by end of junior year', '2026-08-31', 'pending', 'high'),
('Emaad', 'summer_2026', 'Healthcare volunteer work', '2026-08-31', 'pending', 'normal'),
('Emaad', 'summer_2026', 'Light PSAT prep', '2026-08-31', 'pending', 'normal'),
('Emaad', 'junior', 'Take PSAT October 2026 (National Merit qualifying)', '2026-10-15', 'pending', 'high'),
('Emaad', 'junior', 'Enroll in AP Chemistry and AP Biology', '2026-09-01', 'pending', 'high'),
('Emaad', 'junior', 'SAT first attempt - target 1350+', '2027-04-01', 'pending', 'high'),
('Emaad', 'junior', 'Start college list', '2027-03-01', 'pending', 'normal'),
('Emaad', 'summer_2027', 'Strong summer experience / program', '2027-08-31', 'pending', 'high'),
('Emaad', 'summer_2027', 'Draft Common App essay', '2027-08-31', 'pending', 'high'),
('Emaad', 'summer_2027', 'Finalize college list', '2027-08-31', 'pending', 'normal'),
('Emaad', 'senior', 'Submit UC application', '2027-11-30', 'pending', 'high'),
('Emaad', 'senior', 'Complete FAFSA', '2027-10-01', 'pending', 'high'),
('Emaad', 'senior', 'College enrollment decision', '2028-05-01', 'pending', 'high')
ON CONFLICT DO NOTHING;
