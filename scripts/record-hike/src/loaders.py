"""
Data loaders for hiking history, health metrics, and Strava activities.
All Supabase REST calls use the service role key from env var.
"""
import os
import json
import time
import requests
from datetime import date, datetime, timezone
from typing import Optional, List, Dict, Any
from collections import defaultdict

from .models import HikeRecord, HealthMetricRecord, DailyHealthSummary, StravaActivity

SUPABASE_URL = "https://epckjiufeimydxmcrfus.supabase.co"
STRAVA_TOKENS_PATH = "/Users/mumair/my-open-brain/scripts/fitbit-sync/strava-tokens.json"
STRAVA_BASE_URL = "https://www.strava.com/api/v3"


def _get_supabase_headers() -> Dict[str, str]:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise EnvironmentError(
            "SUPABASE_SERVICE_ROLE_KEY is not set. "
            "Please set it before running: export SUPABASE_SERVICE_ROLE_KEY=your_key"
        )
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def load_hiking_history(season: Optional[int] = None) -> List[HikeRecord]:
    """
    Fetch all hike records from Supabase hiking_history table.
    Optionally filter by season.
    Returns a list of HikeRecord sorted by hike_date ascending.
    """
    headers = _get_supabase_headers()
    url = f"{SUPABASE_URL}/rest/v1/hiking_history"

    params: Dict[str, Any] = {
        "order": "hike_date.asc",
        "limit": 1000,
    }
    if season is not None:
        params["season"] = f"eq.{season}"

    resp = requests.get(url, headers=headers, params=params)
    resp.raise_for_status()
    raw = resp.json()

    records = []
    for row in raw:
        try:
            # Normalize hike_date string to date object
            hike_date_val = row.get("hike_date")
            if isinstance(hike_date_val, str):
                hike_date_val = date.fromisoformat(hike_date_val)

            record = HikeRecord(
                id=str(row["id"]) if row.get("id") is not None else None,
                hike_date=hike_date_val,
                season=int(row["season"]),
                hike_number=int(row["hike_number"]),
                hike_code=row["hike_code"],
                trail_name=row["trail_name"],
                alltrails_url=row.get("alltrails_url"),
                cafe_name=row.get("cafe_name"),
                cafe_url=row.get("cafe_url"),
                notes=row.get("notes"),
                attended=row.get("attended"),
                kudoers=row.get("kudoers"),
                kudos_count=row.get("kudos_count"),
                athlete_count=row.get("athlete_count"),
                hr_avg=row.get("hr_avg"),
                hr_max=row.get("hr_max"),
                hr_zones=row.get("hr_zones"),
                photo_count=row.get("photo_count"),
            )
            records.append(record)
        except Exception as e:
            print(f"[loaders] Warning: skipping malformed hike row {row.get('hike_code', '?')}: {e}")

    return records


def load_health_metrics(
    date_from: date,
    date_to: date,
    sources: Optional[List[str]] = None,
) -> List[HealthMetricRecord]:
    """
    Fetch health metrics from Supabase health_metrics table between date_from and date_to (inclusive).
    Optionally filter by sources (e.g. ['fitbit', 'whoop']).
    Uses pagination with limit=1000.
    """
    headers = _get_supabase_headers()
    url = f"{SUPABASE_URL}/rest/v1/health_metrics"

    from_ts = f"{date_from.isoformat()}T00:00:00"
    to_ts = f"{date_to.isoformat()}T23:59:59"

    all_records: List[HealthMetricRecord] = []
    offset = 0
    page_size = 1000

    while True:
        params: Dict[str, Any] = {
            "recorded_at": f"gte.{from_ts}",
            "and": f"(recorded_at.lte.{to_ts})",
            "order": "recorded_at.asc",
            "limit": page_size,
            "offset": offset,
        }
        if sources:
            # Use IN filter
            source_list = ",".join(sources)
            params["source"] = f"in.({source_list})"

        resp = requests.get(url, headers=headers, params=params)
        resp.raise_for_status()
        raw = resp.json()

        if not raw:
            break

        for row in raw:
            try:
                recorded_at_val = row.get("recorded_at")
                if isinstance(recorded_at_val, str):
                    # Parse ISO8601, handle various formats
                    recorded_at_val = datetime.fromisoformat(
                        recorded_at_val.replace("Z", "+00:00")
                    )

                record = HealthMetricRecord(
                    id=str(row["id"]) if row.get("id") is not None else None,
                    recorded_at=recorded_at_val,
                    source=row["source"],
                    metric_type=row["metric_type"],
                    value=float(row["value"]),
                    unit=row.get("unit", ""),
                    metadata=row.get("metadata"),
                    subject=row.get("subject", "Umair"),
                    notes=row.get("notes"),
                )
                all_records.append(record)
            except Exception as e:
                print(f"[loaders] Warning: skipping malformed health metric row: {e}")

        if len(raw) < page_size:
            break
        offset += page_size

    return all_records


