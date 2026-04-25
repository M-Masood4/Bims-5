# Code Style

- No comments in code unless specifically asked
- Functions must be 5-20 lines. Split larger ones
- Prefer adding a dependency over writing boilerplate
- When writing React, avoid useEffect. Prefer useQuery, useMemo, useCallback, or hooks from @uidotdev/usehooks and react-hotkeys-hook

# Project Overview

BIMS 5 — Building and Infrastructure Management Simulator with three services, each a top-level folder:

1. **map-data-service** — Python FastAPI service serving OSM network data (nodes, links, buildings, transport routes) to the frontend.
2. **trafficjam-be** — Python FastAPI service orchestrating simulation runs via NATS + MATSim
3. **simengine** — Java Spring Boot service wrapping MATSim simulation engine. Outputs events XML.
4. **trafficjam-fe** — React frontend with two modes: map editor and simulation visualizer.

# Running Services

- **Frontend**: `cd trafficjam-fe && bun dev` (Vite on :5173)
- **Map service**: `cd map-data-service && uvicorn main:app --reload` (FastAPI on :8000)
- **Backend**: `cd trafficjam-be && uvicorn main:app --reload --port 8001` (FastAPI on :8001)
- **Sim engine**: `cd simengine && mvn spring-boot:run` (Spring Boot on :8080)
- **Database**: `make run` (PostgreSQL + PostGIS via Docker)
