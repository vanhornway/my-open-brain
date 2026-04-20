"""
Classifier: Combines Phase 1 behavior and Phase 2 Strava confirmation into a final attendance decision.
"""
from datetime import date
from typing import Optional, Dict, Any, List

from .models import (
    HikeRecord,
    DailyHealthSummary,
    AttendanceDecision,
    AttendanceEvidence,
    AttendanceStatus,
    BehaviorLabel,
    ConfirmationLabel,
)


def classify(
    hike: HikeRecord,
    phase1_label: BehaviorLabel,
    phase1_conf: float,
    phase1_features: Dict[str, Any],
    phase2_label: ConfirmationLabel,
    phase2_conf: float,
    phase2_details: Dict[str, Any],
    daily: Optional[DailyHealthSummary],
    baselines: Dict[str, Any],
    config: Optional[Dict[str, Any]] = None,
) -> AttendanceDecision:
    """
    Combine Phase 1 and Phase 2 signals into a final AttendanceDecision.

    Decision rules:
    1. Strava confirmed (>=0.90) → CONFIRMED_ATTENDED
    2. Strava confirmed/partial + behavior strong/moderate → CONFIRMED_ATTENDED or LIKELY_ATTENDED
    3. Behavior strong, no Strava → LIKELY_ATTENDED (discounted)
    4. Behavior moderate, no Strava → LIKELY_ATTENDED (more discounted)
    5. Behavior uncertain → UNCERTAIN
    6. Behavior unlikely → LIKELY_MISSED
    7. No data → UNCERTAIN
    """
    # Build evidence object
    evidence = _build_evidence(hike, daily, baselines, phase1_features, phase2_details)

    # ── Classification logic ──────────────────────────────────────────────────
    final_status: AttendanceStatus
    final_confidence: float
    explanation: str

    strava_confirmed = (
        phase2_label == ConfirmationLabel.CONFIRMED and phase2_conf >= 0.90
    )
    strava_partial = phase2_label == ConfirmationLabel.PARTIAL
    strava_available = phase2_label != ConfirmationLabel.NOT_AVAILABLE
    behavior_strong = phase1_label == BehaviorLabel.STRONG
    behavior_moderate = phase1_label == BehaviorLabel.MODERATE
    behavior_uncertain = phase1_label == BehaviorLabel.UNCERTAIN
    behavior_unlikely = phase1_label == BehaviorLabel.UNLIKELY
    behavior_no_data = phase1_label == BehaviorLabel.NO_DATA

    if strava_confirmed:
        final_status = AttendanceStatus.CONFIRMED_ATTENDED
        final_confidence = phase2_conf
        explanation = "Strava confirmed hike activity on same day"

    elif phase2_label in (ConfirmationLabel.CONFIRMED, ConfirmationLabel.PARTIAL):
        if behavior_strong or behavior_moderate:
            # Both Strava and behavior agree → strong confirmation
            combined = (phase2_conf * 0.6) + (phase1_conf * 0.4)
            if combined >= 0.85:
                final_status = AttendanceStatus.CONFIRMED_ATTENDED
                explanation = "Strava partial + strong behavior signal"
            else:
                final_status = AttendanceStatus.LIKELY_ATTENDED
                explanation = "Strava partial + moderate behavior signal"
            final_confidence = combined
        elif behavior_uncertain:
            final_status = AttendanceStatus.LIKELY_ATTENDED
            final_confidence = phase2_conf * 0.65
            explanation = "Strava partial but behavior uncertain"
        elif behavior_unlikely:
            final_status = AttendanceStatus.UNCERTAIN
            final_confidence = 0.5
            explanation = "Strava partial but behavior suggests inactive day — conflicting signals"
        elif behavior_no_data:
            final_status = AttendanceStatus.LIKELY_ATTENDED
            final_confidence = phase2_conf * 0.60
            explanation = "Strava partial, no behavior data"
        else:
            final_status = AttendanceStatus.LIKELY_ATTENDED
            final_confidence = phase2_conf * 0.60
            explanation = "Strava partial match"

    elif phase2_label == ConfirmationLabel.NOT_FOUND and strava_available:
        # Strava was available but no matching activity found
        if behavior_strong:
            final_status = AttendanceStatus.LIKELY_ATTENDED
            final_confidence = phase1_conf * 0.75
            explanation = "Strong behavior signal; no Strava match (may not have logged)"
        elif behavior_moderate:
            final_status = AttendanceStatus.LIKELY_ATTENDED
            final_confidence = phase1_conf * 0.60
            explanation = "Moderate behavior signal; no Strava match"
        elif behavior_uncertain:
            final_status = AttendanceStatus.UNCERTAIN
            final_confidence = phase1_conf * 0.50
            explanation = "Uncertain behavior; no Strava match"
        elif behavior_unlikely:
            final_status = AttendanceStatus.LIKELY_MISSED
            final_confidence = 1.0 - phase1_conf
            explanation = "Unlikely behavior signal; no Strava match"
        else:
            final_status = AttendanceStatus.UNCERTAIN
            final_confidence = 0.0
            explanation = "No behavior data and no Strava match"

    else:
        # Strava NOT_AVAILABLE (disabled or tokens missing)
        if behavior_strong:
            final_status = AttendanceStatus.LIKELY_ATTENDED
            final_confidence = phase1_conf * 0.85
            explanation = "Strong behavior signal; Strava not available"
        elif behavior_moderate:
            final_status = AttendanceStatus.LIKELY_ATTENDED
            final_confidence = phase1_conf * 0.75
            explanation = "Moderate behavior signal; Strava not available"
        elif behavior_uncertain:
            final_status = AttendanceStatus.UNCERTAIN
            final_confidence = phase1_conf
            explanation = "Uncertain behavior; Strava not available"
        elif behavior_unlikely:
            final_status = AttendanceStatus.LIKELY_MISSED
            final_confidence = 1.0 - phase1_conf
            explanation = "Unlikely behavior signal"
        else:
            # NO_DATA
            final_status = AttendanceStatus.UNCERTAIN
            final_confidence = 0.0
            explanation = "No health data or Strava available to determine attendance"

    # Clamp confidence to [0, 1]
    final_confidence = max(0.0, min(1.0, final_confidence))

    # ── Enrichment gap detection ───────────────────────────────────────────────
    has_health_data = daily is not None and len(daily.sources_present) > 0
    suspected_enrichment_gap = (
        hike.attended is True
        and hike.hr_avg is None
        and has_health_data
    )

    # ── Data quality notes ─────────────────────────────────────────────────────
    data_quality_notes: List[str] = []

    if behavior_no_data:
        data_quality_notes.append("No health metrics found for this date")
    if suspected_enrichment_gap:
        data_quality_notes.append(
            "Enrichment gap: attended=True in DB but hr_avg is missing despite health data existing"
        )
    if hike.attended is True and not behavior_strong and not strava_confirmed:
        data_quality_notes.append(
            "DB says attended=True but signals are not conclusive — consider enriching"
        )
    if hike.hr_avg is None and hike.attended is True:
        data_quality_notes.append("hr_avg missing for attended hike")
    if phase2_label == ConfirmationLabel.NOT_AVAILABLE:
        data_quality_notes.append("Strava not available (disabled or token missing)")

    # ── Provenance ─────────────────────────────────────────────────────────────
    provenance: Dict[str, Any] = {
        "explanation": explanation,
        "phase1": {
            "label": phase1_label.value,
            "confidence": phase1_conf,
            "features": phase1_features,
        },
        "phase2": {
            "label": phase2_label.value,
            "confidence": phase2_conf,
            "details": phase2_details,
        },
        "sources_used": daily.sources_present if daily else [],
        "db_attended": hike.attended,
    }

    return AttendanceDecision(
        hike_date=hike.hike_date,
        season=hike.season,
        hike_number=hike.hike_number,
        hike_code=hike.hike_code,
        trail_name=hike.trail_name,
        attended_db=hike.attended,
        ground_truth=None,  # Set by evaluate.py
        phase1_behavior_label=phase1_label,
        phase1_behavior_confidence=phase1_conf,
        phase2_confirmation_label=phase2_label,
        phase2_confirmation_confidence=phase2_conf,
        final_attendance_status=final_status,
        final_confidence=final_confidence,
        suspected_enrichment_gap=suspected_enrichment_gap,
        evidence=evidence,
        data_quality_notes=data_quality_notes,
        provenance=provenance,
    )


