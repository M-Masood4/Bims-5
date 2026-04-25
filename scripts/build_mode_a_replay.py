#!/usr/bin/env python3
"""Generate deterministic Mode A replay grid and changelog data."""

from __future__ import annotations

import argparse
import csv
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Any


YEARS = list(range(2016, 2027))
BELFAST_BBOX = [-6.08, 54.52, -5.78, 54.70]
CENTER = (-5.9301, 54.5973)
RIVER_LAGAN = [
    (-5.902, 54.665),
    (-5.914, 54.635),
    (-5.924, 54.606),
    (-5.928, 54.590),
    (-5.915, 54.560),
]
DEVELOPMENT_ZONES = [
    {"name": "Titanic Quarter", "lon": -5.902, "lat": 54.608, "weight": 1.0},
    {"name": "City Centre", "lon": -5.929, "lat": 54.598, "weight": 0.95},
    {"name": "Cathedral Quarter", "lon": -5.927, "lat": 54.603, "weight": 0.8},
    {"name": "Sirocco / Waterfront", "lon": -5.915, "lat": 54.594, "weight": 0.86},
    {"name": "Queen's Quarter", "lon": -5.936, "lat": 54.584, "weight": 0.58},
]
BIKE_STATIONS = [
    (-5.930, 54.597),
    (-5.922, 54.602),
    (-5.938, 54.586),
    (-5.914, 54.607),
    (-5.957, 54.585),
    (-5.899, 54.596),
]
TRANSIT_NODES = [
    (-5.917, 54.596),
    (-5.929, 54.595),
    (-5.934, 54.601),
    (-5.908, 54.603),
    (-5.953, 54.591),
]
GREEN_ANCHORS = [
    (-5.956, 54.591),
    (-5.940, 54.582),
    (-5.894, 54.594),
    (-5.981, 54.605),
    (-5.915, 54.620),
]
HIGH_DEPRIVATION_ANCHORS = [
    (-5.955, 54.607),
    (-5.940, 54.618),
    (-5.975, 54.583),
    (-5.900, 54.620),
]


def clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


def distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1 = a
    lon2, lat2 = b
    x = (lon2 - lon1) * 111.32 * math.cos(math.radians((lat1 + lat2) / 2))
    y = (lat2 - lat1) * 110.54
    return math.hypot(x, y)


def nearest_score(point: tuple[float, float], anchors: list[tuple[float, float]], radius_km: float) -> float:
    distance = min(distance_km(point, anchor) for anchor in anchors)
    return clamp(1 - distance / radius_km)


def weighted_anchor_score(point: tuple[float, float], anchors: list[dict[str, float]], radius_km: float) -> float:
    score = 0.0
    for anchor in anchors:
      distance = distance_km(point, (anchor["lon"], anchor["lat"]))
      score = max(score, anchor["weight"] * clamp(1 - distance / radius_km))
    return clamp(score)


def grid_cells(cols: int = 18, rows: int = 12) -> list[dict[str, Any]]:
    west, south, east, north = BELFAST_BBOX
    dx = (east - west) / cols
    dy = (north - south) / rows
    cells = []
    for row in range(rows):
        for col in range(cols):
            x0 = west + col * dx
            x1 = x0 + dx
            y0 = south + row * dy
            y1 = y0 + dy
            lon = (x0 + x1) / 2
            lat = (y0 + y1) / 2
            cells.append(
                {
                    "id": f"belfast_{row:02d}_{col:02d}",
                    "row": row,
                    "col": col,
                    "center": (lon, lat),
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
                    },
                }
            )
    return cells


def load_population(root: Path) -> dict[int, int]:
    path = root / "Belfast-Population-Total-Population-By-Year-2026-04-25-14-06.csv"
    values: dict[int, int] = {}
    if not path.exists():
        return values
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.reader(handle)
        next(reader, None)
        for row in reader:
            if len(row) >= 2 and row[0].strip().isdigit():
                year = int(row[0])
                if 2016 <= year <= 2026:
                    values[year] = int(float(row[1]))
    return values


