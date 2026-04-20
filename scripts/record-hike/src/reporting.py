"""
Reporting module: rich-formatted season report.
Shows per-hike attendance decisions and evaluation summary.
"""
from datetime import date
from typing import List, Dict, Optional, Any

from rich.console import Console
from rich.table import Table
from rich import box
from tabulate import tabulate

from .models import (
    AttendanceDecision,
    AttendanceStatus,
    BehaviorLabel,
    ConfirmationLabel,
)

console = Console()


# ── Label abbreviations ────────────────────────────────────────────────────────

_BEHAVIOR_SHORT = {
    BehaviorLabel.STRONG: "[bold green]STRONG[/bold green]",
    BehaviorLabel.MODERATE: "[green]MOD[/green]",
    BehaviorLabel.UNCERTAIN: "[yellow]UNC[/yellow]",
    BehaviorLabel.UNLIKELY: "[red]UNLIKELY[/red]",
    BehaviorLabel.NO_DATA: "[dim]NODATA[/dim]",
}

_CONFIRM_SHORT = {
    ConfirmationLabel.CONFIRMED: "[bold green]CONF[/bold green]",
    ConfirmationLabel.PARTIAL: "[green]PART[/green]",
    ConfirmationLabel.NOT_FOUND: "[red]NONE[/red]",
    ConfirmationLabel.NOT_AVAILABLE: "[dim]NA[/dim]",
}

_STATUS_STYLE = {
    AttendanceStatus.CONFIRMED_ATTENDED: "[bold green]CONF_ATT[/bold green]",
    AttendanceStatus.LIKELY_ATTENDED: "[green]LIKELY_ATT[/green]",
    AttendanceStatus.UNCERTAIN: "[yellow]UNCERTAIN[/yellow]",
    AttendanceStatus.LIKELY_MISSED: "[red]LIKELY_MISS[/red]",
    AttendanceStatus.CONFIRMED_MISSED: "[bold red]CONF_MISS[/bold red]",
}


def _bool_display(val: Optional[bool]) -> str:
    if val is True:
        return "[green]T[/green]"
    if val is False:
        return "[red]F[/red]"
    return "[dim]?[/dim]"


def _match_symbol(predicted: Optional[bool], truth: Optional[bool]) -> str:
    """Show a check/cross/dash based on prediction vs ground truth."""
    if truth is None or predicted is None:
        return "[dim]~[/dim]"
    if predicted == truth:
        return "[green]✓[/green]"
    return "[red]✗[/red]"


def _one_line_explanation(decision: AttendanceDecision) -> str:
    """
    Generate a concise 1-line explanation for the decision.
    """
    p1 = decision.phase1_behavior_label
    p2 = decision.phase2_confirmation_label
    conf = decision.final_confidence
    status = decision.final_attendance_status

    if status == AttendanceStatus.CONFIRMED_ATTENDED:
        if p2 == ConfirmationLabel.CONFIRMED:
            return f"Strava confirmed ({conf:.0%})"
        return f"Strong signals agree ({conf:.0%})"
    elif status == AttendanceStatus.LIKELY_ATTENDED:
        if p2 in (ConfirmationLabel.CONFIRMED, ConfirmationLabel.PARTIAL):
            return f"Strava partial + {p1.value.split('_')[0]} behavior ({conf:.0%})"
        return f"{p1.value.split('_')[0].capitalize()} behavior only ({conf:.0%})"
    elif status == AttendanceStatus.UNCERTAIN:
        if p1 == BehaviorLabel.NO_DATA:
            return "No health data for this date"
        return f"Mixed/weak signals ({conf:.0%})"
    elif status == AttendanceStatus.LIKELY_MISSED:
        return f"Low activity indicators ({1-conf:.0%} missed confidence)"
    elif status == AttendanceStatus.CONFIRMED_MISSED:
        return "Confirmed no hike activity"
    return "Unknown"


