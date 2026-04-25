#!/usr/bin/env python3
"""Generate deterministic Mode A replay grid, hotspots, and changelog data."""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Any


YEARS = list(range(2016, 2027))
BELFAST_BBOX = [-6.08, 54.52, -5.78, 54.70]
CENTER = (-5.9301, 54.5973)
RIVER_LAGAN = [(-5.902, 54.665), (-5.914, 54.635), (-5.924, 54.606), (-5.928, 54.590), (-5.915, 54.560)]

DEVELOPMENT_ZONES = [
    {"name": "Titanic Quarter", "lon": -5.902, "lat": 54.608, "weight": 1.0},
    {"name": "City Centre", "lon": -5.929, "lat": 54.598, "weight": 0.95},
    {"name": "Cathedral Quarter", "lon": -5.927, "lat": 54.603, "weight": 0.82},
    {"name": "Sirocco / Waterfront", "lon": -5.915, "lat": 54.594, "weight": 0.86},
    {"name": "Queen's Quarter", "lon": -5.936, "lat": 54.584, "weight": 0.58},
]
BIKE_STATIONS = [(-5.930, 54.597), (-5.922, 54.602), (-5.938, 54.586), (-5.914, 54.607), (-5.957, 54.585), (-5.899, 54.596)]
TRANSIT_NODES = [(-5.917, 54.596), (-5.929, 54.595), (-5.934, 54.601), (-5.908, 54.603), (-5.953, 54.591)]
GREEN_ANCHORS = [(-5.956, 54.591), (-5.940, 54.582), (-5.894, 54.594), (-5.981, 54.605), (-5.915, 54.620)]
HIGH_DEPRIVATION_ANCHORS = [(-5.955, 54.607), (-5.940, 54.618), (-5.975, 54.583), (-5.900, 54.620)]
JOB_EDUCATION_ANCHORS = [(-5.929, 54.598), (-5.936, 54.584), (-5.917, 54.596), (-5.902, 54.608), (-5.925, 54.602)]
FLOOD_RISK_ANCHORS = RIVER_LAGAN
AREA_ANCHORS = [
    {"name": "York Street / New Lodge", "lon": -5.928, "lat": 54.611},
    {"name": "Titanic Quarter", "lon": -5.902, "lat": 54.608},
    {"name": "Cathedral Quarter", "lon": -5.927, "lat": 54.603},
    {"name": "City Centre", "lon": -5.929, "lat": 54.598},
    {"name": "Sirocco / Waterfront", "lon": -5.915, "lat": 54.594},
    {"name": "Queen's Quarter", "lon": -5.936, "lat": 54.584},
    {"name": "Ormeau / Lagan Corridor", "lon": -5.916, "lat": 54.576},
    {"name": "East Belfast", "lon": -5.870, "lat": 54.596},
    {"name": "West Belfast", "lon": -5.975, "lat": 54.595},
    {"name": "Harbour Estate", "lon": -5.895, "lat": 54.625},
]

