import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

FUTURE_LAYERS_DIR = Path(__file__).parent / "future_layers"
FUTURE_LAYERS_DIR.mkdir(exist_ok=True)


BELFAST_2036_LAYERS = [
    {
        "id": "york-street-interchange",
        "name": "York Street Interchange (Completed)",
        "year": 2036,
        "layer_type": "road",
        "description": "Grade-separated interchange connecting Westlink, M2 and M3 — eliminates the bottleneck.",
        "geojson": {
            "type": "Feature",
            "properties": {"name": "York Street Interchange", "highway": "motorway_link", "lanes": 3, "maxspeed": 60},
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [-5.9340, 54.6050],
                    [-5.9335, 54.6055],
                    [-5.9325, 54.6060],
                    [-5.9310, 54.6065],
                    [-5.9295, 54.6070],
                ],
            },
        },
    },
    {
        "id": "glider-e-way",
        "name": "Glider East-West Extension",
        "year": 2036,
        "layer_type": "transit",
        "description": "New Glider BRT route connecting Dundonald to Belfast City Centre via Newtownards Road.",
        "geojson": {
            "type": "Feature",
            "properties": {"name": "Glider East-West", "route": "bus", "ref": "G3", "colour": "#E63946"},
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [-5.8400, 54.5950],
                    [-5.8600, 54.5960],
                    [-5.8800, 54.5970],
                    [-5.9000, 54.5985],
                    [-5.9200, 54.6000],
                    [-5.9350, 54.6010],
                ],
            },
        },
    },
    {
        "id": "belfast-bike-network",
        "name": "Belfast Bicycle Network Phase 2",
        "year": 2036,
        "layer_type": "cycling",
        "description": "Protected cycle lanes connecting North Belfast to Titanic Quarter and Queen's University.",
        "geojson": {
            "type": "Feature",
            "properties": {"name": "Belfast Bicycle Network", "highway": "cycleway", "surface": "asphalt"},
            "geometry": {
                "type": "MultiLineString",
                "coordinates": [
                    [[-5.9250, 54.6100], [-5.9270, 54.6050], [-5.9300, 54.6000], [-5.9310, 54.5950]],
                    [[-5.9310, 54.5950], [-5.9200, 54.5920], [-5.9100, 54.5900]],
                ],
            },
        },
    },
    {
        "id": "community-hub-north",
        "name": "North Belfast Community Hub",
        "year": 2036,
        "layer_type": "building",
        "description": "15-minute city community hub with health, education, and leisure facilities.",
        "geojson": {
            "type": "Feature",
            "properties": {"name": "North Belfast Hub", "building": "civic", "amenity": "community_centre"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [-5.9450, 54.6150],
                    [-5.9440, 54.6150],
                    [-5.9440, 54.6145],
                    [-5.9450, 54.6145],
                    [-5.9450, 54.6150],
                ]],
            },
        },
    },
    {
        "id": "ltn-south-belfast",
        "name": "Low Traffic Neighbourhood — Ormeau",
        "year": 2036,
        "layer_type": "policy_zone",
        "description": "Modal filter zone reducing through-traffic on residential streets in the Ormeau area.",
        "geojson": {
            "type": "Feature",
            "properties": {"name": "Ormeau LTN", "zone_type": "ltn", "max_vehicles": 50},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [-5.9200, 54.5850],
                    [-5.9100, 54.5850],
                    [-5.9100, 54.5800],
                    [-5.9200, 54.5800],
                    [-5.9200, 54.5850],
                ]],
            },
        },
    },
]

_user_layers: list[dict] = []


def list_future_layers(year: int | None = None) -> list[dict]:
    all_layers = BELFAST_2036_LAYERS + _user_layers
    if year is not None:
        return [l for l in all_layers if l["year"] == year]
    return all_layers


def get_future_layer(layer_id: str) -> dict | None:
    for layer in BELFAST_2036_LAYERS + _user_layers:
        if layer["id"] == layer_id:
            return layer
    return None


def create_future_layer(layer: dict) -> dict:
    _user_layers.append(layer)
    return layer


def delete_future_layer(layer_id: str) -> bool:
    for i, layer in enumerate(_user_layers):
        if layer["id"] == layer_id:
            _user_layers.pop(i)
            return True
    return False
