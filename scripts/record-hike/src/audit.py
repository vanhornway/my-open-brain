"""
Data quality audit module.
Produces a row-per-hike audit of what data is present vs. missing.
"""
from typing import List, Dict, Optional
from datetime import date
from collections import defaultdict

from rich.console import Console
from rich.table import Table
from rich import box
from tabulate import tabulate

from .models import HikeRecord, DailyHealthSummary, DataQualityAuditRow, StravaActivity

console = Console()


def run_audit(
    hikes: List[HikeRecord],
    daily_summaries: Dict[date, DailyHealthSummary],
    strava_by_date: Dict[date, List[StravaActivity]],
) -> List[DataQualityAuditRow]:
    """
    For each hike, produce a DataQualityAuditRow describing what data is present.

    suspected_enrichment_gap: attended_db=True AND hr_avg missing AND same_day_any_health_data=True
    repair_candidate: suspected_enrichment_gap=True AND (strava_matched OR same_day_whoop_strain=True)
    """
    rows: List[DataQualityAuditRow] = []

    for hike in hikes:
        d = hike.hike_date
        daily: Optional[DailyHealthSummary] = daily_summaries.get(d)

        # Hike-level field presence
        hr_avg_present = hike.hr_avg is not None
        hr_max_present = hike.hr_max is not None
        hr_zones_present = hike.hr_zones is not None and len(hike.hr_zones) > 0
        photo_count_present = hike.photo_count is not None
        kudoers_present = hike.kudoers is not None and len(hike.kudoers) > 0

        # Health data presence
        if daily is not None:
            same_day_fitbit_steps = daily.fitbit_steps is not None
            same_day_fitbit_active_minutes = daily.fitbit_active_minutes is not None
            same_day_fitbit_resting_hr = daily.fitbit_resting_hr is not None
            same_day_whoop_strain = daily.whoop_strain is not None
            same_day_whoop_recovery = daily.whoop_recovery_score is not None
            same_day_whoop_hrv = daily.whoop_hrv is not None
            same_day_whoop_hr_zones = (
                daily.whoop_hr_zone_3 is not None
                or daily.whoop_hr_zone_4 is not None
                or daily.whoop_hr_zone_5 is not None
            )
            same_day_any_health_data = len(daily.sources_present) > 0
            metric_types_available = daily.metric_types_present
        else:
            same_day_fitbit_steps = False
            same_day_fitbit_active_minutes = False
            same_day_fitbit_resting_hr = False
            same_day_whoop_strain = False
            same_day_whoop_recovery = False
            same_day_whoop_hrv = False
            same_day_whoop_hr_zones = False
            same_day_any_health_data = False
            metric_types_available = []

        # Strava match: any activity on this date
        strava_activities = strava_by_date.get(d, [])
        strava_matched = len(strava_activities) > 0

        # Enrichment gap: attended but no HR data even though health data exists
        suspected_enrichment_gap = (
            hike.attended is True
            and not hr_avg_present
            and same_day_any_health_data
        )

        # Repair candidate: enrichment gap AND (strava or whoop strain)
        repair_candidate = suspected_enrichment_gap and (
            strava_matched or same_day_whoop_strain
        )

        row = DataQualityAuditRow(
            hike_date=d,
            season=hike.season,
            hike_code=hike.hike_code,
            trail_name=hike.trail_name,
            attended_db=hike.attended,
            hr_avg_present=hr_avg_present,
            hr_max_present=hr_max_present,
            hr_zones_present=hr_zones_present,
            photo_count_present=photo_count_present,
            kudoers_present=kudoers_present,
            same_day_fitbit_steps=same_day_fitbit_steps,
            same_day_fitbit_active_minutes=same_day_fitbit_active_minutes,
            same_day_fitbit_resting_hr=same_day_fitbit_resting_hr,
            same_day_whoop_strain=same_day_whoop_strain,
            same_day_whoop_recovery=same_day_whoop_recovery,
            same_day_whoop_hrv=same_day_whoop_hrv,
            same_day_whoop_hr_zones=same_day_whoop_hr_zones,
            same_day_any_health_data=same_day_any_health_data,
            metric_types_available=metric_types_available,
            suspected_enrichment_gap=suspected_enrichment_gap,
            strava_matched=strava_matched,
            repair_candidate=repair_candidate,
        )
        rows.append(row)

    return rows


