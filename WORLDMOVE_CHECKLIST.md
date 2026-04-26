# WorldMove + Multi-Era Integration Checklist

> **Data file**: `154_GB_Belfast.npz` — 15×16 grid, 240 cells, ~1.14M total population, 15,199 trajectories (48-step), 34 POI types  
> **Reference**: https://fi.ee.tsinghua.edu.cn/worldmove/about

---

## Phase 1 — Multi-Era Foundation ("Time Awareness")

### Backend: Scenario `target_year`
- [x] Add `target_year` (int, default 2026) to `Scenario` DB model
- [x] Add `target_year` to `ScenarioCreate`, `ScenarioUpdate`, `ScenarioSummary`, `ScenarioResponse` schemas
- [x] Wire through `api/scenarios.py` create/update endpoints
- [x] Wire through `db/scenario_repository.py` create/update/list

### Map Data: Future Layers
- [x] Create `future_layers.py` module (5 pre-built Belfast 2036 layers)
- [x] Add `/future-layers` CRUD endpoints to `map-data-service/main.py`
- [x] Support filtering by `year`

### Frontend: Timeline & Engine Selector
- [x] `target_year` flows through API client (create/update scenario)
- [x] `target_year` parsed from API responses into Scenario type
- [x] Engine selector (MATSim/WorldMove) in LaunchDialog
- [x] Auto-select WorldMove for forecast year ≥ 2030
- [x] Agent count slider for WorldMove mode
- [x] `engine_type` and `max_agents` sent in form data to backend
- [x] API endpoints for `futureLayers` and `scorecard` added

---

## Phase 2 — WorldMove Engine Integration (Scale)

### Service (scaffolded in previous session)
- [x] `worldmove-sim/` directory with FastAPI wrapper
- [x] NPZ data loader + trajectory-to-event converter
- [x] NATS bridge (pub/sub for sim configs and events)
- [x] Docker + docker-compose integration

### Backend Orchestration
- [x] `engine_type` field on Run model + schema + response
- [x] Backend routes WORLDMOVE runs to WorldMove engine
- [x] WorldMove adapter sends config via NATS

---

## Phase 3 — Grounded Policy Intelligence

### AI Service (New: `ai-logic-service/`)
- [x] Scaffold `ai-logic-service/` directory (FastAPI)
- [x] `config.py` — Gemini model + API key settings
- [x] `knowledge.py` — Belfast Agenda, Bolder Vision, UKCP18 grounding context
- [x] `schemas.py` — GroundingRequest, GroundedConfig, AnalysisRequest, Scorecard models
- [x] `engine.py` — Gemini-powered grounding + analysis with fallback defaults
- [x] `main.py` — `/ground` and `/analyze` endpoints
- [x] `Dockerfile.ai` + docker-compose integration (port 8003)

### Backend Integration
- [x] `scorecard.py` — Backend module calling AI service
- [x] Auto-ground 2036 runs before WorldMove launch
- [x] `GET /scenarios/{id}/runs/{id}/scorecard` endpoint
- [x] Grounding response included in start_run result

---

## Phase 4 — Future Mobility & Activity Modeling

### Activity-Based Demand
- [x] Gravity model demand generator
- [x] Activity chain generator (worker/student/stay-home profiles)
- [x] Trajectory converter (cell→link events)

### Autonomous Vehicle Mode
- [x] `avOnly` and `futureTech` properties added to `TrafficLink` type
- [ ] WorldMove engine: treat AV links with higher capacity
- [ ] Frontend: "AV Only" toggle in link attribute panel

---

## Phase 5 — 2036 Scorecard

### Backend
- [x] Scorecard endpoint analyzes completed runs against Belfast Agenda
- [x] Returns A-F grades for Sustainability, Congestion, Equity
- [x] Actionable advice + infrastructure suggestions

### Frontend
- [x] `ScorecardPanel` component with grade circles, advice, suggestions
- [x] Integrated into visualizer (appears for completed runs)
- [x] CSS: glassmorphism card, color-coded grades, suggestion cards
- [x] Scorecard + FutureLayer types exported

---

## Files Created / Modified This Session

### New Files
| File | Purpose |
|------|---------|
| `ai-logic-service/main.py` | FastAPI AI service |
| `ai-logic-service/engine.py` | Gemini grounding + analysis |
| `ai-logic-service/knowledge.py` | Belfast policy knowledge base |
| `ai-logic-service/schemas.py` | Grounding/Scorecard models |
| `ai-logic-service/config.py` | Settings |
| `ai-logic-service/requirements.txt` | Dependencies |
| `ai-logic-service/.env.example` | Environment template |
| `docker/Dockerfile.ai` | Docker build for AI service |
| `map-data-service/future_layers.py` | Belfast 2036 future infrastructure |
| `trafficjam-be/scorecard.py` | Backend AI service integration |
| `trafficjam-fe/src/components/scorecard-panel/scorecard-panel.tsx` | Scorecard UI |
| `trafficjam-fe/src/components/scorecard-panel/scorecard-panel.module.css` | Scorecard styles |

### Modified Files
| File | Changes |
|------|---------|
| `trafficjam-be/db/models.py` | `target_year` on Scenario |
| `trafficjam-be/schemas/scenario.py` | `target_year` on all schema variants |
| `trafficjam-be/db/scenario_repository.py` | `target_year` in create/update/list |
| `trafficjam-be/api/scenarios.py` | `target_year` wired through create/update |
| `trafficjam-be/api/runs.py` | AI grounding + scorecard endpoint |
| `map-data-service/main.py` | Future layers CRUD endpoints |
| `docker-compose.yml` | ai-logic service added |
| `trafficjam-fe/src/types/scenarios.ts` | EngineType, Scorecard, FutureLayer types |
| `trafficjam-fe/src/types/network.ts` | avOnly, futureTech on TrafficLink |
| `trafficjam-fe/src/types/index.ts` | New type exports |
| `trafficjam-fe/src/api/endpoints.ts` | scorecard + futureLayers endpoints |
| `trafficjam-fe/src/api/http.ts` | Engine type in form + futureLayers routing |
| `trafficjam-fe/src/api/raw-types.ts` | engineType, maxAgents, target_year |
| `trafficjam-fe/src/api/client.ts` | fetchScorecard, fetchFutureLayers, targetYear |
| `trafficjam-fe/src/api/decoders.ts` | targetYear in scenario decoder |
| `trafficjam-fe/src/presentation/editor/.../launch-dialog.tsx` | Engine selector + agent count |
| `trafficjam-fe/src/presentation/editor/.../launch-dialog.module.css` | Engine picker styles |
| `trafficjam-fe/src/presentation/visualizer/index.tsx` | ScorecardPanel integration |
