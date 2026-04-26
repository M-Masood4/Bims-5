import logging

import httpx

from config import get_settings

logger = logging.getLogger(__name__)


async def ground_for_year(
    target_year: int,
    agent_count: int = 1000,
    scenario_name: str = "",
    future_layers: list[str] | None = None,
) -> dict | None:
    if target_year <= 2026:
        return None

    ai_url = get_settings().ai_service_url
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{ai_url}/ground",
                json={
                    "target_year": target_year,
                    "agent_count": agent_count,
                    "scenario_name": scenario_name,
                    "future_layers": future_layers or [],
                },
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        logger.warning(f"AI grounding unavailable, using defaults: {e}")
        return _default_grounding(target_year)


async def analyze_run(
    target_year: int,
    total_agents: int,
    total_events: int,
    mode_split: dict[str, float] | None = None,
    congested_links: list[str] | None = None,
    future_layers: list[str] | None = None,
) -> dict:
    ai_url = get_settings().ai_service_url
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{ai_url}/analyze",
                json={
                    "target_year": target_year,
                    "total_agents": total_agents,
                    "total_events": total_events,
                    "mode_split": mode_split or {},
                    "congested_links": congested_links or [],
                    "future_layers": future_layers or [],
                },
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        logger.warning(f"AI analysis unavailable, using defaults: {e}")
        return _default_scorecard(target_year)


def _default_grounding(year: int) -> dict:
    ev_pct = min(50.0, (year - 2026) * 5.0)
    return {
        "ev_percentage": ev_pct,
        "mode_split": {"car": 0.55, "pt": 0.22, "walk": 0.15, "cycle": 0.08},
        "rationale": [
            f"DfI targets 50% EV by 2036 — interpolated to {ev_pct:.0f}% for {year}",
            "Belfast Agenda: 50% active travel/PT mode share by 2035",
        ],
        "policy_refs": ["Belfast Agenda Target 6", "DfI EV Strategy"],
    }


def _default_scorecard(year: int = 2036) -> dict:
    ev_pct = min(50.0, (year - 2026) * 5.0)
    active_travel_target = 50
    return {
        "overall_grade": "C",
        "grades": [
            {
                "category": "Sustainability",
                "grade": "C",
                "score": 55.0,
                "target": f"50% CO2 reduction by 2035 / {ev_pct:.0f}% EV adoption by {year}",
                "finding": "EV adoption on track but active travel mode share below target.",
            },
            {
                "category": "Congestion",
                "grade": "C",
                "score": 50.0,
                "target": "20% traffic reduction in Belfast city centre",
                "finding": "Key arterials on York Street and Westlink remain congested.",
            },
            {
                "category": "Equity",
                "grade": "B",
                "score": 70.0,
                "target": f"15-minute neighbourhood access / {active_travel_target}% active travel share",
                "finding": "Good transit coverage in South and East Belfast; gaps persist in North Belfast.",
            },
        ],
        "actionable_advice": [
            "Introduce a Low Traffic Neighbourhood (LTN) scheme in the Ormeau Road corridor.",
            "Extend the Glider BRT route to Titanic Quarter and East Belfast.",
            "Add protected cycling infrastructure on the Lisburn Road to improve active travel share.",
        ],
        "future_layer_suggestions": [
            {
                "name": "York Gate Interchange cycle bypass",
                "type": "cycling",
                "area": "North Belfast / York Street",
                "rationale": "Eliminates the major gap in the Belfast cycling network at the interchange.",
            }
        ],
    }
