import asyncio
import json
from collections.abc import AsyncGenerator, Awaitable, Callable

from nats.js import JetStreamContext
from nats.errors import TimeoutError as NatsTimeoutError
from fastapi import Request

class RunEventConsumer:
    def __init__(self, js: JetStreamContext, run_id: str):
        self.js = js
        self.run_id = run_id
        self.stream_name = f"run_{run_id.replace('-', '_')}"
        self.subject = f"run.{run_id}.events"

    async def stream_events(
        self,
        request: Request,
        is_replay: bool,
        check_done: Callable[[], Awaitable[bool]]
    ) -> AsyncGenerator[dict, None]:
        """
        Streams events from NATS JetStream.
        If is_replay is True, it stops once it reaches the end of the current stream.
        """
        try:
            # Replay means we start from the beginning
            # Non-replay means we start from now
            sub = await self.js.subscribe(
                self.subject,
                deliver_policy="all" if is_replay else "new",
            )

            # For replay, we need to know how many messages are in the stream right now
            last_seq = 0
            if is_replay:
                try:
                    stream_info = await self.js.stream_info(self.stream_name)
                    last_seq = stream_info.state.last_seq
                except Exception:
                    # Stream might not exist yet if no events fired
                    last_seq = 0

            while True:
                if await request.is_disconnected():
                    break

                try:
                    msg = await sub.next_msg(timeout=1.0)
                    await msg.ack()
                    
                    data = json.loads(msg.data.decode())
                    yield {
                        "event": "message",
                        "id": str(msg.metadata.sequence.stream),
                        "data": json.dumps(data)
                    }

                    # If we are replaying and just hit the last sequence that existed when we started, stop.
                    if is_replay and msg.metadata.sequence.stream >= last_seq:
                        break

                except NatsTimeoutError:
                    # If not replaying, check if the run is actually finished
                    if not is_replay:
                        if await check_done():
                            # One last check for any messages that arrived while checking
                            break
                    continue

        except Exception as e:
            yield {
                "event": "error",
                "data": json.dumps({"error": str(e)})
            }
        finally:
            if 'sub' in locals():
                await sub.unsubscribe()
