#!/usr/bin/env python3
"""Train the deterministic BIMS 5 forecast artifacts from local Mode A data."""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Any


BASELINE_YEAR = 2025
START_YEAR = 2026
HORIZON_YEAR = 2036
OBSERVED_YEARS = list(range(2016, BASELINE_YEAR + 1))
FORECAST_YEARS = list(range(START_YEAR, HORIZON_YEAR + 1))
MODEL_VERSION = "bims5-forecast-v1-2025-baseline"

METRICS = [
    "traffic",
    "population",
    "jobs",
    "economy",
    "housingPressure",
    "services",
    "electricity",
    "environmentAir",
    "greenScore",
    "fairness",
    "fiscalBalance",
    "planningViability",
]


def clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


def rounded_metrics(values: dict[str, float]) -> dict[str, float]:
    return {metric: round(clamp(float(values.get(metric, 0.0))), 3) for metric in METRICS}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_mode_a_grid(root: Path, year: int) -> dict[str, dict[str, Any]]:
    path = root / "web" / "data" / "mode-a" / f"grid_{year}.geojson"
    payload = read_json(path)
    return {feature["properties"]["cell_id"]: feature for feature in payload.get("features", [])}


def load_population_index(summary: dict[str, Any]) -> dict[int, float]:
    raw = {int(year): int(value) for year, value in (summary.get("populationByYear") or {}).items()}
    if not raw:
        return {year: (year - 2016) / (BASELINE_YEAR - 2016) for year in OBSERVED_YEARS}
    base = raw.get(2016) or min(raw.values())
    high = max(raw.values()) or base
    return {year: clamp((raw.get(year, base) - base) / max(1, high - base)) for year in OBSERVED_YEARS}


def load_event_density(root: Path, cells: dict[str, dict[str, Any]]) -> dict[str, dict[str, float]]:
    path = root / "data" / "derived" / "2026" / "belfast_infrastructure_events_2016_2026.json"
    density = {cell_id: defaultdict(float) for cell_id in cells}
    if not path.exists():
        return {cell_id: dict(values) for cell_id, values in density.items()}
    try:
        events = read_json(path).get("events", [])
    except (json.JSONDecodeError, OSError):
        events = []
    centroids = {cell_id: centroid(feature.get("geometry")) for cell_id, feature in cells.items()}
    for event in events:
        year = int(event.get("year") or 0)
        if year < 2016 or year > BASELINE_YEAR:
            continue
        coords = event.get("coordinates")
        if not isinstance(coords, list) or len(coords) < 2:
            continue
        point = (float(coords[0]), float(coords[1]))
        nearest = min(centroids.items(), key=lambda item: distance_km(point, item[1]))[0]
        signal = str(event.get("signal") or "other")
        density[nearest][signal] += 1.0
        density[nearest]["all"] += 1.0
    max_by_signal: dict[str, float] = defaultdict(float)
    for values in density.values():
        for signal, count in values.items():
            max_by_signal[signal] = max(max_by_signal[signal], count)
    out: dict[str, dict[str, float]] = {}
    for cell_id, values in density.items():
        out[cell_id] = {signal: round(count / (max_by_signal[signal] or 1), 3) for signal, count in values.items()}
    return out


