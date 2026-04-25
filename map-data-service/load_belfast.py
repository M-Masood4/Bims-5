"""
Load Belfast OSM data into PostGIS for BIMS 5.

Downloads road network, buildings, and public transport from OpenStreetMap
and inserts them into the bims5 PostGIS database.

Usage:
    cd map-data-service
    pip install osmnx psycopg2-binary python-dotenv requests
    python load_belfast.py

DATABASE_URL is read from .env (or environment). The script clears existing
data and reloads fresh from OSM, so it is safe to re-run.
"""

import json
import os

import osmnx as ox
import psycopg2
import requests
from dotenv import load_dotenv

load_dotenv()

_raw = os.getenv("DATABASE_URL", "postgresql+asyncpg://admin:admin@localhost:5432/bims5")
DATABASE_URL = _raw.replace("postgresql+asyncpg://", "postgresql://").replace(
    "postgresql+psycopg2://", "postgresql://"
)

PLACE = "Belfast, Northern Ireland, United Kingdom"
NORTH, SOUTH, EAST, WEST = 54.65, 54.55, -5.81, -6.05
OVERPASS_URL = "https://overpass.kumi.systems/api/interpreter"


def _str(val) -> str | None:
    if val is None or (isinstance(val, float)):
        return None
    if isinstance(val, list):
        return str(val[0]) if val else None
    return str(val)


def _building_type(tags: dict) -> str | None:
    amenity = tags.get("amenity", "")
    building = tags.get("building", "")
    shop = tags.get("shop", "")

    if building == "supermarket" or shop == "supermarket":
        return "supermarket"
    if amenity == "school" or building == "school":
        return "school"
    if amenity == "kindergarten" or building == "kindergarten":
        return "kindergarten"
    if amenity in ("parking", "bicycle_parking") or building in ("parking", "garage", "garages"):
        return "parking"
    if shop or building in ("retail", "commercial", "kiosk"):
        return "retail"
    if building in ("apartments", "flat"):
        return "apartments"
    if building in ("residential", "dwelling_house", "semidetached_house", "detached"):
        return "residential"
    if building in ("house", "terrace", "bungalow", "dormitory"):
        return "house"
    return None


def load_road_network(cur):
    print("Downloading road network...")
    G = ox.graph_from_place(PLACE, network_type="drive", simplify=True)
    nodes_gdf, edges_gdf = ox.graph_to_gdfs(G)

    print(f"  Inserting {len(nodes_gdf)} nodes...")
    for node_id, row in nodes_gdf.iterrows():
        lng, lat = row.geometry.x, row.geometry.y
        conn_count = G.degree(node_id)
        cur.execute(
            "INSERT INTO nodes (id, connection_count, geom) "
            "VALUES (%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326)) ON CONFLICT DO NOTHING",
            (int(node_id), conn_count, lng, lat),
        )

    print(f"  Inserting {len(edges_gdf)} links...")
    link_id = 1
    for (u, v, _), row in edges_gdf.iterrows():
        coords = list(row.geometry.coords)
        if len(coords) < 2:
            continue
        wkt = "LINESTRING(" + ", ".join(f"{x} {y}" for x, y in coords) + ")"
        cur.execute(
            "INSERT INTO links (id, from_node, to_node, highway, lanes, maxspeed, name, ref, surface, oneway, geom) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, ST_SetSRID(ST_GeomFromText(%s),4326)) ON CONFLICT DO NOTHING",
            (
                link_id, int(u), int(v),
                _str(row.get("highway")), _str(row.get("lanes")),
                _str(row.get("maxspeed")), _str(row.get("name")),
                _str(row.get("ref")), _str(row.get("surface")),
                _str(row.get("oneway")), wkt,
            ),
        )
        link_id += 1

    print(f"  Road network loaded ({link_id - 1} links).")