def load_air_quality(root: Path) -> dict[int, float]:
    path = root / "belfast_air_quality.csv"
    if not path.exists():
        return {}
    yearly: dict[int, list[float]] = {}
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for index, row in enumerate(reader):
            date = row.get("Date", "")
            if len(date) < 10:
                continue
            try:
                year = int(date[-4:])
            except ValueError:
                continue
            if year not in YEARS:
                continue
            vals = []
            for key in [
                "Belfast Centre/ Nitrogen dioxide",
                "Belfast Centre/ PM10 particulate matter (Hourly measured)",
                "Belfast Centre/ PM2.5 particulate matter (Hourly measured)",
            ]:
                try:
                    vals.append(float(row.get(key, "")))
                except ValueError:
                    pass
            if vals:
                yearly.setdefault(year, []).append(mean(vals))
            if index > 140_000:
                break
    if not yearly:
        return {}
    raw = {year: mean(vals) for year, vals in yearly.items()}
    min_v = min(raw.values())
    max_v = max(raw.values())
    normalized = {}
    for year in YEARS:
        fallback = raw.get(year)
        if fallback is None:
            known_years = sorted(raw)
            before = max([item for item in known_years if item <= year], default=known_years[0])
            after = min([item for item in known_years if item >= year], default=known_years[-1])
            if before == after:
                fallback = raw[before]
            else:
                t = (year - before) / (after - before)
                fallback = raw[before] * (1 - t) + raw[after] * t
        exposure = (fallback - min_v) / (max_v - min_v or 1)
        normalized[year] = clamp(1 - exposure)
    return normalized


def metric_values(cell: dict[str, Any], year: int, air_by_year: dict[int, float]) -> dict[str, float]:
    progress = (year - 2016) / 10
    point = cell["center"]
    centre = nearest_score(point, [CENTER], 5.6)
    river = nearest_score(point, RIVER_LAGAN, 2.2)
    development_anchor = weighted_anchor_score(point, DEVELOPMENT_ZONES, 4.8)
    bike_anchor = nearest_score(point, BIKE_STATIONS, 3.4)
    transit_anchor = nearest_score(point, TRANSIT_NODES, 3.7)
    green_anchor = nearest_score(point, GREEN_ANCHORS, 3.8)
    deprivation = nearest_score(point, HIGH_DEPRIVATION_ANCHORS, 4.6)

    wave = 0.04 * math.sin((cell["row"] * 1.7 + cell["col"] * 0.9 + year) * 0.7)
    development_pressure = clamp(0.14 + development_anchor * (0.42 + 0.35 * progress) + centre * 0.14 + wave)
    planning_intensity = clamp(0.08 + development_anchor * (0.34 + 0.42 * progress) + river * 0.12 + wave * 0.5)
    green_cover = clamp(0.34 + green_anchor * 0.45 + river * 0.12 - development_pressure * (0.16 + 0.08 * progress) + 0.03 * math.cos(year + cell["col"]))
    mobility_access = clamp(0.20 + transit_anchor * 0.34 + bike_anchor * (0.16 + 0.28 * progress) + centre * 0.14)
    bike_activity = clamp(0.05 + bike_anchor * (0.15 + 0.58 * min(progress, 0.6)) + centre * 0.12)
    air_quality = clamp((air_by_year.get(year, 0.58) * 0.58) + green_cover * 0.20 - development_pressure * 0.16 - centre * 0.05 + 0.24)
    opportunity_access = clamp(mobility_access * 0.42 + green_cover * 0.18 + centre * 0.20 + (1 - development_pressure) * 0.08 + 0.12)
    fairness_context = clamp(deprivation)
    deprivation_weighted_opportunity = clamp(opportunity_access * (0.74 + 0.26 * fairness_context))

    return {
        "development_pressure": round(development_pressure, 3),
        "planning_intensity": round(planning_intensity, 3),
        "green_cover": round(green_cover, 3),
        "mobility_access": round(mobility_access, 3),
        "bike_activity": round(bike_activity, 3),
        "air_quality": round(air_quality, 3),
        "opportunity_access": round(opportunity_access, 3),
        "fairness_context": round(fairness_context, 3),
        "deprivation_weighted_opportunity": round(deprivation_weighted_opportunity, 3),
    }


