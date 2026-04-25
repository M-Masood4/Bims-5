# Services Reference

## trafficjam-fe (React Frontend)

**Stack:** React 19, TypeScript, Vite, Mapbox GL, deck.gl, TanStack Query
**Package manager:** bun / pnpm

Two modes accessible from the sidebar:
- **Map Editor** — draw nodes and links on the map, define road network
- **Simulation Visualiser** — replay agent events from a completed run

Key env vars (`.env`):
```
VITE_MAPBOX_TOKEN=pk.eyJ1IjoibW1hc29vZDQiLCJhIjoiY21vZTlqam85MGI1MjJzc2NqOHF6Y3BlYiJ9.2j4I04zTUuF1YvughT4yyQ
VITE_MAP_DATA_SERVICE_URL=http://localhost:8000
VITE_TRAFFICJAM_BE_URL=http://localhost:8001
```

---

## map-data-service (Python FastAPI)

**Stack:** Python 3.13, FastAPI, SQLAlchemy async, PostGIS
**Port:** 8000

Serves pre-loaded OSM data for a bounding box. Data must be imported separately via OSM tools.

Key env vars:
```
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/bims5
```

---

## trafficjam-be (Python FastAPI)

**Stack:** Python 3.13, FastAPI, SQLAlchemy async, Alembic, NATS
**Port:** 8001

Manages scenarios and runs. Generates MATSim agent plans, submits to simengine, streams events via SSE.

Key env vars:
```
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/bims5
NATS_URL=nats://localhost:4222
SIMENGINE_URL=http://localhost:8080
```

---

## simengine (Java Spring Boot)

**Stack:** Java 17, Spring Boot 3, MATSim 2024.0, NATS JNats
**Port:** 8080
**Package:** `com.bims5`

Accepts network.xml + plans.xml via multipart POST, runs MATSim simulation, publishes events to NATS JetStream.

Key env vars:
```
NATS_URL=nats://localhost:4222
```
