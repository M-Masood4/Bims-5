from typing import TYPE_CHECKING, Protocol

from agents.models import Agent, DailyPlan
from agents.config import AgentConfig

if TYPE_CHECKING:
    from agents.plans.plan_generator import PlanContext


class PlanStrategy(Protocol):
    def supports(self, agent: Agent, config: AgentConfig) -> bool: ...
    def generate(self, agent: Agent, ctx: "PlanContext", config: AgentConfig) -> DailyPlan | None: ...
