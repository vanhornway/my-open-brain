"""
Evaluation module for Season 14 ground truth.
Computes precision, recall, accuracy, confusion matrix, and error analysis.
"""
from datetime import date
from typing import List, Dict, Optional, Any

from .models import AttendanceDecision, AttendanceStatus

def _is_attended_prediction(status: AttendanceStatus) -> Optional[bool]:
    """
    Map AttendanceStatus to a binary attended prediction.
    Returns None for UNCERTAIN (unresolved).
    """
    if status in (AttendanceStatus.CONFIRMED_ATTENDED, AttendanceStatus.LIKELY_ATTENDED):
        return True
    elif status in (AttendanceStatus.CONFIRMED_MISSED, AttendanceStatus.LIKELY_MISSED):
        return False
    return None  # UNCERTAIN


def evaluate_season(
    decisions: List[AttendanceDecision],
    season: int,
) -> Dict[str, Any]:
    """
    Evaluate classifier performance against ground truth for the given season.

    Returns a dict with:
    - precision_confirmed_attended
    - precision_confirmed_missed
    - recall_attended
    - recall_missed
    - overall_accuracy
    - confusion_matrix (TP, FP, TN, FN counts)
    - unresolved_count (UNCERTAIN decisions)
    - errors (list of dicts describing misclassifications)
    - season_decisions (list with ground_truth filled in)
    - n_total, n_evaluated
    """
    season_decisions = [d for d in decisions if d.season == season]

    # Use attended_db (the manually maintained DB field) as ground truth.
    # Only evaluate hikes where attended_db is explicitly set (not NULL).
    for dec in season_decisions:
        dec.ground_truth = dec.attended_db  # None means "unknown" — excluded from metrics

    evaluated = [d for d in season_decisions if d.ground_truth is not None]
    n_total = len(season_decisions)
    n_evaluated = len(evaluated)

    if n_evaluated == 0:
        return {
            "season": season,
            "n_total": n_total,
            "n_evaluated": 0,
            "error": "No ground truth available for this season",
            "season_decisions": season_decisions,
        }

    # Confusion matrix
    # Positive class = attended, Negative class = missed
    tp = 0  # predicted attended, actually attended
    fp = 0  # predicted attended, actually missed
    tn = 0  # predicted missed, actually missed
    fn = 0  # predicted missed, actually attended

    unresolved_count = 0
    errors: List[Dict[str, Any]] = []

    for dec in evaluated:
        prediction = _is_attended_prediction(dec.final_attendance_status)
        gt = dec.ground_truth

        if prediction is None:
            unresolved_count += 1
            # Count uncertain decisions that we know the truth for
            if gt is True:
                fn += 0  # soft: uncertain on attended day is not a hard FN
                errors.append({
                    "hike_code": dec.hike_code,
                    "hike_date": str(dec.hike_date),
                    "trail_name": dec.trail_name,
                    "ground_truth": "attended",
                    "predicted": "uncertain",
                    "type": "unresolved_attended",
                    "confidence": dec.final_confidence,
                    "phase1": dec.phase1_behavior_label.value,
                    "phase2": dec.phase2_confirmation_label.value,
                    "explanation": "Decision uncertain but hike was attended",
                })
            else:
                errors.append({
                    "hike_code": dec.hike_code,
                    "hike_date": str(dec.hike_date),
                    "trail_name": dec.trail_name,
                    "ground_truth": "missed",
                    "predicted": "uncertain",
                    "type": "unresolved_missed",
                    "confidence": dec.final_confidence,
                    "phase1": dec.phase1_behavior_label.value,
                    "phase2": dec.phase2_confirmation_label.value,
                    "explanation": "Decision uncertain but hike was missed",
                })
            continue

        if prediction is True and gt is True:
            tp += 1
        elif prediction is True and gt is False:
            fp += 1
            errors.append({
                "hike_code": dec.hike_code,
                "hike_date": str(dec.hike_date),
                "trail_name": dec.trail_name,
                "ground_truth": "missed",
                "predicted": "attended",
                "type": "false_positive",
                "confidence": dec.final_confidence,
                "phase1": dec.phase1_behavior_label.value,
                "phase2": dec.phase2_confirmation_label.value,
                "explanation": f"Predicted attended (confidence {dec.final_confidence:.0%}) but was missed",
            })
        elif prediction is False and gt is False:
            tn += 1
        elif prediction is False and gt is True:
            fn += 1
            errors.append({
                "hike_code": dec.hike_code,
                "hike_date": str(dec.hike_date),
                "trail_name": dec.trail_name,
                "ground_truth": "attended",
                "predicted": "missed",
                "type": "false_negative",
                "confidence": dec.final_confidence,
                "phase1": dec.phase1_behavior_label.value,
                "phase2": dec.phase2_confirmation_label.value,
                "explanation": f"Predicted missed (confidence {dec.final_confidence:.0%}) but attended",
            })

    # Precision: of all "attended" predictions, how many are correct?
    predicted_attended_confirmed = [
        d for d in evaluated
        if d.final_attendance_status == AttendanceStatus.CONFIRMED_ATTENDED
    ]
    predicted_attended_likely = [
        d for d in evaluated
        if d.final_attendance_status == AttendanceStatus.LIKELY_ATTENDED
    ]
    predicted_missed = [
        d for d in evaluated
        if d.final_attendance_status in (
            AttendanceStatus.CONFIRMED_MISSED, AttendanceStatus.LIKELY_MISSED
        )
    ]

    def precision(tp_count: int, fp_count: int) -> Optional[float]:
        if tp_count + fp_count == 0:
            return None
        return tp_count / (tp_count + fp_count)

    def recall(tp_count: int, fn_count: int) -> Optional[float]:
        if tp_count + fn_count == 0:
            return None
        return tp_count / (tp_count + fn_count)

    # Count correct confirmed attended predictions
    conf_att_correct = sum(1 for d in predicted_attended_confirmed if d.ground_truth is True)
    conf_att_wrong = sum(1 for d in predicted_attended_confirmed if d.ground_truth is False)

    # Count correct likely attended predictions
    likely_att_correct = sum(1 for d in predicted_attended_likely if d.ground_truth is True)
    likely_att_wrong = sum(1 for d in predicted_attended_likely if d.ground_truth is False)

    # Count correct missed predictions
    missed_correct = sum(1 for d in predicted_missed if d.ground_truth is False)
    missed_wrong = sum(1 for d in predicted_missed if d.ground_truth is True)

    # Overall accuracy (excluding uncertain)
    resolved = [d for d in evaluated if _is_attended_prediction(d.final_attendance_status) is not None]
    n_resolved = len(resolved)
    n_correct = sum(
        1 for d in resolved
        if _is_attended_prediction(d.final_attendance_status) == d.ground_truth
    )
    overall_accuracy = n_correct / n_resolved if n_resolved > 0 else None

    # Status distribution
    status_dist: Dict[str, int] = {}
    for d in season_decisions:
        key = d.final_attendance_status.value
        status_dist[key] = status_dist.get(key, 0) + 1

    return {
        "season": season,
        "n_total": n_total,
        "n_evaluated": n_evaluated,
        "n_resolved": n_resolved,
        "n_unresolved": unresolved_count,
        "confusion_matrix": {
            "TP": tp,
            "FP": fp,
            "TN": tn,
            "FN": fn,
        },
        "precision_confirmed_attended": precision(conf_att_correct, conf_att_wrong),
        "precision_likely_attended": precision(likely_att_correct, likely_att_wrong),
        "precision_confirmed_missed": precision(missed_correct, missed_wrong),
        "recall_attended": recall(tp, fn),
        "recall_missed": recall(tn, fp),
        "overall_accuracy": overall_accuracy,
        "n_confirmed_attended": len(predicted_attended_confirmed),
        "n_likely_attended": len(predicted_attended_likely),
        "n_predicted_missed": len(predicted_missed),
        "status_distribution": status_dist,
        "errors": errors,
        "season_decisions": season_decisions,
    }


