import math
import random
from dataclasses import dataclass


@dataclass
class ODPair:
    origin: int
    destination: int
    flow: float


class GravityDemandGenerator:
    def __init__(
        self,
        population: dict[int, float],
        grid_coords: dict[str, list[float]],
        beta: float = 1.5,
        distance_decay: float = 2.0,
    ):
        self.population = population
        self.grid_coords = grid_coords
        self.beta = beta
        self.distance_decay = distance_decay

    def _distance(self, cell_a: int, cell_b: int) -> float:
        ca = self.grid_coords[str(cell_a)]
        cb = self.grid_coords[str(cell_b)]
        dlat = math.radians(cb[1] - ca[1])
        dlng = math.radians(cb[0] - ca[0])
        a = (
            math.sin(dlat / 2) ** 2
            + math.cos(math.radians(ca[1]))
            * math.cos(math.radians(cb[1]))
            * math.sin(dlng / 2) ** 2
        )
        return 6371.0 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    def generate_od_matrix(self, cells: list[int]) -> list[ODPair]:
        od_pairs = []
        for origin in cells:
            pop_o = self.population.get(origin, 0)
            if pop_o <= 0:
                continue

            weights = []
            for dest in cells:
                if dest == origin:
                    weights.append((dest, 0.0))
                    continue
                pop_d = self.population.get(dest, 0)
                dist = max(self._distance(origin, dest), 0.5)
                attraction = (pop_d ** self.beta) / (dist ** self.distance_decay)
                weights.append((dest, attraction))

            total_attraction = sum(w for _, w in weights)
            if total_attraction <= 0:
                continue

            for dest, attraction in weights:
                if attraction <= 0:
                    continue
                flow = pop_o * (attraction / total_attraction)
                if flow >= 0.1:
                    od_pairs.append(ODPair(origin=origin, destination=dest, flow=flow))

        return od_pairs

    def sample_destinations(self, origin: int, cells: list[int], n: int = 1) -> list[int]:
        pop_o = self.population.get(origin, 0)
        if pop_o <= 0:
            return [random.choice(cells) for _ in range(n)]

        weights = []
        valid_cells = []
        for dest in cells:
            if dest == origin:
                continue
            pop_d = self.population.get(dest, 0)
            dist = max(self._distance(origin, dest), 0.5)
            w = (pop_d ** self.beta) / (dist ** self.distance_decay)
            if w > 0:
                weights.append(w)
                valid_cells.append(dest)

        if not valid_cells:
            return [random.choice(cells) for _ in range(n)]

        return random.choices(valid_cells, weights=weights, k=n)
