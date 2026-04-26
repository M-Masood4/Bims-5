import asyncio
import logging
import uuid

import nats.js.errors
from nats.js import JetStreamContext

from trafficjam_be.db.database import async_session_factory
from trafficjam_be.db.repository import RunRepository
from trafficjam_be.schemas.run import RunStatus, StatusMessage

logger = logging.getLogger(__name__)


def map_status(sim_status: str) -> RunStatus | None:
    match sim_status:
        # Based on SimEngine status names
        case "STARTED":
            return RunStatus.RUNNING
        case "COMPLETED":
            return RunStatus.COMPLETED
        case "FAILED":
            return RunStatus.FAILED
        case _:
            return None


async def monitor_all_statuses(js: JetStreamContext):
    repo = RunRepository(async_session_factory)

    while True:
        try:
            sub = await js.subscribe("simulation.status.*")
            async for msg in sub.messages:
                run_id = msg.subject.split(".")[-1]
                try:
                    status_raw = msg.data.decode()
                    status_msg = StatusMessage.model_validate_json(status_raw)
                    new_status = map_status(status_msg.status)
                    if new_status:
                        event_count = status_msg.event_count if status_msg.event_count > 0 else None
                        await repo.update_status(
                            uuid.UUID(run_id),
                            new_status,
                            event_count=event_count,
                        )
                        logger.info(f"Run {run_id} → {new_status.value} (events={status_msg.event_count})")
                    await msg.ack()
                except Exception as e:
                    logger.error(f"Status update failed for {run_id}: {e}")
        except Exception as e:
            logger.warning(f"Status monitor subscription error, retrying in 5s: {e}")
            await asyncio.sleep(5)
