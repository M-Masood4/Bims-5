import json
import sys
import types
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from api import runs as runs_module
from dependencies import get_run_repo, get_scenario_repo, get_sim_engine


SCENARIO_ID = "11111111-1111-1111-1111-111111111111"
VALID_BOUNDS = json.dumps(
    {"minLat": 51.5, "minLng": -0.1, "maxLat": 51.6, "maxLng": 0.0}
)


def _make_run_record():
    return SimpleNamespace(
        id=uuid.uuid4(),
        scenario_id=uuid.UUID(SCENARIO_ID),
        status="PENDING",
    )


def _make_app(run_repo, scenario_repo, sim_engine):
    app = FastAPI()
    app.include_router(runs_module.router)
    app.dependency_overrides[get_run_repo] = lambda: run_repo
    app.dependency_overrides[get_scenario_repo] = lambda: scenario_repo
    app.dependency_overrides[get_sim_engine] = lambda: sim_engine
    return app


def _mocks(create_run_return=None, sim_id="sim-test-123"):
    run_repo = SimpleNamespace(
        create_run=AsyncMock(return_value=create_run_return or _make_run_record()),
        update_status=AsyncMock(),
    )
    scenario_repo = SimpleNamespace(
        get_scenario=AsyncMock(return_value=SimpleNamespace(plan_params={})),
    )
    sim_engine = SimpleNamespace(
        start=AsyncMock(return_value=SimpleNamespace(simulation_id=sim_id)),
    )
    return run_repo, scenario_repo, sim_engine


def _patch_plan_generation(monkeypatch):
    monkeypatch.setattr(
        runs_module,
        "parse_buildings_and_bounds",
        lambda buildings, bounds: (
            json.loads(buildings) if buildings else [],
            json.loads(bounds) if bounds else {},
        ),
    )

    def _fake_generate(bounds_dict, buildings_list, agent_config, max_agents):
        return "<plans/>"

    monkeypatch.setattr(runs_module, "generate_plans_xml", _fake_generate)


def test_oversized_buildings_part_returns_413():
    run_repo, scenario_repo, sim_engine = _mocks()
    app = _make_app(run_repo, scenario_repo, sim_engine)
    client = TestClient(app)

    oversized = b"[" + (b'"' + b"x" * 1048580 + b'"') + b"]"
    assert len(oversized) > 1048576

    files = [
        ("networkFile", ("net.xml", b"<network/>", "application/xml")),
        ("buildingsFiles", ("buildings-part-0.json", oversized, "application/json")),
    ]
    data = {
        "bounds": VALID_BOUNDS,
        "buildingsTransport": "file-parts-v1",
        "buildingsSchemaVersion": "1",
        "buildingsPartCount": "1",
    }
    response = client.post(
        f"/scenarios/{SCENARIO_ID}/runs/start", files=files, data=data
    )

    assert response.status_code == 413, response.text
    assert response.json()["detail"] == "buildingsFiles part exceeds 1048576 bytes"
    run_repo.create_run.assert_not_awaited()


def test_mismatched_part_count_returns_400():
    run_repo, scenario_repo, sim_engine = _mocks()
    app = _make_app(run_repo, scenario_repo, sim_engine)
    client = TestClient(app)

    files = [
        ("networkFile", ("net.xml", b"<network/>", "application/xml")),
        ("buildingsFiles", ("buildings-part-0.json", b"[]", "application/json")),
        ("buildingsFiles", ("buildings-part-1.json", b"[]", "application/json")),
    ]
    data = {
        "bounds": VALID_BOUNDS,
        "buildingsTransport": "file-parts-v1",
        "buildingsSchemaVersion": "1",
        "buildingsPartCount": "3",
    }
    response = client.post(
        f"/scenarios/{SCENARIO_ID}/runs/start", files=files, data=data
    )

    assert response.status_code == 400, response.text
    assert "buildingsPartCount does not match" in response.json()["detail"]
    run_repo.create_run.assert_not_awaited()


def test_unsupported_schema_version_returns_400():
    run_repo, scenario_repo, sim_engine = _mocks()
    app = _make_app(run_repo, scenario_repo, sim_engine)
    client = TestClient(app)

    files = [
        ("networkFile", ("net.xml", b"<network/>", "application/xml")),
        ("buildingsFiles", ("buildings-part-0.json", b"[]", "application/json")),
    ]
    data = {
        "bounds": VALID_BOUNDS,
        "buildingsTransport": "file-parts-v1",
        "buildingsSchemaVersion": "2",
        "buildingsPartCount": "1",
    }
    response = client.post(
        f"/scenarios/{SCENARIO_ID}/runs/start", files=files, data=data
    )

    assert response.status_code == 400, response.text
    assert "Unsupported buildingsSchemaVersion" in response.json()["detail"]
    run_repo.create_run.assert_not_awaited()


def test_valid_file_parts_v1_proceeds(monkeypatch):
    run_repo, scenario_repo, sim_engine = _mocks()
    app = _make_app(run_repo, scenario_repo, sim_engine)
    _patch_plan_generation(monkeypatch)
    client = TestClient(app)

    part_a = json.dumps([
        {"id": "b1", "position": [51.5, -0.1], "type": "residential", "tags": {}, "hotspot": False}
    ]).encode()
    part_b = json.dumps([
        {"id": "b2", "position": [51.55, -0.05], "type": "office", "tags": {}, "hotspot": True}
    ]).encode()

    files = [
        ("networkFile", ("net.xml", b"<network/>", "application/xml")),
        ("buildingsFiles", ("buildings-part-0.json", part_a, "application/json")),
        ("buildingsFiles", ("buildings-part-1.json", part_b, "application/json")),
    ]
    data = {
        "bounds": VALID_BOUNDS,
        "buildingsTransport": "file-parts-v1",
        "buildingsSchemaVersion": "1",
        "buildingsPartCount": "2",
        "iterations": "1",
    }
    response = client.post(
        f"/scenarios/{SCENARIO_ID}/runs/start", files=files, data=data
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["simulation_id"] == "sim-test-123"
    assert body["scenario_id"] == SCENARIO_ID
    run_repo.create_run.assert_awaited_once()
    sim_engine.start.assert_awaited_once()
