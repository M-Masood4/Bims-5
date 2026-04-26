import asyncio
from contextlib import asynccontextmanager

import httpx
import nats as nats_lib
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from trafficjam_be.api import runs, scenarios
from trafficjam_be.config import get_settings
from trafficjam_be.services.status_monitor import monitor_all_statuses


async def _ensure_simulations_stream(js):
    """Ensure the simulations stream exists for status tracking"""
    try:
        await js.add_stream(name="simulations", subjects=["simulation.status.*"])
    except Exception:
        # Stream might already exist
        pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Setup NATS
    settings = get_settings()
    app.state.nc = await nats_lib.connect(settings.nats_url)
    app.state.js = app.state.nc.jetstream()
    
    # Setup HTTP Client
    app.state.http_client = httpx.AsyncClient(timeout=60.0)
    
    await _ensure_simulations_stream(app.state.js)
    app.state.status_worker = asyncio.create_task(monitor_all_statuses(app.state.js))
    yield
    app.state.status_worker.cancel()
    await app.state.http_client.aclose()
    await app.state.nc.close()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scenarios.router)
app.include_router(runs.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