def print_season_report(
    decisions: List[AttendanceDecision],
    ground_truth_map: Optional[Dict[date, bool]] = None,
) -> None:
    """
    Print a comprehensive season report showing per-hike decisions.

    Columns:
    - hike_code
    - trail_name (truncated to 30 chars)
    - attended_db
    - ground_truth
    - match symbol (✓/✗/~)
    - phase1 label (abbreviated)
    - phase2 label (abbreviated)
    - final status
    - confidence %
    - enrichment gap flag
    - 1-line explanation
    """
    if not decisions:
        console.print("[yellow]No decisions to display.[/yellow]")
        return

    season = decisions[0].season if decisions else "?"
    console.rule(f"[bold cyan]Season {season} Attendance Report[/bold cyan]")

    table = Table(
        title=f"Season {season} — Hike Attendance Decisions",
        box=box.SIMPLE_HEAVY,
        header_style="bold cyan",
        show_lines=False,
        expand=True,
    )

    table.add_column("#", width=4, style="dim")
    table.add_column("Date", width=12)
    table.add_column("Code", width=10)
    table.add_column("Trail", width=30, overflow="fold")
    table.add_column("DB", width=4)
    table.add_column("GT", width=4)
    table.add_column("✓", width=3)
    table.add_column("P1", width=9)
    table.add_column("P2", width=6)
    table.add_column("Final", width=12)
    table.add_column("Conf%", width=6)
    table.add_column("Gap", width=4)
    table.add_column("Explanation", overflow="fold")

    # Apply ground truth from map if provided
    if ground_truth_map:
        for dec in decisions:
            if dec.ground_truth is None and dec.hike_date in ground_truth_map:
                dec.ground_truth = ground_truth_map[dec.hike_date]

    for i, dec in enumerate(sorted(decisions, key=lambda d: d.hike_date), 1):
        predicted = None
        if dec.final_attendance_status in (
            AttendanceStatus.CONFIRMED_ATTENDED, AttendanceStatus.LIKELY_ATTENDED
        ):
            predicted = True
        elif dec.final_attendance_status in (
            AttendanceStatus.CONFIRMED_MISSED, AttendanceStatus.LIKELY_MISSED
        ):
            predicted = False

        match_sym = _match_symbol(predicted, dec.ground_truth)
        gap_flag = "[bold red]GAP[/bold red]" if dec.suspected_enrichment_gap else ""
        conf_str = f"{dec.final_confidence:.0%}"

        table.add_row(
            str(i),
            str(dec.hike_date),
            dec.hike_code,
            dec.trail_name[:30],
            _bool_display(dec.attended_db),
            _bool_display(dec.ground_truth),
            match_sym,
            _BEHAVIOR_SHORT.get(dec.phase1_behavior_label, dec.phase1_behavior_label.value),
            _CONFIRM_SHORT.get(dec.phase2_confirmation_label, dec.phase2_confirmation_label.value),
            _STATUS_STYLE.get(dec.final_attendance_status, dec.final_attendance_status.value),
            conf_str,
            gap_flag,
            _one_line_explanation(dec),
        )

    console.print(table)

    # ── Summary stats ──────────────────────────────────────────────────────────
    total = len(decisions)
    n_conf_att = sum(1 for d in decisions if d.final_attendance_status == AttendanceStatus.CONFIRMED_ATTENDED)
    n_likely_att = sum(1 for d in decisions if d.final_attendance_status == AttendanceStatus.LIKELY_ATTENDED)
    n_uncertain = sum(1 for d in decisions if d.final_attendance_status == AttendanceStatus.UNCERTAIN)
    n_likely_miss = sum(1 for d in decisions if d.final_attendance_status == AttendanceStatus.LIKELY_MISSED)
    n_conf_miss = sum(1 for d in decisions if d.final_attendance_status == AttendanceStatus.CONFIRMED_MISSED)
    n_gaps = sum(1 for d in decisions if d.suspected_enrichment_gap)

    console.print("\n[bold]Season Summary:[/bold]")
    summary_data = [
        ["Total hikes", total],
        ["Confirmed Attended", n_conf_att],
        ["Likely Attended", n_likely_att],
        ["Uncertain", n_uncertain],
        ["Likely Missed", n_likely_miss],
        ["Confirmed Missed", n_conf_miss],
        ["Enrichment Gaps", n_gaps],
    ]
    console.print(tabulate(summary_data, headers=["Category", "Count"], tablefmt="rounded_outline"))

    # ── Precision/Recall summary (if ground truth available) ──────────────────
    with_gt = [d for d in decisions if d.ground_truth is not None]
    if with_gt:
        console.print("\n[bold]Ground Truth Comparison:[/bold]")
        correct = sum(
            1 for d in with_gt
            if (
                d.final_attendance_status in (AttendanceStatus.CONFIRMED_ATTENDED, AttendanceStatus.LIKELY_ATTENDED)
                and d.ground_truth is True
            ) or (
                d.final_attendance_status in (AttendanceStatus.CONFIRMED_MISSED, AttendanceStatus.LIKELY_MISSED)
                and d.ground_truth is False
            )
        )
        unresolved = sum(
            1 for d in with_gt
            if d.final_attendance_status == AttendanceStatus.UNCERTAIN
        )
        wrong = sum(
            1 for d in with_gt
            if (
                d.final_attendance_status in (AttendanceStatus.CONFIRMED_ATTENDED, AttendanceStatus.LIKELY_ATTENDED)
                and d.ground_truth is False
            ) or (
                d.final_attendance_status in (AttendanceStatus.CONFIRMED_MISSED, AttendanceStatus.LIKELY_MISSED)
                and d.ground_truth is True
            )
        )
        resolved = len(with_gt) - unresolved
        accuracy = correct / resolved if resolved > 0 else None

        gt_data = [
            ["With ground truth", len(with_gt)],
            ["Correct predictions", correct],
            ["Wrong predictions", wrong],
            ["Unresolved (uncertain)", unresolved],
            ["Accuracy (of resolved)", f"{accuracy:.1%}" if accuracy is not None else "N/A"],
        ]
        console.print(tabulate(gt_data, headers=["Metric", "Value"], tablefmt="rounded_outline"))

        # Show wrong/unresolved rows
        problem_rows = [
            d for d in with_gt
            if d.final_attendance_status == AttendanceStatus.UNCERTAIN
            or (
                d.final_attendance_status in (AttendanceStatus.CONFIRMED_ATTENDED, AttendanceStatus.LIKELY_ATTENDED)
                and d.ground_truth is False
            )
            or (
                d.final_attendance_status in (AttendanceStatus.CONFIRMED_MISSED, AttendanceStatus.LIKELY_MISSED)
                and d.ground_truth is True
            )
        ]

        if problem_rows:
            console.print(f"\n[bold yellow]Problem Cases ({len(problem_rows)}):[/bold yellow]")
            prob_table = Table(box=box.SIMPLE, header_style="bold yellow")
            prob_table.add_column("Date")
            prob_table.add_column("Code")
            prob_table.add_column("Trail")
            prob_table.add_column("GT")
            prob_table.add_column("Predicted")
            prob_table.add_column("Conf%")
            prob_table.add_column("Issue")

            for d in problem_rows:
                pred_str = d.final_attendance_status.value
                issue = "uncertain" if d.final_attendance_status == AttendanceStatus.UNCERTAIN else "mismatch"
                prob_table.add_row(
                    str(d.hike_date),
                    d.hike_code,
                    d.trail_name[:25],
                    "att" if d.ground_truth else "miss",
                    pred_str[:12],
                    f"{d.final_confidence:.0%}",
                    issue,
                )
            console.print(prob_table)


def print_data_notes(decisions: List[AttendanceDecision]) -> None:
    """Print data quality notes for decisions that have them."""
    decisions_with_notes = [d for d in decisions if d.data_quality_notes]
    if not decisions_with_notes:
        return

    console.print(f"\n[bold yellow]Data Quality Notes ({len(decisions_with_notes)} hikes):[/bold yellow]")
    for d in sorted(decisions_with_notes, key=lambda x: x.hike_date):
        console.print(f"  [cyan]{d.hike_date} {d.hike_code}[/cyan] — {d.trail_name}")
        for note in d.data_quality_notes:
            console.print(f"    • {note}")
