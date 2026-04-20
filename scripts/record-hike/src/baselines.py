"""
Baseline computation module.
Computes median health metrics on non-hike Saturdays as the reference "typical Saturday".
Also computes all-days median as a secondary reference.
"""
import statistics
from datetime import date, timedelta
from typing import List, Dict, Optional, Any

from .models import HikeRecord, DailyHealthSummary


def _safe_median(values: List[float]) -> Optional[float]:
    """Compute median of a list of floats, returning None if empty."""
    clean = [v for v in values if v is not None]
    if not clean:
        return None
    return statistics.median(clean)


def compute_baselines(
    hikes: List[HikeRecord],
    daily_summaries: Dict[date, DailyHealthSummary],
) -> Dict[str, Optional[float]]:
    """
    Compute baseline metrics from:
    1. Non-hike Saturdays — Saturdays where attended=False or attended=None
    2. All non-Saturday days as secondary baseline

    Returns a dict with keys like:
      saturday_non_hike_steps
      saturday_non_hike_active_minutes
      saturday_non_hike_strain
      saturday_non_hike_calories
      all_days_median_steps
      all_days_median_active_minutes
      all_days_median_strain
      all_days_median_calories
      all_days_median_resting_hr
      all_days_median_hrv
    """
    # Build a set of hike dates and their attendance
    hike_date_to_attended: Dict[date, Optional[bool]] = {
        h.hike_date: h.attended for h in hikes
    }

    # Classify all days with health data
    saturday_non_hike_steps: List[float] = []
    saturday_non_hike_active_minutes: List[float] = []
    saturday_non_hike_strain: List[float] = []
    saturday_non_hike_calories: List[float] = []
    saturday_non_hike_resting_hr: List[float] = []
    saturday_non_hike_hrv: List[float] = []

    all_steps: List[float] = []
    all_active_minutes: List[float] = []
    all_strain: List[float] = []
    all_calories: List[float] = []
    all_resting_hr: List[float] = []
    all_hrv: List[float] = []

    for d, summary in daily_summaries.items():
        is_saturday = d.weekday() == 5  # Monday=0, Saturday=5
        attendance = hike_date_to_attended.get(d)
        is_hike_day_attended = is_saturday and attendance is True
        is_non_hike_saturday = is_saturday and not is_hike_day_attended

        # Collect values
        steps_val = summary.fitbit_steps
        active_min_val = summary.fitbit_active_minutes
        strain_val = summary.whoop_strain
        calories_val = summary.fitbit_calories or summary.whoop_calories
        resting_hr_val = summary.fitbit_resting_hr or summary.whoop_resting_hr
        hrv_val = summary.fitbit_hrv or summary.whoop_hrv

        # All-days aggregation
        if steps_val is not None:
            all_steps.append(steps_val)
        if active_min_val is not None:
            all_active_minutes.append(active_min_val)
        if strain_val is not None:
            all_strain.append(strain_val)
        if calories_val is not None:
            all_calories.append(calories_val)
        if resting_hr_val is not None:
            all_resting_hr.append(resting_hr_val)
        if hrv_val is not None:
            all_hrv.append(hrv_val)

        # Non-hike Saturday aggregation
        if is_non_hike_saturday:
            if steps_val is not None:
                saturday_non_hike_steps.append(steps_val)
            if active_min_val is not None:
                saturday_non_hike_active_minutes.append(active_min_val)
            if strain_val is not None:
                saturday_non_hike_strain.append(strain_val)
            if calories_val is not None:
                saturday_non_hike_calories.append(calories_val)
            if resting_hr_val is not None:
                saturday_non_hike_resting_hr.append(resting_hr_val)
            if hrv_val is not None:
                saturday_non_hike_hrv.append(hrv_val)

    # Fall back to all-days medians if not enough Saturday data
    def _with_fallback(saturday_vals: List[float], all_vals: List[float]) -> Optional[float]:
        result = _safe_median(saturday_vals)
        if result is None:
            result = _safe_median(all_vals)
        return result

    baselines: Dict[str, Optional[float]] = {
        # Saturday non-hike baselines (primary)
        "saturday_non_hike_steps": _with_fallback(saturday_non_hike_steps, all_steps),
        "saturday_non_hike_active_minutes": _with_fallback(
            saturday_non_hike_active_minutes, all_active_minutes
        ),
        "saturday_non_hike_strain": _with_fallback(saturday_non_hike_strain, all_strain),
        "saturday_non_hike_calories": _with_fallback(saturday_non_hike_calories, all_calories),
        "saturday_non_hike_resting_hr": _with_fallback(
            saturday_non_hike_resting_hr, all_resting_hr
        ),
        "saturday_non_hike_hrv": _with_fallback(saturday_non_hike_hrv, all_hrv),
        # All-days medians (secondary reference)
        "all_days_median_steps": _safe_median(all_steps),
        "all_days_median_active_minutes": _safe_median(all_active_minutes),
        "all_days_median_strain": _safe_median(all_strain),
        "all_days_median_calories": _safe_median(all_calories),
        "all_days_median_resting_hr": _safe_median(all_resting_hr),
        "all_days_median_hrv": _safe_median(all_hrv),
        # Sample sizes (for diagnostics)
        "_n_saturday_non_hike_days": float(len(saturday_non_hike_steps)),
        "_n_all_days": float(len(all_steps)),
    }

    return baselines


def describe_baselines(baselines: Dict[str, Any]) -> None:
    """Print a summary of computed baselines."""
    from tabulate import tabulate
    rows = []
    for key, val in baselines.items():
        if key.startswith("_"):
            continue
        val_str = f"{val:.1f}" if val is not None else "N/A"
        rows.append([key, val_str])
    print("\nComputed Baselines:")
    print(tabulate(rows, headers=["Metric", "Value"], tablefmt="rounded_outline"))
    n_sat = baselines.get("_n_saturday_non_hike_days", 0)
    n_all = baselines.get("_n_all_days", 0)
    print(f"  (Based on {int(n_sat)} non-hike Saturdays and {int(n_all)} total days with data)")
