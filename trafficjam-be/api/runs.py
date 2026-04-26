import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sse_starlette.event_source import EventSourceResponse

from trafficjam_be.adapters.simengine import SimulationEnginePort
from trafficjam_be.consumers import RunEventConsumer
from trafficjam_be.db.repository import RunRepository
from trafficjam_be.dependencies import (
    get_run_repo,
    get_scenario_repo,
    get_sim_engine,
)
from trafficjam_be.schemas.run import RunCreate, RunResponse, RunStatus

router = APIRouter(prefix="/scenarios/{scenario_id}/runs", tags=["runs"])


@router.post("", response_model=RunResponse)
async def create_run(
    scenario_id: str,
    run_in: RunCreate,
    repo: Annotated[RunRepository, Depends(get_run_repo)],
    scenario_repo=Depends(get_scenario_repo),
    sim_engine: SimulationEnginePort = Depends(get_sim_engine),
):
    scenario = await scenario_repo.get_scenario(uuid.UUID(scenario_id))
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")

    run = await repo.create_run(uuid.UUID(scenario_id), run_in)

    try:
        await sim_engine.start_simulation(str(run.id), scenario.network_xml, scenario.plans_xml)
    except Exception as e:
        await repo.update_status(run.id, RunStatus.FAILED)
        raise HTTPException(status_code=500, detail=f"Failed to start sim engine: {e}")

    return run


@router.get("", response_model=list[RunResponse])
async def list_runs(
    scenario_id: str,
    repo: Annotated[RunRepository, Depends(get_run_repo)],
):
    return await repo.list_runs_by_scenario(uuid.UUID(scenario_id))


@router.get("/{run_id}", response_model=RunResponse)
async def get_run(
    scenario_id: str,
    run_id: str,
    repo: Annotated[RunRepository, Depends(get_run_repo)],
):
    run = await repo.get_run_by_scenario(uuid.UUID(scenario_id), uuid.UUID(run_id))
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.get("/{run_id}/events")
async def stream_run_events(
    request: Request,
    scenario_id: str,
    run_id: str,
    is_replay: bool = Query(False),
    repo: Annotated[RunRepository, Depends(get_run_repo)] = Depends(get_run_repo),
):
    """
    Streams simulation events via SSE.
    If is_replay=True, it streams all historical events for the run and then closes.
    If is_replay=False, it streams live events.
    """
    consumer = RunEventConsumer(request.app.state.js, run_id)
    try:
        parsed_id = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid run_id")

    async def check_done() -> bool:
        refreshed = await repo.get_run_by_scenario(uuid.UUID(scenario_id), parsed_id)
        return refreshed is not None and refreshed.status in (
            RunStatus.COMPLETED,
            RunStatus.FAILED,
        )

    return EventSourceResponse(consumer.stream_events(request, is_replay, check_done))
