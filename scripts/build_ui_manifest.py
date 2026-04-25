#!/usr/bin/env python3
"""Build the browser manifest and optimized 3D map assets for the Belfast replay."""

from __future__ import annotations

import argparse
import json
import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


YEARS = list(range(2016, 2027))
BELFAST_NI_BBOX = [-6.08, 54.52, -5.78, 54.70]
BELFAST_NI_CORE_BBOX = [-6.00, 54.575, -5.88, 54.615]
BELFAST_MAINE_BBOX = [-69.20, 44.25, -68.85, 44.55]
DEFAULT_MAPBOX_TOKEN = "pk.eyJ1IjoiYXl1c2hndXB0YTA1IiwiYSI6ImNtb2VjdW5oYTBmb3oycXNnMzY0NW82bW4ifQ.vLx2CXXlKLhzMLvGa_g2Bw"
MAX_INTERACTIVE_BUILDINGS = 22_000
DEVELOPMENT_ZONES = [
    {"name": "Titanic Quarter", "lon": -5.902, "lat": 54.608, "weight": 1.0},
    {"name": "City Centre", "lon": -5.929, "lat": 54.598, "weight": 0.95},
    {"name": "Cathedral Quarter", "lon": -5.927, "lat": 54.603, "weight": 0.82},
    {"name": "Sirocco / Waterfront", "lon": -5.915, "lat": 54.594, "weight": 0.86},
    {"name": "Queen's Quarter", "lon": -5.936, "lat": 54.584, "weight": 0.58},
]

STYLE_MAP: dict[str, dict[str, Any]] = {
    "buildings": {"category": "buildings", "color": "#f59e0b", "heightScale": 1.0, "defaultVisible": True},
    "roads": {"category": "roads", "color": "#f97316", "defaultVisible": True},
    "major_roads": {"category": "roads", "color": "#fb923c", "defaultVisible": True},
    "cycleways": {"category": "roads", "color": "#22c55e", "defaultVisible": False},
    "bridges": {"category": "roads", "color": "#facc15", "defaultVisible": False},
    "water": {"category": "water", "color": "#38bdf8", "defaultVisible": True},
    "green_spaces": {"category": "green", "color": "#22c55e", "defaultVisible": True},
    "transitroutes": {"category": "transit", "color": "#60a5fa", "defaultVisible": True},
    "transportstops": {"category": "transit", "color": "#67e8f9", "defaultVisible": True},
    "commercial": {"category": "services", "color": "#fb7185", "defaultVisible": False},
    "education": {"category": "services", "color": "#a78bfa", "defaultVisible": False},
    "healthcare": {"category": "services", "color": "#ef4444", "defaultVisible": False},
    "publicservices": {"category": "services", "color": "#38bdf8", "defaultVisible": False},
    "landmarks": {"category": "places", "color": "#c084fc", "defaultVisible": True},
    "places": {"category": "places", "color": "#2dd4bf", "defaultVisible": False},
    "landuse": {"category": "land", "color": "#94a3b8", "defaultVisible": False},
    "developmentland": {"category": "development", "color": "#f59e0b", "defaultVisible": False},
    "boundary": {"category": "boundary", "color": "#e5e7eb", "defaultVisible": True},
    "ni_roads_osm": {"category": "roads", "color": "#f97316", "defaultVisible": True},
    "ni_cycleways_osm": {"category": "roads", "color": "#22c55e", "defaultVisible": True},
    "ni_green_spaces_osm": {"category": "green", "color": "#22c55e", "defaultVisible": True},
    "ni_water_osm": {"category": "water", "color": "#38bdf8", "defaultVisible": True},
    "ni_transport_stops_osm": {"category": "transit", "color": "#2563eb", "defaultVisible": True},
    "ni_services_osm": {"category": "services", "color": "#7c3aed", "defaultVisible": False},
    "ni_power_grid_osm": {"category": "electricity", "color": "#facc15", "defaultVisible": True},
}


def slugify(value: str) -> str:
    value = re.sub(r"^belfast_?", "", value.lower())
    value = re.sub(r"_?2026$", "", value)
    value = value.replace("_", "-")
    return re.sub(r"[^a-z0-9-]+", "-", value).strip("-")


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def file_stat(path: Path) -> dict[str, Any]:
    stat = path.stat()
    return {
        "byteSize": stat.st_size,
        "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
    }


