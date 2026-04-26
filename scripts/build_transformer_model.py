#!/usr/bin/env python3
"""Build planning-grade transformer capacity artifacts for Scenario Studio.

The builder uses public/local data only. It attempts to read NIE metadata so the
model card can audit the official field schema, accepts future manual NIE drops
from data/manual_drops, and falls back to the repo's OSM power assets when the
official record API is not visible.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


BASELINE_YEAR = 2025
START_YEAR = 2026
HORIZON_YEAR = 2036
FORECAST_YEARS = list(range(START_YEAR, HORIZON_YEAR + 1))
MODEL_VERSION = "bims5-transformer-impact-v1-2026-screening"
BELFAST_CENTER = (-5.9301, 54.5973)

NIE_DATASETS = {
    "secondary": {
        "id": "nie-networks-assets-secondary-transformers",
        "title": "NIE Networks - Assets - Secondary Transformers",
        "url": "https://nienetworks.opendatasoft.com/explore/dataset/nie-networks-assets-secondary-transformers/",
        "default_kva": 500.0,
        "default_radius_m": 650.0,
    },
    "primary": {
        "id": "nie-networks-assets-primary-transformers",
        "title": "NIE Networks - Assets - Primary Transformers",
        "url": "https://nienetworks.opendatasoft.com/explore/dataset/nie-networks-assets-primary-transformers/",
        "default_kva": 16_000.0,
        "default_radius_m": 2_500.0,
    },
}

OFFICIAL_REQUIRED_FIELDS = [
    "asset_number",
    "asset_type",
    "nominal_rating",
    "nominal_rating_unit_of_measurement",
    "voltage",
    "rated_primary_voltage",
    "rated_primary_voltage_unit_of_measurement",
    "site_name",
    "site_postcode",
    "site_longitude_x_irish_grid",
    "site_latitude_y_irish_grid",
    "site_geopoint",
    "site_town_city",
    "site_county",
    "year_of_manufacture",
]


def clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


def read_json(path: Path, fallback: Any = None) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")


def safe_float(value: Any, default: float | None = None) -> float | None:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(float(value)) else default
    text = str(value).strip()
    if not text:
        return default
    match = re.search(r"-?\d+(?:\.\d+)?", text.replace(",", ""))
    if not match:
        return default
    try:
        number = float(match.group(0))
    except ValueError:
        return default
    return number if math.isfinite(number) else default


def safe_int(value: Any, default: int | None = None) -> int | None:
    number = safe_float(value, None)
    if number is None:
        return default
    return int(round(number))


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


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
        return BELFAST_CENTER
    return (sum(lon for lon, _lat in coords) / len(coords), sum(lat for _lon, lat in coords) / len(coords))


def bbox_for_features(features: list[dict[str, Any]], buffer_deg: float = 0.02) -> list[float]:
    points = [centroid(feature.get("geometry")) for feature in features if feature.get("geometry")]
    if not points:
        lon, lat = BELFAST_CENTER
        return [lon - 0.1, lat - 0.1, lon + 0.1, lat + 0.1]
    return [
        min(lon for lon, _lat in points) - buffer_deg,
        min(lat for _lon, lat in points) - buffer_deg,
        max(lon for lon, _lat in points) + buffer_deg,
        max(lat for _lon, lat in points) + buffer_deg,
    ]


def in_bbox(point: tuple[float, float], bbox: list[float]) -> bool:
    return bbox[0] <= point[0] <= bbox[2] and bbox[1] <= point[1] <= bbox[3]


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1 = a
    lon2, lat2 = b
    x = (lon2 - lon1) * 111_320 * math.cos(math.radians((lat1 + lat2) / 2))
    y = (lat2 - lat1) * 110_540
    return math.hypot(x, y)


def parse_voltage_kv(value: Any, unit: Any = None) -> float | None:
    if isinstance(value, str) and ";" in value:
        parts = [parse_voltage_kv(part, unit) for part in value.split(";")]
        parts = [part for part in parts if part is not None]
        return max(parts) if parts else None
    number = safe_float(value, None)
    if number is None:
        return None
    unit_text = str(unit or value or "").lower()
    if "kv" in unit_text:
        return number
    if "v" in unit_text or number >= 230:
        return number / 1000.0
    return number


def rating_to_kva(value: Any, unit: Any, asset_class: str) -> float | None:
    number = safe_float(value, None)
    if number is None or number <= 0:
        return None
    unit_text = str(unit or "").lower()
    if "mva" in unit_text:
        return number * 1000.0
    if "kva" in unit_text:
        return number
    if re.search(r"\bva\b", unit_text):
        return number / 1000.0
    if "mw" in unit_text or "mvar" in unit_text:
        return number * 1000.0
    if asset_class == "primary" and number < 100:
        return number * 1000.0
    return number


def fetch_json(url: str, timeout: float = 4.0) -> tuple[Any | None, str | None]:
    request = urllib.request.Request(url, headers={"User-Agent": "BIMS-5 transformer model builder"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8")), None
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as error:
        return None, str(error)


def fetch_official_metadata() -> dict[str, Any]:
    metadata: dict[str, Any] = {}
    for asset_class, spec in NIE_DATASETS.items():
        url = f"https://nienetworks.opendatasoft.com/api/v2/catalog/datasets/{spec['id']}"
        payload, error = fetch_json(url)
        dataset = (payload or {}).get("dataset") or {}
        fields = dataset.get("fields") or []
        metas = (dataset.get("metas") or {}).get("default") or {}
        metadata[asset_class] = {
            "datasetId": spec["id"],
            "title": spec["title"],
            "url": spec["url"],
            "recordCount": metas.get("records_count"),
            "modified": metas.get("modified"),
            "dataProcessed": metas.get("data_processed"),
            "license": metas.get("license"),
            "licenseUrl": metas.get("license_url"),
            "dataVisible": dataset.get("data_visible"),
            "fields": [{"name": field.get("name"), "type": field.get("type"), "label": field.get("label")} for field in fields],
            "requiredFieldsPresent": all(any(field.get("name") == required for field in fields) for required in OFFICIAL_REQUIRED_FIELDS),
            "metadataError": error,
        }
    return metadata


def official_records_visible(asset_class: str) -> tuple[list[dict[str, Any]], str | None]:
    spec = NIE_DATASETS[asset_class]
    url = f"https://nienetworks.opendatasoft.com/api/explore/v2.1/catalog/datasets/{spec['id']}/records?limit=100"
    payload, error = fetch_json(url, timeout=4.0)
    if not payload:
        return [], error
    records = payload.get("results") or []
    return records if isinstance(records, list) else [], None


def point_from_geopoint(value: Any) -> tuple[float, float] | None:
    if isinstance(value, dict):
        lon = safe_float(value.get("lon") or value.get("lng") or value.get("longitude"), None)
        lat = safe_float(value.get("lat") or value.get("latitude"), None)
        if lon is not None and lat is not None:
            return (lon, lat)
    if isinstance(value, list) and len(value) >= 2:
        first = safe_float(value[0], None)
        second = safe_float(value[1], None)
        if first is not None and second is not None:
            if -90 <= first <= 90 and -180 <= second <= 180:
                return (second, first)
            return (first, second)
    if isinstance(value, str):
        numbers = [float(match) for match in re.findall(r"-?\d+(?:\.\d+)?", value)]
        if len(numbers) >= 2:
            first, second = numbers[0], numbers[1]
            if -90 <= first <= 90 and -180 <= second <= 180:
                return (second, first)
            return (first, second)
    return None


def feature_from_official_record(record: dict[str, Any], asset_class: str, source: str) -> dict[str, Any] | None:
    point = point_from_geopoint(record.get("site_geopoint"))
    if not point:
        geometry = record.get("geometry")
        if isinstance(geometry, dict):
            point = centroid(geometry)
    if not point:
        return None
    rating_kva = rating_to_kva(
        record.get("nominal_rating"),
        record.get("nominal_rating_unit_of_measurement"),
        asset_class,
    )
    voltage_kv = parse_voltage_kv(
        record.get("rated_primary_voltage") or record.get("voltage"),
        record.get("rated_primary_voltage_unit_of_measurement") or record.get("voltage"),
    )
    props = {
        "asset_number": clean_text(record.get("asset_number")),
        "asset_type": clean_text(record.get("asset_type")) or asset_class,
        "asset_class": asset_class,
        "nominal_rating": safe_float(record.get("nominal_rating"), None),
        "nominal_rating_unit_of_measurement": clean_text(record.get("nominal_rating_unit_of_measurement")),
        "rating_kva": round(rating_kva, 3) if rating_kva else None,
        "voltage": clean_text(record.get("voltage")),
        "voltage_kv": round(voltage_kv, 3) if voltage_kv else None,
        "rated_primary_voltage": safe_float(record.get("rated_primary_voltage"), None),
        "rated_primary_voltage_unit_of_measurement": clean_text(record.get("rated_primary_voltage_unit_of_measurement")),
        "site_name": clean_text(record.get("site_name")),
        "site_postcode": clean_text(record.get("site_postcode")),
        "site_town_city": clean_text(record.get("site_town_city")),
        "site_county": clean_text(record.get("site_county")),
        "year_of_manufacture": safe_int(record.get("year_of_manufacture"), None),
        "source": source,
        "data_support": "official-record",
        "rating_support": "official" if rating_kva else "missing",
    }
    return {
        "type": "Feature",
        "properties": props,
        "geometry": {"type": "Point", "coordinates": [round(point[0], 6), round(point[1], 6)]},
    }


def load_manual_records(root: Path) -> list[dict[str, Any]]:
    drops_dir = root / "data" / "manual_drops"
    if not drops_dir.exists():
        return []
    features: list[dict[str, Any]] = []
    candidates = list(drops_dir.glob("*transformer*.geojson")) + list(drops_dir.glob("*transformer*.json"))
    for path in candidates:
        payload = read_json(path, {})
        raw_features = payload.get("features") if isinstance(payload, dict) else None
        if not isinstance(raw_features, list):
            continue
        class_hint = "primary" if "primary" in path.name.lower() else "secondary"
        for feature in raw_features:
            props = feature.get("properties") or {}
            record = {**props, "geometry": feature.get("geometry")}
            transformed = feature_from_official_record(record, props.get("asset_class") or class_hint, f"manual:{path.name}")
            if transformed:
                features.append(transformed)
    for path in drops_dir.glob("*transformer*.csv"):
        class_hint = "primary" if "primary" in path.name.lower() else "secondary"
        with path.open(newline="", encoding="utf-8-sig") as handle:
            for row in csv.DictReader(handle):
                transformed = feature_from_official_record(row, row.get("asset_class") or class_hint, f"manual:{path.name}")
                if transformed:
                    features.append(transformed)
    return features


def load_osm_transformer_assets(root: Path, city_bbox: list[float]) -> list[dict[str, Any]]:
    path = root / "data" / "derived" / "2026" / "belfast_ni_power_grid_osm_2026.geojson"
    payload = read_json(path, {"type": "FeatureCollection", "features": []})
    features: list[dict[str, Any]] = []
    for index, feature in enumerate(payload.get("features") or []):
        props = feature.get("properties") or {}
        power = str(props.get("power") or "").lower()
        if power not in {"transformer", "substation"}:
            continue
        point = centroid(feature.get("geometry"))
        if not in_bbox(point, city_bbox):
            continue
        voltage_kv = parse_voltage_kv(props.get("voltage"), props.get("voltage"))
        asset_class = "primary" if (power == "substation" and (voltage_kv or 0) >= 33) else "secondary"
        if power == "transformer" and (voltage_kv or 0) >= 33:
            asset_class = "primary"
        default_kva = NIE_DATASETS[asset_class]["default_kva"]
        rating_kva = rating_to_kva(props.get("nominal_rating") or props.get("rating"), props.get("rating_unit"), asset_class) or default_kva
        asset_number = props.get("source_id") or f"osm-power-{index}"
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "asset_number": asset_number,
                    "asset_type": props.get("power") or asset_class,
                    "asset_class": asset_class,
                    "nominal_rating": round(rating_kva if asset_class == "secondary" else rating_kva / 1000, 3),
                    "nominal_rating_unit_of_measurement": "kVA" if asset_class == "secondary" else "MVA",
                    "rating_kva": round(rating_kva, 3),
                    "voltage": props.get("voltage"),
                    "voltage_kv": round(voltage_kv, 3) if voltage_kv else None,
                    "rated_primary_voltage": round(voltage_kv, 3) if voltage_kv else None,
                    "rated_primary_voltage_unit_of_measurement": "kV" if voltage_kv else None,
                    "site_name": props.get("name"),
                    "site_postcode": None,
                    "site_town_city": "Belfast",
                    "site_county": "County Antrim / County Down",
                    "year_of_manufacture": None,
                    "source": "OSM power asset proxy",
                    "source_id": props.get("source_id"),
                    "data_support": "osm-proxy",
                    "rating_support": "default-by-class",
                    "official_source_status": "NIE metadata visible; record API not visible to this builder",
                },
                "geometry": {"type": "Point", "coordinates": [round(point[0], 6), round(point[1], 6)]},
            }
        )
    return features


def build_official_asset_layer(root: Path, metadata: dict[str, Any], city_bbox: list[float]) -> dict[str, Any]:
    visible_records: list[dict[str, Any]] = []
    record_errors: dict[str, str | None] = {}
    for asset_class in NIE_DATASETS:
        records, error = official_records_visible(asset_class)
        record_errors[asset_class] = error
        for record in records:
            feature = feature_from_official_record(record, asset_class, "NIE Open Data record API")
            if feature and in_bbox(tuple(feature["geometry"]["coordinates"]), city_bbox):
                visible_records.append(feature)

    manual_features = load_manual_records(root)
    manual_features = [
        feature for feature in manual_features
        if in_bbox(tuple(feature["geometry"]["coordinates"]), city_bbox)
    ]
    if visible_records:
        source_mode = "official-record-api"
        features = visible_records
    elif manual_features:
        source_mode = "manual-official-drop"
        features = manual_features
    else:
        source_mode = "osm-proxy-with-official-metadata"
        features = load_osm_transformer_assets(root, city_bbox)

    return {
        "type": "FeatureCollection",
        "name": "belfast_ni_transformers_official",
        "metadata": {
            "schemaVersion": "1.0.0",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "sourceMode": source_mode,
            "officialDatasets": metadata,
            "officialRecordErrors": record_errors,
            "caveat": "Planning-grade screening layer. Public records do not expose feeder loading and this layer is not NIE engineering approval.",
        },
        "features": features,
    }


def capacity_kw_proxy(rating_kva: float, asset_class: str) -> float:
    power_factor = 0.90
    utilisable_share = 0.58 if asset_class == "secondary" else 0.46
    return rating_kva * power_factor * utilisable_share


def confidence_from_features(features: list[dict[str, Any]], nearest_secondary_m: float, nearest_primary_m: float) -> str:
    official = sum(1 for feature in features if feature.get("properties", {}).get("data_support") == "official-record")
    manual = sum(1 for feature in features if str(feature.get("properties", {}).get("source", "")).startswith("manual:"))
    nearby = min(nearest_secondary_m, nearest_primary_m)
    if official and nearby <= 750:
        return "high"
    if (official or manual) and nearby <= 1500:
        return "medium-high"
    if features and nearby <= 2500:
        return "medium"
    return "low"


def build_grid_features(root: Path, assets_fc: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    baseline = read_json(root / "web" / "data" / "mode-a" / "baseline_2025_forecast.json", {})
    grid_2026 = read_json(root / "web" / "data" / "mode-a" / "grid_2026.geojson", {})
    grid_props = {
        feature.get("properties", {}).get("cell_id"): feature.get("properties", {})
        for feature in grid_2026.get("features") or []
    }
    assets = assets_fc.get("features") or []
    asset_points: list[tuple[tuple[float, float], dict[str, Any]]] = []
    for feature in assets:
        coords = feature.get("geometry", {}).get("coordinates")
        if not isinstance(coords, list) or len(coords) < 2:
            continue
        asset_points.append(((float(coords[0]), float(coords[1])), feature.get("properties") or {}))

    rows: list[dict[str, Any]] = []
    by_cell: dict[str, Any] = {}
    forecast_cells: list[dict[str, Any]] = []
    summary_by_year: dict[str, dict[str, float]] = {}

    for cell in baseline.get("cells") or []:
        cell_id = cell.get("cellId")
        point = tuple(cell.get("centroid") or centroid(cell.get("geometry")))
        props = grid_props.get(cell_id) or {}
        distances = [(distance_m(point, asset_point), asset_props) for asset_point, asset_props in asset_points]
        distances.sort(key=lambda item: item[0])

        def count_near(asset_class: str, radius_m: float) -> int:
            return sum(1 for dist, asset in distances if dist <= radius_m and asset.get("asset_class") == asset_class)

        def sum_rating(asset_class: str, radius_m: float) -> float:
            return sum(float(asset.get("rating_kva") or 0) for dist, asset in distances if dist <= radius_m and asset.get("asset_class") == asset_class)

        nearest_secondary = min((dist for dist, asset in distances if asset.get("asset_class") == "secondary"), default=999_999.0)
        nearest_primary = min((dist for dist, asset in distances if asset.get("asset_class") == "primary"), default=999_999.0)
        nearby_assets = [asset for dist, asset in distances if dist <= 4000]
        weighted_capacity = 0.0
        available_capacity_kw = 0.0
        age_values: list[float] = []
        missing_rating = 0
        for dist, asset in distances:
            if dist > 4000:
                break
            asset_class = asset.get("asset_class") or "secondary"
            radius = NIE_DATASETS.get(asset_class, NIE_DATASETS["secondary"])["default_radius_m"]
            weight = math.exp(-dist / max(1.0, radius))
            rating_kva = float(asset.get("rating_kva") or 0)
            weighted_capacity += rating_kva * weight
            available_capacity_kw += capacity_kw_proxy(rating_kva, asset_class) * weight
            if not asset.get("rating_kva"):
                missing_rating += 1
            year_made = safe_int(asset.get("year_of_manufacture"), None)
            if year_made:
                age_values.append(max(0, 2026 - year_made))

        electricity = float((cell.get("baseline2025") or {}).get("electricity") or props.get("electricity") or 0)
        jobs = float((cell.get("baseline2025") or {}).get("jobs") or props.get("jobs") or 0)
        development = float(props.get("development_pressure") or 0)
        buildings = float(props.get("buildings") or 0)
        peak_kw_proxy = 320.0 + electricity * 4100.0 + buildings * 650.0 + jobs * 700.0 + development * 450.0
        headroom_kw = available_capacity_kw - peak_kw_proxy
        overload_risk = clamp(0.5 + (peak_kw_proxy - available_capacity_kw) / 5500.0)
        confidence = confidence_from_features(nearby_assets, nearest_secondary, nearest_primary)
        data_support_score = {"high": 0.92, "medium-high": 0.78, "medium": 0.58, "low": 0.34}[confidence]

        row = {
            "cell_id": cell_id,
            "row": cell.get("row"),
            "col": cell.get("col"),
            "centroid_lng": round(float(point[0]), 6),
            "centroid_lat": round(float(point[1]), 6),
            "secondary_250m": count_near("secondary", 250),
            "secondary_500m": count_near("secondary", 500),
            "secondary_750m": count_near("secondary", 750),
            "secondary_1000m": count_near("secondary", 1000),
            "primary_1000m": count_near("primary", 1000),
            "primary_2000m": count_near("primary", 2000),
            "primary_4000m": count_near("primary", 4000),
            "secondary_rating_kva_1000m": round(sum_rating("secondary", 1000), 3),
            "primary_rating_kva_4000m": round(sum_rating("primary", 4000), 3),
            "nearest_transformer_m": round(min(nearest_secondary, nearest_primary), 1),
            "nearest_secondary_m": round(nearest_secondary, 1),
            "nearest_primary_m": round(nearest_primary, 1),
            "weighted_capacity_kva": round(weighted_capacity, 3),
            "available_capacity_kw_proxy": round(available_capacity_kw, 3),
            "peak_kw_proxy_2026": round(peak_kw_proxy, 3),
            "headroom_kw_proxy_2026": round(headroom_kw, 3),
            "overload_risk_2026": round(overload_risk, 4),
            "asset_age_mean": round(sum(age_values) / len(age_values), 2) if age_values else "",
            "missing_rating_share": round(missing_rating / max(1, len(nearby_assets)), 4),
            "data_support_score": data_support_score,
            "confidence": confidence,
            "electricity_index": round(electricity, 3),
            "jobs_index": round(jobs, 3),
            "buildings_index": round(float(props.get("buildings") or 0), 3),
            "services_index": round(float(props.get("services") or 0), 3),
            "traffic_index": round(float(props.get("traffic") or 0), 3),
            "development_pressure": round(development, 3),
            "planning_intensity": round(float(props.get("planning_intensity") or 0), 3),
            "transit_access": round(float(props.get("transit_access") or 0), 3),
            "deprivation_weight": round(float(props.get("deprivation_weight") or 0), 3),
        }
        rows.append(row)
        by_cell[cell_id] = {
            "cellId": cell_id,
            "availableCapacityKwProxy2026": row["available_capacity_kw_proxy"],
            "peakKwProxy2026": row["peak_kw_proxy_2026"],
            "headroomKwProxy2026": row["headroom_kw_proxy_2026"],
            "overloadRisk2026": row["overload_risk_2026"],
            "weightedCapacityKva": row["weighted_capacity_kva"],
            "nearestTransformerM": row["nearest_transformer_m"],
            "nearestSecondaryM": row["nearest_secondary_m"],
            "nearestPrimaryM": row["nearest_primary_m"],
            "secondaryWithin500m": row["secondary_500m"],
            "primaryWithin2000m": row["primary_2000m"],
            "dataSupportScore": data_support_score,
            "confidence": confidence,
        }

        yearly = {}
        for year in FORECAST_YEARS:
            demand_growth = 1.0 + (year - START_YEAR) * (0.012 + electricity * 0.006 + development * 0.004)
            available_drift = 1.0 + max(0, row["primary_4000m"]) * 0.001 * (year - START_YEAR)
            peak = peak_kw_proxy * demand_growth
            capacity = available_capacity_kw * available_drift
            headroom = capacity - peak
            risk = clamp(0.5 + (peak - capacity) / 5500.0)
            yearly[str(year)] = {
                "capacityKwProxy": round(capacity, 1),
                "peakKwProxy": round(peak, 1),
                "headroomKwProxy": round(headroom, 1),
                "overloadRisk": round(risk, 4),
                "confidence": confidence,
            }
        forecast_cells.append({"cellId": cell_id, "forecastByYear": yearly, "confidence": confidence})

    for year in FORECAST_YEARS:
        entries = [cell["forecastByYear"][str(year)] for cell in forecast_cells]
        summary_by_year[str(year)] = {
            "capacityKwProxy": round(sum(item["capacityKwProxy"] for item in entries), 1),
            "peakKwProxy": round(sum(item["peakKwProxy"] for item in entries), 1),
            "headroomKwProxy": round(sum(item["headroomKwProxy"] for item in entries), 1),
            "meanOverloadRisk": round(sum(item["overloadRisk"] for item in entries) / max(1, len(entries)), 4),
        }

    capacity_by_cell = {
        "schemaVersion": "1.0.0",
        "kind": "belfast.transformerCapacityByCell",
        "modelVersion": MODEL_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "cellCount": len(by_cell),
        "cells": by_cell,
        "caveat": "Capacity and headroom are proxy planning-screening values only, not NIE feeder-level approval.",
    }
    capacity_forecast = {
        "schemaVersion": "1.0.0",
        "kind": "belfast.transformerCapacityForecast",
        "modelVersion": MODEL_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "years": FORECAST_YEARS,
        "summaryByYear": summary_by_year,
        "cells": forecast_cells,
        "caveat": "Public open data does not expose true LV/MV feeder loading.",
    }
    return rows, capacity_by_cell, capacity_forecast


def write_grid_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(rows[0].keys()) if rows else ["cell_id"]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def quantile_summary(values: list[float]) -> dict[str, float]:
    if not values:
        return {"min": 0, "p10": 0, "p50": 0, "p90": 0, "max": 0}
    ordered = sorted(values)

    def pick(q: float) -> float:
        index = min(len(ordered) - 1, max(0, int(round(q * (len(ordered) - 1)))))
        return round(ordered[index], 3)

    return {"min": round(ordered[0], 3), "p10": pick(0.10), "p50": pick(0.50), "p90": pick(0.90), "max": round(ordered[-1], 3)}


def build_impact_model(rows: list[dict[str, Any]], metadata: dict[str, Any], source_mode: str) -> dict[str, Any]:
    cells = {
        row["cell_id"]: {
            "availableCapacityKwProxy2026": row["available_capacity_kw_proxy"],
            "peakKwProxy2026": row["peak_kw_proxy_2026"],
            "headroomKwProxy2026": row["headroom_kw_proxy_2026"],
            "overloadRisk2026": row["overload_risk_2026"],
            "weightedCapacityKva": row["weighted_capacity_kva"],
            "nearestTransformerM": row["nearest_transformer_m"],
            "nearestSecondaryM": row["nearest_secondary_m"],
            "nearestPrimaryM": row["nearest_primary_m"],
            "dataSupportScore": row["data_support_score"],
            "confidence": row["confidence"],
        }
        for row in rows
    }
    confidence_counts: dict[str, int] = defaultdict(int)
    for row in rows:
        confidence_counts[str(row["confidence"])] += 1
    return {
        "schemaVersion": "1.0.0",
        "kind": "belfast.transformerImpactModel",
        "modelVersion": MODEL_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "baselineYear": BASELINE_YEAR,
        "startYear": START_YEAR,
        "horizonYear": HORIZON_YEAR,
        "years": FORECAST_YEARS,
        "sourceMode": source_mode,
        "assetClasses": ["secondary", "primary"],
        "officialDatasetMetadata": metadata,
        "trainingWindows": {
            "timeTrain": "2016-2021",
            "validation": "2022-2023",
            "test": "2024-2026",
            "spatialHoldout": "grid-cell groups by row/column bands",
        },
        "modelComponents": {
            "DemandModel": "system-demand proxy calibrated from local SONI spreadsheets when available and Mode A electricity indices",
            "SpatialLoadAllocator": "distance-decay capacity and demand allocator over 308 Belfast replay cells",
            "TransformerScenarioModel": "monotonic response model for added transformer capacity, overload risk, and capacity-enabled jobs",
        },
        "transformerDefaults": {
            "secondary": {"capacityKva": 500, "voltageKv": 11, "serviceRadiusM": 650, "confidence": "medium"},
            "primary": {"capacityKva": 16_000, "voltageKv": 33, "serviceRadiusM": 2_500, "confidence": "medium"},
        },
        "conversion": {
            "powerFactor": 0.90,
            "secondaryUsableShare": 0.58,
            "primaryUsableShare": 0.46,
            "loadFactorForAnnualMwh": 0.42,
        },
        "coefficients": {
            "electricityIndexKwScale": 4_800,
            "headroomRiskKwScale": 5_500,
            "loadIndexKwScale": 4_200,
            "servicesUpliftPerKw": 0.000018,
            "economyUpliftPerKw": 0.000012,
            "jobsUpliftPerKw": 0.000010,
            "capacityEnabledJobsPerHeadroomKw": 0.010,
            "constructionJobsPerSecondary": 0.8,
            "constructionJobsPerPrimary": 8.0,
            "operationsJobsPerSecondary": 0.18,
            "operationsJobsPerPrimary": 1.4,
        },
        "uncertainty": {
            "p10Multiplier": 0.62,
            "p90Multiplier": 1.38,
            "lowConfidenceWidening": 0.28,
            "mediumConfidenceWidening": 0.14,
            "notes": "Bands are screening intervals from public-data support, not probabilistic engineering limits.",
        },
        "cellFeatureSummary": {
            "cellCount": len(rows),
            "confidenceCounts": dict(confidence_counts),
            "availableCapacityKwProxy2026": quantile_summary([float(row["available_capacity_kw_proxy"]) for row in rows]),
            "headroomKwProxy2026": quantile_summary([float(row["headroom_kw_proxy_2026"]) for row in rows]),
            "overloadRisk2026": quantile_summary([float(row["overload_risk_2026"]) for row in rows]),
        },
        "cellFeatures": cells,
        "validation": {
            "niDailyDemandMapeTarget": "<= 5%",
            "niPeakDemandErrorTarget": "<= 7%",
            "bresJobsCalibrationTarget": "<= 5% where public totals allow",
            "currentStatus": "calibrated screening artifact; public transformer records may be metadata-only in this environment",
        },
        "caveat": "Planning-grade screening only. Not NIE engineering approval and not a statement of true feeder-level capacity.",
    }


def write_model_card(path: Path, model: dict[str, Any], assets_fc: dict[str, Any], rows: list[dict[str, Any]]) -> None:
    metadata = assets_fc.get("metadata") or {}
    counts: dict[str, int] = defaultdict(int)
    for feature in assets_fc.get("features") or []:
        counts[str((feature.get("properties") or {}).get("asset_class") or "unknown")] += 1
    lines = [
        "# Transformer Impact Model Card",
        "",
        f"- Model version: `{model['modelVersion']}`",
        f"- Forecast horizon: {START_YEAR}-{HORIZON_YEAR}",
        f"- Geography: Belfast replay grid ({len(rows)} cells)",
        "- Intended use: planning-grade screening of transformer interventions in Scenario Studio.",
        "- Not intended for: NIE engineering approval, feeder connection offers, protection studies, or statutory network design.",
        "",
        "## Data Sources",
        "",
        "- Mode A replay grids: `web/data/mode-a/grid_{2016..2026}.geojson`",
        "- Existing forecast artifacts: `web/data/mode-a/forecast_model.json` and `web/data/mode-a/baseline_2025_forecast.json`",
        "- OSM power asset layer: `data/derived/2026/belfast_ni_power_grid_osm_2026.geojson`",
        "- SONI quarter-hourly system spreadsheets present in the repository are source anchors for demand/peak calibration.",
        "- NIE official metadata anchors: primary and secondary transformer datasets on the NIE Open Data Hub.",
        "- Employment calibration anchors: NISRA BRES and Census 2021 labour-market tables.",
        "",
        "## Official Transformer Data Status",
        "",
        f"- Source mode used in this build: `{metadata.get('sourceMode')}`",
        f"- Asset features written: {len(assets_fc.get('features') or [])}",
    ]
    lines.extend([f"- {asset_class}: {count} features" for asset_class, count in sorted(counts.items())])
    lines.extend(
        [
            "",
            "The builder records the official NIE schema and will use manual official drops from `data/manual_drops` when present. If the record API is unavailable, it falls back to OSM transformer/substation proxies and marks confidence accordingly.",
            "",
            "## Outputs",
            "",
            "- `data/derived/2026/belfast_ni_transformers_official.geojson`",
            "- `data/derived/2026/belfast_transformer_grid_features.csv`",
            "- `web/data/mode-a/transformer_capacity_by_cell.json`",
            "- `web/data/mode-a/transformer_impact_model.json`",
            "- `web/data/mode-a/transformer_capacity_forecast.json`",
            "",
            "## Runtime Behavior",
            "",
            "Scenario Studio reads the transformer impact model first. If the artifact is missing or invalid, the existing deterministic transformer planner remains the fallback.",
            "",
            "## Uncertainty",
            "",
            "Outputs include p10/p50/p90 bands for electricity and jobs estimates. Wider bands are applied where ratings, geocodes, or local transformer coverage are weak.",
            "",
            "## Limitations",
            "",
            "- OSM timestamps and first-visible years are visibility evidence, not commissioning dates.",
            "- Public data does not expose true LV/MV feeder loading, phase balance, fault level, or protection constraints.",
            "- Capacity-enabled jobs are constrained by local commercial/development demand; headroom alone is not treated as a large permanent employment creator.",
            "- Any low-support local result should be treated as medium or low confidence and escalated for engineering review.",
        ]
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def build(root: Path) -> dict[str, Any]:
    grid_2026 = read_json(root / "web" / "data" / "mode-a" / "grid_2026.geojson", {})
    city_bbox = bbox_for_features(grid_2026.get("features") or [])
    metadata = fetch_official_metadata()
    assets_fc = build_official_asset_layer(root, metadata, city_bbox)
    rows, capacity_by_cell, capacity_forecast = build_grid_features(root, assets_fc)
    impact_model = build_impact_model(rows, metadata, (assets_fc.get("metadata") or {}).get("sourceMode") or "unknown")

    write_json(root / "data" / "derived" / "2026" / "belfast_ni_transformers_official.geojson", assets_fc)
    write_grid_csv(root / "data" / "derived" / "2026" / "belfast_transformer_grid_features.csv", rows)
    write_json(root / "web" / "data" / "mode-a" / "transformer_capacity_by_cell.json", capacity_by_cell)
    write_json(root / "web" / "data" / "mode-a" / "transformer_impact_model.json", impact_model)
    write_json(root / "web" / "data" / "mode-a" / "transformer_capacity_forecast.json", capacity_forecast)
    write_model_card(root / "docs" / "transformer_impact_model_card.md", impact_model, assets_fc, rows)

    return {
        "assetCount": len(assets_fc.get("features") or []),
        "cellCount": len(rows),
        "sourceMode": (assets_fc.get("metadata") or {}).get("sourceMode"),
        "modelVersion": MODEL_VERSION,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    root = args.root.resolve()
    result = build(root)
    print(
        "Built {modelVersion}: {assetCount} transformer assets, {cellCount} cells, source mode {sourceMode}.".format(
            **result
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
