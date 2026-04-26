import logging
import numpy as np
from pathlib import Path

logger = logging.getLogger(__name__)


class WorldMoveData:
    def __init__(self, npz_path: str):
        self.npz_path = npz_path
        self._data = None
        self._grid_coords = None

    def load(self):
        logger.info(f"Loading WorldMove data from {self.npz_path}")
        self._data = np.load(self.npz_path, allow_pickle=True)
        self._grid_coords = self._data["grid"].item()
        logger.info(
            f"Loaded: {self.trajectory_count} trajectories, "
            f"{self.cell_count} cells, "
            f"{self.total_population:.0f} population"
        )

    @property
    def grid(self) -> dict[int, list[float]]:
        return self._grid_coords

    @property
    def population(self) -> np.ndarray:
        return self._data["pop"]

    @property
    def poi(self) -> np.ndarray:
        return self._data["poi"]

    @property
    def trajectories(self) -> np.ndarray:
        return self._data["traj"]

    @property
    def cell_count(self) -> int:
        return len(self._grid_coords)

    @property
    def trajectory_count(self) -> int:
        return self.trajectories.shape[0]

    @property
    def time_steps(self) -> int:
        return self.trajectories.shape[1]

    @property
    def total_population(self) -> float:
        return float(self.population.sum())

    @property
    def grid_shape(self) -> tuple[int, int]:
        return self.population.shape

    def cell_coords(self, cell_idx: int) -> tuple[float, float]:
        coords = self._grid_coords[str(cell_idx)]
        return (coords[1], coords[0])

    def cell_coords_lnglat(self, cell_idx: int) -> tuple[float, float]:
        coords = self._grid_coords[str(cell_idx)]
        return (coords[0], coords[1])


def build_adjacency(grid_shape: tuple[int, int]) -> dict[int, list[int]]:
    rows, cols = grid_shape
    adjacency: dict[int, list[int]] = {}
    for r in range(rows):
        for c in range(cols):
            cell = r * cols + c
            neighbors = []
            for dr in [-1, 0, 1]:
                for dc in [-1, 0, 1]:
                    if dr == 0 and dc == 0:
                        continue
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < rows and 0 <= nc < cols:
                        neighbors.append(nr * cols + nc)
            adjacency[cell] = neighbors
    return adjacency


def trajectory_to_link_events(
    trajectory: np.ndarray,
    agent_id: str,
    grid_coords: dict[int, list[float]],
    step_duration: float = 1800.0,
) -> list[dict]:
    events = []
    for step in range(len(trajectory) - 1):
        from_cell = int(trajectory[step])
        to_cell = int(trajectory[step + 1])
        time = step * step_duration

        if from_cell == to_cell:
            continue

        from_coords = grid_coords[str(from_cell)]
        to_coords = grid_coords[str(to_cell)]
        link_id = f"{from_cell}-{to_cell}"

        events.append({
            "type": "linkLeave",
            "time": time,
            "agentId": agent_id,
            "linkId": link_id,
            "activityType": None,
            "x": from_coords[0],
            "y": from_coords[1],
        })
        events.append({
            "type": "linkEnter",
            "time": time + 1.0,
            "agentId": agent_id,
            "linkId": link_id,
            "activityType": None,
            "x": to_coords[0],
            "y": to_coords[1],
        })

    return events
