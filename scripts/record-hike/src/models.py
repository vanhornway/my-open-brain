from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import date, datetime
from enum import Enum


class AttendanceStatus(str, Enum):
    CONFIRMED_ATTENDED = "confirmed_attended"
    LIKELY_ATTENDED = "likely_attended"
    UNCERTAIN = "uncertain"
    LIKELY_MISSED = "likely_missed"
    CONFIRMED_MISSED = "confirmed_missed"


class BehaviorLabel(str, Enum):
    STRONG = "strong_likely_hike_behavior"
    MODERATE = "moderate_likely_hike_behavior"
    UNCERTAIN = "uncertain_behavior"
    UNLIKELY = "unlikely_hike_behavior"
    NO_DATA = "no_data"


class ConfirmationLabel(str, Enum):
    CONFIRMED = "strava_confirmed"
    PARTIAL = "strava_partial"
    NOT_FOUND = "strava_not_found"
    NOT_AVAILABLE = "not_available"


class HikeRecord(BaseModel):
    id: Optional[str] = None
    hike_date: date
    season: int
    hike_number: int
    hike_code: str
    trail_name: str
    alltrails_url: Optional[str] = None
    cafe_name: Optional[str] = None
    cafe_url: Optional[str] = None
    notes: Optional[str] = None
    attended: Optional[bool] = None
    kudoers: Optional[List[str]] = None
    kudos_count: Optional[int] = None
    athlete_count: Optional[int] = None
    hr_avg: Optional[float] = None
    hr_max: Optional[float] = None
    hr_zones: Optional[List[Dict]] = None
    photo_count: Optional[int] = None


class HealthMetricRecord(BaseModel):
    id: Optional[str] = None
    recorded_at: datetime
    source: str  # fitbit, whoop, etc.
    metric_type: str
    value: float
    unit: str
    metadata: Optional[Dict[str, Any]] = None
    subject: str = "Umair"
    notes: Optional[str] = None


class DailyHealthSummary(BaseModel):
    """Aggregated health data for a single day from all sources"""
    date: date
    # Fitbit
    fitbit_steps: Optional[float] = None
    fitbit_active_minutes: Optional[float] = None
    fitbit_calories: Optional[float] = None
    fitbit_resting_hr: Optional[float] = None
    fitbit_hrv: Optional[float] = None
    fitbit_sleep_hours: Optional[float] = None
    fitbit_sleep_score: Optional[float] = None
    fitbit_spo2: Optional[float] = None
    # WHOOP
    whoop_strain: Optional[float] = None
    whoop_recovery_score: Optional[float] = None
    whoop_hrv: Optional[float] = None
    whoop_resting_hr: Optional[float] = None
    whoop_calories: Optional[float] = None
    whoop_sleep_hours: Optional[float] = None
    whoop_hr_zone_3: Optional[float] = None  # % in zone 3
    whoop_hr_zone_4: Optional[float] = None
    whoop_hr_zone_5: Optional[float] = None
    # Which sources have data for this day
    sources_present: List[str] = Field(default_factory=list)
    metric_types_present: List[str] = Field(default_factory=list)


class StravaActivity(BaseModel):
    id: int
    name: str
    activity_type: str
    start_date_local: datetime
    distance_m: float
    elapsed_time_s: int
    total_elevation_gain: Optional[float] = None
    average_heartrate: Optional[float] = None
    max_heartrate: Optional[float] = None
    athlete_count: Optional[int] = None
    kudos_count: Optional[int] = None

    @property
    def distance_km(self) -> float:
        return self.distance_m / 1000

    @property
    def start_hour(self) -> int:
        return self.start_date_local.hour


class AttendanceEvidence(BaseModel):
    steps_day: Optional[float] = None
    active_minutes_day: Optional[float] = None
    strain_day: Optional[float] = None
    calories_day: Optional[float] = None
    resting_hr: Optional[float] = None
    hrv: Optional[float] = None
    hr_zone_3_pct: Optional[float] = None
    hr_zone_4_pct: Optional[float] = None
    hr_zone_5_pct: Optional[float] = None
    steps_vs_baseline: Optional[float] = None
    active_minutes_vs_baseline: Optional[float] = None
    strain_vs_baseline: Optional[float] = None
    strava_match: bool = False
    strava_activity_type: Optional[str] = None
    strava_distance_km: Optional[float] = None
    strava_elevation_m: Optional[float] = None
    strava_start_hour: Optional[int] = None
    manual_workout_detected: bool = False
    sources_available: List[str] = Field(default_factory=list)


class AttendanceDecision(BaseModel):
    hike_date: date
    season: int
    hike_number: int
    hike_code: str
    trail_name: str
    attended_db: Optional[bool] = None
    ground_truth: Optional[bool] = None
    phase1_behavior_label: BehaviorLabel = BehaviorLabel.NO_DATA
    phase1_behavior_confidence: float = 0.0
    phase2_confirmation_label: ConfirmationLabel = ConfirmationLabel.NOT_AVAILABLE
    phase2_confirmation_confidence: float = 0.0
    final_attendance_status: AttendanceStatus = AttendanceStatus.UNCERTAIN
    final_confidence: float = 0.0
    suspected_enrichment_gap: bool = False
    evidence: AttendanceEvidence = Field(default_factory=AttendanceEvidence)
    data_quality_notes: List[str] = Field(default_factory=list)
    provenance: Dict[str, Any] = Field(default_factory=dict)


class DataQualityAuditRow(BaseModel):
    hike_date: date
    season: int
    hike_code: str
    trail_name: str
    attended_db: Optional[bool]
    hr_avg_present: bool
    hr_max_present: bool
    hr_zones_present: bool
    photo_count_present: bool
    kudoers_present: bool
    same_day_fitbit_steps: bool
    same_day_fitbit_active_minutes: bool
    same_day_fitbit_resting_hr: bool
    same_day_whoop_strain: bool
    same_day_whoop_recovery: bool
    same_day_whoop_hrv: bool
    same_day_whoop_hr_zones: bool
    same_day_any_health_data: bool
    metric_types_available: List[str]
    suspected_enrichment_gap: bool  # attended+no_hr but health data exists
    strava_matched: bool = False
    repair_candidate: bool = False
