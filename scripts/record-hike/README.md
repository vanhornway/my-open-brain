# Record Hike — Attendance Detection System

A multi-phase Python system that determines whether the user attended each scheduled group hike, using daily health metrics (Fitbit, WHOOP) and Strava activity data as evidence.

---

## What This Does

The system answers: **"Did I attend this hike?"** for every hike in the hiking history database, using a three-phase pipeline:

| Phase | Name | What it does |
|-------|------|--------------|
| **0** | Data Load & Audit | Loads hiking history, health metrics (Fitbit/WHOOP), and Strava activities. Audits data completeness. |
| **1** | Behavior Detection | Scores each hike day against baseline non-hike Saturdays using step count, active minutes, WHOOP strain, calories, and HR zones. |
| **2** | Strava Confirmation | Looks for a matching Strava activity on the hike date. Scores it for type, distance, elevation, and start time. |
| **3** | Classification | Combines Phase 1 + Phase 2 into a final `AttendanceStatus` with confidence score. |

**Final statuses:**
- `confirmed_attended` — Strava confirmed or strong multi-signal agreement
- `likely_attended` — Single source or moderate signals
- `uncertain` — Insufficient data to decide
- `likely_missed` — Low activity indicators
- `confirmed_missed` — (Future: explicit DB flag)

---

## Setup

### 1. Install dependencies

```bash
cd /Users/mumair/my-open-brain/scripts/record-hike
pip install -r requirements.txt
```

### 2. Set your Supabase service role key

```bash
export SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

Find this in your Supabase dashboard: **Project Settings → API → service_role (secret key)**

> The system will print a clear error message and exit if this is not set.

### 3. Strava (optional but recommended)

Strava tokens are read from:
```
/Users/mumair/my-open-brain/scripts/fitbit-sync/strava-tokens.json
```

For token refresh, optionally set:
```bash
export STRAVA_CLIENT_ID=your_client_id
export STRAVA_CLIENT_SECRET=your_client_secret
```

---

## How to Run

### Full evaluation (Season 14)

```bash
python run_evaluation.py
```

### Specific season

```bash
python run_evaluation.py --season 14
```

### Audit only (check data completeness without classifying)

```bash
python run_evaluation.py --audit-only
```

### Skip Strava (behavior-only, faster)

```bash
python run_evaluation.py --no-strava
```

### Show computed baseline values

```bash
python run_evaluation.py --show-baselines
```

### Show per-hike data quality notes

```bash
python run_evaluation.py --show-notes
```

---

## How to Interpret Output

### Data Quality Audit Table

Columns: `HR↑` (hr_avg present), `Zones`, `Photo`, `Kudos`, `FBstep` (Fitbit steps), `FBmin`, `WHPstr` (WHOOP strain), `WHPzn`, `Strava`, `Gap?`, `Repair?`

- **Gap?** = `attended=True` in DB but `hr_avg` is missing despite health data existing on that day
- **Repair?** = Gap + Strava or WHOOP strain available → we can propose a fill

### Season Report Table

| Column | Meaning |
|--------|---------|
| P1 | Phase 1 label: STRONG / MOD / UNC / UNLIKELY / NODATA |
| P2 | Phase 2 label: CONF (Strava confirmed) / PART (partial) / NONE (not found) / NA (not available) |
| Final | Final attendance status |
| Conf% | Confidence in the final decision |
| ✓ | Green check = matches ground truth, Red cross = mismatch, ~ = unknown |
| Gap | Red GAP = enrichment gap (attended but missing HR data) |

### Evaluation Results

- **TP** = predicted attended, actually attended
- **FP** = predicted attended, actually missed (false positive)
- **TN** = predicted missed, actually missed
- **FN** = predicted missed, actually attended (false negative)
- **Precision** = of all "attended" predictions, how many are right
- **Recall** = of all actual attended hikes, how many were caught

### Repair Proposals

For every attended hike missing `hr_avg`, the system proposes a data source:
- **strava** (green) — Strava activity HR available, high confidence (~85%)
- **whoop_strain** (yellow) — WHOOP strain present but no session HR
- **fitbit_steps** (cyan) — Only Fitbit steps, very low confidence
- **none** (red) — No data at all; manual entry required

---

## System Design

### Phase 0: Data Loading

- **Hiking history** — Supabase REST API `hiking_history` table, filtered by season
- **Health metrics** — Supabase REST API `health_metrics` table, paginated by date range
  - `source` = `fitbit` or `whoop`
  - All data is **daily aggregates** (no intraday timestamps)
- **Strava** — OAuth token from `strava-tokens.json`, paginated `/athlete/activities` API

### Phase 1: Behavior Scoring

For each hike date, compute a weighted score from daily aggregate metrics:

```
score = 0.30 * normalize(steps / baseline)
      + 0.25 * normalize(active_minutes / baseline)
      + 0.20 * normalize(strain / baseline)
      + 0.10 * normalize(calories / baseline)
      + 0.10 * hr_zone_elevation (zones 3+4+5 percentage)
      + 0.05 * recovery_inverse (lower recovery = harder day)