def _bool_symbol(val: bool) -> str:
    return "[green]Y[/green]" if val else "[red]-[/red]"


def print_audit_report(rows: List[DataQualityAuditRow]) -> None:
    """
    Print a rich audit report with:
    1. Full table
    2. Summary stats
    3. By-season breakdown
    4. Missing field frequency
    """
    console.rule("[bold blue]Data Quality Audit Report[/bold blue]")

    # ── 1. Full table ──────────────────────────────────────────────────────────
    table = Table(
        title="Per-Hike Data Quality",
        box=box.SIMPLE_HEAVY,
        show_lines=False,
        header_style="bold cyan",
        expand=True,
    )
    table.add_column("Date", style="dim", width=12)
    table.add_column("Code", width=10)
    table.add_column("Trail", width=22, overflow="fold")
    table.add_column("Att", width=4)
    table.add_column("HR↑", width=4)
    table.add_column("Zones", width=5)
    table.add_column("Photo", width=5)
    table.add_column("Kudos", width=5)
    table.add_column("FBstep", width=6)
    table.add_column("FBmin", width=5)
    table.add_column("WHPstr", width=6)
    table.add_column("WHPzn", width=5)
    table.add_column("Strava", width=6)
    table.add_column("Gap?", width=5)
    table.add_column("Repair?", width=7)

    for r in rows:
        att_str = (
            "[green]T[/green]"
            if r.attended_db is True
            else ("[red]F[/red]" if r.attended_db is False else "[yellow]?[/yellow]")
        )
        gap_str = "[bold red]GAP[/bold red]" if r.suspected_enrichment_gap else ""
        repair_str = "[bold yellow]YES[/bold yellow]" if r.repair_candidate else ""

        table.add_row(
            str(r.hike_date),
            r.hike_code,
            r.trail_name[:22],
            att_str,
            _bool_symbol(r.hr_avg_present),
            _bool_symbol(r.hr_zones_present),
            _bool_symbol(r.photo_count_present),
            _bool_symbol(r.kudoers_present),
            _bool_symbol(r.same_day_fitbit_steps),
            _bool_symbol(r.same_day_fitbit_active_minutes),
            _bool_symbol(r.same_day_whoop_strain),
            _bool_symbol(r.same_day_whoop_hr_zones),
            _bool_symbol(r.strava_matched),
            gap_str,
            repair_str,
        )

    console.print(table)

    total = len(rows)
    attended_rows = [r for r in rows if r.attended_db is True]
    missed_rows = [r for r in rows if r.attended_db is False]
    gap_rows = [r for r in rows if r.suspected_enrichment_gap]
    repair_rows = [r for r in rows if r.repair_candidate]
    no_health_rows = [r for r in rows if not r.same_day_any_health_data]

    # ── 2. Summary stats ──────────────────────────────────────────────────────
    console.print("\n[bold]Summary Statistics[/bold]")
    summary_data = [
        ["Total hikes", total],
        ["Attended (db=True)", len(attended_rows)],
        ["Missed (db=False)", len(missed_rows)],
        ["Attendance unknown (db=None)", total - len(attended_rows) - len(missed_rows)],
        ["Enrichment gaps (attended, no HR, has health data)", len(gap_rows)],
        ["Repair candidates (gap + strava/whoop)", len(repair_rows)],
        ["No same-day health data at all", len(no_health_rows)],
        ["With Strava activity", sum(1 for r in rows if r.strava_matched)],
        ["With hr_avg", sum(1 for r in rows if r.hr_avg_present)],
        ["With hr_zones", sum(1 for r in rows if r.hr_zones_present)],
        ["With kudoers", sum(1 for r in rows if r.kudoers_present)],
        ["With Fitbit steps", sum(1 for r in rows if r.same_day_fitbit_steps)],
        ["With WHOOP strain", sum(1 for r in rows if r.same_day_whoop_strain)],
    ]
    console.print(tabulate(summary_data, headers=["Metric", "Count"], tablefmt="rounded_outline"))

    # ── 3. By-season breakdown ────────────────────────────────────────────────
    console.print("\n[bold]By-Season Breakdown[/bold]")
    seasons: Dict[int, List[DataQualityAuditRow]] = defaultdict(list)
    for r in rows:
        seasons[r.season].append(r)

    season_data = []
    for s in sorted(seasons.keys()):
        s_rows = seasons[s]
        s_total = len(s_rows)
        s_attended = sum(1 for r in s_rows if r.attended_db is True)
        s_gap = sum(1 for r in s_rows if r.suspected_enrichment_gap)
        s_hr = sum(1 for r in s_rows if r.hr_avg_present)
        s_health = sum(1 for r in s_rows if r.same_day_any_health_data)
        s_strava = sum(1 for r in s_rows if r.strava_matched)
        season_data.append([
            f"S{s}", s_total, s_attended, s_hr,
            f"{s_health}/{s_total}",
            f"{s_strava}/{s_total}",
            s_gap,
        ])

    console.print(tabulate(
        season_data,
        headers=["Season", "Total", "Attended", "Has HR", "Has Health", "Has Strava", "Gaps"],
        tablefmt="rounded_outline",
    ))

    # ── 4. Missing field frequency ────────────────────────────────────────────
    console.print("\n[bold]Missing Field Frequency[/bold]")

    def missing_pct(count: int) -> str:
        if total == 0:
            return "0%"
        return f"{count}/{total} ({100*count//total}%)"

    missing_data = [
        ["hr_avg", missing_pct(sum(1 for r in rows if not r.hr_avg_present))],
        ["hr_max", missing_pct(sum(1 for r in rows if not r.hr_max_present))],
        ["hr_zones", missing_pct(sum(1 for r in rows if not r.hr_zones_present))],
        ["photo_count", missing_pct(sum(1 for r in rows if not r.photo_count_present))],
        ["kudoers", missing_pct(sum(1 for r in rows if not r.kudoers_present))],
        ["fitbit_steps (same day)", missing_pct(sum(1 for r in rows if not r.same_day_fitbit_steps))],
        ["fitbit_active_minutes", missing_pct(sum(1 for r in rows if not r.same_day_fitbit_active_minutes))],
        ["fitbit_resting_hr", missing_pct(sum(1 for r in rows if not r.same_day_fitbit_resting_hr))],
        ["whoop_strain", missing_pct(sum(1 for r in rows if not r.same_day_whoop_strain))],
        ["whoop_recovery", missing_pct(sum(1 for r in rows if not r.same_day_whoop_recovery))],
        ["whoop_hrv", missing_pct(sum(1 for r in rows if not r.same_day_whoop_hrv))],
        ["whoop_hr_zones", missing_pct(sum(1 for r in rows if not r.same_day_whoop_hr_zones))],
        ["any_health_data", missing_pct(sum(1 for r in rows if not r.same_day_any_health_data))],
    ]
    console.print(tabulate(missing_data, headers=["Field", "Missing"], tablefmt="rounded_outline"))

    # ── List enrichment gaps ──────────────────────────────────────────────────
    if gap_rows:
        console.print(f"\n[bold red]Enrichment Gaps ({len(gap_rows)}):[/bold red]")
        gap_table = Table(box=box.SIMPLE, header_style="bold red")
        gap_table.add_column("Date")
        gap_table.add_column("Code")
        gap_table.add_column("Trail")
        gap_table.add_column("Strava?")
        gap_table.add_column("WHOOP strain?")
        gap_table.add_column("Repair?")
        for r in gap_rows:
            gap_table.add_row(
                str(r.hike_date),
                r.hike_code,
                r.trail_name[:30],
                "Y" if r.strava_matched else "-",
                "Y" if r.same_day_whoop_strain else "-",
                "[bold yellow]YES[/bold yellow]" if r.repair_candidate else "no",
            )
        console.print(gap_table)
