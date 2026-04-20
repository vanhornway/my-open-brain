"""
Phase 1: Behavior-based attendance detection.
Uses daily aggregate health metrics to score how likely a day was a hike day.
"""
import os
import yaml
from typing import Optional, Dict, Tuple, Any

from .models import DailyHealthSummary, BehaviorLabel

# Path to config directory relative to this file's location
_CONFIG_DIR = os.path.join(os.path.dirname(__file__), "..", "config")


def _load_config() -> Dict[str, Any]:
    """Load behavior_rules.yaml and thresholds.yaml, merging them into one dict."""
    behavior_path = os.path.join(_CONFIG_DIR, "behavior_rules.yaml")
    thresholds_path = os.path.join(_CONFIG_DIR, "thresholds.yaml")

    with open(behavior_path, "r") as f:
        behavior_cfg = yaml.safe_load(f)
    with open(thresholds_path, "r") as f:
        thresholds_cfg = yaml.safe_load(f)

    return {"behavior": behavior_cfg, "thresholds": thresholds_cfg}


def _normalize_ratio(ratio: Optional[float], strong_mult: float, moderate_mult: float) -> float:
    """
    Normalize a ratio (metric / baseline) into a 0-1 score.
    Below moderate multiplier → 0.0
    At or above strong multiplier → 1.0
    Linear interpolation in between.
    Cap ratio at 3.0 before normalizing to avoid outlier inflation.
    """
    if ratio is None:
        return 0.0
    ratio = min(ratio, 3.0)
    if ratio < moderate_mult:
        return 0.0
    if ratio >= strong_mult:
        return 1.0
    # Linear interpolation between moderate and strong
    span = strong_mult - moderate_mult
    return (ratio - moderate_mult) / span