```

Baseline = median of non-hike Saturdays from health_metrics history.

| Score | Label |
|-------|-------|
| ≥ 0.75 | STRONG |
| ≥ 0.50 | MODERATE |
| ≥ 0.30 | UNCERTAIN |
| < 0.30 | UNLIKELY |
| no data | NO_DATA |

### Phase 2: Strava Confirmation

Looks for a Strava activity on the same date and scores it:

```
confidence = 0.30 (base, any activity)
           + 0.15 if type in [Hike, Walk, TrailRun, Run]
           + 0.10 if start hour in [5..10]
           + 0.10 if distance in [5..30 km]
           + 0.10 if elevation > 100 m
           + 0.05 if kudos > 0
```

| Confidence | Label |
|-----------|-------|
| ≥ 0.90 | CONFIRMED |
| ≥ 0.65 | PARTIAL |
| < 0.65 | NOT_FOUND |

### Classification Rules

```
Strava CONFIRMED (≥0.90)                          → confirmed_attended
Strava PARTIAL + behavior STRONG/MODERATE         → confirmed_attended or likely_attended
Behavior STRONG, Strava unavailable               → likely_attended (×0.85)
Behavior MODERATE, Strava unavailable             → likely_attended (×0.75)
Behavior UNCERTAIN                                → uncertain
Behavior UNLIKELY                                 → likely_missed
No data                                           → uncertain
```

---

## File Structure

```
record-hike/
├── README.md                  This file
├── requirements.txt           Python dependencies
├── run_evaluation.py          Main entry point
├── config/
│   ├── thresholds.yaml        Scoring thresholds
│   ├── behavior_rules.yaml    Phase 1 weights and minimums
│   └── confirmation_rules.yaml Phase 2 Strava rules
└── src/
    ├── models.py              Pydantic data models
    ├── loaders.py             Supabase + Strava data loading
    ├── audit.py               Data quality audit
    ├── baselines.py           Baseline metric computation
    ├── phase1_behavior.py     Behavior-based detection
    ├── phase2_confirmation.py Strava confirmation
    ├── classifier.py          Final decision combination
    ├── repair.py              Repair proposal generation
    ├── evaluate.py            Season 14 ground truth evaluation
    └── reporting.py           Rich terminal output
```

---

## Failure Modes

| Failure | Symptom | Cause | Fix |
|---------|---------|-------|-----|
| Missing env var | Exits immediately with red panel | `SUPABASE_SERVICE_ROLE_KEY` not set | `export SUPABASE_SERVICE_ROLE_KEY=...` |
| All NO_DATA | Every hike shows NODATA | Health metrics table empty or date range mismatch | Check `health_metrics` table has data; verify `recorded_at` timezone |
| All UNCERTAIN | No confident decisions | Baselines computed from too few non-hike Saturdays | Need more historical health data loaded |
| Strava 401 | Strava skipped with warning | Access token expired | Set `STRAVA_CLIENT_ID` + `STRAVA_CLIENT_SECRET` for auto-refresh |
| Strava NOT_FOUND everywhere | Phase 2 always NONE | Activities not logged in Strava on hike days | Normal if user doesn't use Strava; system falls back to Phase 1 only |
| High FP rate | Predicting attended when missed | Baseline too low (missed hikes inflate non-hike baseline) | Check S14_MISSED set is accurate; review baseline days used |
| High FN rate | Predicting missed when attended | Metrics below baseline thresholds | Adjust `steps_moderate` / `strain_moderate` multipliers in thresholds.yaml |
| Enrichment gaps | GAP flags on attended hikes | HR data never written to `hiking_history` table | Use repair proposals to fill from Strava |
| Season not found | 0 hikes loaded | Wrong season number or not in DB | Verify season exists in `hiking_history` table |

---

## Season 14 Ground Truth (for evaluation)

- **Total hikes:** 20 (Season Oct 2025 – Mar 2026)
- **Attended:** 15
- **Confirmed missed:**
  - 2026-02-14 — Mt Umunhum
  - 2026-01-03 — Stanford Dish
  - 2025-12-27 — China Hole Henry Coe
  - 2025-11-01 — Windy Hill Portola Valley
  - 2025-10-04 — Boccardo Loop Alum Rock

All other Season 14 hikes are assumed `attended=True`.

---

## Configuration Tuning

All scoring parameters are in `config/`. No code changes needed:

- **`thresholds.yaml`** — Adjust `strong_threshold`, `moderate_threshold` for stricter/looser behavior detection
- **`behavior_rules.yaml`** — Adjust feature weights (must sum to 1.0) and soft minimums
- **`confirmation_rules.yaml`** — Adjust Strava activity type list, distance/elevation windows, confidence boosts
