#!/usr/bin/env python3
"""Index local data-source files and write a normalized provenance manifest.

The script is intentionally offline-first: it never downloads remote datasets.
It scans local repository data and manual drops, computes deterministic
fingerprints, and extracts lightweight metadata where file size permits.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable


DEFAULT_INVENTORY = Path("config/source_inventory.json")
DEFAULT_OUTPUT = Path("manifests/provenance_manifest.json")
DEFAULT_SCAN_DIRS = ("data",)
SUPPORTED_SUFFIXES = {
    ".csv",
    ".geojson",
    ".gpkg",
    ".jpg",
    ".jpeg",
    ".json",
    ".kml",
    ".kmz",
    ".md",
    ".pdf",
    ".png",
    ".shp",
    ".tif",
    ".tiff",
    ".txt",
    ".xlsx",
    ".xml",
    ".zip",
}
YEAR_RE = re.compile(r"(?<!\d)(20(?:1[6-9]|2[0-6]))(?!\d)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Index Belfast replay source data and write provenance JSON."
    )
    parser.add_argument(
        "--root",
        default=".",
        help="Repository root to scan. Defaults to the current directory.",
    )
    parser.add_argument(
        "--inventory",
        default=str(DEFAULT_INVENTORY),
        help="Source inventory JSON path, relative to --root unless absolute.",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="Manifest output JSON path, relative to --root unless absolute.",
    )
    parser.add_argument(
        "--scan-dir",
        action="append",
        dest="scan_dirs",
        help="Directory to scan, relative to --root unless absolute. Can be repeated.",
    )
    parser.add_argument(
        "--max-geojson-bytes",
        type=int,
        default=5_000_000,
        help="Maximum GeoJSON/JSON file size to parse for feature metadata.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build and validate the manifest but print a summary instead of writing JSON.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Only print errors.",
    )
    return parser.parse_args()


def resolve_path(root: Path, value: str | Path) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return root / path


def repo_relative(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def load_inventory(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        inventory = json.load(handle)
    validate_inventory(inventory)
    return inventory


def validate_inventory(inventory: dict[str, Any]) -> None:
    required_source_fields = {
        "id",
        "name",
        "category",
        "coverage_years",
        "access_pattern",
        "automation",
        "ingestion_status",
        "license",
        "provenance",
    }
    seen: set[str] = set()
    for source in inventory.get("sources", []):
        missing = sorted(required_source_fields.difference(source))
        if missing:
            raise ValueError(f"source {source.get('id', '<missing id>')} missing {missing}")
        source_id = source["id"]
        if source_id in seen:
            raise ValueError(f"duplicate source id: {source_id}")
        seen.add(source_id)
        if not isinstance(source["coverage_years"], list) or not source["coverage_years"]:
            raise ValueError(f"source {source_id} must declare coverage_years")
        for nested in ("license", "provenance"):
            if not isinstance(source[nested], dict):
                raise ValueError(f"source {source_id} field {nested} must be an object")


def iter_source_files(root: Path, scan_dirs: Iterable[str], output: Path) -> Iterable[Path]:
    output_resolved = output.resolve()
    for scan_dir in scan_dirs:
        base = resolve_path(root, scan_dir)
        if not base.exists():
            continue
        if base.is_file():
            candidates = [base]
        else:
            candidates = sorted(p for p in base.rglob("*") if p.is_file())
        for path in candidates:
            if path.resolve() == output_resolved:
                continue
            if path.name.startswith("."):
                continue
            if path.name.lower() == "readme.md":
                continue
            if path.suffix.lower() in SUPPORTED_SUFFIXES:
                yield path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_head_text(path: Path, limit: int = 262_144) -> str:
    try:
        with path.open("rb") as handle:
            return handle.read(limit).decode("utf-8", errors="ignore").lower()
    except OSError:
        return ""


def extract_years(rel_path: str) -> list[int]:
    return sorted({int(match.group(1)) for match in YEAR_RE.finditer(rel_path)})


def folder_year(path: Path) -> int | None:
    for part in path.parts:
        if YEAR_RE.fullmatch(part):
            return int(part)
    return None


def filename_year(path: Path) -> int | None:
    matches = [int(match.group(1)) for match in YEAR_RE.finditer(path.stem)]
    return matches[-1] if matches else None


def normalize_layer(path: Path) -> str:
    stem = path.stem.lower()
    stem = re.sub(r"(?i)belfast", "", stem)
    stem = YEAR_RE.sub("", stem)
    stem = re.sub(r"[^a-z0-9]+", "_", stem)
    stem = re.sub(r"_+", "_", stem).strip("_")
    aliases = {
        "boudnary": "boundary",
        "exportbuildings": "buildings_export",
        "transit_routes": "transit_routes",
        "transportstops": "transport_stops",
    }
    return aliases.get(stem, stem or path.stem.lower())


def media_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".tif", ".tiff"}:
        return "raster"
    if suffix in {".geojson", ".gpkg", ".kml", ".kmz", ".shp"}:
        return "vector"
    if suffix in {".json", ".xml"}:
        return "structured"
    if suffix in {".csv", ".xlsx"}:
        return "tabular"
    if suffix in {".png", ".jpg", ".jpeg"}:
        return "image"
    if suffix in {".pdf", ".txt", ".md"}:
        return "document"
    if suffix == ".zip":
        return "archive"
    return "other"


def classify_source(path: Path, rel_path: str, head: str) -> tuple[str, float, list[str]]:
    parts = set(Path(rel_path).parts)
    notes: list[str] = []
    suffix = path.suffix.lower()

    if "manual_drops" in parts:
        return "manual_google_earth", 0.65, ["manual_drop_path"]
    if "overpass-turbo" in head or "openstreetmap.org" in head or "openstreetmap" in head:
        return "osm_overpass", 0.95, ["embedded_osm_metadata"]
    if rel_path.startswith("data/2016/") and suffix in {".tif", ".tiff"}:
        return "repo_existing_2016_rasters", 0.8, ["local_raster_baseline"]
    if rel_path.startswith("data/2026/") and suffix in {".geojson", ".json"}:
        return "repo_existing_2026_geojson", 0.55, ["local_2026_vector_without_embedded_source"]
    return "unknown", 0.0, notes


def geojson_metadata(path: Path, size_bytes: int, max_geojson_bytes: int) -> dict[str, Any]:
    suffix = path.suffix.lower()
    if suffix not in {".geojson", ".json"}:
        return {}
    if size_bytes > max_geojson_bytes:
        return {
            "metadata_skipped": True,
            "metadata_skip_reason": f"file exceeds --max-geojson-bytes ({max_geojson_bytes})",
        }

    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        return {"metadata_error": str(exc)}

    meta: dict[str, Any] = {}
    for key in ("type", "generator", "copyright", "timestamp", "name"):
        if key in data:
            meta[key] = data[key]

    if data.get("type") != "FeatureCollection" or not isinstance(data.get("features"), list):
        return meta

    features = data["features"]
    geometry_types: set[str] = set()
    bbox: list[float] | None = None
    for feature in features:
        geometry = feature.get("geometry") if isinstance(feature, dict) else None
        if not geometry:
            continue
        collect_geometry_metadata(geometry, geometry_types, bbox_ref := [bbox])
        bbox = bbox_ref[0]

    meta["feature_count"] = len(features)
    meta["geometry_types"] = sorted(geometry_types)
    if bbox:
        meta["bbox_wgs84"] = [round(value, 7) for value in bbox]
    return meta


def collect_geometry_metadata(
    geometry: dict[str, Any], geometry_types: set[str], bbox_ref: list[list[float] | None]
) -> None:
    geometry_type = geometry.get("type")
    if isinstance(geometry_type, str):
        geometry_types.add(geometry_type)
    if geometry_type == "GeometryCollection":
        for child in geometry.get("geometries", []) or []:
            if isinstance(child, dict):
                collect_geometry_metadata(child, geometry_types, bbox_ref)
        return
    for lon, lat in iter_positions(geometry.get("coordinates")):
        if bbox_ref[0] is None:
            bbox_ref[0] = [lon, lat, lon, lat]
        else:
            bbox = bbox_ref[0]
            bbox[0] = min(bbox[0], lon)
            bbox[1] = min(bbox[1], lat)
            bbox[2] = max(bbox[2], lon)
            bbox[3] = max(bbox[3], lat)


def iter_positions(value: Any) -> Iterable[tuple[float, float]]:
    if not isinstance(value, list) or not value:
        return
    if (
        len(value) >= 2
        and isinstance(value[0], (int, float))
        and isinstance(value[1], (int, float))
    ):
        yield float(value[0]), float(value[1])
        return
    for child in value:
        yield from iter_positions(child)


def bbox_intersects(a: list[float], b: list[float]) -> bool:
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


def quality_flags(
    entry: dict[str, Any], target_bbox: list[float] | None, source_ids: set[str]
) -> list[str]:
    flags: list[str] = []
    if entry["source_id"] not in source_ids:
        flags.append("source_not_in_inventory")
    if entry.get("folder_year") and entry.get("filename_year"):
        if entry["folder_year"] != entry["filename_year"]:
            flags.append("folder_filename_year_mismatch")
    metadata = entry.get("metadata", {})
    bbox = metadata.get("bbox_wgs84")
    if target_bbox and bbox and not bbox_intersects(bbox, target_bbox):
        flags.append("outside_target_belfast_ni_bbox")
    if metadata.get("metadata_skipped"):
        flags.append("metadata_skipped")
    if metadata.get("metadata_error"):
        flags.append("metadata_error")
    return flags


def build_entry(
    path: Path,
    root: Path,
    inventory: dict[str, Any],
    max_geojson_bytes: int,
) -> dict[str, Any]:
    rel_path = repo_relative(path, root)
    size_bytes = path.stat().st_size
    years = extract_years(rel_path)
    head = read_head_text(path)
    source_id, confidence, evidence = classify_source(path, rel_path, head)
    metadata = geojson_metadata(path, size_bytes, max_geojson_bytes)
    folder = folder_year(path)
    filename = filename_year(path)
    entry: dict[str, Any] = {
        "path": rel_path,
        "sha256": sha256_file(path),
        "size_bytes": size_bytes,
        "media_type": media_type(path),
        "file_extension": path.suffix.lower().lstrip("."),
        "layer": normalize_layer(path),
        "years_observed": years,
        "primary_year": filename or folder or (years[0] if years else None),
        "folder_year": folder,
        "filename_year": filename,
        "source_id": source_id,
        "source_detection_confidence": confidence,
        "source_detection_evidence": evidence,
        "metadata": metadata,
    }
    target_bbox = inventory.get("target_area", {}).get("approx_bbox_wgs84")
    source_ids = {source["id"] for source in inventory.get("sources", [])}
    entry["quality_flags"] = quality_flags(entry, target_bbox, source_ids)
    return entry


def build_manifest(
    root: Path,
    inventory: dict[str, Any],
    inventory_path: Path,
    scan_dirs: Iterable[str],
    output: Path,
    max_geojson_bytes: int,
) -> dict[str, Any]:
    entries = [
        build_entry(path, root, inventory, max_geojson_bytes)
        for path in iter_source_files(root, scan_dirs, output)
    ]
    entries.sort(key=lambda item: item["path"])
    source_counts: dict[str, int] = {}
    flag_counts: dict[str, int] = {}
    for entry in entries:
        source_counts[entry["source_id"]] = source_counts.get(entry["source_id"], 0) + 1
        for flag in entry["quality_flags"]:
            flag_counts[flag] = flag_counts.get(flag, 0) + 1

    return {
        "schema_version": "1.0",
        "project": inventory.get("project", "belfast-historical-replay-2016-2026"),
        "inventory_path": repo_relative(inventory_path, root),
        "scan_dirs": list(scan_dirs),
        "target_area": inventory.get("target_area", {}),
        "summary": {
            "file_count": len(entries),
            "total_size_bytes": sum(entry["size_bytes"] for entry in entries),
            "source_counts": dict(sorted(source_counts.items())),
            "quality_flag_counts": dict(sorted(flag_counts.items())),
        },
        "entries": entries,
    }


def write_manifest(path: Path, manifest: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)
        handle.write("\n")


def print_summary(manifest: dict[str, Any], dry_run: bool) -> None:
    prefix = "dry-run " if dry_run else ""
    summary = manifest["summary"]
    print(
        f"{prefix}indexed {summary['file_count']} files "
        f"({summary['total_size_bytes']} bytes)"
    )
    if summary["source_counts"]:
        print("sources:")
        for source_id, count in summary["source_counts"].items():
            print(f"  {source_id}: {count}")
    if summary["quality_flag_counts"]:
        print("quality flags:")
        for flag, count in summary["quality_flag_counts"].items():
            print(f"  {flag}: {count}")


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    inventory_path = resolve_path(root, args.inventory)
    output_path = resolve_path(root, args.output)
    scan_dirs = tuple(args.scan_dirs or DEFAULT_SCAN_DIRS)

    try:
        inventory = load_inventory(inventory_path)
        manifest = build_manifest(
            root=root,
            inventory=inventory,
            inventory_path=inventory_path,
            scan_dirs=scan_dirs,
            output=output_path,
            max_geojson_bytes=args.max_geojson_bytes,
        )
        if args.dry_run:
            if not args.quiet:
                print_summary(manifest, dry_run=True)
            return 0
        write_manifest(output_path, manifest)
        if not args.quiet:
            print_summary(manifest, dry_run=False)
            print(f"wrote {repo_relative(output_path, root)}")
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI should report concise failures.
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
