import asyncio
import logging
from contextlib import asynccontextmanager

import nats as nats_lib
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from engine import WorldMoveData, build_adjacency
from nats_bridge import NatsBridge
from schemas import SimulationConfig, SimulationStartResult

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    nc = await nats_lib.connect(settings.nats_url)
    js = nc.jetstream()
    app.state.nc = nc
    app.state.js = js

    data = WorldMoveData(f"{settings.data_dir}/154_GB_Belfast.npz")
    data.load()
    app.state.data = data

    bridge = NatsBridge(js, data)
    app.state.bridge = bridge
    app.state.config_worker = asyncio.create_task(bridge.subscribe_configs())

    yield

    app.state.config_worker.cancel()
    await nc.drain()


app = FastAPI(
    title="WorldMove Simulation Engine",
    description=(
        "High-concurrency mobility simulation powered by WorldMove trajectory data. "
        "Consumes simulation configs from NATS and publishes linkEnter/linkLeave events "
        "to the SIMULATIONS stream, compatible with the BIMS 5 backend."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post(
    "/api/simulations",
    response_model=SimulationStartResult,
    summary="Start a WorldMove simulation",
)
async def start_simulation(config: SimulationConfig):
    bridge: NatsBridge = app.state.bridge
    simulation_id = await bridge.start_simulation(
        config.scenario_id,
        config.run_id,
        config.max_agents,
    )
    return SimulationStartResult(
        simulation_id=simulation_id,
        scenario_id=config.scenario_id,
        run_id=config.run_id,
    )


@app.get("/api/data/info", summary="WorldMove dataset info")
async def data_info():
    data: WorldMoveData = app.state.data
    return {
        "cell_count": data.cell_count,
        "trajectory_count": data.trajectory_count,
        "time_steps": data.time_steps,
        "total_population": data.total_population,
        "grid_shape": data.grid_shape,
        "poi_types": int(data.poi.shape[2]),
    }


@app.get("/api/data/grid", summary="Grid cell coordinates")
async def data_grid():
    data: WorldMoveData = app.state.data
    return {
        "cells": {
            k: {"lng": v[0], "lat": v[1]}
            for k, v in data.grid.items()
        }
    }


@app.get("/api/data/population", summary="Population per grid cell")
async def data_population():
    data: WorldMoveData = app.state.data
    pop = data.population
    result = {}
    rows, cols = pop.shape
    for r in range(rows):
        for c in range(cols):
            cell_idx = r * cols + c
            result[str(cell_idx)] = float(pop[r, c])
    return {"population": result, "total": data.total_population}


@app.get("/api/data/adjacency", summary="Grid cell adjacency matrix")
async def data_adjacency():
    data: WorldMoveData = app.state.data
    adj = build_adjacency(data.grid_shape)
    return {"adjacency": adj}


@app.get("/api/data/trajectories", summary="Sample trajectories")
async def data_trajectories(
    limit: int = Query(default=100, le=5000, description="Max trajectories to return"),
    offset: int = Query(default=0, ge=0, description="Offset index"),
):
    data: WorldMoveData = app.state.data
    trajs = data.trajectories[offset:offset + limit]
    grid = data.grid

    result = []
    for traj in trajs:
        coords = []
        for cell_idx in traj:
            cell_str = str(int(cell_idx))
            if cell_str in grid:
                c = grid[cell_str]
                coords.append({"lng": c[0], "lat": c[1], "cell": int(cell_idx)})
        result.append(coords)

    return {"trajectories": result, "total": data.trajectory_count}


@app.get("/health", summary="Health check")
async def health():
    return {"status": "ok", "engine": "worldmove"}


if __name__ == "__main__":
    import uvicorn
    settings = get_settings()
    uvicorn.run(app, host=settings.host, port=settings.port)
