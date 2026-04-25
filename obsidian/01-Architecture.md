# Architecture

## Service Map

```
trafficjam-fe (:5173)
    │
    ├── GET /network?bbox=...  ──►  map-data-service (:8000)
    │                                   └── PostGIS (OSM nodes, links, buildings)
    │
    ├── POST /scenarios  ────────►  trafficjam-be (:8001)
    │   GET  /runs/{id}/events  ◄──     └── NATS JetStream
    │                                       └── simengine (:8080) [MATSim]
```

## Services

| Service | Stack | Port | Role |
|---------|-------|------|------|
| `trafficjam-fe` | React + Vite | 5173 | Map editor + simulation visualiser |
| `map-data-service` | Python FastAPI | 8000 | OSM data from PostGIS |
| `trafficjam-be` | Python FastAPI | 8001 | Simulation orchestration |
| `simengine` | Java Spring Boot | 8080 | MATSim wrapper |

## Data Stores

- **PostgreSQL + PostGIS** — OSM network data (nodes, links, buildings, transport routes)
- **NATS JetStream** — simulation events, status, and output file storage

## Key Flows

### Loading map data
Frontend → `GET /network?min_lat=...` → PostGIS `ST_Intersects` query → nodes/links/buildings/routes

### Running a simulation
1. Frontend creates a scenario (`POST /scenarios`)
2. Frontend starts a run (`POST /scenarios/{id}/runs`)
3. `trafficjam-be` generates MATSim plans XML from scenario config
4. `trafficjam-be` POSTs network + plans to `simengine`
5. `simengine` runs MATSim, publishes events to NATS
6. `trafficjam-be` streams events back to frontend via SSE
