import json
from dataclasses import dataclass

from nats.js import JetStreamContext

from adapters.simengine import SimulationStartResult


class NatsWorldMoveAdapter:
    def __init__(self, js: JetStreamContext):
        self.js = js

    async def start(
        self,
        scenario_id: str,
        run_id: str,
        max_agents: int = 10000,
        npz_path: str = "154_GB_Belfast.npz",
    ) -> SimulationStartResult:
        config = {
            "scenario_id": scenario_id,
            "run_id": run_id,
            "max_agents": max_agents,
            "npz_path": npz_path,
        }

        await self.js.publish(
            "sim.worldmove.config",
            json.dumps(config).encode(),
        )

        return SimulationStartResult(simulation_id=run_id)