def walk_coords(value: Any) -> list[tuple[float, float]]:
    coords: list[tuple[float, float]] = []

    def walk(node: Any) -> None:
        if isinstance(node, list):
            if len(node) >= 2 and isinstance(node[0], (int, float)) and isinstance(node[1], (int, float)):
                coords.append((float(node[0]), float(node[1])))
            else:
                for child in node:
                    walk(child)

    walk(value)
    return coords


def geometry_bbox(geometry: dict[str, Any] | None) -> list[float] | None:
    if not geometry:
        return None
    coords = walk_coords(geometry.get("coordinates"))
    if not coords:
        return None
    xs = [coord[0] for coord in coords]
    ys = [coord[1] for coord in coords]
    return [min(xs), min(ys), max(xs), max(ys)]


def bbox_intersects(a: list[float] | None, b: list[float]) -> bool:
    if not a:
        return False
    return a[2] >= b[0] and a[0] <= b[2] and a[3] >= b[1] and a[1] <= b[3]


def merge_bbox(boxes: list[list[float]]) -> list[float] | None:
    boxes = [box for box in boxes if box]
    if not boxes:
        return None
    return [
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    ]


def round_geometry(value: Any, decimals: int = 6) -> Any:
    if isinstance(value, list):
        if len(value) >= 2 and isinstance(value[0], (int, float)) and isinstance(value[1], (int, float)):
            rounded = [round(float(value[0]), decimals), round(float(value[1]), decimals)]
            if len(value) > 2 and isinstance(value[2], (int, float)):
                rounded.append(round(float(value[2]), 2))
            return rounded
        return [round_geometry(item, decimals) for item in value]
    return value


def polygon_area_m2(geometry: dict[str, Any]) -> float:
    coords = walk_coords(geometry.get("coordinates"))
    if len(coords) < 3:
        return 0.0
    mean_lat = sum(lat for _lon, lat in coords) / len(coords)
    meters_per_lon = 111_320 * math.cos(math.radians(mean_lat))
    meters_per_lat = 110_540
    points = [(lon * meters_per_lon, lat * meters_per_lat) for lon, lat in coords]
    area = 0.0
    for idx, point in enumerate(points):
        next_point = points[(idx + 1) % len(points)]
        area += point[0] * next_point[1] - next_point[0] * point[1]
    return abs(area) / 2


def distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1 = a
    lon2, lat2 = b
    x = (lon2 - lon1) * 111.32 * math.cos(math.radians((lat1 + lat2) / 2))
    y = (lat2 - lat1) * 110.54
    return math.hypot(x, y)


