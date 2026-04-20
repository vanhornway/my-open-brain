"""
Repair proposal module.
Identifies attended hikes with missing enrichment data and proposes repairs.
"""
from datetime import date
from typing import List, Dict, Any, Optional

from .models import (
    HikeRecord,
    AttendanceDecision,
    StravaActivity,
    DailyHealthSummary,
)

_PLAUSIBLE_HIKE_TYPES = {"Hike", "Walk", "TrailRun", "Run"}


def _best_strava_match(
    activities: List[StravaActivity],
) -> Optional[StravaActivity]:
    """
    From a list of activities on the hike day, pick the best match for a hike.
    Prefer Hike > Walk > TrailRun > Run, then by distance descending.
    """
    if not activities:
        return None

    type_priority = {"Hike": 0, "Walk": 1, "TrailRun": 2, "Run": 3}

    def sort_key(act: StravaActivity):
        return (type_priority.get(act.activity_type, 99), -act.distance_km)

    plausible = [a for a in activities if a.activity_type in _PLAUSIBLE_HIKE_TYPES]
    if plausible:
        return sorted(plausible, key=sort_key)[0]
    # Fall back to any activity
    return sorted(activities, key=lambda a: -a.distance_km)[0]


def propose_repairs(
    hikes: List[HikeRecord],
    decisions: List[AttendanceDecision],
    strava_by_date: Dict[date, List[StravaActivity]],
    daily_summaries: Dict[date, DailyHealthSummary],
) -> List[Dict[str, Any]]:
    """
    For each attended hike with missing hr_avg (enrichment gap),
    propose concrete repairs based on available data sources.

    Each repair proposal is a dict:
    {
        hike_code: str,
        hike_date: date,
        trail_name: str,
        field: str,           # which field to repair
        proposed_value: Any,  # the proposed fill value
        provenance: str,      # where the value comes from
        confidence: float,    # 0-1
        note: str,            # human-readable explanation
    }
    """
    # Build quick lookup for decisions
    decision_by_code: Dict[str, AttendanceDecision] = {
        d.hike_code: d for d in decisions
    }

    proposals: List[Dict[str, Any]] = []

    for hike in hikes:
        # Only repair attended hikes with missing hr_avg
        if hike.attended is not True:
            continue
        if hike.hr_avg is not None:
            continue

        d = hike.hike_date
        strava_activities = strava_by_date.get(d, [])
        daily = daily_summaries.get(d)
        decision = decision_by_code.get(hike.hike_code)

        best_strava = _best_strava_match(strava_activities)

        if best_strava is not None:
            # Propose Strava-based repair
            if best_strava.average_heartrate is not None:
                proposals.append({
                    "hike_code": hike.hike_code,
                    "hike_date": d,
                    "trail_name": hike.trail_name,
                    "field": "hr_avg",
                    "proposed_value": round(best_strava.average_heartrate, 1),
                    "provenance": "strava",
                    "confidence": 0.85,
                    "note": (
                        f"Strava activity '{best_strava.name}' "
                        f"({best_strava.activity_type}, {best_strava.distance_km:.1f} km) "
                        f"avg HR: {best_strava.average_heartrate:.0f} bpm"
                    ),
                })

            if best_strava.max_heartrate is not None:
                proposals.append({
                    "hike_code": hike.hike_code,
                    "hike_date": d,
                    "trail_name": hike.trail_name,
                    "field": "hr_max",
                    "proposed_value": round(best_strava.max_heartrate, 1),
                    "provenance": "strava",
                    "confidence": 0.85,
                    "note": (
                        f"Strava activity '{best_strava.name}' "
                        f"max HR: {best_strava.max_heartrate:.0f} bpm"
                    ),
                })

            if best_strava.athlete_count is not None and hike.athlete_count is None:
                proposals.append({
                    "hike_code": hike.hike_code,
                    "hike_date": d,
                    "trail_name": hike.trail_name,
                    "field": "athlete_count",
                    "proposed_value": best_strava.athlete_count,
                    "provenance": "strava",
                    "confidence": 0.90,
                    "note": (
                        f"Strava activity shows {best_strava.athlete_count} athletes "
                        f"(group size indicator)"
                    ),
                })

            if best_strava.kudos_count is not None and hike.kudos_count is None:
                proposals.append({
                    "hike_code": hike.hike_code,
                    "hike_date": d,
                    "trail_name": hike.trail_name,
                    "field": "kudos_count",
                    "proposed_value": best_strava.kudos_count,
                    "provenance": "strava",
                    "confidence": 0.95,
                    "note": f"Strava activity received {best_strava.kudos_count} kudos",
                })

        elif daily is not None and daily.whoop_strain is not None:
            # Strava not available, but WHOOP strain gives an activity signal
            proposals.append({
                "hike_code": hike.hike_code,
                "hike_date": d,
                "trail_name": hike.trail_name,
                "field": "hr_avg",
                "proposed_value": None,
                "provenance": "whoop_strain",
                "confidence": 0.30,
                "note": (
                    f"WHOOP strain available ({daily.whoop_strain:.1f}) but no per-session HR data. "
                    "Cannot compute hr_avg from daily aggregate strain alone. "
                    "Manual entry or Strava activity required."
                ),
            })

            if daily.whoop_resting_hr is not None:
                proposals.append({
                    "hike_code": hike.hike_code,
                    "hike_date": d,
                    "trail_name": hike.trail_name,
                    "field": "hr_avg (note)",
                    "proposed_value": None,
                    "provenance": "whoop_resting_hr",
                    "confidence": 0.20,
                    "note": (
                        f"WHOOP resting HR on this day: {daily.whoop_resting_hr:.0f} bpm. "
                        "Not equivalent to avg workout HR but may indicate cardiovascular state."
                    ),
                })

        elif daily is not None and daily.fitbit_steps is not None:
            # Only Fitbit steps — weakest signal
            baseline_steps = (
                daily_summaries.get(d) and None
            )
            proposals.append({
                "hike_code": hike.hike_code,
                "hike_date": d,
                "trail_name": hike.trail_name,
                "field": "hr_avg",
                "proposed_value": None,
                "provenance": "fitbit_steps",
                "confidence": 0.15,
                "note": (
                    f"Fitbit steps suggest active day ({daily.fitbit_steps:,.0f} steps) "
                    "but no per-session HR data available. "
                    "Strava activity link required to fill hr_avg."
                ),
            })

        else:
            # No data at all — just flag it
            proposals.append({
                "hike_code": hike.hike_code,
                "hike_date": d,
                "trail_name": hike.trail_name,
                "field": "hr_avg",
                "proposed_value": None,
                "provenance": "none",
                "confidence": 0.0,
                "note": (
                    "No health data or Strava activity found for this date. "
                    "HR data must be entered manually."
                ),
            })

    return proposals


