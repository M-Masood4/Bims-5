from fastapi import Depends, Request

from trafficjam_be.adapters.simengine import HttpSimEngineAdapter, SimulationEnginePort
from trafficjam_be.adapters.worldmove import NatsWorldMoveAdapter
from trafficjam_be.config import Settings, get_settings
from trafficjam_be.db.database import async_session_factory
from trafficjam_be.db.repository import RunRepository
from trafficjam_be.db.scenario_repository import ScenarioRepository


def get_run_repo() -> RunRepository:
    return RunRepository(async_session_factory)


def get_scenario_repo() -> ScenarioRepository:
    return ScenarioRepository(async_session_factory)


def get_sim_engine(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> SimulationEnginePort:
    return HttpSimEngineAdapter(settings.simengine_url, client=request.app.state.http_client)


def get_worldmove_engine(request: Request) -> NatsWorldMoveAdapter:
    return NatsWorldMoveAdapter(request.app.state.js)
