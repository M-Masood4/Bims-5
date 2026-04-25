import json
from io import StringIO
from typing import Iterable

from agents.agent_creation import create_agents_from_network
from agents.config import AgentConfig
from agents.models import Building
from agents.plans.plan_generator import generate_plan_for_agent
from agents.plans.xml_writer import MATSimXMLWriter


def parse_buildings_and_bounds(
    buildings_json: str, bounds_json: str
) -> tuple[list[Building], dict]:
    buildings = [Building.model_validate(b) for b in json.loads(buildings_json)]
    bounds = json.loads(bounds_json)
    bounds = {
        "north": bounds.get("north", bounds.get("maxLat")),
        "south": bounds.get("south", bounds.get("minLat")),
        "east": bounds.get("east", bounds.get("maxLng")),
        "west": bounds.get("west", bounds.get("minLng")),
    }
    return buildings, bounds


def reassemble_run_buildings(
    parts: Iterable[tuple[str, bytes]],
) -> list[Building]:
    """Reassemble file-parts-v1 building parts into Building models.

    Each part is the bytes of a JSON array of run-building records shaped
    `{id, position, type, tags, hotspot}`. Parts are sorted by filename so
    the deterministic frontend order is preserved. Backend Building models
    are reconstructed with `osm_id=0` and `geometry=[position]` because the
    plan generator does not read building geometry; this keeps simulation
    behavior unchanged while staying under the multipart byte ceiling.
    """
    ordered = sorted(parts, key=lambda item: item[0])
    records: list[dict] = []
    for filename, content in ordered:
        try:
            decoded = json.loads(content.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            raise ValueError(f"Invalid JSON in {filename or '<unnamed>'}: {e}") from e
        if not isinstance(decoded, list):
            raise ValueError(
                f"Building part {filename or '<unnamed>'} must be a JSON array"
            )
        records.extend(decoded)

    buildings: list[Building] = []
    for index, raw in enumerate(records):
        if not isinstance(raw, dict):
            raise ValueError(f"Building record at index {index} must be an object")
        position = raw.get("position")
        if not isinstance(position, (list, tuple)) or len(position) != 2:
            raise ValueError(
                f"Building record at index {index} missing valid `position`"
            )
        merged = {
            "osm_id": raw.get("osm_id", 0),
            "geometry": raw.get("geometry") or [tuple(position)],
            **raw,
        }
        merged["position"] = tuple(position)
        merged["geometry"] = [tuple(p) for p in merged["geometry"]]
        buildings.append(Building.model_validate(merged))

    return buildings


def parse_bounds(bounds_json: str) -> dict:
    bounds = json.loads(bounds_json)
    return {
        "north": bounds.get("north", bounds.get("maxLat")),
        "south": bounds.get("south", bounds.get("minLat")),
        "east": bounds.get("east", bounds.get("maxLng")),
        "west": bounds.get("west", bounds.get("minLng")),
    }


def generate_plans_xml(
    bounds: dict,
    buildings: list[Building],
    agent_config: AgentConfig,
    max_agents: int,
) -> str:
    writer = MATSimXMLWriter()
    writer.create_plans_document()

    agents = create_agents_from_network(
        bounds=bounds,
        buildings=buildings,
        transport_routes=[],
        country_code="IRL",
        agent_config=agent_config,
        max_agents=max_agents,
    )

    for agent in agents:
        plan = generate_plan_for_agent(agent, buildings, agent_config)
        if plan:
            writer.add_person_plan(agent.id, plan)

    stream = StringIO()
    writer.write_to_stream(stream)
    return stream.getvalue()
