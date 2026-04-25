import asyncio
import json
import logging
import uuid
from typing import Optional

import nats.js.errors as jserrors
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
import fastapi.responses
from sse_starlette import EventSourceResponse

from adapters.simengine import SimulationEnginePort
from agents.config import AgentConfig
from agents.plans.population import (
    generate_plans_xml,
    parse_bounds,
    parse_buildings_and_bounds,
    reassemble_run_buildings,
)
from consumers import EventConsumer
from db import RunRepository, RunStatus, ScenarioRepository
from dependencies import get_run_repo, get_scenario_repo, get_sim_engine

router = APIRouter(prefix="/scenarios", tags=["runs"])
logger = logging.getLogger(__name__)

BUILDINGS_PART_HARD_LIMIT_BYTES = 1048576
BUILDINGS_TRANSPORT_FILE_PARTS_V1 = "file-parts-v1"
BUILDINGS_SCHEMA_VERSION = 1


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
        description=(
            "Legacy compatibility fallback. JSON array of building objects used for "
            "agent plan generation. Prefer the file-parts-v1 multipart transport via "
            "buildingsFiles for any payload approaching 1MB."
        ),
    ),
    buildingsFiles: list[UploadFile] = File(
        default_factory=list,
        description=(
            "Repeated JSON file parts for the file-parts-v1 transport. Each part must "
            "be <= 1048576 bytes. Filenames should be `buildings-part-<index>.json` so "
            "ordering is deterministic on reassembly."
        ),
    ),
    buildingsTransport: Optional[str] = Form(
        None,
        description="Transport identifier for buildings payload. Use `file-parts-v1` for the new contract.",
    ),
    buildingsSchemaVersion: Optional[int] = Form(
        None,
        description="Schema version for the buildings payload contract. Currently must be 1 when transport is file-parts-v1.",
    ),
    buildingsPartCount: Optional[int] = Form(
        None,
        description="Number of `buildingsFiles` parts the client sent. Must equal len(buildingsFiles) when transport is file-parts-v1.",
    ),
    bounds: Optional[str] = Form(
        None,
        description="JSON object with bounding box (minLat, minLng, maxLat, maxLng)",
    ),
    iterations: int = Form(1, description="Number of MATSim iterations"),
    randomSeed: int | None = Form(None, description="Random seed for reproducibility"),
    note: str | None = Form(None, description="Optional annotation for this run"),
    run_repo: RunRepository = Depends(get_run_repo),
    scenario_repo: ScenarioRepository = Depends(get_scenario_repo),
    sim_engine: SimulationEnginePort = Depends(get_sim_engine),
):
    try:
        parsed_scenario_id = uuid.UUID(scenario_id)
    except ValueError:
        raise HTTPException(400, "Invalid scenario ID")

    prebuilt_buildings: Optional[list] = None

    if buildingsTransport == BUILDINGS_TRANSPORT_FILE_PARTS_V1:
        if buildingsSchemaVersion != BUILDINGS_SCHEMA_VERSION:
            raise HTTPException(400, "Unsupported buildingsSchemaVersion")
        if buildingsPartCount is None or buildingsPartCount != len(buildingsFiles):
            raise HTTPException(
                400, "buildingsPartCount does not match buildingsFiles count"
            )

        validated_parts: list[tuple[str, bytes]] = []
        for f in buildingsFiles:
            content = await f.read()
            if len(content) > BUILDINGS_PART_HARD_LIMIT_BYTES:
                raise HTTPException(
                    413, "buildingsFiles part exceeds 1048576 bytes"
                )
            validated_parts.append((f.filename or "", content))

        try:
            prebuilt_buildings = reassemble_run_buildings(validated_parts)
        except Exception as e:
            raise HTTPException(400, f"Invalid buildingsFiles payload: {e}")
    elif buildingsTransport is not None:
        raise HTTPException(400, "Unsupported buildingsTransport")

    if prebuilt_buildings is None and (not buildings or not bounds):
        raise HTTPException(
            400, "Buildings and bounds are required for plan generation."
        )
    if prebuilt_buildings is not None and not bounds:
        raise HTTPException(
            400, "Buildings and bounds are required for plan generation."
        )

    run = await run_repo.create_run(
        parsed_scenario_id,
        iterations=iterations,
        random_seed=randomSeed,
        note=note,
    )

    scenario = await scenario_repo.get_scenario(parsed_scenario_id)
    plan_params = (scenario.plan_params or {}) if scenario else {}
    agent_config = AgentConfig.from_plan_params(plan_params)
    max_agents = plan_params.get("maxAgents", 1000)

    try:
        if prebuilt_buildings is not None:
            buildings_list = prebuilt_buildings
            bounds_dict = parse_bounds(bounds) if bounds else {}
        else:
            buildings_list, bounds_dict = parse_buildings_and_bounds(buildings, bounds)
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
    return EventSourceResponse(consumer.stream_events(request, is_replay))


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