def direction(metric: str, delta: float) -> str:
    threshold = 0.045
    if abs(delta) < threshold:
        return "stable"
    if metric in {"air_quality", "green_cover", "opportunity_access", "mobility_access", "deprivation_weighted_opportunity", "bike_activity"}:
        return "improved" if delta > 0 else "worsened"
    if metric in {"development_pressure", "planning_intensity"}:
        return "increased" if delta > 0 else "decreased"
    return "changed"


def dominant_change(values: dict[str, float], baseline: dict[str, float]) -> str:
    deltas = {key: values[key] - baseline[key] for key in values}
    ordered = sorted(deltas.items(), key=lambda item: abs(item[1]), reverse=True)
    metric, delta = ordered[0]
    if metric == "development_pressure" and delta > 0.08:
        return "appeared"
    return direction(metric, delta)


def confidence(values: dict[str, float], year: int) -> str:
    evidence_sources = 2
    if year in {2016, 2018, 2020, 2021, 2026}:
        evidence_sources += 1
    if values["development_pressure"] > 0.55 or values["mobility_access"] > 0.55:
        evidence_sources += 1
    return "high" if evidence_sources >= 4 else "medium" if evidence_sources == 3 else "low"


def evidence_for(values: dict[str, float], year: int, change: str) -> list[str]:
    evidence = [
        "OpenStreetMap building export clipped to Belfast NI core",
        "250m-style grid proxy generated from local spatial anchors",
    ]
    if year in {2016, 2018, 2020}:
        evidence.append("Local raster source available for satellite/NDVI review")
    if year == 2021:
        evidence.append("NISRA census and NI Air hourly archive available")
    if year >= 2021:
        evidence.append("NI Air annual trend proxy included")
    if change in {"appeared", "increased"}:
        evidence.append("Development pressure proxy uses waterfront and city-centre intensity")
    if change in {"improved", "worsened"}:
        evidence.append("Opportunity and exposure scores are normalized directional indicators")
    return evidence


def feature_collection(cells: list[dict[str, Any]], values_by_cell: dict[str, dict[int, dict[str, float]]], year: int) -> dict[str, Any]:
    features = []
    for cell in cells:
        values = values_by_cell[cell["id"]][year]
        baseline = values_by_cell[cell["id"]][2016]
        previous = values_by_cell[cell["id"]][max(2016, year - 1)]
        deltas_2016 = {f"{key}_delta_2016": round(values[key] - baseline[key], 3) for key in values}
        deltas_prev = {f"{key}_delta_previous": round(values[key] - previous[key], 3) for key in values}
        change = dominant_change(values, baseline)
        features.append(
            {
                "type": "Feature",
                "id": f"{cell['id']}_{year}",
                "properties": {
                    "cell_id": cell["id"],
                    "year": year,
                    "row": cell["row"],
                    "col": cell["col"],
                    **values,
                    **deltas_2016,
                    **deltas_prev,
                    "dominant_change": change,
                    "confidence": confidence(values, year),
                    "evidence": evidence_for(values, year, change),
                },
                "geometry": cell["geometry"],
            }
        )
    return {
        "type": "FeatureCollection",
        "name": f"mode_a_grid_{year}",
        "metadata": {
            "year": year,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "bbox": BELFAST_BBOX,
            "cell_count": len(features),
            "resolution_note": "Regular demo grid approximating 250m-500m cells across Belfast NI.",
        },
        "features": features,
    }


