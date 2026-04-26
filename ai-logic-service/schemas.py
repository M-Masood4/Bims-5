from pydantic import BaseModel, Field


class GroundingRequest(BaseModel):
    target_year: int = Field(description="Simulation target year")
    agent_count: int = Field(default=1000, description="Number of agents")
    mode_split: dict[str, float] | None = Field(default=None, description="Current mode split (car, pt, walk, cycle)")
    ev_percentage: float = Field(default=0.0, description="Current EV percentage")
    scenario_name: str = Field(default="", description="Name of the scenario")
    future_layers: list[str] = Field(default_factory=list, description="Active future layer IDs")


class GroundedConfig(BaseModel):
    ev_percentage: float = Field(description="Adjusted EV adoption percentage")
    mode_split: dict[str, float] = Field(description="Policy-adjusted mode split")
    rationale: list[str] = Field(description="Explanation of each adjustment")
    policy_refs: list[str] = Field(description="Referenced policy targets")


class AnalysisRequest(BaseModel):
    target_year: int = Field(description="Simulation year")
    total_agents: int = Field(description="Number of agents simulated")
    total_events: int = Field(description="Total simulation events")
    avg_trip_duration_min: float = Field(default=0.0, description="Average trip duration in minutes")
    mode_split: dict[str, float] = Field(default_factory=dict, description="Observed mode split")
    congested_links: list[str] = Field(default_factory=list, description="IDs of links above capacity")
    ev_percentage: float = Field(default=0.0, description="EV adoption percentage")
    co2_tonnes: float = Field(default=0.0, description="Estimated CO2 emissions in tonnes")
    active_travel_pct: float = Field(default=0.0, description="Percentage of walking + cycling trips")
    future_layers: list[str] = Field(default_factory=list, description="Active future layer IDs")


class ScorecardGrade(BaseModel):
    category: str = Field(description="Category name")
    grade: str = Field(description="A-F grade")
    score: float = Field(description="Numeric score 0-100")
    target: str = Field(description="Policy target referenced")
    finding: str = Field(description="Key finding explanation")


class Scorecard(BaseModel):
    overall_grade: str = Field(description="Overall A-F grade")
    grades: list[ScorecardGrade] = Field(description="Category grades")
    actionable_advice: list[str] = Field(description="Specific infrastructure recommendations")
    future_layer_suggestions: list[dict] = Field(description="Suggested new infrastructure layers")