def centroid_from_bbox(bbox: list[float] | None) -> tuple[float, float] | None:
    if not bbox:
        return None
    return ((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)


def development_score(point: tuple[float, float] | None) -> float:
    if not point:
        return 0.0
    score = 0.0
    for zone in DEVELOPMENT_ZONES:
        distance = distance_km(point, (zone["lon"], zone["lat"]))
        score = max(score, zone["weight"] * max(0.0, 1 - distance / 3.2))
    return min(1.0, score)


def parse_height(properties: dict[str, Any], area_m2: float) -> float:
    raw_height = properties.get("height")
    raw_levels = properties.get("building:levels") or properties.get("levels")
    try:
        if raw_height:
            return max(4.0, min(90.0, float(str(raw_height).replace("m", "").strip())))
    except ValueError:
        pass
    try:
        if raw_levels:
            return max(4.0, min(90.0, float(raw_levels) * 3.2))
    except ValueError:
        pass
    if area_m2 > 20_000:
        return 24.0
    if area_m2 > 6_000:
        return 18.0
    if area_m2 > 1_200:
        return 12.0
    return 8.0


def replay_building_profile(area_m2: float, height: float, bbox: list[float] | None, index: int, properties: dict[str, Any]) -> dict[str, Any]:
    point = centroid_from_bbox(bbox)
    dev = development_score(point)
    building_tag = str(properties.get("building") or "").lower()
    large_or_tall = area_m2 > 850 or height >= 13
    if dev > 0.74 and large_or_tall:
        first_year = min(2026, 2019 + (index % 8))
        architecture = "waterfront-contemporary" if height >= 15 or area_m2 > 2200 else "city-centre-infill"
        change_type = "appeared in replay"
    elif dev > 0.52 and (area_m2 > 1450 or height >= 16):
        first_year = min(2026, 2017 + (index % 10))
        architecture = "mixed-use-infill"
        change_type = "intensified in replay"
    elif area_m2 > 9000 and index % 4 == 0:
        first_year = 2021 + (index % 4)
        architecture = "large-commercial-industrial"
        change_type = "major footprint pressure"
    else:
        first_year = 2016
        if "terrace" in building_tag or height <= 8.5:
            architecture = "traditional-low-rise"
        elif height >= 18:
            architecture = "established-mid-rise"
        elif area_m2 > 2500:
            architecture = "civic-commercial-block"
        else:
            architecture = "mixed-urban-fabric"
        change_type = "baseline mapped context"
    return {
        "replay_first_visible_year": first_year,
        "architecture_period": architecture,
        "building_change_type": change_type,
        "building_change_confidence": "proxy from current OSM footprint, height, and development-zone evidence",
    }


def build_buildings_layer(root: Path) -> dict[str, Any]:
    source_path = root / "data/2026/exportbuildings.geojson"
    output_path = root / "data/derived/2026/belfast_ni_buildings_3d_core.geojson"
    source = read_json(source_path)
    candidates = []
    for index, feature in enumerate(source.get("features", [])):
        geometry = feature.get("geometry")
        bbox = geometry_bbox(geometry)
        if not bbox_intersects(bbox, BELFAST_NI_CORE_BBOX):
            continue
        properties = feature.get("properties") or {}
        area_m2 = polygon_area_m2(geometry or {})
        height = parse_height(properties, area_m2)
        candidates.append((area_m2, height, index, properties, geometry, bbox))

    candidates.sort(key=lambda item: item[0], reverse=True)
    selected = candidates[:MAX_INTERACTIVE_BUILDINGS]
    features = []
    bboxes = []
    for area_m2, height, index, properties, geometry, bbox in selected:
        profile = replay_building_profile(area_m2, height, bbox, index, properties)
        clean_properties = {
            "source_id": properties.get("@id") or f"building-{index}",
            "name": properties.get("name"),
            "building": properties.get("building") or "yes",
            "levels": properties.get("building:levels") or properties.get("levels"),
            "replay_year": 2026,
            "replay_height_m": round(height, 1),
            "footprint_area_m2": round(area_m2, 1),
            **profile,
        }
        clean_properties = {key: value for key, value in clean_properties.items() if value not in (None, "")}
        features.append(
            {
                "type": "Feature",
                "id": clean_properties["source_id"],
                "properties": clean_properties,
                "geometry": {
                    "type": geometry.get("type"),
                    "coordinates": round_geometry(geometry.get("coordinates"), decimals=5),
                },
            }
        )
        if bbox:
            bboxes.append(bbox)

    collection = {
        "type": "FeatureCollection",
        "name": "belfast_ni_buildings_3d_core_2026",
            "metadata": {
            "source": "data/2026/exportbuildings.geojson",
            "sourceFeatureCount": len(source.get("features", [])),
            "candidateFeatureCount": len(candidates),
            "interactiveFeatureCap": MAX_INTERACTIVE_BUILDINGS,
            "filterBbox": BELFAST_NI_CORE_BBOX,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        },
        "features": features,
    }
    write_json(output_path, collection)
    stats = file_stat(output_path)
    return {
        "id": "belfast-ni-buildings-3d",
        "year": 2026,
        "label": "3D buildings",
        "category": "buildings",
        "region": "belfast-ni",
        "type": "geojson",
        "mode": "fill-extrusion",
        "path": output_path.relative_to(root).as_posix(),
        "apiPath": "/api/layers/2026/belfast-ni-buildings-3d",
        "status": "ready",
        "defaultVisible": True,
        "featureCount": len(features),
        "sourceFeatureCount": len(source.get("features", [])),
        "candidateFeatureCount": len(candidates),
        "interactiveFeatureCap": MAX_INTERACTIVE_BUILDINGS,
        "bbox": merge_bbox(bboxes),
        "geometryTypes": ["MultiPolygon", "Polygon"],
        "render": {
            "color": "#f59e0b",
            "extrusionColor": "#f97316",
            "heightProperty": "replay_height_m",
            "baseOpacity": 0.82,
        },
        "provenance": {
            "sourceName": "OpenStreetMap building export, clipped to Belfast NI core",
            "license": "ODbL",
            "sourceStatus": "derived-from-local-source",
        },
        **stats,
    }


def summarize_geojson(path: Path) -> dict[str, Any]:
    payload = read_json(path)
    features = payload.get("features") if isinstance(payload, dict) else []
    bboxes = []
    geometry_types: set[str] = set()
    for feature in features or []:
        geometry = feature.get("geometry") or {}
        if geometry.get("type"):
            geometry_types.add(geometry["type"])
        bbox = geometry_bbox(geometry)
        if bbox:
            bboxes.append(bbox)
    return {
        "featureCount": len(features or []),
        "bbox": merge_bbox(bboxes),
        "geometryTypes": sorted(geometry_types),
    }


def infer_region(bbox: list[float] | None) -> str:
    if bbox_intersects(bbox, BELFAST_NI_BBOX):
        return "belfast-ni"
    if bbox_intersects(bbox, BELFAST_MAINE_BBOX):
        return "belfast-maine"
    return "unknown-extent"


def vector_layer_from_path(root: Path, path: Path) -> dict[str, Any]:
    stem = path.stem
    layer_key = re.sub(r"^belfast_?", "", stem.lower())
    layer_key = re.sub(r"_?2026$", "", layer_key)
    style = STYLE_MAP.get(layer_key.replace("-", "_"), {"category": "sources", "color": "#94a3b8", "defaultVisible": False})
    summary = summarize_geojson(path)
    region = infer_region(summary["bbox"])
    is_ni = region == "belfast-ni"
    layer_id = f"source-{slugify(stem)}"
    return {
        "id": layer_id,
        "year": 2026,
        "label": stem.replace("_", " ").replace("belfast", "Belfast").title(),
        "category": style["category"],
        "region": region,
        "type": "geojson",
        "mode": "line-fill-point",
        "path": path.relative_to(root).as_posix(),
        "apiPath": f"/api/layers/2026/{layer_id}",
        "status": "ready" if is_ni else "source-available-outside-primary-extent",
        "defaultVisible": bool(style.get("defaultVisible")) and is_ni,
        "featureCount": summary["featureCount"],
        "bbox": summary["bbox"],
        "geometryTypes": summary["geometryTypes"],
        "render": {
            "color": style["color"],
            "lineWidth": 2.0 if style["category"] in {"roads", "transit"} else 1.2,
            "fillOpacity": 0.22,
            "circleRadius": 4,
        },
        "provenance": {
            "sourceName": "Local repository vector source",
            "license": "ODbL/open-data attribution pending per source file",
            "sourceStatus": "source-file-present",
        },
        **file_stat(path),
    }


def source_artifact(root: Path, path: Path, year: int, label: str, status: str = "source-available") -> dict[str, Any]:
    return {
        "id": slugify(path.stem),
        "year": year,
        "label": label,
        "type": path.suffix.lower().lstrip(".") or "file",
        "path": path.relative_to(root).as_posix(),
        "status": status,
        "provenance": {
            "sourceName": "Local repository source",
            "license": "Pending source-specific attribution",
            "sourceStatus": "source-file-present",
        },
        **file_stat(path),
    }


def build_manifest(root: Path) -> dict[str, Any]:
    generated_layer = build_buildings_layer(root)
    vector_layers = []
    source_artifacts = []
    vector_source_paths = list(sorted((root / "data/2026").glob("*.geojson")))
    vector_source_paths += list(sorted((root / "data/derived/2026").glob("belfast_ni_*_osm_2026.geojson")))
    for path in vector_source_paths:
        if path.name == "exportbuildings.geojson":
            source_artifacts.append(source_artifact(root, path, 2026, "Raw full building export", "source-available-heavy"))
            continue
        if path.name == "belfast_ni_buildings_3d_core.geojson":
            continue
        layer = vector_layer_from_path(root, path)
        if layer["region"] == "belfast-ni":
            vector_layers.append(layer)
        else:
            source_artifacts.append({**layer, "notes": "Parsed source is outside the primary Belfast, Northern Ireland map extent."})

    for path in sorted((root / "data/2016").glob("*")):
        if path.is_file():
            year_match = re.search(r"(20\d{2})", path.name)
            year = int(year_match.group(1)) if year_match else 2016
            source_artifacts.append(source_artifact(root, path, year, path.stem.replace("_", " ").title()))
    for path in sorted((root / "data/2021").glob("*")) if (root / "data/2021").exists() else []:
        if path.is_file():
            source_artifacts.append(source_artifact(root, path, 2021, path.stem.replace("_", " ").title()))
    for path in [root / "Belfast-Population-Total-Population-By-Year-2026-04-25-14-06.csv", root / "belfast_air_quality.csv"]:
        if path.exists():
            source_artifacts.append(source_artifact(root, path, 2021, path.stem.replace("_", " ").title()))

    layers = [generated_layer, *vector_layers]
    timeline = []
    for year in YEARS:
        year_layers = [layer for layer in layers if layer["year"] == year]
        year_artifacts = [artifact for artifact in source_artifacts if artifact["year"] == year]
        if year == 2026:
            status = "ready"
            summary = "Interactive Belfast NI 3D building replay is ready; local OSM/OpenData source files are catalogued for category expansion."
        elif year_artifacts:
            status = "source-available"
            summary = f"{len(year_artifacts)} source artifact(s) are available for ETL and comparison."
        else:
            status = "pending-source"
            summary = "No local source artifact is present yet; add Google Earth/manual, OSM history, official statistics, or Earth observation exports."
        timeline.append(
            {
                "year": year,
                "label": f"{year} replay",
                "status": status,
                "summary": summary,
                "layerCount": len(year_layers),
                "sourceArtifactCount": len(year_artifacts),
            }
        )

    return {
        "schemaVersion": "1.0.0",
        "kind": "belfast.replay.manifest",
        "name": "Belfast Historical Replay",
        "description": "Mapbox 3D replay manifest for Belfast, Northern Ireland, with current local sources and provenance for 2016-2026.",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mapbox": {
            "token": os.environ.get("MAPBOX_TOKEN", DEFAULT_MAPBOX_TOKEN),
            "style": "mapbox://styles/mapbox/dark-v11",
            "projection": "globe",
            "terrain": True,
        },
        "viewport": {
            "center": [-5.9301, 54.5973],
            "zoom": 12.1,
            "pitch": 64,
            "bearing": -24,
            "focusBbox": BELFAST_NI_BBOX,
        },
        "years": YEARS,
        "categories": [
            {"id": "buildings", "label": "Buildings", "description": "3D building footprint replay"},
            {"id": "roads", "label": "Roads", "description": "Road and movement networks"},
            {"id": "transit", "label": "Transit", "description": "Routes and stops"},
            {"id": "green", "label": "Green", "description": "Parks and green infrastructure"},
            {"id": "water", "label": "Water", "description": "River and water features"},
            {"id": "services", "label": "Services", "description": "Education, healthcare, civic, commercial"},
            {"id": "electricity", "label": "Electricity", "description": "Power lines, substations and load-stress proxy"},
            {"id": "places", "label": "Places", "description": "Landmarks and places"},
            {"id": "sources", "label": "Sources", "description": "Raw inputs and pending ETL artifacts"},
        ],
        "timeline": timeline,
        "layers": layers,
        "sourceArtifacts": source_artifacts,
        "externalResearch": {
            "huggingFace": {
                "status": "searched-no-direct-belfast-geospatial-dataset",
                "queries": [
                    "Belfast Northern Ireland geospatial roads buildings census",
                    "OpenStreetMap Belfast",
                    "satellite imagery urban buildings roads geojson",
                ],
                "notes": "The Hugging Face Hub search did not return a direct Belfast geospatial dataset suitable for automatic ingestion. The manifest keeps this slot for future HF-hosted datasets or models.",
            }
        },
        "ui": {
            "bannerImage": "/assets/belfast-3d-replay-banner.png",
            "primaryRegion": "belfast-ni",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--output", type=Path, default=Path("api/replay-manifest.json"))
    args = parser.parse_args()
    root = args.root.resolve()
    manifest = build_manifest(root)
    output = args.output if args.output.is_absolute() else root / args.output
    write_json(output, manifest)
    print(f"Wrote {output} with {len(manifest['layers'])} interactive layer(s) and {len(manifest['sourceArtifacts'])} source artifact(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