def print_evaluation_results(results: Dict[str, Any]) -> None:
    """Print evaluation results in a formatted way using rich."""
    from rich.console import Console
    from rich.table import Table
    from rich import box

    console = Console()

    if "error" in results:
        console.print(f"[red]Evaluation error: {results['error']}[/red]")
        return

    season = results["season"]
    console.rule(f"[bold green]Season {season} Evaluation Results[/bold green]")

    # Summary
    console.print(f"\n[bold]Season {season} Summary:[/bold]")
    summary_items = [
        ("Total hikes", results["n_total"]),
        ("Evaluated (w/ ground truth)", results["n_evaluated"]),
        ("Resolved predictions", results["n_resolved"]),
        ("Unresolved (uncertain)", results["n_unresolved"]),
        ("Overall accuracy", f"{results['overall_accuracy']:.1%}" if results["overall_accuracy"] is not None else "N/A"),
    ]
    from tabulate import tabulate
    console.print(tabulate(summary_items, tablefmt="rounded_outline"))

    # Confusion matrix
    cm = results["confusion_matrix"]
    console.print("\n[bold]Confusion Matrix:[/bold]")
    cm_data = [
        ["", "[bold]Pred: Attended[/bold]", "[bold]Pred: Missed[/bold]"],
        ["[bold]True: Attended[/bold]", f"[green]TP={cm['TP']}[/green]", f"[red]FN={cm['FN']}[/red]"],
        ["[bold]True: Missed[/bold]", f"[red]FP={cm['FP']}[/red]", f"[green]TN={cm['TN']}[/green]"],
    ]
    for row in cm_data:
        console.print("  " + "  |  ".join(str(c) for c in row))

    # Precision/Recall
    console.print("\n[bold]Precision / Recall:[/bold]")
    pr_data = [
        ["Confirmed Attended",
         f"{results['precision_confirmed_attended']:.1%}" if results['precision_confirmed_attended'] is not None else "N/A",
         f"({results['n_confirmed_attended']} predictions)"],
        ["Likely Attended",
         f"{results['precision_likely_attended']:.1%}" if results['precision_likely_attended'] is not None else "N/A",
         f"({results['n_likely_attended']} predictions)"],
        ["Predicted Missed",
         f"{results['precision_confirmed_missed']:.1%}" if results['precision_confirmed_missed'] is not None else "N/A",
         f"({results['n_predicted_missed']} predictions)"],
        ["Recall (Attended)", f"{results['recall_attended']:.1%}" if results['recall_attended'] is not None else "N/A", ""],
        ["Recall (Missed)", f"{results['recall_missed']:.1%}" if results['recall_missed'] is not None else "N/A", ""],
    ]
    console.print(tabulate(pr_data, headers=["Category", "Precision/Recall", "Count"], tablefmt="rounded_outline"))

    # Status distribution
    console.print("\n[bold]Status Distribution:[/bold]")
    dist = results["status_distribution"]
    dist_data = [[k, v] for k, v in sorted(dist.items())]
    console.print(tabulate(dist_data, headers=["Status", "Count"], tablefmt="rounded_outline"))

    # Errors
    errors = results.get("errors", [])
    if errors:
        console.print(f"\n[bold red]Classification Errors / Uncertainties ({len(errors)}):[/bold red]")
        err_table = Table(box=box.SIMPLE, header_style="bold red")
        err_table.add_column("Date", width=12)
        err_table.add_column("Code", width=10)
        err_table.add_column("Trail", width=25)
        err_table.add_column("Truth", width=8)
        err_table.add_column("Predicted", width=12)
        err_table.add_column("Type", width=18)
        err_table.add_column("P1", width=8)
        err_table.add_column("P2", width=10)
        err_table.add_column("Conf%", width=6)

        for e in errors:
            type_style = {
                "false_positive": "red",
                "false_negative": "red",
                "unresolved_attended": "yellow",
                "unresolved_missed": "yellow",
            }.get(e["type"], "white")

            err_table.add_row(
                e["hike_date"],
                e["hike_code"],
                e["trail_name"][:25],
                e["ground_truth"],
                e["predicted"],
                f"[{type_style}]{e['type']}[/{type_style}]",
                _shorten_label(e["phase1"]),
                _shorten_label(e["phase2"]),
                f"{int(e['confidence']*100)}%",
            )
        console.print(err_table)
    else:
        console.print("\n[green]No classification errors — all predictions match ground truth![/green]")


def _shorten_label(label: str) -> str:
    """Shorten long label strings for display."""
    mapping = {
        "strong_likely_hike_behavior": "STRONG",
        "moderate_likely_hike_behavior": "MOD",
        "uncertain_behavior": "UNC",
        "unlikely_hike_behavior": "UNLIKELY",
        "no_data": "NODATA",
        "strava_confirmed": "CONF",
        "strava_partial": "PART",
        "strava_not_found": "NONE",
        "not_available": "NA",
    }
    return mapping.get(label, label[:8])