def _load_strava_tokens() -> Dict[str, Any]:
    """Load Strava tokens from local JSON file."""
    with open(STRAVA_TOKENS_PATH, "r") as f:
        return json.load(f)


def _refresh_strava_token_if_needed(tokens: Dict[str, Any]) -> Dict[str, Any]:
    """
    Check if the Strava access token is expired and refresh if needed.
    expires_at is in milliseconds since epoch.
    """
    expires_at_ms = tokens.get("expires_at", 0)
    # Convert ms to seconds for comparison
    expires_at_s = expires_at_ms / 1000 if expires_at_ms > 1e10 else expires_at_ms
    now_s = time.time()

    if now_s < expires_at_s - 300:
        # Token still valid (with 5-minute buffer)
        return tokens

    print("[loaders] Strava token expired or expiring soon, refreshing...")
    client_id = os.environ.get("STRAVA_CLIENT_ID")
    client_secret = os.environ.get("STRAVA_CLIENT_SECRET")

    if not client_id or not client_secret:
        print(
            "[loaders] Warning: STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET not set. "
            "Using existing token — it may be expired."
        )
        return tokens

    resp = requests.post(
        "https://www.strava.com/oauth/token",
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "refresh_token",
            "refresh_token": tokens["refresh_token"],
        },
    )
    resp.raise_for_status()
    new_tokens = resp.json()

    # Merge and save
    tokens.update(new_tokens)
    with open(STRAVA_TOKENS_PATH, "w") as f:
        json.dump(tokens, f, indent=2)

    return tokens


def load_strava_activities() -> List[StravaActivity]:
    """
    Load all Strava activities for the athlete using the stored access token.
    Paginates through all pages (200 per page).
    Maps API response to StravaActivity model.
    """
    try:
        tokens = _load_strava_tokens()
    except FileNotFoundError:
        print(f"[loaders] Strava tokens not found at {STRAVA_TOKENS_PATH}. Skipping Strava.")
        return []

    tokens = _refresh_strava_token_if_needed(tokens)
    access_token = tokens.get("access_token")
    if not access_token:
        print("[loaders] No Strava access token available. Skipping Strava.")
        return []

    headers = {"Authorization": f"Bearer {access_token}"}
    all_activities: List[StravaActivity] = []
    page = 1

    while True:
        resp = requests.get(
            f"{STRAVA_BASE_URL}/athlete/activities",
            headers=headers,
            params={"per_page": 200, "page": page},
        )
        if resp.status_code == 401:
            print("[loaders] Strava unauthorized (401). Token may be invalid.")
            break
        resp.raise_for_status()
        raw = resp.json()

        if not raw:
            break

        for act in raw:
            try:
                # Parse start_date_local
                start_local_str = act.get("start_date_local", "")
                if start_local_str:
                    start_local = datetime.fromisoformat(
                        start_local_str.replace("Z", "+00:00")
                    )
                    # Make timezone-naive if it's UTC (Strava local dates have no tz offset)
                    if start_local.tzinfo is not None:
                        start_local = start_local.replace(tzinfo=None)
                else:
                    continue

                activity = StravaActivity(
                    id=int(act["id"]),
                    name=act.get("name", ""),
                    activity_type=act.get("type", act.get("sport_type", "Unknown")),
                    start_date_local=start_local,
                    distance_m=float(act.get("distance", 0)),
                    elapsed_time_s=int(act.get("elapsed_time", 0)),
                    total_elevation_gain=act.get("total_elevation_gain"),
                    average_heartrate=act.get("average_heartrate"),
                    max_heartrate=act.get("max_heartrate"),
                    athlete_count=act.get("athlete_count"),
                    kudos_count=act.get("kudos_count"),
                )
                all_activities.append(activity)
            except Exception as e:
                print(f"[loaders] Warning: skipping malformed Strava activity {act.get('id', '?')}: {e}")

        if len(raw) < 200:
            break
        page += 1

    print(f"[loaders] Loaded {len(all_activities)} Strava activities across {page} page(s).")
    return all_activities


