import asyncio
import logging
import uuid
from typing import Optional

import nats.js.errors as jserrors
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
import fastapi.responses
from sse_starlette import EventSourceResponse

from adapters.simengine import SimulationEnginePort
from adapters.worldmove import NatsWorldMoveAdapter
from agents.config import AgentConfig
from agents.plans.population import generate_plans_xml, parse_buildings_and_bounds
from consumers import EventConsumer
from db import RunRepository, RunStatus, EngineType, ScenarioRepository
from dependencies import get_run_repo, get_scenario_repo, get_sim_engine, get_worldmove_engine
from scorecard import ground_for_year, analyze_run

router = APIRouter(prefix="/scenarios", tags=["runs"])
logger = logging.getLogger(__name__)


async def _read_upload_text(upload: UploadFile | None) -> str | None:
    if upload is None:
        return None
    content = await upload.read()
    return content.decode("utf-8")


@router.get(
    "/{scenario_id}/runs",
    summary="List runs",
    response_description="All runs for the scenario, ordered by creation time",
)
async def list_runs(
    scenario_id: str,
    repo: RunRepository = Depends(get_run_repo),
):
    try:
        parsed_scenario_id = uuid.UUID(scenario_id)
    except ValueError:
        raise HTTPException(400, "Invalid scenario ID")
    runs = await repo.list_runs(parsed_scenario_id)
    return [
        {
            "id": str(r.id),
            "scenarioId": str(r.scenario_id),
            "status": r.status,
            "iterations": r.iterations,
            "randomSeed": r.random_seed,
            "engineType": r.engine_type,
            "note": r.note,
            "createdAt": r.created_at.isoformat() if r.created_at else None,
        }
        for r in runs
    ]


@router.post(
    "/{scenario_id}/runs",
    summary="Create a run",
    description="Creates a new run record in `PENDING` status without starting the simulation. Use `/start` to launch it.",
    response_description="Created run with its assigned ID",
)
async def create_run(
    scenario_id: str,
    run_id: str | None = None,
    repo: RunRepository = Depends(get_run_repo),
):
    parsed_scenario_id = uuid.UUID(scenario_id)
    parsed_id = uuid.UUID(run_id) if run_id else None
    run = await repo.create_run(parsed_scenario_id, parsed_id)
    return {
        "scenario_id": str(run.scenario_id),
        "run_id": str(run.id),
        "status": run.status,
    }


