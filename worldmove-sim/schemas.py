from enum import Enum
from pydantic import BaseModel, Field


class EngineType(str, Enum):
    MATSIM = "MATSIM"
    WORLDMOVE = "WORLDMOVE"


class SimulationConfig(BaseModel):
    scenario_id: str = Field(description="Parent scenario UUID")
    run_id: str = Field(description="Run UUID")
    npz_path: str = Field(description="Path to WorldMove NPZ data file")
    max_agents: int = Field(default=10000, description="Maximum agents to simulate")
    time_steps: int = Field(default=48, description="Number of time steps in trajectory")
    step_duration_seconds: float = Field(default=1800.0, description="Real-world seconds per time step (default 30min)")


class SimulationEvent(BaseModel):
    type: str = Field(description="Event type: linkEnter, linkLeave, actStart, actEnd, departure, arrival")
    time: float = Field(description="Simulation time in seconds")
    agent_id: str = Field(description="Agent identifier")
    link_id: str | None = Field(default=None, description="Link identifier (grid cell pair)")
    cell_id: int | None = Field(default=None, description="Grid cell index")
    lat: float | None = Field(default=None, description="Latitude of event")
    lng: float | None = Field(default=None, description="Longitude of event")


class SimulationStatus(BaseModel):
    status: str = Field(description="RUNNING, COMPLETED, or FAILED")
    progress: float = Field(default=0.0, description="Progress 0.0 to 1.0")
    event_count: int = Field(default=0, description="Total events emitted")
    agent_count: int = Field(default=0, description="Total agents simulated")


class SimulationStartResult(BaseModel):
    simulation_id: str = Field(description="Unique simulation run ID")
    scenario_id: str = Field(description="Parent scenario UUID")
    run_id: str = Field(description="Run UUID")
    status: str = Field(default="RUNNING")
