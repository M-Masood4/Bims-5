import random
from dataclasses import dataclass
from enum import Enum


class ActivityType(str, Enum):
    HOME = "home"
    WORK = "work"
    EDUCATION = "education"
    SHOPPING = "shopping"
    LEISURE = "leisure"
    ERRANDS = "errands"


@dataclass
class Activity:
    type: ActivityType
    cell_id: int
    start_time: float
    duration: float


ACTIVITY_PROFILES = {
    "worker": [
        (ActivityType.HOME, 0, 7 * 3600, 1.0),
        (ActivityType.WORK, 7, 8 * 3600, 0.9),
        (ActivityType.SHOPPING, 17, 1 * 3600, 0.3),
        (ActivityType.HOME, 18, 6 * 3600, 1.0),
    ],
    "student": [
        (ActivityType.HOME, 0, 7.5 * 3600, 1.0),
        (ActivityType.EDUCATION, 8, 6 * 3600, 0.95),
        (ActivityType.LEISURE, 15, 2 * 3600, 0.4),
        (ActivityType.HOME, 17, 7 * 3600, 1.0),
    ],
    "stay_home": [
        (ActivityType.HOME, 0, 10 * 3600, 1.0),
        (ActivityType.SHOPPING, 10, 1.5 * 3600, 0.5),
        (ActivityType.HOME, 12, 4 * 3600, 1.0),
        (ActivityType.ERRANDS, 16, 1 * 3600, 0.3),
        (ActivityType.HOME, 17, 7 * 3600, 1.0),
    ],
}

PROFILE_WEIGHTS = {"worker": 0.55, "student": 0.20, "stay_home": 0.25}


def _jitter(value: float, pct: float = 0.15) -> float:
    return value * random.uniform(1 - pct, 1 + pct)


class ActivityChainGenerator:
    def __init__(self, poi_data: dict[int, list[float]] | None = None):
        self.poi_data = poi_data or {}

    def _select_profile(self) -> str:
        profiles = list(PROFILE_WEIGHTS.keys())
        weights = list(PROFILE_WEIGHTS.values())
        return random.choices(profiles, weights=weights, k=1)[0]

    def generate_chain(self, home_cell: int, destination_cells: list[int]) -> list[Activity]:
        profile_name = self._select_profile()
        profile = ACTIVITY_PROFILES[profile_name]
        chain = []
        dest_idx = 0

        for activity_type, start_hour, duration, probability in profile:
            if random.random() > probability:
                continue

            if activity_type == ActivityType.HOME:
                cell = home_cell
            elif dest_idx < len(destination_cells):
                cell = destination_cells[dest_idx]
                dest_idx += 1
            else:
                cell = home_cell

            chain.append(Activity(
                type=activity_type,
                cell_id=cell,
                start_time=_jitter(start_hour * 3600 if isinstance(start_hour, int) else start_hour),
                duration=_jitter(duration),
            ))

        return chain

    def chain_to_trajectory(self, chain: list[Activity], time_steps: int = 48) -> list[int]:
        step_duration = 24 * 3600 / time_steps
        trajectory = []

        for step in range(time_steps):
            t = step * step_duration
            current_cell = chain[0].cell_id
            for act in chain:
                if act.start_time <= t:
                    current_cell = act.cell_id
            trajectory.append(current_cell)

        return trajectory