@router.post(
    "/{scenario_id}/runs/start",
    summary="Start a simulation run",
    description=(
        "Generates a MATSim plans XML from `buildings` and `bounds`, then submits the network file "
        "and plans to the simulation engine. The run streams events back via SSE once started."
    ),
    response_description="Started run with simulation engine ID",
)
async def start_run(
    scenario_id: str,
    networkFile: UploadFile = File(
        ..., description="MATSim-compatible network XML file"
    ),
    buildings: Optional[str] = Form(
        None,
        description="JSON array of building objects used for agent plan generation",
    ),
    buildingsFile: UploadFile | None = File(
        None,
        description="JSON file of building objects used for agent plan generation",
    ),
    bounds: Optional[str] = Form(
        None,
        description="JSON object with bounding box (minLat, minLng, maxLat, maxLng)",
    ),
    iterations: int = Form(1, description="Number of MATSim iterations"),
    randomSeed: int | None = Form(None, description="Random seed for reproducibility"),
    note: str | None = Form(None, description="Optional annotation for this run"),
    engine_type: str = Form("MATSIM", description="Simulation engine: MATSIM or WORLDMOVE"),
    max_agents: int = Form(1000, description="Maximum agents for WorldMove simulations"),
    run_repo: RunRepository = Depends(get_run_repo),
    scenario_repo: ScenarioRepository = Depends(get_scenario_repo),
    sim_engine: SimulationEnginePort = Depends(get_sim_engine),
    wm_engine: NatsWorldMoveAdapter = Depends(get_worldmove_engine),
):
    try:
        parsed_scenario_id = uuid.UUID(scenario_id)
    except ValueError:
        raise HTTPException(400, "Invalid scenario ID")

    parsed_engine = EngineType(engine_type.upper())

    run = await run_repo.create_run(
        parsed_scenario_id,
        iterations=iterations,
        random_seed=randomSeed,
        note=note,
    )

    scenario = await scenario_repo.get_scenario(parsed_scenario_id)

    if parsed_engine == EngineType.WORLDMOVE:
        grounding = await ground_for_year(
            target_year=scenario.target_year if scenario else 2036,
            agent_count=max_agents,
            scenario_name=scenario.name if scenario else "",
        )

        try:
            result = await wm_engine.start(
                scenario_id=scenario_id,
                run_id=str(run.id),
                max_agents=max_agents,
            )
        except Exception as e:
            logger.error(f"WorldMove start failed: {e}")
            await run_repo.update_status(run.id, RunStatus.FAILED)
            raise HTTPException(500, f"Failed to start WorldMove simulation: {e}")

        await run_repo.update_status(run.id, RunStatus.RUNNING)

        return {
            "scenario_id": scenario_id,
            "run_id": str(run.id),
            "simulation_id": result.simulation_id,
            "engine_type": "WORLDMOVE",
            "status": "RUNNING",
            "grounding": grounding,
        }

    buildings_json = await _read_upload_text(buildingsFile) or buildings

    if not buildings_json or not bounds:
        await run_repo.update_status(run.id, RunStatus.FAILED)
        raise HTTPException(
            400, "Buildings and bounds are required for plan generation."
        )

    plan_params = (scenario.plan_params or {}) if scenario else {}
    agent_config = AgentConfig.from_plan_params(plan_params)
    max_agents = plan_params.get("maxAgents", 1000)

    try:
        buildings_list, bounds_dict = parse_buildings_and_bounds(
            buildings_json, bounds
        )
    except Exception as e:
        await run_repo.update_status(run.id, RunStatus.FAILED)
        raise HTTPException(400, f"Invalid buildings or bounds data: {e}")

    if not buildings_list:
        await run_repo.update_status(run.id, RunStatus.FAILED)
        raise HTTPException(
            400,
            "No buildings found in this area. Load OSM data into the database first.",
        )

    try:
        plans_xml = await asyncio.to_thread(
            generate_plans_xml, bounds_dict, buildings_list, agent_config, max_agents
        )
    except Exception as e:
        logger.error(f"Failed to generate plans: {e}")
        await run_repo.update_status(run.id, RunStatus.FAILED)
        raise HTTPException(500, f"Plan generation failed: {e}")

    run_id = str(run.id)

    if not networkFile.filename:
        await run_repo.update_status(run.id, RunStatus.FAILED)
        raise HTTPException(400, "Network file is required")
    if not networkFile.content_type:
        await run_repo.update_status(run.id, RunStatus.FAILED)
        raise HTTPException(400, "Network file content type is required")

    try:
        result = await sim_engine.start(
            scenario_id=scenario_id,
            run_id=run_id,
            network_filename=networkFile.filename,
            network_file=await networkFile.read(),
            network_content_type=networkFile.content_type,
            plans_xml=plans_xml,
            iterations=iterations,
            random_seed=randomSeed,
        )
    except Exception as e:
        logger.error(f"SimEngine request failed: {e}")
        await run_repo.update_status(run.id, RunStatus.FAILED)
        raise HTTPException(500, f"Failed to start simulation in SimEngine: {e}")

    return {
        "scenario_id": scenario_id,
        "run_id": run_id,
        "simulation_id": result.simulation_id,
        "status": "RUNNING",
    }