def detect_behavior(
    daily: Optional[DailyHealthSummary],
    baselines: Dict[str, Any],
    config: Optional[Dict[str, Any]] = None,
) -> Tuple[BehaviorLabel, float, Dict[str, Any]]:
    """
    Detect hike-day behavior from daily aggregate health metrics.

    Returns:
        (BehaviorLabel, confidence_float, feature_dict)

    confidence_float is in [0, 1].
    feature_dict contains per-feature normalized scores and ratios for provenance.
    """
    if config is None:
        config = _load_config()

    if daily is None:
        return BehaviorLabel.NO_DATA, 0.0, {"reason": "no_daily_summary"}

    behavior_cfg = config.get("behavior", {})
    thresholds_cfg = config.get("thresholds", {})
    weights = behavior_cfg.get("weights", {})
    minimums = behavior_cfg.get("minimums", {})
    multipliers = thresholds_cfg.get("baseline_multipliers", {})
    thresholds = thresholds_cfg.get("behavior", {})

    # ── Feature extraction ─────────────────────────────────────────────────────

    # Steps vs baseline
    baseline_steps = baselines.get("saturday_non_hike_steps") or baselines.get("all_days_median_steps")
    steps_val = daily.fitbit_steps
    steps_ratio: Optional[float] = None
    steps_score = 0.0
    if steps_val is not None and baseline_steps and baseline_steps > 0:
        steps_ratio = steps_val / baseline_steps
        steps_score = _normalize_ratio(
            steps_ratio,
            multipliers.get("steps_strong", 1.8),
            multipliers.get("steps_moderate", 1.3),
        )
        # Soft minimum cap: if steps < minimum, reduce contribution
        min_steps = minimums.get("steps_minimum", 8000)
        if steps_val < min_steps:
            steps_score *= steps_val / min_steps

    # Active minutes vs baseline
    baseline_active = (
        baselines.get("saturday_non_hike_active_minutes")
        or baselines.get("all_days_median_active_minutes")
    )
    active_val = daily.fitbit_active_minutes
    active_ratio: Optional[float] = None
    active_score = 0.0
    if active_val is not None and baseline_active and baseline_active > 0:
        active_ratio = active_val / baseline_active
        active_score = _normalize_ratio(
            active_ratio,
            multipliers.get("active_minutes_strong", 2.0),
            multipliers.get("active_minutes_moderate", 1.4),
        )
        min_active = minimums.get("active_minutes_minimum", 60)
        if active_val < min_active:
            active_score *= active_val / min_active

    # WHOOP strain vs baseline
    baseline_strain = (
        baselines.get("saturday_non_hike_strain")
        or baselines.get("all_days_median_strain")
    )
    strain_val = daily.whoop_strain
    strain_ratio: Optional[float] = None
    strain_score = 0.0
    if strain_val is not None and baseline_strain and baseline_strain > 0:
        strain_ratio = strain_val / baseline_strain
        strain_score = _normalize_ratio(
            strain_ratio,
            multipliers.get("strain_strong", 1.6),
            multipliers.get("strain_moderate", 1.1),
        )
        min_strain = minimums.get("strain_minimum", 10.0)
        if strain_val < min_strain:
            strain_score *= strain_val / min_strain

    # Calories vs baseline
    baseline_calories = (
        baselines.get("saturday_non_hike_calories")
        or baselines.get("all_days_median_calories")
    )
    calories_val = daily.fitbit_calories or daily.whoop_calories
    calories_ratio: Optional[float] = None
    calories_score = 0.0
    if calories_val is not None and baseline_calories and baseline_calories > 0:
        calories_ratio = calories_val / baseline_calories
        calories_score = _normalize_ratio(
            calories_ratio,
            multipliers.get("calories_strong", 1.5),
            multipliers.get("calories_moderate", 1.1),
        )
        min_cal = minimums.get("calories_minimum", 400)
        if calories_val < min_cal:
            calories_score *= calories_val / min_cal

    # HR zone elevation: zone 3+4+5 proportion > 30% is strong signal
    zone3 = daily.whoop_hr_zone_3 or 0.0
    zone4 = daily.whoop_hr_zone_4 or 0.0
    zone5 = daily.whoop_hr_zone_5 or 0.0
    zone_high_pct = zone3 + zone4 + zone5
    hr_zone_score = 0.0
    if daily.whoop_hr_zone_3 is not None or daily.whoop_hr_zone_4 is not None:
        # Normalize: 0% → 0.0, 30% → 0.5, 60%+ → 1.0
        hr_zone_score = min(zone_high_pct / 60.0, 1.0) if zone_high_pct > 0 else 0.0

    # Recovery score inverse: lower recovery on following day = harder workout
    # We use same-day recovery as an inverse signal (lower recovery = already worked hard)
    recovery_val = daily.whoop_recovery_score
    recovery_inverse_score = 0.0
    if recovery_val is not None:
        # Recovery 0-100%; below 33% = strong signal of hard day
        # Normalize: 100% → 0.0, 0% → 1.0
        recovery_inverse_score = max(0.0, (70.0 - recovery_val) / 70.0)
        recovery_inverse_score = min(recovery_inverse_score, 1.0)

    # ── Weighted sum ───────────────────────────────────────────────────────────
    w_steps = weights.get("steps_vs_baseline", 0.30)
    w_active = weights.get("active_minutes_vs_baseline", 0.25)
    w_strain = weights.get("strain_vs_baseline", 0.20)
    w_calories = weights.get("calories_vs_baseline", 0.10)
    w_hr_zone = weights.get("hr_zone_elevation", 0.10)
    w_recovery = weights.get("recovery_score_inverse", 0.05)

    # Only count weight for features that have data
    total_weight = 0.0
    raw_score = 0.0

    feature_contributions = {}

    if steps_val is not None and baseline_steps:
        raw_score += w_steps * steps_score
        total_weight += w_steps
        feature_contributions["steps"] = {"ratio": steps_ratio, "score": steps_score, "weight": w_steps}

    if active_val is not None and baseline_active:
        raw_score += w_active * active_score
        total_weight += w_active
        feature_contributions["active_minutes"] = {"ratio": active_ratio, "score": active_score, "weight": w_active}

    if strain_val is not None and baseline_strain:
        raw_score += w_strain * strain_score
        total_weight += w_strain
        feature_contributions["strain"] = {"ratio": strain_ratio, "score": strain_score, "weight": w_strain}

    if calories_val is not None and baseline_calories:
        raw_score += w_calories * calories_score
        total_weight += w_calories
        feature_contributions["calories"] = {"ratio": calories_ratio, "score": calories_score, "weight": w_calories}

    if daily.whoop_hr_zone_3 is not None or daily.whoop_hr_zone_4 is not None:
        raw_score += w_hr_zone * hr_zone_score
        total_weight += w_hr_zone
        feature_contributions["hr_zone"] = {"zone_high_pct": zone_high_pct, "score": hr_zone_score, "weight": w_hr_zone}

    if recovery_val is not None:
        raw_score += w_recovery * recovery_inverse_score
        total_weight += w_recovery
        feature_contributions["recovery_inverse"] = {
            "recovery_val": recovery_val,
            "score": recovery_inverse_score,
            "weight": w_recovery,
        }

    # No data at all
    if total_weight == 0.0:
        return BehaviorLabel.NO_DATA, 0.0, {"reason": "no_relevant_metrics"}

    # Normalize by actual weight used (handles partial data gracefully)
    confidence = raw_score / total_weight

    # Apply thresholds
    strong_thresh = thresholds.get("strong_threshold", 0.75)
    moderate_thresh = thresholds.get("moderate_threshold", 0.50)
    uncertain_thresh = thresholds.get("uncertain_threshold", 0.30)

    if confidence >= strong_thresh:
        label = BehaviorLabel.STRONG
    elif confidence >= moderate_thresh:
        label = BehaviorLabel.MODERATE
    elif confidence >= uncertain_thresh:
        label = BehaviorLabel.UNCERTAIN
    else:
        label = BehaviorLabel.UNLIKELY

    feature_dict = {
        "confidence": confidence,
        "total_weight_used": total_weight,
        "raw_score": raw_score,
        "features": feature_contributions,
        "values": {
            "steps": steps_val,
            "active_minutes": active_val,
            "strain": strain_val,
            "calories": calories_val,
            "zone_high_pct": zone_high_pct,
            "recovery": recovery_val,
        },
        "baselines_used": {
            "steps": baseline_steps,
            "active_minutes": baseline_active,
            "strain": baseline_strain,
            "calories": baseline_calories,
        },
    }

    return label, confidence, feature_dict
