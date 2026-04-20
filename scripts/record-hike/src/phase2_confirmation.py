"""
Phase 2: Strava confirmation module.
Uses Strava activity data to confirm or deny hike attendance.
"""
import os
import yaml
from abc import ABC, abstractmethod
from datetime import date
from typing import List, Dict, Optional, Tuple, Any

from .models import HikeRecord, StravaActivity, ConfirmationLabel

_CONFIG_DIR = os.path.join(os.path.dirname(__file__), "..", "config")


def _load_confirmation_config() -> Dict[str, Any]:
    """Load confirmation_rules.yaml and thresholds.yaml."""
    conf_path = os.path.join(_CONFIG_DIR, "confirmation_rules.yaml")
    thresh_path = os.path.join(_CONFIG_DIR, "thresholds.yaml")

    with open(conf_path, "r") as f:
        conf_cfg = yaml.safe_load(f)
    with open(thresh_path, "r") as f:
        thresh_cfg = yaml.safe_load(f)

    return {"confirmation": conf_cfg, "thresholds": thresh_cfg}


class StravaProvider(ABC):
    """Abstract interface for providing Strava activities by date."""

    @abstractmethod
    def get_activities_for_date(self, d: date) -> List[StravaActivity]:
        """Return all Strava activities for a given date."""
        ...


class LiveStravaProvider(StravaProvider):
    """
    Uses pre-loaded activities dict keyed by date.
    The dict is built by loaders.build_strava_by_date().
    """

    def __init__(self, activities_by_date: Dict[date, List[StravaActivity]]):
        self._activities_by_date = activities_by_date

    def get_activities_for_date(self, d: date) -> List[StravaActivity]:
        return self._activities_by_date.get(d, [])


class StubStravaProvider(StravaProvider):
    """Returns empty for all dates — used when Strava is unavailable."""

    def get_activities_for_date(self, d: date) -> List[StravaActivity]:
        return []


def _score_activity(
    activity: StravaActivity,
    conf_cfg: Dict[str, Any],
) -> Tuple[float, Dict[str, Any]]:
    """
    Score a single Strava activity against hike plausibility rules.
    Returns (confidence, detail_dict).
    """
    plausible_types = conf_cfg.get("plausible_activity_types", ["Hike", "Walk", "TrailRun", "Run"])
    dist_min = conf_cfg.get("hike_distance_km_min", 5.0)
    dist_max = conf_cfg.get("hike_distance_km_max", 30.0)
    elev_min = conf_cfg.get("hike_elevation_m_min", 100)
    start_hour_min = conf_cfg.get("hike_start_hour_min", 5)
    start_hour_max = conf_cfg.get("hike_start_hour_max", 10)
    boosts = conf_cfg.get("boosts", {})

    confidence = 0.3  # base for any activity existing
    details: Dict[str, Any] = {
        "activity_id": activity.id,
        "activity_name": activity.name,
        "activity_type": activity.activity_type,
        "distance_km": round(activity.distance_km, 2),
        "elevation_m": activity.total_elevation_gain,
        "start_hour": activity.start_hour,
        "kudos_count": activity.kudos_count,
        "boosts_applied": [],
    }

    # Type boost
    if activity.activity_type in plausible_types:
        boost = boosts.get("type_is_hike", 0.15)
        confidence += boost
        details["boosts_applied"].append(f"type_is_hike +{boost}")

    # Start time boost
    if start_hour_min <= activity.start_hour <= start_hour_max:
        boost = boosts.get("start_time_in_window", 0.10)
        confidence += boost
        details["boosts_applied"].append(f"start_time_in_window +{boost}")

    # Distance plausibility
    if dist_min <= activity.distance_km <= dist_max:
        boost = boosts.get("distance_plausible", 0.10)
        confidence += boost
        details["boosts_applied"].append(f"distance_plausible +{boost}")

    # Elevation plausibility
    if activity.total_elevation_gain is not None and activity.total_elevation_gain >= elev_min:
        boost = boosts.get("elevation_plausible", 0.10)
        confidence += boost
        details["boosts_applied"].append(f"elevation_plausible +{boost}")

    # Kudos boost
    if activity.kudos_count and activity.kudos_count > 0:
        boost = boosts.get("kudos_present", 0.05)
        confidence += boost
        details["boosts_applied"].append(f"kudos_present +{boost}")

    details["final_confidence"] = confidence
    return confidence, details


def confirm_with_strava(
    hike: HikeRecord,
    activities: List[StravaActivity],
    config: Optional[Dict[str, Any]] = None,
) -> Tuple[ConfirmationLabel, float, Dict[str, Any]]:
    """
    Attempt to confirm hike attendance via Strava activities on the same date.

    Steps:
    1. Filter activities on hike date (already done by caller — activities are for this date).
    2. Score each activity.
    3. Pick the best-scoring activity.
    4. Apply label thresholds.

    Returns:
        (ConfirmationLabel, confidence, detail_dict)
    """
    if config is None:
        config = _load_confirmation_config()

    conf_cfg = config.get("confirmation", {})
    thresh_cfg = config.get("thresholds", {})
    strava_thresh = thresh_cfg.get("strava", {})
    confirmed_threshold = strava_thresh.get("confirmed_threshold", 0.90)
    likely_threshold = strava_thresh.get("likely_threshold", 0.65)

    if not activities:
        return ConfirmationLabel.NOT_FOUND, 0.0, {"reason": "no_activities_on_date"}

    # Score all activities, pick the best
    best_confidence = 0.0
    best_details: Dict[str, Any] = {}
    all_scores = []

    for act in activities:
        conf, details = _score_activity(act, conf_cfg)
        all_scores.append({"activity": act.name, "type": act.activity_type, "confidence": conf})
        if conf > best_confidence:
            best_confidence = conf
            best_details = details

    best_details["all_activities_scored"] = all_scores
    best_details["activities_on_date"] = len(activities)

    if best_confidence >= confirmed_threshold:
        label = ConfirmationLabel.CONFIRMED
    elif best_confidence >= likely_threshold:
        label = ConfirmationLabel.PARTIAL
    else:
        label = ConfirmationLabel.NOT_FOUND

    return label, best_confidence, best_details
