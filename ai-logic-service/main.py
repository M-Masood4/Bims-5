import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from engine import ground_agent_params, analyze_simulation
from schemas import (
    GroundingRequest,
    GroundedConfig,
    AnalysisRequest,
    Scorecard,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


TAGS_METADATA = [
    {
        "name": "grounding",
        "description": "Ground simulation parameters against Belfast policy knowledge base using Gemini.",
    },
    {
        "name": "analysis",
        "description": "Analyze simulation results and generate policy scorecards.",
    },
    {
        "name": "ops",
        "description": "Operational endpoints.",
    },
]

app = FastAPI(
    title="BIMS 5 AI Logic Service",
    description=(
        "Policy intelligence powered by Gemini with Grounding Lite. "
        "Grounds agent parameters against Belfast Agenda 2035 targets, "
        "A Bolder Vision transport strategy, and UKCP18 climate projections. "
        "Analyzes simulation outputs into A–F scorecards with actionable advice."
    ),
    version="1.0.0",
    openapi_tags=TAGS_METADATA,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post(
    "/ground",
    response_model=GroundedConfig,
    tags=["grounding"],
    summary="Ground agent parameters for a simulation run",
    description=(
        "Given a scenario's target year and current parameters, returns policy-grounded "
        "adjustments for EV adoption, mode split, and agent behaviour."
    ),
)
async def ground(request: GroundingRequest):
    try:
        return await ground_agent_params(request)
    except Exception as e:
        logger.exception("Grounding failed")
        raise HTTPException(500, f"Grounding failed: {e}")


@app.post(
    "/analyze",
    response_model=Scorecard,
    tags=["analysis"],
    summary="Analyze simulation results against policy targets",
    description=(
        "Grades a completed simulation on Sustainability, Congestion, and Equity. "
        "Returns A-F grades, actionable advice, and infrastructure suggestions."
    ),
)
async def analyze(request: AnalysisRequest):
    try:
        return await analyze_simulation(request)
    except Exception as e:
        logger.exception("Analysis failed")
        raise HTTPException(500, f"Analysis failed: {e}")


@app.get("/health", tags=["ops"], summary="Health check")
async def health():
    settings = get_settings()
    return {
        "status": "ok",
        "engine": "gemini",
        "model": settings.gemini_model,
        "has_api_key": bool(settings.gemini_api_key),
    }


if __name__ == "__main__":
    import uvicorn
    settings = get_settings()
    uvicorn.run(app, host=settings.host, port=settings.port)