def metric_card(metric: str, label: str, values: list[float], baseline_values: list[float], good_direction: str) -> dict[str, Any]:
    current = mean(values)
    baseline = mean(baseline_values)
    delta = current - baseline
    positive = delta >= 0 if good_direction == "up" else delta <= 0
    return {
        "metric": metric,
        "label": label,
        "value": round(current, 3),
        "display": f"{round(current * 100)}",
        "delta": round(delta, 3),
        "deltaDisplay": f"{'+' if delta >= 0 else ''}{round(delta * 100)}",
        "trend": "improved" if positive and abs(delta) >= 0.02 else "worsened" if not positive and abs(delta) >= 0.02 else "stable",
        "sparkline": [round(item, 3) for item in values[:12]],
    }


def commits_for_year(year: int, averages: dict[int, dict[str, float]]) -> list[dict[str, Any]]:
    current = averages[year]
    base = averages[2016]
    previous = averages[max(2016, year - 1)]
    dev_delta = current["development_pressure"] - base["development_pressure"]
    bike_delta = current["bike_activity"] - base["bike_activity"]
    green_delta = current["green_cover"] - base["green_cover"]
    air_delta = current["air_quality"] - base["air_quality"]
    opportunity_delta = current["deprivation_weighted_opportunity"] - base["deprivation_weighted_opportunity"]
    yearly_dev = current["development_pressure"] - previous["development_pressure"]
    return [
        {
            "id": f"{year}-development",
            "symbol": "+",
            "type": "development",
            "title": "Development pressure concentrated around waterfront and city-centre zones",
            "delta": round(dev_delta, 3),
            "confidence": "medium",
            "tone": "increase",
            "evidence": ["OSM building footprint context", "Planning pressure proxy", "Waterfront/city-centre spatial anchors"],
        },
        {
            "id": f"{year}-mobility",
            "symbol": "+" if bike_delta >= 0 else "~",
            "type": "mobility",
            "title": "Bike and active-travel access strengthens around central corridors",
            "delta": round(bike_delta, 3),
            "confidence": "medium",
            "tone": "improved" if bike_delta >= 0 else "changed",
            "evidence": ["Belfast Bikes historical source plan", "OSM cycleway/station context", "Transit node access proxy"],
        },
        {
            "id": f"{year}-green",
            "symbol": "+" if green_delta >= 0 else "-",
            "type": "green",
            "title": "Green-cover signal holds around parks but weakens near development pressure",
            "delta": round(green_delta, 3),
            "confidence": "medium" if year in {2016, 2018, 2020, 2026} else "low",
            "tone": "improved" if green_delta >= 0 else "worsened",
            "evidence": ["NDVI/NDBI raster source availability", "OSM parks and green-space context", "Development-pressure counter-signal"],
        },
        {
            "id": f"{year}-air",
            "symbol": "+" if air_delta >= 0 else "-",
            "type": "air",
            "title": "Air-quality exposure proxy improves, with road corridors still flagged",
            "delta": round(air_delta, 3),
            "confidence": "high" if year >= 2021 else "medium",
            "tone": "improved" if air_delta >= 0 else "worsened",
            "evidence": ["NI Air Belfast Centre hourly archive", "Road-pressure proxy", "Green-cover modifier"],
        },
        {
            "id": f"{year}-fairness",
            "symbol": "!" if opportunity_delta < 0.08 and year > 2016 else "~",
            "type": "fairness",
            "title": "Opportunity gains remain uneven after deprivation weighting",
            "delta": round(opportunity_delta, 3),
            "confidence": "medium",
            "tone": "risk" if opportunity_delta < 0.08 and year > 2016 else "changed",
            "evidence": ["NISRA census/deprivation source plan", "Transport and services access proxy", "Fairness-weighted opportunity score"],
        },
        {
            "id": f"{year}-yearly",
            "symbol": "~",
            "type": "diff",
            "title": "Year-on-year city diff updated from previous replay state",
            "delta": round(yearly_dev, 3),
            "confidence": "medium",
            "tone": "changed",
            "evidence": ["Deterministic yearly grid metrics", "2016 baseline comparison", "Previous-year delta"],
        },
    ]