def load_buildings(cur):
    print("Downloading buildings...")
    try:
        gdf = ox.features_from_place(PLACE, tags={"building": True})
    except Exception as e:
        print(f"  Warning: could not load buildings: {e}")
        return

    gdf = gdf[gdf.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].to_crs(epsg=4326)
    print(f"  Processing {len(gdf)} building footprints...")

    inserted = 0
    building_id = 1
    for _, row in gdf.iterrows():
        raw_tags = {}
        for col in ["amenity", "building", "shop", "name", "addr:street", "building:levels"]:
            val = row.get(col)
            if val and not isinstance(val, float):
                raw_tags[col] = str(val)

        btype = _building_type(raw_tags)
        if btype is None:
            continue

        poly = row.geometry if row.geometry.geom_type == "Polygon" else row.geometry.geoms[0]
        centroid = poly.centroid
        coords = [[c[0], c[1]] for c in poly.exterior.coords]

        cur.execute(
            "INSERT INTO buildings (id, geometry, type, building, building_levels, name, addr_street, shop, geom) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s, ST_SetSRID(ST_MakePoint(%s,%s),4326)) ON CONFLICT DO NOTHING",
            (
                building_id, json.dumps(coords), btype,
                raw_tags.get("building"), raw_tags.get("building:levels"),
                raw_tags.get("name"), raw_tags.get("addr:street"),
                raw_tags.get("shop"), centroid.x, centroid.y,
            ),
        )
        building_id += 1
        inserted += 1

    print(f"  Inserted {inserted} buildings.")


def load_transport_routes(cur):
    print("Downloading public transport routes from Overpass...")
    query = f"""
    [out:json][timeout:90];
    (relation["route"~"^(bus|tram|train|subway|ferry)$"]({SOUTH},{WEST},{NORTH},{EAST}););
    out body; >; out skel qt;
    """
    try:
        resp = requests.get(
            OVERPASS_URL,
            params={"data": query},
            headers={"Accept": "application/json"},
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        print(f"  Warning: could not load transport routes: {e}")
        return

    ways = {el["id"]: el for el in data["elements"] if el["type"] == "way"}
    node_map = {el["id"]: el for el in data["elements"] if el["type"] == "node"}

    inserted = 0
    route_id = 1
    for el in data["elements"]:
        if el["type"] != "relation":
            continue
        tags = el.get("tags", {})
        route = tags.get("route", "")
        if not route:
            continue

        for member in el.get("members", []):
            if member["type"] != "way":
                continue
            way = ways.get(member["ref"])
            if not way:
                continue
            coords = [(node_map[n]["lon"], node_map[n]["lat"]) for n in way.get("nodes", []) if n in node_map]
            if len(coords) < 2:
                continue
            wkt = "LINESTRING(" + ", ".join(f"{x} {y}" for x, y in coords) + ")"
            cur.execute(
                'INSERT INTO transport_routes (id, way_id, colour, "from", name, network, operator, ref, route, "to", geom) '
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, ST_SetSRID(ST_GeomFromText(%s),4326)) ON CONFLICT DO NOTHING",
                (
                    route_id, way["id"],
                    tags.get("colour"), tags.get("from"), tags.get("name"),
                    tags.get("network"), tags.get("operator"), tags.get("ref"),
                    route, tags.get("to"), wkt,
                ),
            )
            route_id += 1
            inserted += 1

    print(f"  Inserted {inserted} transport route segments.")


def main():
    print(f"Connecting to: {DATABASE_URL}")
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        cur.execute("CREATE EXTENSION IF NOT EXISTS postgis;")
        print("Clearing existing data...")
        cur.execute("TRUNCATE TABLE transport_routes, buildings, links, nodes CASCADE;")

        load_road_network(cur)
        load_buildings(cur)
        load_transport_routes(cur)

        conn.commit()
        print("\nBelfast OSM data loaded successfully.")
        print("Restart the map-data-service and reload the map in the browser.")
    except Exception as e:
        conn.rollback()
        print(f"\nFailed: {e}")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
