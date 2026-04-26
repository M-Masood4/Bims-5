from dataclasses import dataclass
from typing import Protocol

import httpx


@dataclass
class SimulationStartResult:
    simulation_id: str


class SimulationEnginePort(Protocol):
    async def start(
        self,
        scenario_id: str,
        run_id: str,
        network_filename: str,
        network_file: bytes,
        network_content_type: str,
        plans_xml: str,
        iterations: int,
        random_seed: int | None,
    ) -> SimulationStartResult: ...


class HttpSimEngineAdapter:
    def __init__(self, base_url: str, client: httpx.AsyncClient | None = None):
        self.base_url = base_url
        self._client = client

    async def start(
        self,
        scenario_id: str,
        run_id: str,
        network_filename: str,
        network_file: bytes,
        network_content_type: str,
        plans_xml: str,
        iterations: int,
        random_seed: int | None,
    ) -> SimulationStartResult:
        files = {
            "networkFile": (network_filename, network_file, network_content_type),
            "plansFile": ("plans.xml", plans_xml, "application/xml"),
        }
        data = {"iterations": iterations, "scenarioId": scenario_id, "runId": run_id}
        if random_seed is not None:
            data["randomSeed"] = random_seed

        client = self._client or httpx.AsyncClient()
        owns_client = self._client is None
        try:
            response = await client.post(
                f"{self.base_url}/api/simulations",
                files=files,
                data=data,
                timeout=60.0,
            )
            response.raise_for_status()
            return SimulationStartResult(simulation_id=response.json()["simulationId"])
        finally:
            if owns_client:
                await client.aclose()