def print_repair_proposals(proposals: List[Dict[str, Any]]) -> None:
    """Print repair proposals in a formatted table using rich."""
    from rich.console import Console
    from rich.table import Table
    from rich import box

    console = Console()

    if not proposals:
        console.print("\n[green]No repair proposals — all attended hikes have HR data.[/green]")
        return

    console.rule("[bold yellow]Repair Proposals[/bold yellow]")
    console.print(
        f"[yellow]{len(proposals)} repair proposal(s) for attended hikes missing hr_avg[/yellow]\n"
    )

    table = Table(
        title="Proposed Data Repairs",
        box=box.SIMPLE_HEAVY,
        header_style="bold yellow",
        expand=True,
    )
    table.add_column("Date", width=12)
    table.add_column("Code", width=10)
    table.add_column("Trail", width=25, overflow="fold")
    table.add_column("Field", width=14)
    table.add_column("Proposed Value", width=16)
    table.add_column("Source", width=14)
    table.add_column("Conf%", width=6)
    table.add_column("Note", overflow="fold")

    for p in proposals:
        conf_str = f"{int(p['confidence']*100)}%"
        val_str = str(p["proposed_value"]) if p["proposed_value"] is not None else "[dim]N/A[/dim]"
        provenance_color = {
            "strava": "green",
            "whoop_strain": "yellow",
            "whoop_resting_hr": "yellow",
            "fitbit_steps": "cyan",
            "none": "red",
        }.get(p["provenance"], "white")
        prov_str = f"[{provenance_color}]{p['provenance']}[/{provenance_color}]"

        table.add_row(
            str(p["hike_date"]),
            p["hike_code"],
            p["trail_name"][:25],
            p["field"],
            val_str,
            prov_str,
            conf_str,
            p["note"][:80] + "..." if len(p["note"]) > 80 else p["note"],
        )

    console.print(table)

    # Summary by source
    from collections import Counter
    source_counts = Counter(p["provenance"] for p in proposals)
    console.print("\n[bold]By Source:[/bold]")
    for source, count in source_counts.most_common():
        console.print(f"  {source}: {count} proposal(s)")