def build_strava_by_date(activities: List[StravaActivity]) -> Dict[date, List[StravaActivity]]:
    """
    Group Strava activities by their local date.
    Returns a dict of date -> list of activities on that day.
    """
    by_date: Dict[date, List[StravaActivity]] = defaultdict(list)
    for act in activities:
        d = act.start_date_local.date()
        by_date[d].append(act)
    return dict(by_date)


def build_daily_summaries(
    metrics: List[HealthMetricRecord],
) -> Dict[date, DailyHealthSummary]:
    """
    Aggregate a flat list of HealthMetricRecords into a dict of date -> DailyHealthSummary.

    Health metrics are daily aggregates (no intraday timestamps).
    We group by date(recorded_at) and extract the relevant fields per source.
    When multiple records exist for the same date/source/metric_type, use the last one.
    """
    # Group metrics by (date, source, metric_type)
    grouped: Dict[date, Dict[str, Dict[str, float]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    metric_types_by_date: Dict[date, set] = defaultdict(set)

    for m in metrics:
        d = m.recorded_at.date()
        grouped[d][m.source][m.metric_type] = m.value
        metric_types_by_date[d].add(m.metric_type)

    summaries: Dict[date, DailyHealthSummary] = {}

    for d, sources_data in grouped.items():
        fitbit = sources_data.get("fitbit", {})
        whoop = sources_data.get("whoop", {})

        sources_present = list(sources_data.keys())

        # Build WHOOP hr_zone fields
        # WHOOP stores hr_zone_1 through hr_zone_5
        whoop_hr_zone_3 = whoop.get("hr_zone_3")
        whoop_hr_zone_4 = whoop.get("hr_zone_4")
        whoop_hr_zone_5 = whoop.get("hr_zone_5")

        summary = DailyHealthSummary(
            date=d,
            # Fitbit fields
            fitbit_steps=fitbit.get("steps"),
            fitbit_active_minutes=fitbit.get("active_minutes"),
            fitbit_calories=fitbit.get("calories_burned"),
            fitbit_resting_hr=fitbit.get("resting_heart_rate"),
            fitbit_hrv=fitbit.get("hrv"),
            fitbit_sleep_hours=fitbit.get("sleep_hours"),
            fitbit_sleep_score=fitbit.get("sleep_score"),
            fitbit_spo2=fitbit.get("spo2"),
            # WHOOP fields
            whoop_strain=whoop.get("strain"),
            whoop_recovery_score=whoop.get("recovery_score"),
            whoop_hrv=whoop.get("hrv"),
            whoop_resting_hr=whoop.get("resting_heart_rate"),
            whoop_calories=whoop.get("calories_active"),
            whoop_sleep_hours=whoop.get("sleep_hours"),
            whoop_hr_zone_3=whoop_hr_zone_3,
            whoop_hr_zone_4=whoop_hr_zone_4,
            whoop_hr_zone_5=whoop_hr_zone_5,
            sources_present=sources_present,
            metric_types_present=sorted(metric_types_by_date[d]),
        )
        summaries[d] = summary

    return summaries