CORE_METRICS = [
    {
        "id": "traffic",
        "label": "Traffic",
        "why": "Shows where corridor strain, road pressure and access disruption accumulate over time.",
        "map": "Traffic heatmap, road additions, disrupted corridors and strain hotspots.",
        "goodDirection": "down",
        "color": "#f97316",
    },
    {
        "id": "jobs",
        "label": "Jobs",
        "why": "Shows whether employment, education and commercial access are strengthening or fragmenting.",
        "map": "Job-access zones, commercial growth corridors, education anchors and reachable opportunities.",
        "goodDirection": "up",
        "color": "#7c3aed",
    },
    {
        "id": "electricity",
        "label": "Electricity",
        "why": "Shows where growth may tighten grid headroom around substations, cables and load corridors.",
        "map": "Power-grid lines, substation load proxy, headroom status and reinforcement pressure.",
        "goodDirection": "down",
        "color": "#0f766e",
    },
    {
        "id": "buildings",
        "label": "Buildings",
        "why": "Shows mapped footprint additions, development pressure and architectural-period shifts.",
        "map": "3D building additions, mapped footprint change, development zones and built-up intensity.",
        "goodDirection": "up",
        "color": "#2563eb",
    },
    {
        "id": "services",
        "label": "Services",
        "why": "Shows how access to civic, health, education, recreation and commercial services changed.",
        "map": "Service-access heatmap, civic anchors, health/education points and underserved gaps.",
        "goodDirection": "up",
        "color": "#16a34a",
    },
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
    return clamp(1 - min(distance_km(point, anchor) for anchor in anchors) / radius_km)


def weighted_anchor_score(point: tuple[float, float], anchors: list[dict[str, float]], radius_km: float) -> float:
    score = 0.0
    for anchor in anchors:
        score = max(score, float(anchor["weight"]) * clamp(1 - distance_km(point, (anchor["lon"], anchor["lat"])) / radius_km))
    return clamp(score)


def grid_cells(cols: int = 22, rows: int = 14) -> list[dict[str, Any]]:
    west, south, east, north = BELFAST_BBOX
    dx = (east - west) / cols
    dy = (north - south) / rows
    cells = []
    for row in range(rows):
        for col in range(cols):
            x0 = round(west + col * dx, 6)
            x1 = round(x0 + dx, 6)
            y0 = round(south + row * dy, 6)
            y1 = round(y0 + dy, 6)
            cells.append(
                {
                    "id": f"belfast_{row:02d}_{col:02d}",
                    "row": row,
                    "col": col,
                    "center": ((x0 + x1) / 2, (y0 + y1) / 2),
                    "geometry": {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]},
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


def load_census_total(root: Path) -> int | None:
    path = root / "data/2021/belfast_census_2021_dataset.csv"
    if not path.exists():
        return None
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            if row.get("Variable") == "Total Population":
                return int(float(row["Value"]))
    return None


def load_air_quality(root: Path) -> dict[int, float]:
    path = root / "belfast_air_quality.csv"
    if not path.exists():
        return {}
    yearly: dict[int, list[float]] = {}
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            date = row.get("Date", "")
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
    if not yearly:
        return {}
    raw = {year: mean(vals) for year, vals in yearly.items()}
    min_v = min(raw.values())
    max_v = max(raw.values())
    normalized = {}
    for year in YEARS:
        if year in raw:
            value = raw[year]
        else:
            known = sorted(raw)
            before = max([item for item in known if item <= year], default=known[0])
            after = min([item for item in known if item >= year], default=known[-1])
            value = raw[before] if before == after else raw[before] + (raw[after] - raw[before]) * ((year - before) / (after - before))
        normalized[year] = clamp((value - min_v) / (max_v - min_v or 1))
    return normalized


def raster_years(root: Path) -> dict[int, set[str]]:
    found: dict[int, set[str]] = {}
    for path in list((root / "data/2016").glob("*.tif")) + list((root / "data/2026").glob("*.tif")):
        match = re.search(r"(20\d{2})", path.name)
        if match:
            year = int(match.group(1))
            kind = "ndvi" if "ndvi" in path.name.lower() else "ndbi" if "ndbi" in path.name.lower() else "rgb"
            found.setdefault(year, set()).add(kind)
    return found


def parse_float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(str(value).strip().replace('"', ""))
    except ValueError:
        return None


def load_points_csv(root: Path, relative_path: str, lon_keys: list[str], lat_keys: list[str]) -> list[tuple[float, float]]:
    path = root / relative_path
    if not path.exists():
        return []
    points: list[tuple[float, float]] = []
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            lon = next((parse_float(row.get(key)) for key in lon_keys if parse_float(row.get(key)) is not None), None)
            lat = next((parse_float(row.get(key)) for key in lat_keys if parse_float(row.get(key)) is not None), None)
            if lon is not None and lat is not None and BELFAST_BBOX[0] <= lon <= BELFAST_BBOX[2] and BELFAST_BBOX[1] <= lat <= BELFAST_BBOX[3]:
                points.append((lon, lat))
    return points


def point_density_score(point: tuple[float, float], points: list[tuple[float, float]], radius_km: float, count_for_full_score: int) -> float:
    if not points:
        return 0.0
    count = sum(1 for candidate in points if distance_km(point, candidate) <= radius_km)
    return clamp(count / count_for_full_score)


def interpolate_yearly(raw: dict[int, float], fallback: float = 0.0) -> dict[int, float]:
    if not raw:
        return {year: fallback for year in YEARS}
    known = sorted(raw)
    values = {}
    for year in YEARS:
        if year in raw:
            values[year] = raw[year]
            continue
        before = max([item for item in known if item <= year], default=known[0])
        after = min([item for item in known if item >= year], default=known[-1])
        if before == after:
            if year < known[0]:
                values[year] = raw[before] * 0.62
            else:
                values[year] = raw[before]
        else:
            values[year] = raw[before] + (raw[after] - raw[before]) * ((year - before) / (after - before))
    return values


def load_bike_trip_index(root: Path) -> tuple[dict[int, float], dict[int, int]]:
    totals: dict[int, int] = {}
    for path in sorted((root / "data/2016").glob("BelfastBikes_*.json")):
        if path.stat().st_size < 10:
            continue
        match = re.search(r"(20\d{2})", path.name)
        if not match:
            continue
        year = int(match.group(1))
        try:
            trips = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if not isinstance(trips, list):
            continue
        valid = sum(1 for item in trips if str(item.get("invalid", "0")) != "1")
        totals[year] = totals.get(year, 0) + valid
    if not totals:
        return ({year: 0.0 for year in YEARS}, {})
    max_total = max(totals.values()) or 1
    normalized = {year: clamp(total / max_total) for year, total in totals.items()}
    return interpolate_yearly(normalized, fallback=0.25), totals


def build_static_context(root: Path, cells: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    tree_points = load_points_csv(root, "data/2016/Trees-Open-Data.csv", ["Longitude"], ["Latitude"])
    bike_station_points = load_points_csv(root, "data/2016/belfast-bike-stations-updated-25-june-2021.csv", ["Longitude"], ["Latitude"])
    pitch_points = load_points_csv(root, "data/2016/pitchesplayingfieldsdata.csv", ["LONGITUDE"], ["LATITUDE"])
    toilet_points = load_points_csv(root, "data/2016/toiletsdata.csv", ["LONGITUDE"], ["LATITUDE"])
    civic_points = pitch_points + toilet_points
    context: dict[str, dict[str, float]] = {}
    for cell in cells:
        point = cell["center"]
        context[cell["id"]] = {
            "tree_density": point_density_score(point, tree_points, radius_km=0.7, count_for_full_score=85),
            "bike_station_context": point_density_score(point, bike_station_points, radius_km=1.2, count_for_full_score=5),
            "civic_service_context": point_density_score(point, civic_points, radius_km=1.4, count_for_full_score=5),
            "recreation_context": point_density_score(point, pitch_points, radius_km=1.7, count_for_full_score=5),
        }
    return context


def support_values(
    cell: dict[str, Any],
    year: int,
    air_by_year: dict[int, float],
    population_by_year: dict[int, int],
    static_context: dict[str, dict[str, float]],
    bike_trip_index: dict[int, float],
) -> dict[str, float]:
    progress = (year - 2016) / 10
    point = cell["center"]
    context = static_context.get(cell["id"], {})
    centre = nearest_score(point, [CENTER], 5.7)
    river = nearest_score(point, RIVER_LAGAN, 2.1)
    development = weighted_anchor_score(point, DEVELOPMENT_ZONES, 4.5)
    bikes = max(nearest_score(point, BIKE_STATIONS, 3.2), context.get("bike_station_context", 0.0))
    transit = nearest_score(point, TRANSIT_NODES, 3.8)
    green = max(nearest_score(point, GREEN_ANCHORS, 3.5), context.get("tree_density", 0.0) * 0.72 + context.get("recreation_context", 0.0) * 0.28)
    deprivation = nearest_score(point, HIGH_DEPRIVATION_ANCHORS, 4.5)
    jobs = nearest_score(point, JOB_EDUCATION_ANCHORS, 4.0)
    flood = nearest_score(point, FLOOD_RISK_ANCHORS, 1.7)
    bike_year_signal = bike_trip_index.get(year, progress)
    wave = 0.035 * math.sin((cell["row"] * 1.4 + cell["col"] * 0.7 + year * 0.4))
    pop_growth = 0.0
    if population_by_year:
        base = population_by_year.get(2016) or min(population_by_year.values())
        current = population_by_year.get(year, base)
        pop_growth = clamp((current - base) / max(base, 1) * 5.0, -0.2, 0.35)

    development_pressure = clamp(0.12 + development * (0.38 + 0.36 * progress) + centre * 0.13 + pop_growth + wave)
    planning_intensity = clamp(0.08 + development * (0.28 + 0.48 * progress) + river * 0.14 + wave * 0.5)
    green_cover = clamp(0.36 + green * 0.42 + river * 0.11 - development_pressure * (0.17 + 0.08 * progress) + 0.03 * math.cos(year + cell["col"]))
    transit_access = clamp(0.18 + transit * 0.48 + centre * 0.18)
    bike_access = clamp(0.05 + bikes * (0.16 + 0.58 * bike_year_signal) + centre * 0.08)
    road_pressure = clamp(0.14 + centre * 0.38 + development * 0.32 + (1 - green_cover) * 0.12)
    pollutant_exposure = clamp(air_by_year.get(year, 0.45) * 0.55 + road_pressure * 0.35 - green_cover * 0.12 + flood * 0.08)
    service_access = clamp(jobs * 0.38 + transit_access * 0.30 + centre * 0.10 + bike_access * 0.12 + context.get("civic_service_context", 0.0) * 0.10)
    traffic_pressure = clamp(road_pressure * 0.74 + development_pressure * 0.16 - bike_access * 0.10 - transit_access * 0.06 + centre * 0.08)

    return {
        "development_pressure": development_pressure,
        "planning_intensity": planning_intensity,
        "green_cover": green_cover,
        "transit_access": transit_access,
        "bike_access": bike_access,
        "road_pressure": road_pressure,
        "pollutant_exposure": pollutant_exposure,
        "service_access": service_access,
        "traffic_pressure": traffic_pressure,
        "deprivation_weight": deprivation,
        "flood_risk": flood,
        "jobs_access": jobs,
        "centre_access": centre,
        "bike_trip_index": bike_year_signal,
        "tree_canopy_context": context.get("tree_density", 0.0),
        "civic_service_context": context.get("civic_service_context", 0.0),
    }


def core_metrics(support: dict[str, float], year: int, population_by_year: dict[int, int]) -> dict[str, float]:
    progress = (year - 2016) / 10
    traffic = clamp(
        support["traffic_pressure"] * 0.58
        + support["road_pressure"] * 0.18
        + support["development_pressure"] * 0.14
        + (1 - support["transit_access"]) * 0.06
        - support["bike_access"] * 0.07
        + progress * 0.04
    )
    jobs = clamp(
        support["jobs_access"] * 0.34
        + support["service_access"] * 0.26
        + support["transit_access"] * 0.15
        + support["centre_access"] * 0.13
        + support["civic_service_context"] * 0.05
        + progress * (0.05 + support["centre_access"] * 0.03)
    )
    electricity = clamp(
        0.16
        + support["development_pressure"] * 0.28
        + support["service_access"] * 0.14
        + support["traffic_pressure"] * 0.13
        + support["centre_access"] * 0.12
        + support["jobs_access"] * 0.10
        + progress * 0.12
    )
    buildings = clamp(
        0.10
        + support["development_pressure"] * 0.43
        + support["planning_intensity"] * 0.28
        + support["centre_access"] * 0.09
        + (1 - support["green_cover"]) * 0.07
        + progress * 0.14
    )
    services = clamp(
        support["service_access"] * 0.50
        + support["civic_service_context"] * 0.18
        + support["transit_access"] * 0.14
        + support["jobs_access"] * 0.08
        + support["bike_access"] * 0.06
        + progress * 0.04
    )
    return {
        "traffic": round(traffic, 3),
        "jobs": round(jobs, 3),
        "electricity": round(electricity, 3),
        "buildings": round(buildings, 3),
        "services": round(services, 3),
        "development_pressure": round(support["development_pressure"], 3),
        "green_cover": round(support["green_cover"], 3),
        "bike_access": round(support["bike_access"], 3),
        "transit_access": round(support["transit_access"], 3),
        "traffic_pressure": round(support["traffic_pressure"], 3),
        "planning_intensity": round(support["planning_intensity"], 3),
        "deprivation_weight": round(support["deprivation_weight"], 3),
        "bike_trip_index": round(support["bike_trip_index"], 3),
        "tree_canopy_context": round(support["tree_canopy_context"], 3),
        "civic_service_context": round(support["civic_service_context"], 3),
    }


def metric_direction(metric: str, delta: float) -> str:
    if abs(delta) < 0.035:
        return "stable"
    if metric in {"traffic", "electricity"}:
        return "worsened" if delta > 0 else "improved"
    if metric == "buildings":
        return "appeared" if delta > 0 else "reduced"
    return "improved" if delta > 0 else "worsened"


def evidence_for(metric: str, year: int, rasters: dict[int, set[str]]) -> list[str]:
    evidence = {
        "traffic": ["OSM roads, bridges and cycleways", "Belfast Bikes yearly trip snapshots", "Development-zone and road-pressure proxy", "Transit-node access context"],
        "jobs": ["OSM commercial, education and healthcare services", "NISRA census and population context", "Transit and centre-access proxy", "Public service and civic-point inventory"],
        "electricity": ["OSM power lines, substations and transformers", "GRID reference method: load/headroom replay proxy", "Development, service and job-access pressure"],
        "buildings": ["OSM building footprints and replay-first-visible-year profile", "Planning/development-zone pressure proxy", "Sentinel/Landsat NDBI source availability"],
        "services": ["OSM health, education, civic and commercial services", "Belfast public toilets and pitches open data", "Transit, bike and centre-access proxy"],
    }[metric][:]
    if year in rasters:
        evidence.append(f"Local raster evidence for {year}: {', '.join(sorted(rasters[year]))}")
    elif year in {2017, 2019, 2021, 2023, 2025}:
        evidence.append("Interpolated between available raster/statistical evidence years")
    return evidence


def feature_collection(cells: list[dict[str, Any]], values: dict[str, dict[int, dict[str, float]]], year: int, rasters: dict[int, set[str]]) -> dict[str, Any]:
    features = []
    for cell in cells:
        props = values[cell["id"]][year]
        base = values[cell["id"]][2016]
        previous = values[cell["id"]][max(2016, year - 1)]
        metric_deltas = {f"{metric}_delta_2016": round(props[metric] - base[metric], 3) for metric in [item["id"] for item in CORE_METRICS]}
        metric_deltas.update({f"{metric}_delta_previous": round(props[metric] - previous[metric], 3) for metric in [item["id"] for item in CORE_METRICS]})
        dominant_metric = max([item["id"] for item in CORE_METRICS], key=lambda metric: abs(metric_deltas[f"{metric}_delta_2016"]))
        dominant_change = metric_direction(dominant_metric, metric_deltas[f"{dominant_metric}_delta_2016"])
        confidence = "high" if year in {2016, 2021, 2026} else "medium" if year in rasters else "low-medium"
        features.append(
            {
                "type": "Feature",
                "id": f"{cell['id']}_{year}",
                "properties": {
                    "cell_id": cell["id"],
                    "year": year,
                    "row": cell["row"],
                    "col": cell["col"],
                    **props,
                    **metric_deltas,
                    "dominant_metric": dominant_metric,
                    "dominant_change": dominant_change,
                    "confidence": confidence,
                    "evidence": evidence_for(dominant_metric, year, rasters),
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
            "resolution_note": "Regular replay grid across Belfast NI; values are normalized 0-1 lens scores.",
        },
        "features": features,
    }


def metric_card(metric_meta: dict[str, Any], year_values: list[float], base_values: list[float], sparkline_values: list[float]) -> dict[str, Any]:
    metric = metric_meta["id"]
    current = mean(year_values)
    baseline = mean(base_values)
    delta = current - baseline
    good_up = metric_meta["goodDirection"] == "up"
    improved = delta >= 0 if good_up else delta <= 0
    return {
        "metric": metric,
        "label": metric_meta["label"],
        "value": round(current, 3),
        "display": f"{round(current * 100)}",
        "delta": round(delta, 3),
        "deltaDisplay": f"{'+' if delta >= 0 else ''}{round(delta * 100)}",
        "trend": "improved" if improved and abs(delta) >= 0.02 else "worsened" if not improved and abs(delta) >= 0.02 else "stable",
        "why": metric_meta["why"],
        "mapShows": metric_meta["map"],
        "color": metric_meta["color"],
        "sparkline": [round(value, 3) for value in sparkline_values],
    }


def area_name(point: tuple[float, float]) -> str:
    nearest = min(AREA_ANCHORS, key=lambda anchor: distance_km(point, (anchor["lon"], anchor["lat"])))
    return str(nearest["name"])


def commit_month(metric: str, year: int) -> str:
    months = {
        "traffic": "Sep",
        "jobs": "Jun",
        "electricity": "Jul",
        "buildings": "Oct",
        "services": "Aug",
    }
    return f"{months.get(metric, 'May')} {year}"


def affected_signals(metric: str, year: int, averages: dict[int, dict[str, float]]) -> list[dict[str, Any]]:
    relationships = {
        "traffic": ["traffic", "jobs", "services"],
        "jobs": ["jobs", "traffic", "services"],
        "electricity": ["electricity", "buildings", "jobs"],
        "buildings": ["buildings", "traffic", "electricity"],
        "services": ["services", "jobs", "traffic"],
    }[metric]
    rows = []
    for index, signal in enumerate(relationships):
        before = averages[2016][signal]
        after = averages[year][signal]
        rows.append(
            {
                "signal": signal,
                "label": next(item["label"] for item in CORE_METRICS if item["id"] == signal),
                "impact": "Strongly affected" if index == 0 else "Moderately affected" if index == 1 else "Slightly affected",
                "before": round(before, 3),
                "after": round(after, 3),
                "delta": round(after - before, 3),
            }
        )
    return rows


def signal_narrative(metric: str, area: str, year: int, delta: float) -> tuple[str, str, str, str]:
    direction = metric_direction(metric, delta)
    severity = "High" if abs(delta) >= 0.12 else "Medium" if abs(delta) >= 0.055 else "Watch"
    if metric == "traffic":
        symbol = "!" if delta > 0.035 else "-" if delta < -0.035 else "~"
        title = f"{area} corridor strain {'increased' if delta >= 0 else 'eased'}"
        subtitle = "Peak-hour road pressure and nearby development activity changed surrounding links"
        explanation = f"The replay highlights grid cells around {area} where road pressure, centre access and development intensity combine into the strongest traffic signal for {year}. Bike and transit access partially offset the heatmap where those datasets are stronger."
    elif metric == "jobs":
        symbol = "+" if delta >= 0 else "-"
        title = f"Commercial activity {'grew' if delta >= 0 else 'weakened'} around {area}"
        subtitle = "Employment, education and service access moved together in this area"
        explanation = f"The jobs signal uses commercial/service anchors, education access and transit reach. In {year}, {area} carries the clearest job-access diff against 2016, so the selected cells show where opportunity is concentrating."
    elif metric == "electricity":
        symbol = "!" if delta > 0.035 else "-" if delta < -0.035 else "~"
        title = f"Grid headroom {'tightened' if delta >= 0 else 'opened'} near {area}"
        subtitle = "Power assets are replayed with GRID-style load and headroom scoring"
        explanation = f"The electricity layer maps OSM power assets onto the replay grid. Around {area}, the load proxy responds to building, service and job growth, marking where reinforcement pressure would deserve further engineering review."
    elif metric == "buildings":
        symbol = "+"
        title = f"{area} building footprint additions concentrated"
        subtitle = "Mapped building additions and architectural-period pressure are visible in 3D"
        explanation = f"The 3D building skeleton changes by replay-first-visible year. Selecting this commit highlights the grid cells near {area} where development pressure and mapped footprint additions contribute most to the {year} building diff."
        direction = "appeared" if delta >= 0 else "reduced"
    else:
        symbol = "+" if delta >= 0 else "-"
        title = f"Service access {'improved' if delta >= 0 else 'remained uneven'} around {area}"
        subtitle = "Health, education, civic and recreation access shifted against the baseline"
        explanation = f"The services signal combines OSM service points, civic datasets, transit reach and bike access. The highlighted {area} cells explain where practical day-to-day access changed most by {year}."
    return symbol, title, subtitle, explanation


def commit(
    symbol: str,
    year: int,
    metric: str,
    title: str,
    subtitle: str,
    explanation: str,
    delta: float,
    confidence: str,
    evidence: list[str],
    tone: str,
    area: str,
    cell_ids: list[str],
    averages: dict[int, dict[str, float]],
) -> dict[str, Any]:
    severity = "High" if abs(delta) >= 0.12 else "Medium" if abs(delta) >= 0.055 else "Watch"
    return {
        "id": f"{year}-{metric}",
        "symbol": symbol,
        "type": metric,
        "signal": metric,
        "title": title,
        "subtitle": subtitle,
        "area": area,
        "month": commit_month(metric, year),
        "severity": severity,
        "delta": round(delta, 3),
        "confidence": confidence,
        "tone": tone,
        "cellIds": cell_ids,
        "mapInstruction": f"Highlight the top {len(cell_ids)} affected replay cells around {area}. Click any cell in the list to zoom into that exact diff.",
        "explanation": explanation,
        "evidence": evidence,
        "affectedSignals": affected_signals(metric, year, averages),
        "auditTrail": [
            "Grid cell score generated deterministically from local source artifacts.",
            "Commit wording is derived from metric deltas, not invented as unsupported fact.",
            "Gemini can summarize the selected diff, but the map state and evidence remain deterministic.",
        ],
    }


def commits_for_year(
    year: int,
    averages: dict[int, dict[str, float]],
    values: dict[str, dict[int, dict[str, float]]],
    cells: list[dict[str, Any]],
    rasters: dict[int, set[str]],
) -> list[dict[str, Any]]:
    current = averages[year]
    base = averages[2016]
    by_cell = {cell["id"]: cell for cell in cells}
    commits = []
    for metric in [item["id"] for item in CORE_METRICS]:
        ordered = sorted(
            values.items(),
            key=lambda item: (item[1][year][metric], abs(item[1][year][metric] - item[1][2016][metric])),
            reverse=True,
        )[:36]
        cell_ids = [cell_id for cell_id, _year_values in ordered]
        leading_cell = by_cell[cell_ids[0]]
        area = area_name(leading_cell["center"])
        delta = current[metric] - base[metric]
        symbol, title, subtitle, explanation = signal_narrative(metric, area, year, delta)
        confidence = "high" if metric in {"traffic", "services"} and year in {2016, 2021, 2026} else "medium-high" if metric in {"buildings", "electricity"} else "medium"
        commits.append(
            commit(
                symbol,
                year,
                metric,
                title,
                subtitle,
                explanation,
                delta,
                confidence,
                evidence_for(metric, year, rasters),
                metric_direction(metric, delta),
                area,
                cell_ids,
                averages,
            )
        )
    return commits


def hotspots_for_year(year: int, values: dict[str, dict[int, dict[str, float]]], cells: list[dict[str, Any]]) -> dict[str, Any]:
    features = []
    by_cell = {cell["id"]: cell for cell in cells}
    for metric in [item["id"] for item in CORE_METRICS]:
        ordered = sorted(values.items(), key=lambda item: item[1][year][metric], reverse=True)[:7]
        for cell_id, year_values in ordered:
            cell = by_cell[cell_id]
            lon, lat = cell["center"]
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "cell_id": cell_id,
                        "year": year,
                        "metric": metric,
                        "value": year_values[year][metric],
                        "label": next(item["label"] for item in CORE_METRICS if item["id"] == metric),
                    },
                    "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                }
            )
    return {"type": "FeatureCollection", "features": features}


def walk_geometry_coords(geometry: dict[str, Any] | None) -> list[tuple[float, float]]:
    coords: list[tuple[float, float]] = []

    def walk(node: Any) -> None:
        if isinstance(node, list):
            if len(node) >= 2 and isinstance(node[0], (int, float)) and isinstance(node[1], (int, float)):
                coords.append((float(node[0]), float(node[1])))
            else:
                for item in node:
                    walk(item)

    if geometry:
        walk(geometry.get("coordinates"))
    return coords


def geometry_centroid(geometry: dict[str, Any] | None) -> tuple[float, float] | None:
    coords = walk_geometry_coords(geometry)
    if not coords:
        return None
    return (sum(lon for lon, _lat in coords) / len(coords), sum(lat for _lon, lat in coords) / len(coords))


def load_power_asset_meta(root: Path) -> dict[str, dict[str, Any]]:
    path = root / "data/raw/overpass/belfast_power_assets_overpass_meta_2026.json"
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    meta: dict[str, dict[str, Any]] = {}
    for element in payload.get("elements", []):
        element_type = element.get("type")
        element_id = element.get("id")
        if not element_type or element_id is None:
            continue
        source_id = f"{element_type}/{element_id}"
        timestamp = str(element.get("timestamp") or "")
        try:
            mapped_year = int(timestamp[:4])
        except ValueError:
            mapped_year = 2016
        meta[source_id] = {
            "osm_timestamp": timestamp,
            "osm_version": element.get("version"),
            "osm_changeset": element.get("changeset"),
            "osm_user": element.get("user"),
            "osm_power": (element.get("tags") or {}).get("power"),
            "mapped_first_visible_year": min(2026, max(2016, mapped_year)),
        }
    return meta


def electricity_status(load: float) -> str:
    if load >= 0.82:
        return "stressed"
    if load >= 0.66:
        return "tight"
    if load >= 0.48:
        return "watch"
    return "headroom"


def electricity_layers_for_year(
    root: Path,
    year: int,
    cells: list[dict[str, Any]],
    values: dict[str, dict[int, dict[str, float]]],
) -> dict[str, Any]:
    path = root / "data/derived/2026/belfast_ni_power_grid_osm_2026.geojson"
    if not path.exists():
        return {"type": "FeatureCollection", "features": []}
    source = json.loads(path.read_text(encoding="utf-8"))
    power_meta = load_power_asset_meta(root)
    progress = (year - 2016) / 10
    features = []
    for feature in source.get("features", []):
        centroid = geometry_centroid(feature.get("geometry"))
        if not centroid:
            continue
        cell = min(cells, key=lambda item: distance_km(centroid, item["center"]))
        metrics = values[cell["id"]][year]
        props = feature.get("properties") or {}
        power_type = props.get("power") or "grid"
        meta = power_meta.get(str(props.get("source_id") or ""))
        first_visible_year = int(meta.get("mapped_first_visible_year", 2016)) if meta else 2016
        if first_visible_year > year:
            continue
        type_weight = 0.08 if power_type in {"line", "minor_line", "cable"} else 0.14 if power_type in {"substation", "transformer"} else 0.05
        load = clamp(
            0.23
            + metrics["electricity"] * 0.28
            + metrics["development_pressure"] * 0.18
            + metrics["jobs"] * 0.12
            + metrics["traffic_pressure"] * 0.08
            + metrics["services"] * 0.06
            + progress * 0.10
            + type_weight
        )
        headroom = clamp(1 - load)
        properties = {
            **{key: value for key, value in props.items() if value not in (None, "")},
            **({key: value for key, value in meta.items() if value not in (None, "")} if meta else {}),
            "year": year,
            "cell_id": cell["id"],
            "replay_first_visible_year": first_visible_year,
            "visibility_basis": "OSM metadata timestamp" if meta else "Current OSM asset without historical metadata",
            "grid_load_pct": round(load * 100, 1),
            "headroom_pct": round(headroom * 100, 1),
            "status": electricity_status(load),
            "confidence": "medium",
            "evidence": [
                "OSM power lines/substations current asset map",
                "Overpass OSM metadata for transformer/substation mapped timestamps" if meta else "No OSM timestamp in local power export; shown from 2016 baseline",
                "GRID reference method: load heatmap and headroom scoring",
                "Load is a Belfast replay proxy weighted by electricity, development, jobs, services and traffic pressure",
            ],
        }
        features.append({"type": "Feature", "id": f"{feature.get('id', len(features))}-{year}", "properties": properties, "geometry": feature.get("geometry")})
    return {
        "type": "FeatureCollection",
        "name": f"belfast_ni_electricity_{year}",
        "metadata": {
            "year": year,
            "source": "OSM power-grid assets with Overpass metadata timestamps and GRID-style load/headroom replay proxy",
            "feature_count": len(features),
            "visibility_note": "Power assets with Overpass metadata appear from their OSM timestamp year; this is mapped-history evidence, not confirmed commissioning date.",
        },
        "features": features,
    }


def build(root: Path, output_dir: Path) -> dict[str, Any]:
    cells = grid_cells()
    air = load_air_quality(root)
    population = load_population(root)
    census_total = load_census_total(root)
    rasters = raster_years(root)
    bike_trip_index, bike_trip_totals = load_bike_trip_index(root)
    static_context = build_static_context(root, cells)
    values: dict[str, dict[int, dict[str, float]]] = {}
    for cell in cells:
        values[cell["id"]] = {}
        for year in YEARS:
            support = support_values(cell, year, air, population, static_context, bike_trip_index)
            values[cell["id"]][year] = core_metrics(support, year, population)

    output_dir.mkdir(parents=True, exist_ok=True)
    for year in YEARS:
        (output_dir / f"grid_{year}.geojson").write_text(json.dumps(feature_collection(cells, values, year, rasters), separators=(",", ":")), encoding="utf-8")
        (output_dir / f"hotspots_{year}.geojson").write_text(json.dumps(hotspots_for_year(year, values, cells), separators=(",", ":")), encoding="utf-8")
        (output_dir / f"electricity_{year}.geojson").write_text(json.dumps(electricity_layers_for_year(root, year, cells, values), separators=(",", ":")), encoding="utf-8")

    averages: dict[int, dict[str, float]] = {}
    for year in YEARS:
        averages[year] = {}
        for metric in [item["id"] for item in CORE_METRICS]:
            averages[year][metric] = mean(cell_years[year][metric] for cell_years in values.values())

    metrics_by_year = {}
    for year in YEARS:
        year_features = [values[cell["id"]][year] for cell in cells]
        base_features = [values[cell["id"]][2016] for cell in cells]
        metrics_by_year[str(year)] = [
            metric_card(
                meta,
                [item[meta["id"]] for item in year_features],
                [item[meta["id"]] for item in base_features],
                [averages[spark_year][meta["id"]] for spark_year in YEARS],
            )
            for meta in CORE_METRICS
        ]

    summary = {
        "schemaVersion": "2.0.0",
        "kind": "belfast.modeA.summary",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "years": YEARS,
        "bbox": BELFAST_BBOX,
        "cellCount": len(cells),
        "gridTemplate": "/data/mode-a/grid_{year}.geojson",
        "hotspotTemplate": "/data/mode-a/hotspots_{year}.geojson",
        "electricityTemplate": "/data/mode-a/electricity_{year}.geojson",
        "coreMetrics": CORE_METRICS,
        "metricsByYear": metrics_by_year,
        "commitsByYear": {str(year): commits_for_year(year, averages, values, cells, rasters) for year in YEARS},
        "populationByYear": population,
        "census2021TotalPopulation": census_total,
        "bikeTripTotalsByYear": bike_trip_totals,
        "bikeTripIndexByYear": {str(key): round(value, 3) for key, value in bike_trip_index.items()},
        "airQualityExposureByYear": {str(key): round(value, 3) for key, value in air.items()},
        "rasterEvidenceByYear": {str(key): sorted(value) for key, value in rasters.items()},
        "sources": [
            {"name": "OpenStreetMap / Overpass local exports", "status": "local", "confidence": "medium", "note": "Buildings, roads, services, places, power assets and development context"},
            {"name": "NI Air Belfast Centre archive", "status": "local", "confidence": "high for available year(s)", "note": "Traffic and exposure context retained as supporting evidence"},
            {"name": "NISRA census and population files", "status": "local", "confidence": "high for official totals", "note": "Jobs, service demand and planning pressure context"},
            {"name": "Sentinel/Landsat NDVI/NDBI/RGB rasters", "status": "local sources", "confidence": "medium pending raster tiling", "note": "Building and development evidence anchors"},
            {"name": "Belfast Bikes trip and station datasets", "status": "local", "confidence": "high for sample months", "note": "Traffic offset and active-travel context"},
            {"name": "Belfast trees, pitches and public toilets open data", "status": "local", "confidence": "medium", "note": "Services and civic-access context"},
            {"name": "BCCAQ air monitoring inventory", "status": "local", "confidence": "medium", "note": "Traffic/exposure supporting context"},
            {"name": "Belfast electricity assets from OSM power tags", "status": "local derived", "confidence": "medium for asset location, proxy for load", "note": "GRID-inspired load/headroom replay over power lines and substations"},
            {"name": "OpenStreetMap Overpass power metadata", "status": "downloaded 2026-04-25", "confidence": "medium for mapped timestamps", "note": "Transformer, substation, generator and plant metadata drives mapped-appearance dots; timestamps are OSM history, not commissioning dates"},
        ],
        "electricityMethod": {
            "sourceInspiration": "GRID-main.zip",
            "rendering": "Power lines and substations use load percentage and headroom status, similar to GRID heatmap/viability scoring.",
            "caveat": "Belfast load is a replay proxy; asset locations come from OSM power tags, and Overpass timestamps show when assets became visible in OSM, not confirmed commissioning dates.",
        },
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
    print(f"Wrote Mode A replay to {output} for {len(summary['years'])} years, {summary['cellCount']} cells, and {len(summary['coreMetrics'])} core metrics.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
