#!/usr/bin/env python3
"""Fetch current Belfast, Northern Ireland OSM context layers from Overpass."""

from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]
BELFAST_BBOX = (54.52, -6.08, 54.70, -5.78)  # south, west, north, east

QUERIES = {
    "roads": """
        way["highway"]["highway"!~"footway|path|steps|service|track|corridor|bridleway|construction"]({bbox});
    """,
    "cycleways": """
        way["highway"~"cycleway|path|footway"]["bicycle"!~"no"]({bbox});
        way["cycleway"]({bbox});
    """,
    "green_spaces": """
        way["leisure"~"park|garden|nature_reserve|pitch|recreation_ground"]({bbox});
        way["landuse"~"grass|forest|meadow|recreation_ground"]({bbox});
        way["natural"~"wood|grassland|heath"]({bbox});
    """,
    "water": """
        way["natural"="water"]({bbox});
        way["waterway"~"river|canal|stream"]({bbox});
        way["water"]({bbox});
    """,
    "transport_stops": """
        node["highway"="bus_stop"]({bbox});
        node["public_transport"~"platform|stop_position"]({bbox});
        node["railway"~"station|halt|tram_stop"]({bbox});
    """,
    "services": """
        node["amenity"~"school|university|college|hospital|clinic|doctors|library|community_centre|townhall"]({bbox});
        node["shop"]({bbox});
        node["office"]({bbox});
    """,
}


def overpass_query(body: str, bbox: tuple[float, float, float, float]) -> dict[str, Any]:
    south, west, north, east = bbox
    query = f"[out:json][timeout:90];({body.format(bbox=f'{south},{west},{north},{east}')});out tags geom;"
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    last_error: Exception | None = None
    for endpoint in OVERPASS_ENDPOINTS:
        request = urllib.request.Request(endpoint, data=data, headers={"User-Agent": "BelfastGit replay ETL"})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as error:  # noqa: BLE001 - retry a small list of public mirrors.
            last_error = error
            time.sleep(4)
    if last_error:
        raise last_error
    raise RuntimeError("No Overpass endpoint configured.")


def way_geometry(element: dict[str, Any]) -> dict[str, Any] | None:
    geometry = element.get("geometry") or []
    coords = [[round(float(point["lon"]), 6), round(float(point["lat"]), 6)] for point in geometry if "lon" in point and "lat" in point]
    if len(coords) < 2:
        return None
    tags = element.get("tags") or {}
    closed = coords[0] == coords[-1] and len(coords) >= 4
    polygonish = any(key in tags for key in ["building", "leisure", "landuse", "natural", "water"])
    if closed and polygonish:
        return {"type": "Polygon", "coordinates": [coords]}
    return {"type": "LineString", "coordinates": coords}


def node_geometry(element: dict[str, Any]) -> dict[str, Any] | None:
    if "lon" not in element or "lat" not in element:
        return None
    return {"type": "Point", "coordinates": [round(float(element["lon"]), 6), round(float(element["lat"]), 6)]}


def convert(payload: dict[str, Any], layer_id: str) -> dict[str, Any]:
    features = []
    for element in payload.get("elements", []):
        geometry = node_geometry(element) if element.get("type") == "node" else way_geometry(element)
        if not geometry:
            continue
        tags = element.get("tags") or {}
        feature_id = f"{element.get('type')}/{element.get('id')}"
        features.append(
            {
                "type": "Feature",
                "id": feature_id,
                "properties": {
                    "source_id": feature_id,
                    "name": tags.get("name"),
                    "highway": tags.get("highway"),
                    "amenity": tags.get("amenity"),
                    "shop": tags.get("shop"),
                    "leisure": tags.get("leisure"),
                    "landuse": tags.get("landuse"),
                    "natural": tags.get("natural"),
                    "waterway": tags.get("waterway"),
                    "route": tags.get("route"),
                },
                "geometry": geometry,
            }
        )
    return {
        "type": "FeatureCollection",
        "name": f"belfast_ni_{layer_id}_osm_2026",
        "metadata": {
            "source": "OpenStreetMap via Overpass API",
            "license": "ODbL",
            "bbox": BELFAST_BBOX,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        },
        "features": features,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("data/derived/2026"))
    parser.add_argument("--force", action="store_true", help="Refetch layers even if the derived file already exists.")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    for layer_id, body in QUERIES.items():
        path = output / f"belfast_ni_{layer_id}_osm_2026.geojson"
        if path.exists() and not args.force:
            print(f"Keeping existing {path}.")
            continue
        payload = overpass_query(body, BELFAST_BBOX)
        collection = convert(payload, layer_id)
        path.write_text(json.dumps(collection, separators=(",", ":")), encoding="utf-8")
        print(f"Wrote {path} with {len(collection['features'])} feature(s).")
        time.sleep(1.2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
