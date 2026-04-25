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

CORE_METRICS = [
    {
        "id": "population_pressure",
        "label": "Population Pressure",
        "why": "Shows where Belfast is becoming denser and whether areas can handle growth.",
        "map": "Density heatmap, new housing zones, and service pressure.",
        "goodDirection": "down",
        "color": "#ef4444",
    },
    {
        "id": "mobility_strain",
        "label": "Mobility Strain",
        "why": "Combines traffic, public transport, walkability, and bike access into one pressure score.",
        "map": "Congested corridors, transit gaps, and bike/road improvements.",
        "goodDirection": "down",
        "color": "#2563eb",
    },
    {
        "id": "economic_opportunity",
        "label": "Economic Opportunity",
        "why": "Shows whether people can reach jobs, education, services, and business areas.",
        "map": "Job-access zones, growth corridors, and reachable opportunities.",
        "goodDirection": "up",
        "color": "#f59e0b",
    },
    {
        "id": "environmental_exposure",
        "label": "Environmental Exposure",
        "why": "Combines air quality, green cover, road exposure, and river/flood-risk context.",
        "map": "Pollution hotspots, green-cover change, and river/flood-risk areas.",
        "goodDirection": "down",
        "color": "#7c3aed",
    },
    {
        "id": "fairness_score",
        "label": "Fairness Score",
        "why": "Shows whether improvements help deprived/underserved areas or only already strong areas.",
        "map": "Who benefits, inequality gaps, and underserved neighbourhoods.",
        "goodDirection": "up",
        "color": "#0f766e",
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
    population_pressure = clamp(0.12 + support["development_pressure"] * 0.46 + support["centre_access"] * 0.18 + support["planning_intensity"] * 0.15 + progress * 0.08)
    mobility_strain = clamp(support["traffic_pressure"] * 0.44 + (1 - support["transit_access"]) * 0.20 + (1 - support["bike_access"]) * 0.18 + support["development_pressure"] * 0.12)
    economic_opportunity = clamp(support["service_access"] * 0.52 + support["jobs_access"] * 0.22 + support["transit_access"] * 0.14 + support["bike_access"] * 0.08 + support["civic_service_context"] * 0.04)
    environmental_exposure = clamp(support["pollutant_exposure"] * 0.45 + (1 - support["green_cover"]) * 0.24 + support["flood_risk"] * 0.18 + support["road_pressure"] * 0.13)
    fairness_score = clamp(0.50 + (economic_opportunity - mobility_strain) * 0.30 - support["deprivation_weight"] * 0.18 + support["transit_access"] * support["deprivation_weight"] * 0.16)
    return {
        "population_pressure": round(population_pressure, 3),
        "mobility_strain": round(mobility_strain, 3),
        "economic_opportunity": round(economic_opportunity, 3),
        "environmental_exposure": round(environmental_exposure, 3),
        "fairness_score": round(fairness_score, 3),
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
    if metric in {"population_pressure", "mobility_strain", "environmental_exposure"}:
        return "worsened" if delta > 0 else "improved"
    return "improved" if delta > 0 else "worsened"


def evidence_for(metric: str, year: int, rasters: dict[int, set[str]]) -> list[str]:
    evidence = {
        "population_pressure": ["NISRA population/census totals", "OSM building density and development-zone proxy", "Planning/local development source inventory"],
        "mobility_strain": ["Belfast Bikes trip snapshots by year", "Belfast bike station locations", "OSM roads/cycleways and transit context"],
        "economic_opportunity": ["NISRA census context", "OSM services, education, healthcare and commercial source layers", "Public toilets, pitches and civic-service point data"],
        "environmental_exposure": ["NI Air Belfast Centre hourly archive", "BCCAQ monitoring-site inventory", "NDVI/NDBI raster source availability", "Tree inventory, road-pressure and River Lagan exposure proxy"],
        "fairness_score": ["NISRA deprivation/Data Zone source plan", "Population and opportunity access weighting", "Underserved-area anchor proxy"],
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


def metric_card(metric_meta: dict[str, Any], year_values: list[float], base_values: list[float]) -> dict[str, Any]:
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
        "sparkline": [round(value, 3) for value in year_values[:14]],
    }


def commit(symbol: str, year: int, metric: str, title: str, delta: float, confidence: str, evidence: list[str], tone: str) -> dict[str, Any]:
    return {
        "id": f"{year}-{metric}",
        "symbol": symbol,
        "type": metric,
        "title": title,
        "delta": round(delta, 3),
        "confidence": confidence,
        "tone": tone,
        "evidence": evidence,
    }


def commits_for_year(year: int, averages: dict[int, dict[str, float]], rasters: dict[int, set[str]]) -> list[dict[str, Any]]:
    current = averages[year]
    base = averages[2016]
    return [
        commit("+", year, "population_pressure", "Population pressure intensifies around the city core and waterfront growth zones", current["population_pressure"] - base["population_pressure"], "medium", evidence_for("population_pressure", year, rasters), "worsened"),
        commit("~", year, "mobility_strain", "Mobility strain shifts along road corridors while transit and bike access offset central pressure", current["mobility_strain"] - base["mobility_strain"], "medium", evidence_for("mobility_strain", year, rasters), metric_direction("mobility_strain", current["mobility_strain"] - base["mobility_strain"])),
        commit("+", year, "economic_opportunity", "Economic opportunity remains strongest near jobs, education, services, and transit corridors", current["economic_opportunity"] - base["economic_opportunity"], "medium", evidence_for("economic_opportunity", year, rasters), metric_direction("economic_opportunity", current["economic_opportunity"] - base["economic_opportunity"])),
        commit("!" if current["environmental_exposure"] > base["environmental_exposure"] else "-", year, "environmental_exposure", "Environmental exposure combines air quality, road pressure, green-cover loss, and river risk", current["environmental_exposure"] - base["environmental_exposure"], "high" if year >= 2021 else "medium", evidence_for("environmental_exposure", year, rasters), metric_direction("environmental_exposure", current["environmental_exposure"] - base["environmental_exposure"])),
        commit("!" if current["fairness_score"] < base["fairness_score"] else "+", year, "fairness_score", "Fairness score tracks whether opportunity gains reach underserved neighbourhoods", current["fairness_score"] - base["fairness_score"], "medium", evidence_for("fairness_score", year, rasters), metric_direction("fairness_score", current["fairness_score"] - base["fairness_score"])),
    ]


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
            metric_card(meta, [item[meta["id"]] for item in year_features], [item[meta["id"]] for item in base_features])
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
        "coreMetrics": CORE_METRICS,
        "metricsByYear": metrics_by_year,
        "commitsByYear": {str(year): commits_for_year(year, averages, rasters) for year in YEARS},
        "populationByYear": population,
        "census2021TotalPopulation": census_total,
        "bikeTripTotalsByYear": bike_trip_totals,
        "bikeTripIndexByYear": {str(key): round(value, 3) for key, value in bike_trip_index.items()},
        "airQualityExposureByYear": {str(key): round(value, 3) for key, value in air.items()},
        "rasterEvidenceByYear": {str(key): sorted(value) for key, value in rasters.items()},
        "sources": [
            {"name": "OpenStreetMap / Overpass local exports", "status": "local", "confidence": "medium", "note": "Buildings, roads, parks, services and development context"},
            {"name": "NI Air Belfast Centre archive", "status": "local", "confidence": "high for available year(s)", "note": "NO2, PM10 and PM2.5 exposure trend input"},
            {"name": "NISRA census and population files", "status": "local", "confidence": "high for official totals", "note": "Population pressure and fairness context"},
            {"name": "Sentinel/Landsat NDVI/NDBI/RGB rasters", "status": "local sources", "confidence": "medium pending raster tiling", "note": "2016, 2018, 2020, 2022 and 2024 raster evidence anchors"},
            {"name": "Belfast Bikes trip and station datasets", "status": "local", "confidence": "high for sample months", "note": "Yearly mobility strain and active-travel signal"},
            {"name": "Belfast trees, pitches and public toilets open data", "status": "local", "confidence": "medium", "note": "Green-cover, recreation and civic-service context"},
            {"name": "BCCAQ air monitoring inventory", "status": "local", "confidence": "medium", "note": "Monitoring-site context for environmental exposure evidence"},
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
    print(f"Wrote Mode A replay to {output} for {len(summary['years'])} years, {summary['cellCount']} cells, and {len(summary['coreMetrics'])} core metrics.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