def build(root: Path, output_dir: Path) -> dict[str, Any]:
    cells = grid_cells()
    air = load_air_quality(root)
    population = load_population(root)
    values_by_cell: dict[str, dict[int, dict[str, float]]] = {}
    for cell in cells:
        values_by_cell[cell["id"]] = {year: metric_values(cell, year, air) for year in YEARS}

    output_dir.mkdir(parents=True, exist_ok=True)
    for year in YEARS:
        collection = feature_collection(cells, values_by_cell, year)
        (output_dir / f"grid_{year}.geojson").write_text(json.dumps(collection, separators=(",", ":")), encoding="utf-8")

    averages: dict[int, dict[str, float]] = {}
    for year in YEARS:
        averages[year] = {}
        for metric in next(iter(values_by_cell.values()))[year]:
            averages[year][metric] = mean(cell_years[year][metric] for cell_years in values_by_cell.values())

    metrics_by_year = {}
    for year in YEARS:
        year_features = [values_by_cell[cell["id"]][year] for cell in cells]
        base_features = [values_by_cell[cell["id"]][2016] for cell in cells]
        metric_values_for = lambda metric, source: [item[metric] for item in source]
        metrics_by_year[str(year)] = [
            metric_card("development_pressure", "Development pressure", metric_values_for("development_pressure", year_features), metric_values_for("development_pressure", base_features), "down"),
            metric_card("mobility_access", "Mobility access", metric_values_for("mobility_access", year_features), metric_values_for("mobility_access", base_features), "up"),
            metric_card("air_quality", "Air quality", metric_values_for("air_quality", year_features), metric_values_for("air_quality", base_features), "up"),
            metric_card("green_cover", "Green cover", metric_values_for("green_cover", year_features), metric_values_for("green_cover", base_features), "up"),
            metric_card("deprivation_weighted_opportunity", "Opportunity fairness", metric_values_for("deprivation_weighted_opportunity", year_features), metric_values_for("deprivation_weighted_opportunity", base_features), "up"),
        ]

    summary = {
        "schemaVersion": "1.0.0",
        "kind": "belfast.modeA.summary",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "years": YEARS,
        "bbox": BELFAST_BBOX,
        "cellCount": len(cells),
        "gridTemplate": "/data/mode-a/grid_{year}.geojson",
        "metricsByYear": metrics_by_year,
        "commitsByYear": {str(year): commits_for_year(year, averages) for year in YEARS},
        "populationByYear": population,
        "airQualityByYear": {str(key): round(value, 3) for key, value in air.items()},
        "layers": [
            {"id": "development_pressure", "label": "Development", "color": "#f97316"},
            {"id": "mobility_access", "label": "Mobility", "color": "#2563eb"},
            {"id": "green_cover", "label": "Green cover", "color": "#16a34a"},
            {"id": "air_quality", "label": "Air quality", "color": "#7c3aed"},
            {"id": "deprivation_weighted_opportunity", "label": "Opportunity", "color": "#0f766e"},
            {"id": "fairness_context", "label": "Fairness", "color": "#e11d48"},
        ],
        "sources": [
            {"name": "OpenStreetMap building export", "status": "local", "confidence": "medium", "note": "3D city skeleton and development proxy"},
            {"name": "NI Air Belfast Centre archive", "status": "local", "confidence": "high for 2021 input", "note": "Air-quality exposure trend proxy"},
            {"name": "NISRA census/population files", "status": "local", "confidence": "high for official totals", "note": "Population/fairness context"},
            {"name": "Sentinel/Landsat rasters", "status": "local sources", "confidence": "medium pending tile ETL", "note": "Green/built-up evidence anchors"},
            {"name": "Belfast Bikes/Translink/planning", "status": "planned source inventory", "confidence": "proxy", "note": "Mode A contract ready for full ingestion"},
        ],
    }
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--output", type=Path, default=Path("web/data/mode-a"))
    args = parser.parse_args()
    root = args.root.resolve()
    output = args.output if args.output.is_absolute() else root / args.output
    summary = build(root, output)
    print(f"Wrote Mode A replay to {output} for {len(summary['years'])} years and {summary['cellCount']} cells.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