def load_planning_counts(root: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    for path in sorted((root / "data" / "raw" / "planning_statistics").glob("planning-statistics-*.csv")):
        match = re.search(r"(20\d{2})-(\d{2})", path.name)
        if not match:
            continue
        key = f"{match.group(1)}-{match.group(2)}"
        for encoding in ("utf-8-sig", "cp1252"):
            try:
                with path.open(newline="", encoding=encoding) as handle:
                    counts[key] = sum(1 for _row in csv.reader(handle)) - 1
                break
            except (OSError, UnicodeDecodeError):
                continue
    return counts


def centroid(geometry: dict[str, Any] | None) -> tuple[float, float]:
    coords: list[tuple[float, float]] = []

    def walk(node: Any) -> None:
        if isinstance(node, list):
            if len(node) >= 2 and isinstance(node[0], (int, float)) and isinstance(node[1], (int, float)):
                coords.append((float(node[0]), float(node[1])))
            else:
                for item in node:
                    walk(item)

    walk((geometry or {}).get("coordinates"))
    if not coords:
        return (-5.9301, 54.5973)
    return (sum(lon for lon, _lat in coords) / len(coords), sum(lat for _lon, lat in coords) / len(coords))


def bbox(geometry: dict[str, Any] | None) -> list[float]:
    coords: list[tuple[float, float]] = []

    def walk(node: Any) -> None:
        if isinstance(node, list):
            if len(node) >= 2 and isinstance(node[0], (int, float)) and isinstance(node[1], (int, float)):
                coords.append((float(node[0]), float(node[1])))
            else:
                for item in node:
                    walk(item)

    walk((geometry or {}).get("coordinates"))
    if not coords:
        return [-5.9301, 54.5973, -5.9301, 54.5973]
    return [min(lon for lon, _lat in coords), min(lat for _lon, lat in coords), max(lon for lon, _lat in coords), max(lat for _lon, lat in coords)]


def distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1 = a
    lon2, lat2 = b
    x = (lon2 - lon1) * 111.32 * math.cos(math.radians((lat1 + lat2) / 2))
    y = (lat2 - lat1) * 110.54
    return math.hypot(x, y)


def source_metrics(props: dict[str, Any], population_index: float) -> dict[str, float]:
    traffic = float(props.get("traffic", 0.0))
    jobs = float(props.get("jobs", 0.0))
    electricity = float(props.get("electricity", 0.0))
    buildings = float(props.get("buildings", 0.0))
    services = float(props.get("services", 0.0))
    development = float(props.get("development_pressure", 0.0))
    green = float(props.get("green_cover", props.get("tree_canopy_context", 0.35)))
    transit = float(props.get("transit_access", 0.18))
    planning = float(props.get("planning_intensity", 0.08))
    deprivation = float(props.get("deprivation_weight", 0.0))
    road = float(props.get("traffic_pressure", traffic))
    environment = clamp(traffic * 0.42 + electricity * 0.24 + road * 0.12 + (1 - green) * 0.22)
    population = clamp(buildings * 0.48 + development * 0.30 + services * 0.07 + population_index * 0.15)
    economy = clamp(jobs * 0.58 + services * 0.17 + planning * 0.15 + transit * 0.10)
    housing = clamp(population * 0.42 + development * 0.28 + (1 - services) * 0.16 + buildings * 0.14)
    fairness = clamp(services * 0.25 + transit * 0.20 + jobs * 0.18 + (1 - environment) * 0.17 + deprivation * 0.20)
    fiscal = clamp(economy * 0.42 + jobs * 0.23 + planning * 0.16 + services * 0.11 - traffic * 0.05 - electricity * 0.04 + 0.08)
    viability = clamp(planning * 0.32 + transit * 0.18 + services * 0.15 + green * 0.13 + (1 - environment) * 0.15 + jobs * 0.07)
    return rounded_metrics(
        {
            "traffic": traffic,
            "population": population,
            "jobs": jobs,
            "economy": economy,
            "housingPressure": housing,
            "services": services,
            "electricity": electricity,
            "environmentAir": environment,
            "greenScore": green,
            "fairness": fairness,
            "fiscalBalance": fiscal,
            "planningViability": viability,
        }
    )


def slope(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    return (values[-1] - values[0]) / max(1, len(values) - 1)


def forecast_cell(
    cell_id: str,
    observed: dict[int, dict[str, float]],
    event_density: dict[str, float],
) -> tuple[dict[str, Any], dict[str, dict[str, float]]]:
    baseline = observed[BASELINE_YEAR]
    early = observed[2016]
    recent_years = [2021, 2022, 2023, 2024, 2025]
    forecast: dict[str, dict[str, float]] = {}
    trends: dict[str, float] = {}
    for metric in METRICS:
        recent = [observed[year][metric] for year in recent_years]
        long = [observed[year][metric] for year in OBSERVED_YEARS]
        event_boost = event_density.get("all", 0.0) * 0.0025
        metric_boost = event_density.get(metric, event_density.get(metric.lower(), 0.0)) * 0.003
        raw_slope = slope(recent) * 0.58 + slope(long) * 0.28 + event_boost + metric_boost
        if metric == "greenScore":
            raw_slope -= event_density.get("buildings", 0.0) * 0.002
        if metric in {"traffic", "electricity", "housingPressure", "environmentAir"}:
            raw_slope += max(0.0, early.get("population", 0.0) - baseline.get("population", 0.0)) * -0.002
        trends[metric] = round(raw_slope, 5)
    for year in FORECAST_YEARS:
        years_ahead = year - BASELINE_YEAR
        eased = 1 - math.exp(-years_ahead / 7.0)
        values = {}
        for metric in METRICS:
            value = baseline[metric] + trends[metric] * years_ahead * (0.82 + eased * 0.18)
            if metric == "planningViability":
                value += event_density.get("buildings", 0.0) * 0.006 * eased
            if metric == "fiscalBalance":
                value += event_density.get("jobs", 0.0) * 0.005 * eased
            values[metric] = value
        forecast[str(year)] = rounded_metrics(values)
    confidence = "medium-high" if event_density.get("all", 0.0) >= 0.15 else "medium"
    model = {
        "cellId": cell_id,
        "trend": trends,
        "baseline2025": baseline,
        "confidence": confidence,
        "evidence": [
            "Mode A 2016-2025 grid snapshots",
            "Infrastructure event density near the cell",
            "Population, air-quality, planning, transport, services and electricity proxy layers",
        ],
    }
    return model, forecast


def build(root: Path, output_dir: Path, docs_dir: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    summary = read_json(root / "web" / "data" / "mode-a" / "summary.json")
    population_index = load_population_index(summary)
    grids = {year: load_mode_a_grid(root, year) for year in OBSERVED_YEARS}
    baseline_grid = grids[BASELINE_YEAR]
    event_density = load_event_density(root, baseline_grid)
    planning_counts = load_planning_counts(root)
    cell_models = []
    baseline_cells = []
    forecast_by_year_summary: dict[str, dict[str, float]] = {}
    cell_forecasts: dict[str, dict[str, dict[str, float]]] = {}

    for cell_id, feature in baseline_grid.items():
        observed = {
            year: source_metrics(grids[year][cell_id]["properties"], population_index.get(year, 0.0))
            for year in OBSERVED_YEARS
        }
        model, forecast = forecast_cell(cell_id, observed, event_density.get(cell_id, {}))
        cell_models.append(model)
        cell_forecasts[cell_id] = forecast
        props = feature.get("properties", {})
        baseline_cells.append(
            {
                "cellId": cell_id,
                "row": props.get("row"),
                "col": props.get("col"),
                "centroid": [round(value, 6) for value in centroid(feature.get("geometry"))],
                "bbox": [round(value, 6) for value in bbox(feature.get("geometry"))],
                "baseline2025": observed[BASELINE_YEAR],
                "forecastByYear": forecast,
                "confidence": model["confidence"],
                "evidence": model["evidence"],
                "geometry": feature.get("geometry"),
            }
        )

    for year in FORECAST_YEARS:
        rows = [cell_forecasts[cell_id][str(year)] for cell_id in cell_forecasts]
        forecast_by_year_summary[str(year)] = {
            metric: round(mean(row[metric] for row in rows), 3)
            for metric in METRICS
        }

    model_payload = {
        "schemaVersion": "1.0.0",
        "kind": "belfast.forecastModel",
        "modelVersion": MODEL_VERSION,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "baselineYear": BASELINE_YEAR,
        "startYear": START_YEAR,
        "horizonYear": HORIZON_YEAR,
        "metrics": METRICS,
        "cellCount": len(baseline_cells),
        "cityPopulationCap": 390000,
        "inputArtifacts": {
            "modeAGrids": "web/data/mode-a/grid_{2016..2025}.geojson",
            "modeASummary": "web/data/mode-a/summary.json",
            "infrastructureEvents": "data/derived/2026/belfast_infrastructure_events_2016_2026.json",
            "planningStatistics": "data/raw/planning_statistics/*.csv",
            "electricityProxy": "web/data/mode-a/electricity_{2016..2025}.geojson",
        },
        "planningRecordCounts": planning_counts,
        "method": {
            "family": "deterministic trend plus planner-response model",
            "notes": [
                "Per-cell forecasts are projected from 2016-2025 Mode A grid values using recent and long-run slopes.",
                "Infrastructure event density influences confidence and small continuation pressure terms.",
                "Scenario impacts are not stored in this model; they are produced at runtime by deterministic planners.",
                "All forecast metrics are normalized to 0-1 proxy planning indices.",
            ],
        },
        "cellModels": cell_models,
    }
    baseline_payload = {
        "schemaVersion": "1.0.0",
        "kind": "belfast.baseline2025Forecast",
        "modelVersion": MODEL_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "baselineYear": BASELINE_YEAR,
        "startYear": START_YEAR,
        "horizonYear": HORIZON_YEAR,
        "years": FORECAST_YEARS,
        "metrics": METRICS,
        "summaryByYear": forecast_by_year_summary,
        "cells": baseline_cells,
        "evidence": [
            "2016-2025 Mode A replay grid snapshots",
            "Infrastructure event density catalog",
            "Population totals, census context, air quality summaries, planning records, transport/services proximity and electricity proxy layers",
        ],
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    docs_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "forecast_model.json").write_text(json.dumps(model_payload, separators=(",", ":")), encoding="utf-8")
    (output_dir / "baseline_2025_forecast.json").write_text(json.dumps(baseline_payload, separators=(",", ":")), encoding="utf-8")
    write_model_card(docs_dir / "forecast_model_card.md", model_payload, baseline_payload)
    return model_payload, baseline_payload


def write_model_card(path: Path, model: dict[str, Any], baseline: dict[str, Any]) -> None:
    summary_2036 = baseline["summaryByYear"][str(HORIZON_YEAR)]
    lines = [
        "# BIMS 5 Forecast Model Card",
        "",
        f"- Model version: `{model['modelVersion']}`",
        f"- Baseline year: {BASELINE_YEAR}",
        f"- Forecast horizon: {START_YEAR}-{HORIZON_YEAR}",
        f"- Geography: Belfast, Northern Ireland replay grid ({model['cellCount']} cells)",
        "- Intended use: proxy planning comparison for building scenarios, branch tradeoffs, and evidence review.",
        "- Not intended for: engineering-grade traffic assignment, grid-capacity approval, statutory fiscal appraisal, or site design certification.",
        "",
        "## Inputs",
        "",
        "- Mode A grid snapshots for 2016-2025",
        "- Infrastructure event density from the local Belfast event catalog",
        "- Population totals and census context",
        "- Air-quality summaries",
        "- Planning/development signals",
        "- Transport and services proximity layers",
        "- Electricity proxy layers",
        "",
        "## Output Metrics",
        "",
        ", ".join(f"`{metric}`" for metric in model["metrics"]),
        "",
        "Every metric is normalized to a 0-1 proxy index. Scenario deltas are computed at runtime by deterministic planners and then clamped to the same bounds.",
        "",
        "## 2036 No-Build Summary",
        "",
    ]
    lines.extend([f"- `{metric}`: {summary_2036[metric]:.3f}" for metric in model["metrics"]])
    lines.extend(
        [
            "",
            "## Governance",
            "",
            "Gemini agents may propose branches, explain tradeoffs, and flag unsupported claims. They do not calculate or override numeric impacts. Numeric values come from this artifact and deterministic planners in `lib/scenario-studio.js`.",
            "",
            "## Limitations",
            "",
            "- Event timestamps can represent mapped visibility or public records, not always physical completion dates.",
            "- Cell-level values are planning proxies derived from available open data and local artifacts.",
            "- Flood, electricity, fiscal, and traffic values are screening signals that should trigger expert review rather than replace it.",
        ]
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--output", type=Path, default=Path("web/data/mode-a"))
    parser.add_argument("--docs", type=Path, default=Path("docs"))
    args = parser.parse_args()
    root = args.root.resolve()
    output_dir = args.output if args.output.is_absolute() else root / args.output
    docs_dir = args.docs if args.docs.is_absolute() else root / args.docs
    model, baseline = build(root, output_dir, docs_dir)
    print(
        f"Trained {model['modelVersion']} with {model['cellCount']} cells; "
        f"wrote {output_dir / 'forecast_model.json'} and {output_dir / 'baseline_2025_forecast.json'}."
    )
    print(f"Forecast years: {baseline['years'][0]}-{baseline['years'][-1]}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
