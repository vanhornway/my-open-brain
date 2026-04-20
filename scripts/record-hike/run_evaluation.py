#!/usr/bin/env python3
"""
Record Hike — Season 14 Evaluation
Usage: python run_evaluation.py [--season 14] [--audit-only] [--no-strava]

This script orchestrates the full hike attendance detection pipeline:
  Phase 0: Load data (hiking history, health metrics, Strava)
  Phase 1: Behavior-based detection from daily health aggregates
  Phase 2: Strava confirmation
  Classify: Combine signals into final attendance decision
  Evaluate: Compare against Season 14 ground truth
  Report:   Print rich-formatted output
"""
import argparse
import os
import sys
from datetime import date, timedelta
from typing import Dict, List, Optional

# Ensure the project root is on sys.path
sys.path.insert(0, os.path.dirname(__file__))

from rich.console import Console
from rich.panel import Panel

console = Console()


def _check_env() -> bool:
    """Check required environment variables are set."""
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        console.print(Panel(
            "[bold red]SUPABASE_SERVICE_ROLE_KEY is not set![/bold red]\n\n"
            "Please run:\n"
            "  [cyan]export SUPABASE_SERVICE_ROLE_KEY=your_service_role_key[/cyan]\n\n"
            "You can find your service role key in the Supabase dashboard:\n"
            "  Project Settings → API → service_role key",
            title="Missing Configuration",
            border_style="red",
        ))
        return False
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Record Hike — Hike attendance detection and evaluation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run_evaluation.py                    # Full pipeline for Season 14
  python run_evaluation.py --season 14        # Same as above
  python run_evaluation.py --audit-only       # Only run data quality audit
  python run_evaluation.py --no-strava        # Skip Strava (faster, behavior-only)
        """,
    )
    parser.add_argument(
        "--season",
        type=int,
        default=14,
        help="Season number to evaluate (default: 14)",
    )
    parser.add_argument(
        "--audit-only",
        action="store_true",
        help="Only run the data quality audit, skip classification and evaluation",
    )
    parser.add_argument(
        "--no-strava",
        action="store_true",
        help="Skip Strava activity loading (behavior-only detection)",
    )
    parser.add_argument(
        "--show-baselines",
        action="store_true",
        help="Print computed baseline values",
    )
    parser.add_argument(
        "--show-notes",
        action="store_true",
        help="Print per-hike data quality notes",
    )
    args = parser.parse_args()

    # ── Environment check ──────────────────────────────────────────────────────
    if not _check_env():
        sys.exit(1)

    console.print(Panel(
        f"[bold cyan]Record Hike — Season {args.season} Analysis[/bold cyan]\n"
        f"Audit only: {args.audit_only}  |  "
        f"Strava: {'disabled' if args.no_strava else 'enabled'}",
        border_style="cyan",
    ))

    # ── Imports (after env check) ──────────────────────────────────────────────
    from src.loaders import (
        load_hiking_history,
        load_health_metrics,
        load_strava_activities,
        build_strava_by_date,
        build_daily_summaries,
    )
    from src.audit import run_audit, print_audit_report
    from src.baselines import compute_baselines, describe_baselines
    from src.phase1_behavior import detect_behavior, _load_config as load_behavior_config
    from src.phase2_confirmation import (
        LiveStravaProvider,
        StubStravaProvider,
        confirm_with_strava,
        _load_confirmation_config,
    )
    from src.classifier import classify
    from src.evaluate import evaluate_season, print_evaluation_results, get_ground_truth
    from src.reporting import print_season_report, print_data_notes
    from src.repair import propose_repairs, print_repair_proposals
    from src.models import AttendanceDecision

    # ──────────────────────────────────────────────────────────────────────────
    # PHASE 0: Load Data
    # ──────────────────────────────────────────────────────────────────────────
    console.print("\n[bold blue]Phase 0: Loading data...[/bold blue]")

    # Load hiking history
    console.print(f"  Loading Season {args.season} hiking history...")
    hikes = load_hiking_history(season=args.season)
    console.print(f"  [green]Loaded {len(hikes)} hike records[/green]")

    if not hikes:
        console.print(f"[red]No hikes found for Season {args.season}. Check your database.[/red]")
        sys.exit(1)

    # Determine date range for health metrics
    hike_dates = [h.hike_date for h in hikes]
    date_from = min(hike_dates) - timedelta(days=7)   # Buffer before first hike
    date_to = max(hike_dates) + timedelta(days=7)     # Buffer after last hike
    console.print(f"  Loading health metrics from {date_from} to {date_to}...")

    health_metrics = load_health_metrics(date_from=date_from, date_to=date_to)
    console.print(f"  [green]Loaded {len(health_metrics)} health metric records[/green]")

    # Build daily summaries
    console.print("  Building daily health summaries...")
    daily_summaries = build_daily_summaries(health_metrics)
    console.print(f"  [green]Built summaries for {len(daily_summaries)} days[/green]")

    # Load Strava activities
    if args.no_strava:
        console.print("  [yellow]Strava disabled (--no-strava)[/yellow]")
        strava_activities = []
    else:
        console.print("  Loading Strava activities...")
        try:
            strava_activities = load_strava_activities()
        except Exception as e:
            console.print(f"  [yellow]Strava load failed: {e}. Continuing without Strava.[/yellow]")
            strava_activities = []

    strava_by_date = build_strava_by_date(strava_activities)
    console.print(f"  [green]Strava activities indexed for {len(strava_by_date)} dates[/green]")

    # ──────────────────────────────────────────────────────────────────────────
    # PHASE 0b: Data Quality Audit
    # ──────────────────────────────────────────────────────────────────────────
    console.print("\n[bold blue]Running Data Quality Audit...[/bold blue]")
    audit_rows = run_audit(hikes, daily_summaries, strava_by_date)
    print_audit_report(audit_rows)

    if args.audit_only:
        console.print("\n[yellow]--audit-only specified. Stopping after audit.[/yellow]")
        return

    # ──────────────────────────────────────────────────────────────────────────
    # PHASE 0c: Compute Baselines
    # ──────────────────────────────────────────────────────────────────────────
    console.print("\n[bold blue]Computing baselines...[/bold blue]")

    # Use all seasons of health data (loaded above) for baseline computation
    # But only use non-hike Saturdays from all available hiking history
    all_hikes = load_hiking_history()  # All seasons for baseline computation
    baselines = compute_baselines(all_hikes, daily_summaries)

    if args.show_baselines:
        describe_baselines(baselines)
    else:
        n_sat = int(baselines.get("_n_saturday_non_hike_days", 0))
        n_all = int(baselines.get("_n_all_days", 0))
        console.print(
            f"  [green]Baselines computed from {n_sat} non-hike Saturdays, "
            f"{n_all} total days with health data[/green]"
        )

    # ──────────────────────────────────────────────────────────────────────────
    # PHASE 1 + 2: Classify each hike
    # ──────────────────────────────────────────────────────────────────────────
    console.print(f"\n[bold blue]Phase 1+2: Classifying {len(hikes)} hikes...[/bold blue]")

    # Pre-load configs once
    behavior_config = load_behavior_config()
    strava_config = _load_confirmation_config() if not args.no_strava else None

    # Set up Strava provider
    if args.no_strava or not strava_activities:
        strava_provider = StubStravaProvider()
    else:
        strava_provider = LiveStravaProvider(strava_by_date)

    decisions: List[AttendanceDecision] = []

    for hike in hikes:
        d = hike.hike_date
        daily = daily_summaries.get(d)

        # Phase 1: Behavior detection
        p1_label, p1_conf, p1_features = detect_behavior(daily, baselines, behavior_config)

        # Phase 2: Strava confirmation
        if args.no_strava:
            from src.models import ConfirmationLabel
            p2_label = ConfirmationLabel.NOT_AVAILABLE
            p2_conf = 0.0
            p2_details: Dict = {"reason": "strava_disabled"}
        else:
            strava_acts = strava_provider.get_activities_for_date(d)
            p2_label, p2_conf, p2_details = confirm_with_strava(
                hike, strava_acts, strava_config
            )

        # Classify
        decision = classify(
            hike=hike,
            phase1_label=p1_label,
            phase1_conf=p1_conf,
            phase1_features=p1_features,
            phase2_label=p2_label,
            phase2_conf=p2_conf,
            phase2_details=p2_details,
            daily=daily,
            baselines=baselines,
        )
        decisions.append(decision)

    console.print(f"  [green]Classified {len(decisions)} hikes[/green]")

    # ──────────────────────────────────────────────────────────────────────────
    # PHASE 3: Evaluation against ground truth
    # ──────────────────────────────────────────────────────────────────────────
    console.print(f"\n[bold blue]Phase 3: Evaluating Season {args.season} against ground truth...[/bold blue]")
    eval_results = evaluate_season(decisions, season=args.season)

    # Update decisions with ground truth from evaluation
    for dec in eval_results.get("season_decisions", decisions):
        for orig in decisions:
            if orig.hike_code == dec.hike_code:
                orig.ground_truth = dec.ground_truth
                break

    # ──────────────────────────────────────────────────────────────────────────
    # PHASE 4: Reporting
    # ──────────────────────────────────────────────────────────────────────────
    console.print("\n[bold blue]Phase 4: Generating report...[/bold blue]")

    # Build ground truth map for reporting
    from src.evaluate import get_ground_truth as _gt
    gt_map = {h.hike_date: _gt(h.hike_date, args.season) for h in hikes}
    gt_map = {k: v for k, v in gt_map.items() if v is not None}

    print_season_report(decisions, ground_truth_map=gt_map)

    if args.show_notes:
        print_data_notes(decisions)

    # Evaluation results
    print_evaluation_results(eval_results)

    # ──────────────────────────────────────────────────────────────────────────
    # PHASE 5: Repair proposals
    # ──────────────────────────────────────────────────────────────────────────
    console.print("\n[bold blue]Phase 5: Computing repair proposals...[/bold blue]")
    repair_proposals = propose_repairs(hikes, decisions, strava_by_date, daily_summaries)
    print_repair_proposals(repair_proposals)

    # ── Final summary ──────────────────────────────────────────────────────────
    console.print("\n")
    console.print(Panel(
        f"[bold green]Analysis Complete — Season {args.season}[/bold green]\n\n"
        f"  Hikes analyzed:     {len(hikes)}\n"
        f"  Decisions made:     {len(decisions)}\n"
        f"  Repair proposals:   {len(repair_proposals)}\n"
        f"  Evaluation errors:  {len(eval_results.get('errors', []))}\n"
        f"  Accuracy:           "
        + (
            f"{eval_results['overall_accuracy']:.1%}"
            if eval_results.get("overall_accuracy") is not None
            else "N/A (no ground truth)"
        ),
        border_style="green",
    ))


if __name__ == "__main__":
    main()
