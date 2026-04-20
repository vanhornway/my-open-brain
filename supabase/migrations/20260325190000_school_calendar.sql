-- ============================================================
-- Migration: school_calendar
-- School break / no-school events for Nyel, Emaad (EVHS) and
-- Omer (Silver Oak Elementary / Evergreen School District).
-- Used for family vacation planning — query is_no_school=true
-- rows across all schools to find shared free windows.
-- ============================================================

CREATE TABLE IF NOT EXISTS school_calendar (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  school       text    NOT NULL,       -- 'EVHS' | 'Silver Oak Elementary'
  people       text[]  NOT NULL,       -- {'Nyel','Emaad'} | {'Omer'}
  school_year  text    NOT NULL,       -- '2025-2026' | '2026-2027' | '2027-2028'
  event_type   text    NOT NULL,       -- 'break' | 'holiday' | 'no_school' | 'first_day' | 'last_day' | 'minimum_day' | 'staff_dev'
  title        text    NOT NULL,
  start_date   date    NOT NULL,
  end_date     date    NOT NULL,       -- same as start_date for single-day events
  is_no_school boolean NOT NULL DEFAULT true,  -- false for first_day/last_day/minimum_day
  notes        text,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_calendar_date ON school_calendar (start_date, end_date);
CREATE INDEX IF NOT EXISTS school_calendar_school ON school_calendar (school);
CREATE INDEX IF NOT EXISTS school_calendar_no_school ON school_calendar (is_no_school, start_date);

-- ── EVHS — 2025-2026 ─────────────────────────────────────────
INSERT INTO school_calendar (school, people, school_year, event_type, title, start_date, end_date, is_no_school) VALUES
('EVHS', ARRAY['Nyel','Emaad'], '2025-2026', 'first_day',  'First Day of School',    '2025-08-07', '2025-08-07', false),
('EVHS', ARRAY['Nyel','Emaad'], '2025-2026', 'holiday',    'Labor Day',               '2025-09-01', '2025-09-01', true),
('EVHS', ARRAY['Nyel','Emaad'], '2025-2026', 'break',      'Fall Break',              '2025-10-06', '2025-10-10', true),
('EVHS', ARRAY['Nyel','Emaad'], '2025-2026', 'holiday',    'Veterans Day',            '2025-11-10', '2025-11-11', true),
('EVHS', ARRAY['Nyel','Emaad'], '2025-2026', 'break',      'Thanksgiving Break',      '2025-11-24', '2025-11-28', true),
('EVHS', ARRAY['Nyel','Emaad'], '2025-2026', 'break',      'Holiday Break',           '2025-12-22', '2026-01-02', true),
('EVHS', ARRAY['Nyel','Emaad'], '2025-2026', 'holiday',    'MLK Day',                 '2026-01-19', '2026-01-19', true),
('EVHS', ARRAY['Nyel','Emaad'], '2025-2026', 'break',      'Winter Break',            '2026-02-16', '2026-02-20', true),
('EVHS', ARRAY['Nyel','Emaad'], '2025-2026', 'holiday',    'César Chávez Day',        '2026-03-30', '2026-03-30', true),
('EVHS', ARRAY['Nyel','Emaad'], '2025-2026', 'break',      'Spring Break',            '2026-04-06', '2026-04-10', true),
('EVHS', ARRAY['Nyel','Emaad'], '2025-2026', 'holiday',    'Memorial Day',            '2026-05-25', '2026-05-25', true),
('EVHS', ARRAY['Nyel','Emaad'], '2025-2026', 'last_day',   'Last Day of School',      '2026-06-04', '2026-06-04', false);

-- ── EVHS — 2026-2027 ─────────────────────────────────────────
INSERT INTO school_calendar (school, people, school_year, event_type, title, start_date, end_date, is_no_school) VALUES
('EVHS', ARRAY['Nyel','Emaad'], '2026-2027', 'first_day',  'First Day of School',    '2026-08-06', '2026-08-06', false),
('EVHS', ARRAY['Nyel','Emaad'], '2026-2027', 'holiday',    'Labor Day',               '2026-09-07', '2026-09-07', true),
('EVHS', ARRAY['Nyel','Emaad'], '2026-2027', 'break',      'Fall Break',              '2026-09-28', '2026-10-02', true),
('EVHS', ARRAY['Nyel','Emaad'], '2026-2027', 'holiday',    'Veterans Day',            '2026-11-11', '2026-11-11', true),
('EVHS', ARRAY['Nyel','Emaad'], '2026-2027', 'break',      'Thanksgiving Break',      '2026-11-23', '2026-11-27', true),
('EVHS', ARRAY['Nyel','Emaad'], '2026-2027', 'break',      'Holiday Break',           '2026-12-21', '2027-01-01', true),
('EVHS', ARRAY['Nyel','Emaad'], '2026-2027', 'holiday',    'MLK Day',                 '2027-01-18', '2027-01-18', true),
('EVHS', ARRAY['Nyel','Emaad'], '2026-2027', 'break',      'Winter Break',            '2027-02-15', '2027-02-19', true),
('EVHS', ARRAY['Nyel','Emaad'], '2026-2027', 'holiday',    'César Chávez Day',        '2027-03-29', '2027-03-29', true),
('EVHS', ARRAY['Nyel','Emaad'], '2026-2027', 'break',      'Spring Break',            '2027-04-05', '2027-04-09', true),
('EVHS', ARRAY['Nyel','Emaad'], '2026-2027', 'no_school',  'Mental Health Awareness Day', '2027-04-30', '2027-04-30', true),
('EVHS', ARRAY['Nyel','Emaad'], '2026-2027', 'holiday',    'Memorial Day',            '2027-05-31', '2027-05-31', true),
('EVHS', ARRAY['Nyel','Emaad'], '2026-2027', 'last_day',   'Last Day of School',      '2027-06-03', '2027-06-03', false);

-- ── EVHS — 2027-2028 ─────────────────────────────────────────
INSERT INTO school_calendar (school, people, school_year, event_type, title, start_date, end_date, is_no_school) VALUES
('EVHS', ARRAY['Nyel','Emaad'], '2027-2028', 'first_day',  'First Day of School',    '2027-08-05', '2027-08-05', false),
('EVHS', ARRAY['Nyel','Emaad'], '2027-2028', 'holiday',    'Labor Day',               '2027-09-06', '2027-09-06', true),
('EVHS', ARRAY['Nyel','Emaad'], '2027-2028', 'break',      'Fall Break',              '2027-09-27', '2027-10-01', true),
('EVHS', ARRAY['Nyel','Emaad'], '2027-2028', 'holiday',    'Veterans Day',            '2027-11-11', '2027-11-12', true),
('EVHS', ARRAY['Nyel','Emaad'], '2027-2028', 'break',      'Thanksgiving Break',      '2027-11-22', '2027-11-26', true),
('EVHS', ARRAY['Nyel','Emaad'], '2027-2028', 'break',      'Holiday Break',           '2027-12-20', '2027-12-31', true),
('EVHS', ARRAY['Nyel','Emaad'], '2027-2028', 'holiday',    'MLK Day',                 '2028-01-17', '2028-01-17', true),
('EVHS', ARRAY['Nyel','Emaad'], '2027-2028', 'break',      'Winter Break',            '2028-02-21', '2028-02-25', true),
('EVHS', ARRAY['Nyel','Emaad'], '2027-2028', 'holiday',    'César Chávez Day',        '2028-03-31', '2028-03-31', true),
('EVHS', ARRAY['Nyel','Emaad'], '2027-2028', 'break',      'Spring Break',            '2028-04-03', '2028-04-07', true),
('EVHS', ARRAY['Nyel','Emaad'], '2027-2028', 'holiday',    'Memorial Day',            '2028-05-29', '2028-05-29', true),
('EVHS', ARRAY['Nyel','Emaad'], '2027-2028', 'last_day',   'Last Day of School',      '2028-06-01', '2028-06-01', false);

-- ── Silver Oak Elementary — 2025-2026 ────────────────────────
INSERT INTO school_calendar (school, people, school_year, event_type, title, start_date, end_date, is_no_school) VALUES
('Silver Oak Elementary', ARRAY['Omer'], '2025-2026', 'first_day',   'First Day of School',         '2025-08-18', '2025-08-18', false),
('Silver Oak Elementary', ARRAY['Omer'], '2025-2026', 'holiday',     'Labor Day',                   '2025-09-01', '2025-09-01', true),
('Silver Oak Elementary', ARRAY['Omer'], '2025-2026', 'staff_dev',   'Staff Development Day',       '2025-10-09', '2025-10-09', true),
('Silver Oak Elementary', ARRAY['Omer'], '2025-2026', 'holiday',     'Veterans Day',                '2025-11-11', '2025-11-11', true),
('Silver Oak Elementary', ARRAY['Omer'], '2025-2026', 'staff_dev',   'Conference Day (no students)','2025-11-19', '2025-11-19', true),
('Silver Oak Elementary', ARRAY['Omer'], '2025-2026', 'break',       'Thanksgiving Break',          '2025-11-24', '2025-11-28', true),
('Silver Oak Elementary', ARRAY['Omer'], '2025-2026', 'break',       'Winter Break',                '2025-12-22', '2026-01-02', true),
('Silver Oak Elementary', ARRAY['Omer'], '2025-2026', 'staff_dev',   'Staff Development Day',       '2026-01-08', '2026-01-08', true),
('Silver Oak Elementary', ARRAY['Omer'], '2025-2026', 'holiday',     'MLK Day',                     '2026-01-19', '2026-01-19', true),
('Silver Oak Elementary', ARRAY['Omer'], '2025-2026', 'break',       'President''s Break',          '2026-02-16', '2026-02-20', true),
('Silver Oak Elementary', ARRAY['Omer'], '2025-2026', 'holiday',     'César Chávez Day',            '2026-03-30', '2026-03-30', true),
('Silver Oak Elementary', ARRAY['Omer'], '2025-2026', 'break',       'Spring Break',                '2026-04-03', '2026-04-10', true),
('Silver Oak Elementary', ARRAY['Omer'], '2025-2026', 'holiday',     'Memorial Day',                '2026-05-25', '2026-05-25', true),
('Silver Oak Elementary', ARRAY['Omer'], '2025-2026', 'last_day',    'Last Day of School',          '2026-06-11', '2026-06-11', false);

-- ── Silver Oak Elementary — 2026-2027 ────────────────────────
INSERT INTO school_calendar (school, people, school_year, event_type, title, start_date, end_date, is_no_school) VALUES
('Silver Oak Elementary', ARRAY['Omer'], '2026-2027', 'first_day',   'First Day of School',         '2026-08-17', '2026-08-17', false),
('Silver Oak Elementary', ARRAY['Omer'], '2026-2027', 'holiday',     'Labor Day',                   '2026-09-07', '2026-09-07', true),
('Silver Oak Elementary', ARRAY['Omer'], '2026-2027', 'staff_dev',   'Staff Development Day',       '2026-10-08', '2026-10-08', true),
('Silver Oak Elementary', ARRAY['Omer'], '2026-2027', 'no_school',   'Diwali (No School)',          '2026-11-10', '2026-11-10', true),
('Silver Oak Elementary', ARRAY['Omer'], '2026-2027', 'holiday',     'Veterans Day',                '2026-11-11', '2026-11-11', true),
('Silver Oak Elementary', ARRAY['Omer'], '2026-2027', 'staff_dev',   'Conference Day (no students)','2026-11-19', '2026-11-19', true),
('Silver Oak Elementary', ARRAY['Omer'], '2026-2027', 'break',       'Thanksgiving Break',          '2026-11-23', '2026-11-27', true),
('Silver Oak Elementary', ARRAY['Omer'], '2026-2027', 'break',       'Winter Break',                '2026-12-21', '2027-01-01', true),
('Silver Oak Elementary', ARRAY['Omer'], '2026-2027', 'staff_dev',   'Staff Development Day',       '2027-01-14', '2027-01-14', true),
('Silver Oak Elementary', ARRAY['Omer'], '2026-2027', 'holiday',     'MLK Day',                     '2027-01-18', '2027-01-18', true),
('Silver Oak Elementary', ARRAY['Omer'], '2026-2027', 'break',       'President''s Break',          '2027-02-15', '2027-02-16', true),
('Silver Oak Elementary', ARRAY['Omer'], '2026-2027', 'holiday',     'César Chávez Day',            '2027-03-31', '2027-03-31', true),
('Silver Oak Elementary', ARRAY['Omer'], '2026-2027', 'break',       'Spring Break',                '2027-03-26', '2027-04-02', true),
('Silver Oak Elementary', ARRAY['Omer'], '2026-2027', 'holiday',     'Memorial Day',                '2027-05-31', '2027-05-31', true),
('Silver Oak Elementary', ARRAY['Omer'], '2026-2027', 'last_day',    'Last Day of School',          '2027-06-11', '2027-06-11', false);
