#!/usr/bin/env python3
"""Build compact spatial replay indexes for Belfast 2016-2026.

The script intentionally uses only the Python standard library. It scans the
available raw data, summarizes GeoJSON feature collections without requiring
geospatial packages, records lightweight raster metadata, and writes stable
JSON manifests for downstream replay/export work.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


REPLAY_YEARS = list(range(2016, 2027))
CATALOG_VERSION = "0.1.0"
DEFAULT_HASH_MAX_BYTES = 10 * 1024 * 1024

EVENT_TABLES = [
    "planning_application_events",
    "osm_feature_version_events",
    "bike_trip_events",
    "bike_station_events",
    "pt_stop_events",
    "pt_route_events",
    "pt_timetable_events",
    "air_observation_events",
    "scenario_branch_events",
    "scenario_edit_events",
]

SNAPSHOT_TABLES = [
    "replay_zones",
    "annual_zone_snapshots",
    "annual_zone_indicators",
    "annual_osm_feature_snapshots",
    "annual_planning_application_snapshots",
    "annual_bike_station_snapshots",
    "annual_pt_stop_snapshots",
    "annual_pt_route_snapshots",
    "annual_air_zone_snapshots",
]


@dataclass(frozen=True)
class SourceFile:
    path: Path
    relative_path: str
    year: int | None
    dataset_id: str
    layer_kind: str
    file_format: str
    size_bytes: int


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Create compact Belfast 2016-2026 spatial replay catalog and timeline manifests."
    )
    parser.add_argument("--input", default="data", help="Raw data directory. Default: data")
    parser.add_argument(
        "--output",
        default="build/spatial_replay",
        help="Derived output directory. Default: build/spatial_replay",
    )
    parser.add_argument(
        "--source-manifest",
        action="append",
        default=[],
        help="Optional future source manifest JSON from the data-source branch. Can be repeated.",
    )
    parser.add_argument(
        "--hash-max-bytes",
        type=int,
        default=DEFAULT_HASH_MAX_BYTES,
        help="Only compute sha256 for files at or below this size. Default: 10485760.",
    )
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON outputs.")
    args = parser.parse_args(argv)

    input_dir = Path(args.input)
    output_dir = Path(args.output)
    catalog = build_catalog(
        input_dir=input_dir,
        source_manifest_paths=[Path(p) for p in args.source_manifest],
        hash_max_bytes=args.hash_max_bytes,
    )
    timeline = build_timeline_manifest(catalog)
    output_dir.mkdir(parents=True, exist_ok=True)

    write_json(output_dir / "catalog.json", catalog, pretty=args.pretty)
    write_json(output_dir / "timeline_manifest.json", timeline, pretty=args.pretty)
    print(f"Wrote {output_dir / 'catalog.json'}")
    print(f"Wrote {output_dir / 'timeline_manifest.json'}")
    return 0


def build_catalog(
    input_dir: Path,
    source_manifest_paths: Iterable[Path] = (),
    hash_max_bytes: int = DEFAULT_HASH_MAX_BYTES,
) -> dict[str, Any]:
    input_root_label = input_dir.as_posix()
    scan_root = input_dir.resolve()
    source_files = discover_source_files(scan_root)
    datasets = [summarize_source_file(item, scan_root, hash_max_bytes) for item in source_files]

    return {
        "catalog_version": CATALOG_VERSION,
        "study_area": "Belfast",
        "replay_years": REPLAY_YEARS,
        "input_root": input_root_label,
        "dataset_count": len(datasets),
        "datasets": datasets,
        "incoming_source_manifests": [
            summarize_source_manifest(path) for path in sorted(source_manifest_paths, key=lambda p: str(p))
        ],
        "contracts": {
            "source_manifest_schema": "schemas/source_manifest.schema.json",
            "sql_model": "schemas/replay_spatial_model.sql",
        },
    }


def discover_source_files(input_dir: Path) -> list[SourceFile]:
    if not input_dir.exists():
        raise FileNotFoundError(f"Input directory does not exist: {input_dir}")

    files: list[SourceFile] = []
    for path in sorted(input_dir.rglob("*")):
        if not path.is_file():
            continue
        suffix = path.suffix.lower().lstrip(".")
        if suffix not in {"geojson", "json", "tif", "tiff"}:
            continue
        relative_path = path.relative_to(input_dir).as_posix()
        files.append(
            SourceFile(
                path=path,
                relative_path=relative_path,
                year=infer_year(relative_path),
                dataset_id=slugify(path.stem),
                layer_kind=classify_layer(path),
                file_format=suffix,
                size_bytes=path.stat().st_size,
            )
        )
    return files


def summarize_source_file(item: SourceFile, input_dir: Path, hash_max_bytes: int) -> dict[str, Any]:
    base: dict[str, Any] = {
        "dataset_id": item.dataset_id,
        "source_path": item.relative_path,
        "source_year": item.year,
        "layer_kind": item.layer_kind,
        "format": item.file_format,
        "size_bytes": item.size_bytes,
        "sha256": sha256_if_small(item.path, item.size_bytes, hash_max_bytes),
    }

    if item.file_format in {"geojson", "json"}:
        base["vector_summary"] = summarize_geojson_file(item.path)
    elif item.file_format in {"tif", "tiff"}:
        base["raster_summary"] = summarize_raster_file(item.path)
    return base


def summarize_geojson_file(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    metadata = extract_geojson_collection_metadata(text)
    decoder = json.JSONDecoder()
    features_start = find_features_array_start(text)
    if features_start is None:
        return summarize_generic_json(text, metadata)

    feature_count = 0
    geometry_types: Counter[str] = Counter()
    property_keys: Counter[str] = Counter()
    osm_id_count = 0
    sample_feature_ids: list[str] = []
    bbox_acc = BBoxAccumulator()
    pos = features_start

    while pos < len(text):
        pos = skip_ws_and_commas(text, pos)
        if pos >= len(text) or text[pos] == "]":
            break
        feature, pos = decoder.raw_decode(text, pos)
        if not isinstance(feature, dict):
            continue
        feature_count += 1
        feature_id = feature.get("id")
        if feature_id is None:
            feature_id = feature.get("properties", {}).get("@id") if isinstance(feature.get("properties"), dict) else None
        if feature_id is not None and len(sample_feature_ids) < 5:
            sample_feature_ids.append(str(feature_id))

        properties = feature.get("properties")
        if isinstance(properties, dict):
            property_keys.update(str(key) for key in properties.keys())
            if "@id" in properties:
                osm_id_count += 1

        geometry = feature.get("geometry")
        if isinstance(geometry, dict):
            geometry_type = str(geometry.get("type") or "Unknown")
            geometry_types[geometry_type] += 1
            bbox_acc.update_from_geometry(geometry)
        else:
            geometry_types["None"] += 1

    return {
        **metadata,
        "feature_count": feature_count,
        "geometry_types": sorted_counter(geometry_types),
        "property_keys_top": sorted_counter(property_keys, limit=40),
        "osm_id_count": osm_id_count,
        "sample_feature_ids": sample_feature_ids,
        "bbox": bbox_acc.as_list(),
    }


def summarize_generic_json(text: str, metadata: dict[str, Any]) -> dict[str, Any]:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        return {**metadata, "json_parse_error": str(exc)}

    if isinstance(payload, list):
        return {**metadata, "record_count": len(payload), "json_shape": "array"}
    if isinstance(payload, dict):
        return {
            **metadata,
            "json_shape": "object",
            "top_level_keys": sorted(str(key) for key in payload.keys()),
        }
    return {**metadata, "json_shape": type(payload).__name__}


def extract_geojson_collection_metadata(text: str) -> dict[str, Any]:
    metadata: dict[str, Any] = {"json_type": extract_top_level_string(text, "type")}
    for key in ("generator", "timestamp", "copyright", "name"):
        value = extract_top_level_string(text, key)
        if value is not None:
            metadata[key] = value
    collection_bbox = extract_top_level_bbox(text)
    if collection_bbox is not None:
        metadata["collection_bbox"] = collection_bbox
    return metadata


def find_features_array_start(text: str) -> int | None:
    match = re.search(r'"features"\s*:', text)
    if not match:
        return None
    pos = match.end()
    while pos < len(text) and text[pos].isspace():
        pos += 1
    if pos >= len(text) or text[pos] != "[":
        return None
    return pos + 1


def skip_ws_and_commas(text: str, pos: int) -> int:
    while pos < len(text) and (text[pos].isspace() or text[pos] == ","):
        pos += 1
    return pos


class BBoxAccumulator:
    def __init__(self) -> None:
        self.min_x: float | None = None
        self.min_y: float | None = None
        self.max_x: float | None = None
        self.max_y: float | None = None

    def update_from_geometry(self, geometry: dict[str, Any]) -> None:
        bbox = geometry.get("bbox")
        if is_bbox(bbox):
            self.update_point(float(bbox[0]), float(bbox[1]))
            self.update_point(float(bbox[2]), float(bbox[3]))
            return
        self.update_from_coordinates(geometry.get("coordinates"))

    def update_from_coordinates(self, coordinates: Any) -> None:
        if not isinstance(coordinates, list):
            return
        if len(coordinates) >= 2 and all(isinstance(value, (int, float)) for value in coordinates[:2]):
            self.update_point(float(coordinates[0]), float(coordinates[1]))
            return
        for child in coordinates:
            self.update_from_coordinates(child)

    def update_point(self, x: float, y: float) -> None:
        self.min_x = x if self.min_x is None else min(self.min_x, x)
        self.min_y = y if self.min_y is None else min(self.min_y, y)
        self.max_x = x if self.max_x is None else max(self.max_x, x)
        self.max_y = y if self.max_y is None else max(self.max_y, y)

    def as_list(self) -> list[float] | None:
        if self.min_x is None or self.min_y is None or self.max_x is None or self.max_y is None:
            return None
        return [round(value, 7) for value in (self.min_x, self.min_y, self.max_x, self.max_y)]


def summarize_raster_file(path: Path) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "file_name": path.name,
        "metadata_strategy": "file_stats_and_tiff_header_only",
    }
    tiff_header = read_tiff_header(path)
    if tiff_header:
        summary.update(tiff_header)
    return summary


def read_tiff_header(path: Path) -> dict[str, Any]:
    try:
        with path.open("rb") as handle:
            header = handle.read(8)
            if len(header) < 8:
                return {"tiff_parse_error": "file_too_short"}
            endian_marker = header[:2]
            if endian_marker == b"II":
                endian = "<"
            elif endian_marker == b"MM":
                endian = ">"
            else:
                return {"tiff_parse_error": "missing_tiff_endian_marker"}
            magic = struct.unpack(endian + "H", header[2:4])[0]
            if magic != 42:
                return {"tiff_magic": magic, "tiff_parse_note": "classic_tiff_header_not_detected"}
            ifd_offset = struct.unpack(endian + "I", header[4:8])[0]
            handle.seek(ifd_offset)
            entry_count_bytes = handle.read(2)
            if len(entry_count_bytes) < 2:
                return {"tiff_parse_error": "missing_ifd_entry_count"}
            entry_count = struct.unpack(endian + "H", entry_count_bytes)[0]
            tags: dict[int, Any] = {}
            for _ in range(entry_count):
                entry = handle.read(12)
                if len(entry) < 12:
                    break
                tag, value_type, count, raw_value = struct.unpack(endian + "HHI4s", entry)
                value = decode_inline_tiff_value(endian, value_type, count, raw_value)
                if value is not None:
                    tags[tag] = value
    except OSError as exc:
        return {"tiff_parse_error": str(exc)}

    named_tags = {
        "tiff_magic": magic,
        "image_width": tags.get(256),
        "image_height": tags.get(257),
        "bits_per_sample": tags.get(258),
        "compression": tags.get(259),
        "photometric_interpretation": tags.get(262),
        "samples_per_pixel": tags.get(277),
        "planar_configuration": tags.get(284),
    }
    return {key: value for key, value in named_tags.items() if value is not None}


def decode_inline_tiff_value(endian: str, value_type: int, count: int, raw_value: bytes) -> Any:
    # Inline IFD values fit in the four-byte value field. Larger arrays point
    # elsewhere in the file and are intentionally skipped for lightweight scans.
    if value_type == 3 and count == 1:  # SHORT
        return struct.unpack(endian + "H", raw_value[:2])[0]
    if value_type == 4 and count == 1:  # LONG
        return struct.unpack(endian + "I", raw_value)[0]
    return None


def build_timeline_manifest(catalog: dict[str, Any]) -> dict[str, Any]:
    datasets_by_year: dict[int, list[dict[str, Any]]] = {year: [] for year in REPLAY_YEARS}
    for dataset in catalog["datasets"]:
        year = dataset.get("source_year")
        if year in datasets_by_year:
            datasets_by_year[year].append(dataset)

    snapshots = []
    for year in REPLAY_YEARS:
        datasets = datasets_by_year[year]
        layer_counts = Counter(dataset["layer_kind"] for dataset in datasets)
        snapshots.append(
            {
                "year": year,
                "status": "observed_source_available" if datasets else "awaiting_source_manifest",
                "source_dataset_ids": [dataset["dataset_id"] for dataset in datasets],
                "layer_kind_counts": dict(sorted(layer_counts.items())),
                "snapshot_tables": SNAPSHOT_TABLES,
            }
        )

    return {
        "manifest_version": CATALOG_VERSION,
        "study_area": catalog["study_area"],
        "year_start": REPLAY_YEARS[0],
        "year_end": REPLAY_YEARS[-1],
        "annual_snapshots": snapshots,
        "event_tables": EVENT_TABLES,
        "spatial_delta_jobs": build_delta_jobs(snapshots),
        "static_replay_exports": [
            {
                "asset_id": "annual_snapshot_tiles",
                "contract": "one static vector/raster summary bundle per replay year",
                "status": "blocked_until_renderer_branch",
            },
            {
                "asset_id": "year_to_year_delta_layers",
                "contract": "added/removed/changed geometries and indicator deltas",
                "status": "ready_for_etl_when_adjacent_years_available",
            },
            {
                "asset_id": "provenance_index",
                "contract": "dataset-level source paths, source manifests, and checksums where small enough",
                "status": "created_by_this_etl",
            },
        ],
        "source_manifest_contract": {
            "schema_path": "schemas/source_manifest.schema.json",
            "merge_expectation": "data-source branch may pass one or more manifest JSON files via --source-manifest without changing this ETL contract.",
        },
    }


def build_delta_jobs(snapshots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    jobs = []
    by_year = {snapshot["year"]: snapshot for snapshot in snapshots}
    for year in REPLAY_YEARS[:-1]:
        next_year = year + 1
        current_ready = bool(by_year[year]["source_dataset_ids"])
        next_ready = bool(by_year[next_year]["source_dataset_ids"])
        jobs.append(
            {
                "from_year": year,
                "to_year": next_year,
                "status": "ready" if current_ready and next_ready else "awaiting_adjacent_sources",
                "delta_tables": [
                    "spatial_feature_deltas",
                    "zone_indicator_deltas",
                    "network_accessibility_deltas",
                ],
            }
        )
    return jobs


def summarize_source_manifest(path: Path) -> dict[str, Any]:
    summary: dict[str, Any] = {"path": str(path), "status": "missing"}
    if not path.exists():
        return summary
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {**summary, "status": "unreadable", "error": str(exc)}
    required = {"manifest_version", "source_batch_id", "study_area", "sources"}
    missing = sorted(required - set(payload.keys())) if isinstance(payload, dict) else sorted(required)
    return {
        "path": str(path),
        "status": "loaded_with_contract_warnings" if missing else "loaded",
        "missing_required_keys": missing,
        "source_count": len(payload.get("sources", [])) if isinstance(payload, dict) else None,
        "source_batch_id": payload.get("source_batch_id") if isinstance(payload, dict) else None,
    }


def infer_year(value: str) -> int | None:
    matches = [int(match) for match in re.findall(r"(?<!\d)(20\d{2})(?!\d)", value)]
    for year in matches:
        if 2000 <= year <= 2099:
            return year
    return None


def classify_layer(path: Path) -> str:
    name = path.stem.lower()
    suffix = path.suffix.lower()
    if suffix in {".tif", ".tiff"}:
        if "ndvi" in name:
            return "raster_indicator_ndvi"
        if "ndbi" in name:
            return "raster_indicator_ndbi"
        if "rgb" in name:
            return "raster_basemap_rgb"
        return "raster_observation"
    if "boundary" in name or "boudnary" in name:
        return "zone_boundary"
    if "transportstop" in name or "transitstop" in name:
        return "pt_stop"
    if "transitroute" in name or "route" in name:
        return "pt_route"
    if "cycleway" in name:
        return "active_travel_network"
    if "road" in name or "bridge" in name:
        return "road_network"
    if "building" in name:
        return "building_footprint"
    if "green" in name or "water" in name or "landuse" in name:
        return "land_cover"
    if "development" in name or "commercial" in name:
        return "planning_or_land_market"
    if "education" in name or "healthcare" in name or "publicservice" in name or "landmark" in name or "places" in name:
        return "poi"
    return "osm_feature"


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", value.strip().lower()).strip("_")
    return slug or "dataset"


def sha256_if_small(path: Path, size_bytes: int, hash_max_bytes: int) -> dict[str, Any]:
    if hash_max_bytes < 0 or size_bytes > hash_max_bytes:
        return {"status": "skipped", "reason": "file_larger_than_hash_max_bytes"}
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"status": "computed", "value": digest.hexdigest()}


def sorted_counter(counter: Counter[str], limit: int | None = None) -> list[dict[str, Any]]:
    items = sorted(counter.items(), key=lambda item: (-item[1], item[0]))
    if limit is not None:
        items = items[:limit]
    return [{"name": key, "count": count} for key, count in items]


def extract_top_level_string(text: str, key: str) -> str | None:
    match = re.search(rf'"{re.escape(key)}"\s*:\s*"((?:[^"\\]|\\.)*)"', text)
    if not match:
        return None
    try:
        return json.loads(f'"{match.group(1)}"')
    except json.JSONDecodeError:
        return match.group(1)


def extract_top_level_bbox(text: str) -> list[float] | None:
    match = re.search(r'"bbox"\s*:\s*\[([^\]]+)\]', text[:4096])
    if not match:
        return None
    try:
        values = [float(part.strip()) for part in match.group(1).split(",")]
    except ValueError:
        return None
    return [round(value, 7) for value in values] if is_bbox(values) else None


def is_bbox(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) >= 4
        and all(isinstance(part, (int, float)) for part in value[:4])
    )


def write_json(path: Path, payload: dict[str, Any], pretty: bool = False) -> None:
    kwargs = {"sort_keys": True}
    if pretty:
        kwargs["indent"] = 2
    path.write_text(json.dumps(payload, **kwargs) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