def _build_evidence(
    hike: HikeRecord,
    daily: Optional[DailyHealthSummary],
    baselines: Dict[str, Any],
    phase1_features: Dict[str, Any],
    phase2_details: Dict[str, Any],
) -> AttendanceEvidence:
    """Build the AttendanceEvidence object from all available signals."""
    if daily is None:
        return AttendanceEvidence(sources_available=[])

    # Baseline ratios from phase1 features
    features = phase1_features.get("features", {})
    steps_ratio = features.get("steps", {}).get("ratio")
    active_ratio = features.get("active_minutes", {}).get("ratio")
    strain_ratio = features.get("strain", {}).get("ratio")

    # Strava details
    strava_match = phase2_details.get("activity_id") is not None
    strava_type = phase2_details.get("activity_type")
    strava_dist = phase2_details.get("distance_km")
    strava_elev = phase2_details.get("elevation_m")
    strava_hour = phase2_details.get("start_hour")

    return AttendanceEvidence(
        steps_day=daily.fitbit_steps,
        active_minutes_day=daily.fitbit_active_minutes,
        strain_day=daily.whoop_strain,
        calories_day=daily.fitbit_calories or daily.whoop_calories,
        resting_hr=daily.fitbit_resting_hr or daily.whoop_resting_hr,
        hrv=daily.fitbit_hrv or daily.whoop_hrv,
        hr_zone_3_pct=daily.whoop_hr_zone_3,
        hr_zone_4_pct=daily.whoop_hr_zone_4,
        hr_zone_5_pct=daily.whoop_hr_zone_5,
        steps_vs_baseline=steps_ratio,
        active_minutes_vs_baseline=active_ratio,
        strain_vs_baseline=strain_ratio,
        strava_match=strava_match,
        strava_activity_type=strava_type,
        strava_distance_km=strava_dist,
        strava_elevation_m=strava_elev,
        strava_start_hour=strava_hour,
        manual_workout_detected=False,
        sources_available=daily.sources_present,
    )