@router.get(
    "/{scenario_id}/runs/{run_id}/events/stream",
    summary="Stream simulation events",
    description=(
        "Opens a Server-Sent Events (SSE) connection that replays all past events from NATS JetStream "
        "and then streams new events as they arrive. Closes automatically when the run completes."
    ),
    response_description="Stream of simulation events (text/event-stream)",
)
async def stream_run_events(
    scenario_id: str,
    run_id: str,
    request: Request,
    repo: RunRepository = Depends(get_run_repo),
):
    try:
        parsed_id = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(400, "Invalid run ID")

    run = await repo.get_run_by_scenario(uuid.UUID(scenario_id), parsed_id)
    if not run:
        raise HTTPException(404, "Run not found")

    consumer = EventConsumer(request.app.state.js, scenario_id, str(parsed_id))
    is_replay = run.status in (RunStatus.COMPLETED, RunStatus.FAILED)

    async def check_done() -> bool:
        refreshed = await repo.get_run_by_scenario(uuid.UUID(scenario_id), parsed_id)
        return refreshed is not None and refreshed.status in (RunStatus.COMPLETED, RunStatus.FAILED)

    return EventSourceResponse(consumer.stream_events(request, is_replay, check_done))


@router.get(
    "/{scenario_id}/runs/{run_id}/simwrapper/{filename:path}",
    summary="Get simulation output file",
    description=(
        "Retrieves a simulation output file (CSV, JSON, YAML, etc.) from the NATS Object Store "
        "for the given run. Responses are cached for 1 hour."
    ),
    response_description="File contents with appropriate Content-Type",
)
async def get_simwrapper_file(
    scenario_id: str,
    run_id: str,
    filename: str,
    request: Request,
    repo: RunRepository = Depends(get_run_repo),
):
    try:
        parsed_id = uuid.UUID(run_id)
        parsed_scenario_id = uuid.UUID(scenario_id)
    except ValueError:
        raise HTTPException(400, "Invalid UUID format")

    run = await repo.get_run_by_scenario(parsed_scenario_id, parsed_id)
    if not run:
        raise HTTPException(404, "Run not found")

    try:
        obj_store = await request.app.state.js.object_store(f"sim-outputs-{run_id}")
        obj = await obj_store.get(filename)
        return fastapi.responses.Response(
            content=obj.data,
            media_type=_content_type_for(filename),
            headers={
                "Content-Disposition": f'inline; filename="{filename}"',
                "Cache-Control": "public, max-age=3600",
            },
        )
    except jserrors.NotFoundError:
        raise HTTPException(404, f"File {filename} not found in Object Store")
    except Exception as e:
        logger.error(f"Error fetching simwrapper file {filename}: {e}")
        raise HTTPException(500, "Failed to retrieve file")


def _content_type_for(filename: str) -> str:
    if filename.endswith((".yaml", ".yml")):
        return "application/x-yaml"
    if filename.endswith(".csv"):
        return "text/csv"
    if filename.endswith(".json"):
        return "application/json"
    return "application/octet-stream"


@router.get(
    "/{scenario_id}/runs/{run_id}/scorecard",
    summary="Get 2036 policy scorecard",
    description=(
        "Analyzes a completed simulation run against Belfast Agenda 2035 targets. "
        "Returns A-F grades for Sustainability, Congestion, and Equity, "
        "plus actionable infrastructure recommendations."
    ),
)
async def get_scorecard(
    scenario_id: str,
    run_id: str,
    repo: RunRepository = Depends(get_run_repo),
    scenario_repo: ScenarioRepository = Depends(get_scenario_repo),
):
    try:
        parsed_id = uuid.UUID(run_id)
        parsed_scenario_id = uuid.UUID(scenario_id)
    except ValueError:
        raise HTTPException(400, "Invalid UUID format")

    run = await repo.get_run_by_scenario(parsed_scenario_id, parsed_id)
    if not run:
        raise HTTPException(404, "Run not found")

    if run.status != RunStatus.COMPLETED:
        raise HTTPException(400, "Scorecard is only available for completed runs")

    scenario = await scenario_repo.get_scenario(parsed_scenario_id)
    target_year = scenario.target_year if scenario else 2026

    total_agents = (scenario.plan_params or {}).get("maxAgents", 1000) if scenario else 1000

    return await analyze_run(
        target_year=target_year,
        total_agents=total_agents,
        total_events=run.event_count,
    )
