import asyncio
import json
import logging
from google import genai

from config import get_settings
from knowledge import GROUNDING_CONTEXT, GROUNDING_SYSTEM_PROMPT
from schemas import (
    GroundingRequest,
    GroundedConfig,
    AnalysisRequest,
    Scorecard,
    ScorecardGrade,
)

logger = logging.getLogger(__name__)


def _build_client() -> genai.Client:
    settings = get_settings()
    return genai.Client(api_key=settings.gemini_api_key)


def _parse_json_block(text: str) -> dict:
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0]
    elif "```" in text:
        text = text.split("```")[1].split("```")[0]
    return json.loads(text.strip())


def _sync_generate(client: genai.Client, model: str, prompt: str, system: str, temperature: float) -> str:
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=genai.types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
        ),
    )
    return response.text


async def ground_agent_params(request: GroundingRequest) -> GroundedConfig:
    settings = get_settings()
    client = _build_client()

    prompt = f"""
{GROUNDING_CONTEXT}

Given a simulation scenario:
- Target Year: {request.target_year}
- Agent Count: {request.agent_count}
- Current Mode Split: {json.dumps(request.mode_split or {})}
- Current EV %: {request.ev_percentage}
- Scenario: {request.scenario_name}
- Active Future Layers: {json.dumps(request.future_layers)}

Adjust the agent parameters to reflect realistic {request.target_year} conditions
based on Belfast policy targets. Return a JSON object with:
{{
  "ev_percentage": <float>,
  "mode_split": {{"car": <float>, "pt": <float>, "walk": <float>, "cycle": <float>}},
  "rationale": ["reason 1", "reason 2", ...],
  "policy_refs": ["Belfast Agenda target X", ...]
}}

Respond ONLY with valid JSON, no markdown, no explanation text.
"""

    try:
        text = await asyncio.to_thread(
            _sync_generate, client, settings.gemini_model, prompt, GROUNDING_SYSTEM_PROMPT, 0.3
        )
        data = _parse_json_block(text)
        return GroundedConfig(**data)
    except Exception:
        logger.warning("Failed to parse grounding response, using defaults.")
        return _default_grounded_config(request.target_year)


async def analyze_simulation(request: AnalysisRequest) -> Scorecard:
    settings = get_settings()
    client = _build_client()

    prompt = f"""
{GROUNDING_CONTEXT}

Analyze these simulation results for Belfast in {request.target_year}:
- Total agents: {request.total_agents}
- Total events: {request.total_events}
- Average trip duration: {request.avg_trip_duration_min:.1f} minutes
- Mode split: {json.dumps(request.mode_split)}
- Congested links: {len(request.congested_links)} links over capacity
- EV adoption: {request.ev_percentage:.1f}%
- CO2 emissions: {request.co2_tonnes:.1f} tonnes
- Active travel: {request.active_travel_pct:.1f}%
- Future infrastructure layers active: {json.dumps(request.future_layers)}

Grade the results A-F in three categories:
1. Sustainability (against CO2, EV, active travel targets)
2. Congestion (against traffic reduction targets)
3. Equity (against 15-min neighbourhood, transit access targets)

Return a JSON object:
{{
  "overall_grade": "A-F",
  "grades": [
    {{
      "category": "Sustainability",
      "grade": "A-F",
      "score": 0-100,
      "target": "specific policy target",
      "finding": "key finding"
    }},
    ...repeat for Congestion and Equity
  ],
  "actionable_advice": [
    "Specific recommendation with street/area name",
    ...
  ],
  "future_layer_suggestions": [
    {{
      "name": "Suggested infrastructure",
      "type": "road|transit|cycling|building|policy_zone",
      "area": "Where in Belfast",
      "rationale": "Why"
    }}
  ]
}}

Respond ONLY with valid JSON.
"""

    try:
        text = await asyncio.to_thread(
            _sync_generate, client, settings.gemini_model, prompt, GROUNDING_SYSTEM_PROMPT, 0.4
        )
        data = _parse_json_block(text)
        return Scorecard(**data)
    except Exception:
        logger.warning("Failed to parse analysis response, using defaults.")
        return _default_scorecard()


def _default_grounded_config(year: int) -> GroundedConfig:
    ev_pct = min(50.0, (year - 2026) * 5.0)
    return GroundedConfig(
        ev_percentage=ev_pct,
        mode_split={"car": 0.55, "pt": 0.22, "walk": 0.15, "cycle": 0.08},
        rationale=[
            f"DfI targets 50% EV adoption by 2036 — interpolated to {ev_pct:.0f}% for {year}",
            "Belfast Agenda targets 50% active travel/PT mode share by 2035",
        ],
        policy_refs=["Belfast Agenda Target 6", "DfI EV Strategy"],
    )


def _default_scorecard() -> Scorecard:
    return Scorecard(
        overall_grade="C",
        grades=[
            ScorecardGrade(
                category="Sustainability", grade="C", score=55.0,
                target="50% CO2 reduction by 2035",
                finding="Insufficient EV adoption and active travel mode share."
            ),
            ScorecardGrade(
                category="Congestion", grade="C", score=50.0,
                target="20% traffic reduction in city centre",
                finding="Key arterials remain congested."
            ),
            ScorecardGrade(
                category="Equity", grade="B", score=70.0,
                target="15-minute neighbourhood access",
                finding="Good transit coverage but gaps in North Belfast."
            ),
        ],
        actionable_advice=[
            "Consider a Low Traffic Neighbourhood in the Ormeau area to reduce through-traffic.",
            "Extend the Glider BRT to East Belfast to improve transit equity.",
        ],
        future_layer_suggestions=[],
    )
