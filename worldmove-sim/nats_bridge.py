import asyncio
import json
import logging
import uuid

import nats
from nats.js import JetStreamContext

from config import get_settings
from engine import WorldMoveData, trajectory_to_link_events

logger = logging.getLogger(__name__)


class NatsBridge:
    def __init__(self, js: JetStreamContext, data: WorldMoveData):
        self.js = js
        self.data = data
        self._tasks: dict[str, asyncio.Task] = {}

    async def ensure_stream(self):
        try:
            await self.js.add_stream(
                name="SIMULATIONS",
                subjects=["sim.>"],
                max_msgs_per_subject=100_000,
            )
        except Exception:
            pass

    async def start_simulation(
        self,
        scenario_id: str,
        run_id: str,
        max_agents: int = 10000,
    ) -> str:
        simulation_id = str(uuid.uuid4())
        task = asyncio.create_task(
            self._run_simulation(scenario_id, run_id, max_agents, simulation_id)
        )
        self._tasks[simulation_id] = task
        return simulation_id

    async def _publish_status(
        self, scenario_id: str, run_id: str, status: str, progress: float, event_count: int, agent_count: int
    ):
        subject = f"sim.{scenario_id}.{run_id}.status"
        payload = json.dumps({
            "status": status,
            "progress": progress,
            "event_count": event_count,
            "agent_count": agent_count,
        })
        await self.js.publish(subject, payload.encode())

    async def _run_simulation(
        self,
        scenario_id: str,
        run_id: str,
        max_agents: int,
        simulation_id: str,
    ):
        settings = get_settings()
        event_subject = f"sim.{scenario_id}.{run_id}.events"
        trajectories = self.data.trajectories
        grid_coords = self.data.grid

        agent_count = min(max_agents, len(trajectories))
        total_events = 0

        await self._publish_status(scenario_id, run_id, "RUNNING", 0.0, 0, agent_count)

        try:
            batch = []
            for i in range(agent_count):
                agent_id = f"wm-{i}"
                events = trajectory_to_link_events(
                    trajectories[i],
                    agent_id,
                    grid_coords,
                    settings.step_duration_seconds,
                )

                for event in events:
                    batch.append(event)
                    if len(batch) >= settings.event_batch_size:
                        payload = json.dumps(batch)
                        await self.js.publish(event_subject, payload.encode())
                        total_events += len(batch)
                        batch = []

                if i % 1000 == 0 and i > 0:
                    progress = i / agent_count
                    await self._publish_status(
                        scenario_id, run_id, "RUNNING", progress, total_events, agent_count
                    )
                    await asyncio.sleep(0)

            if batch:
                payload = json.dumps(batch)
                await self.js.publish(event_subject, payload.encode())
                total_events += len(batch)

            await self._publish_status(
                scenario_id, run_id, "COMPLETED", 1.0, total_events, agent_count
            )
            logger.info(
                f"Simulation {simulation_id} completed: "
                f"{agent_count} agents, {total_events} events"
            )

        except Exception as e:
            logger.exception(f"Simulation {simulation_id} failed")
            await self._publish_status(
                scenario_id, run_id, "FAILED", 0.0, total_events, agent_count
            )

    async def subscribe_configs(self):
        await self.ensure_stream()

        sub = await self.js.subscribe(
            "sim.worldmove.config",
            durable="worldmove-engine",
        )
        logger.info("Subscribed to sim.worldmove.config")

        async for msg in sub.messages:
            try:
                config = json.loads(msg.data.decode())
                scenario_id = config["scenario_id"]
                run_id = config["run_id"]
                max_agents = config.get("max_agents", 10000)

                logger.info(f"Received config for {scenario_id}/{run_id}")
                await self.start_simulation(scenario_id, run_id, max_agents)
                await msg.ack()
            except Exception:
                logger.exception("Failed to process simulation config")
                await msg.nak()
