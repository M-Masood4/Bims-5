import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, HTTPException, Response

logger = logging.getLogger(__name__)
from fastapi.middleware.cors import CORSMiddleware

from models import NetworkResponse
from db import engine, MapDataRepository
from db.database import AsyncSessionLocal
from worldmove_exporter import export_grid_data, export_trajectories
from future_layers import list_future_layers, get_future_layer, create_future_layer, delete_future_layer

CACHE_MAX_AGE = 3600


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await engine.dispose()


TAGS_METADATA = [
    {
        "name": "network",
        "description": "Spatial queries returning road network, buildings, and public transport data for any geographic bounding box worldwide.",
    },
    {
        "name": "future",
        "description": "Future infrastructure layers — proposed 2036 roads, transit, cycling, buildings, and policy zones.",
    },
    {
        "name": "worldmove",
        "description": "WorldMove mobility data exports — grid cells, adjacency matrices, population, POIs, and trajectory sequences.",
    },
    {
        "name": "ops",
        "description": "Operational endpoints for monitoring service health.",
    },
]

app = FastAPI(
    title="Map Data Service",
    description=(
        "Serves OpenStreetMap-derived network data (nodes, links, buildings, transport routes) "
        "from a PostGIS database for use by the BIMS 5 simulation frontend. "
        "Also provides WorldMove mobility data exports for high-scale simulation.\n\n"
        "All coordinates are in **WGS 84** (EPSG:4326) as `[longitude, latitude]` pairs. "
        "Responses are cached for 1 hour (`Cache-Control: public, max-age=3600`)."
    ),
    version="3.0.0",
    openapi_tags=TAGS_METADATA,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _validate_bounds(min_lat: float, min_lng: float, max_lat: float, max_lng: float):
    if min_lat >= max_lat:
        raise HTTPException(status_code=400, detail="min_lat must be less than max_lat")
    if min_lng >= max_lng:
        raise HTTPException(status_code=400, detail="min_lng must be less than max_lng")


@app.get(
    "/network",
    response_model=NetworkResponse,
    tags=["network"],
    summary="Fetch network data for a bounding box",
    description=(
        "Returns all road nodes, directed links, buildings, and public transport routes "
        "whose geometry intersects the given WGS 84 bounding box. "
        "Works for any region with loaded OSM data. "
        "The bounding box must have `min_lat < max_lat` and `min_lng < max_lng`."
    ),
    response_description="Network data (nodes, links, buildings, transport routes) within the requested bounding box",
)
async def get_network(
    response: Response,
    min_lat: float = Query(..., ge=-90, le=90, description="South boundary latitude"),
    min_lng: float = Query(..., ge=-180, le=180, description="West boundary longitude"),
    max_lat: float = Query(..., ge=-90, le=90, description="North boundary latitude"),
    max_lng: float = Query(..., ge=-180, le=180, description="East boundary longitude"),
):
    _validate_bounds(min_lat, min_lng, max_lat, max_lng)
    response.headers["Cache-Control"] = f"public, max-age={CACHE_MAX_AGE}"

    try:
        repository = MapDataRepository(AsyncSessionLocal)
        return await repository.fetch_network(min_lat, min_lng, max_lat, max_lng)
    except Exception:
        logger.exception("Failed to fetch network data")
        raise HTTPException(status_code=500, detail="Failed to fetch network data")


@app.get(
    "/export/worldmove",
    tags=["worldmove"],
    summary="Export WorldMove grid data",
    description=(
        "Returns the full WorldMove dataset for a city: grid cell coordinates, "
        "population distribution, POI counts, adjacency matrix, and metadata."
    ),
)
async def worldmove_export(
    response: Response,
    city_file: str = Query(default="154_GB_Belfast.npz", description="WorldMove NPZ filename"),
):
    response.headers["Cache-Control"] = f"public, max-age={CACHE_MAX_AGE}"
    try:
        return export_grid_data(city_file)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception:
        logger.exception("Failed to export WorldMove data")
        raise HTTPException(status_code=500, detail="Failed to export WorldMove data")


@app.get(
    "/worldmove/trajectories",
    tags=["worldmove"],
    summary="Get WorldMove mobility trajectories",
    description=(
        "Returns trajectory sequences mapped to lat/lng coordinates. "
        "Each trajectory is a sequence of grid cell visits with coordinates."
    ),
)
async def worldmove_trajectories(
    response: Response,
    city_file: str = Query(default="154_GB_Belfast.npz", description="WorldMove NPZ filename"),
    limit: int = Query(default=100, le=5000, description="Max trajectories to return"),
    offset: int = Query(default=0, ge=0, description="Offset index"),
):
    response.headers["Cache-Control"] = f"public, max-age={CACHE_MAX_AGE}"
    try:
        return export_trajectories(city_file, limit, offset)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception:
        logger.exception("Failed to fetch WorldMove trajectories")
        raise HTTPException(status_code=500, detail="Failed to fetch trajectories")


@app.get(
    "/health",
    tags=["ops"],
    summary="Health check",
    response_description="Service status",
)
async def health():
    return {"status": "ok"}


@app.get(
    "/future-layers",
    tags=["future"],
    summary="List future infrastructure layers",
    description="Returns all proposed future infrastructure layers, optionally filtered by target year.",
)
async def list_layers(
    year: int | None = Query(default=None, description="Filter layers by target year (e.g. 2036)"),
):
    return list_future_layers(year)


@app.get(
    "/future-layers/{layer_id}",
    tags=["future"],
    summary="Get a future layer by ID",
)
async def get_layer(layer_id: str):
    layer = get_future_layer(layer_id)
    if not layer:
        raise HTTPException(status_code=404, detail="Future layer not found")
    return layer


@app.post(
    "/future-layers",
    tags=["future"],
    summary="Create a user-defined future layer",
    status_code=201,
)
async def create_layer(body: dict):
    return create_future_layer(body)


@app.delete(
    "/future-layers/{layer_id}",
    tags=["future"],
    summary="Delete a user-defined future layer",
    status_code=204,
)
async def remove_layer(layer_id: str):
    if not delete_future_layer(layer_id):
        raise HTTPException(status_code=404, detail="Layer not found or built-in")
