import logging
from pathlib import Path

import numpy as np
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

NPZ_DIR = Path(__file__).parent.parent / "worldmove-sim" / "data"


class GridCell(BaseModel):
    id: int = Field(description="Grid cell index")
    lng: float = Field(description="Center longitude")
    lat: float = Field(description="Center latitude")
    population: float = Field(description="WorldPop population estimate")
    poi_counts: list[float] = Field(description="POI counts per type (34 types)")


class AdjacencyEntry(BaseModel):
    cell: int = Field(description="Source cell index")
    neighbors: list[int] = Field(description="Adjacent cell indices (queen contiguity)")


class WorldMoveExport(BaseModel):
    city: str = Field(description="City identifier")
    grid_shape: tuple[int, int] = Field(description="(rows, cols) of the grid")
    cells: list[GridCell] = Field(description="Grid cells with coordinates and data")
    adjacency: list[AdjacencyEntry] = Field(description="Adjacency list for each cell")
    trajectory_count: int = Field(description="Number of available trajectories")
    time_steps: int = Field(description="Steps per trajectory")


class TrajectoryExport(BaseModel):
    trajectories: list[list[dict]] = Field(description="List of trajectories as coordinate sequences")
    total: int = Field(description="Total available trajectories")


def load_npz(city_file: str) -> dict:
    path = NPZ_DIR / city_file
    if not path.exists():
        raise FileNotFoundError(f"WorldMove data not found: {path}")
    return np.load(str(path), allow_pickle=True)


def export_grid_data(city_file: str = "154_GB_Belfast.npz") -> WorldMoveExport:
    data = load_npz(city_file)
    grid = data["grid"].item()
    pop = data["pop"]
    poi = data["poi"]
    traj = data["traj"]

    rows, cols = pop.shape
    cells = []

    for r in range(rows):
        for c in range(cols):
            idx = r * cols + c
            coords = grid.get(str(idx))
            if coords is None:
                continue
            cells.append(GridCell(
                id=idx,
                lng=coords[0],
                lat=coords[1],
                population=float(pop[r, c]),
                poi_counts=[float(x) for x in poi[r, c]],
            ))

    adjacency = []
    for r in range(rows):
        for c in range(cols):
            cell = r * cols + c
            neighbors = []
            for dr in [-1, 0, 1]:
                for dc in [-1, 0, 1]:
                    if dr == 0 and dc == 0:
                        continue
                    nr, nc_val = r + dr, c + dc
                    if 0 <= nr < rows and 0 <= nc_val < cols:
                        neighbors.append(nr * cols + nc_val)
            adjacency.append(AdjacencyEntry(cell=cell, neighbors=neighbors))

    city_name = city_file.replace(".npz", "").split("_", 1)[-1]

    return WorldMoveExport(
        city=city_name,
        grid_shape=(rows, cols),
        cells=cells,
        adjacency=adjacency,
        trajectory_count=traj.shape[0],
        time_steps=traj.shape[1],
    )


def export_trajectories(
    city_file: str = "154_GB_Belfast.npz",
    limit: int = 100,
    offset: int = 0,
) -> TrajectoryExport:
    data = load_npz(city_file)
    grid = data["grid"].item()
    traj = data["traj"]

    selected = traj[offset:offset + limit]
    result = []

    for trajectory in selected:
        coords = []
        for cell_idx in trajectory:
            cell_str = str(int(cell_idx))
            if cell_str in grid:
                c = grid[cell_str]
                coords.append({"lng": c[0], "lat": c[1], "cell": int(cell_idx)})
        result.append(coords)

    return TrajectoryExport(trajectories=result, total=int(traj.shape[0]))
