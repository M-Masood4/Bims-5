from dataclasses import dataclass


@dataclass
class LinkEvent:
    event_type: str
    time: float
    agent_id: str
    from_cell: int
    to_cell: int
    lng: float
    lat: float


class TrajectoryConverter:
    def __init__(self, grid_coords: dict[str, list[float]], step_duration: float = 1800.0):
        self.grid_coords = grid_coords
        self.step_duration = step_duration

    def convert(self, trajectory: list[int], agent_id: str) -> list[LinkEvent]:
        events = []
        for step in range(len(trajectory) - 1):
            from_cell = trajectory[step]
            to_cell = trajectory[step + 1]

            if from_cell == to_cell:
                continue

            time = step * self.step_duration
            from_coords = self.grid_coords.get(str(from_cell), [0, 0])
            to_coords = self.grid_coords.get(str(to_cell), [0, 0])

            events.append(LinkEvent(
                event_type="linkLeave",
                time=time,
                agent_id=agent_id,
                from_cell=from_cell,
                to_cell=to_cell,
                lng=from_coords[0],
                lat=from_coords[1],
            ))
            events.append(LinkEvent(
                event_type="linkEnter",
                time=time + 1.0,
                agent_id=agent_id,
                from_cell=from_cell,
                to_cell=to_cell,
                lng=to_coords[0],
                lat=to_coords[1],
            ))

        return events

    def to_dicts(self, events: list[LinkEvent]) -> list[dict]:
        return [
            {
                "type": e.event_type,
                "time": e.time,
                "agent_id": e.agent_id,
                "link_id": f"{e.from_cell}-{e.to_cell}",
                "cell_id": e.to_cell if e.event_type == "linkEnter" else e.from_cell,
                "lng": e.lng,
                "lat": e.lat,
            }
            for e in events
        ]
