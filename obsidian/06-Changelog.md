## 2026-04-25 — Simulation pipeline fixes + Belfast OSM loader + full E2E verified

### What changed

**Backend: simulation no longer crashes on empty buildings**
- `trafficjam-be/api/runs.py` — `start_run` now parses the buildings JSON before validating. An empty list returns a clear HTTP 400 instead of a 500 crash inside `random.choice([])`.
- `trafficjam-be/agents/agent_creation.py` — early guard in `create_agents_from_network` raises `ValueError` if `buildings` is empty.

**Frontend: error messages now surface properly**
- `trafficjam-fe/src/api/http.ts` — `assertOk` is now async; reads FastAPI's `{"detail": "..."}` on error.
- `trafficjam-fe/src/api/client.ts` — two `assertOk` call sites updated to `await`.

**Frontend: LaunchDialog pre-validates building count**
- `trafficjam-fe/src/presentation/editor/components/run-simulation/launch-dialog/launch-dialog.tsx` — Launch button disabled + warning shown when `network.buildings` is empty.

**Building type support expanded**
- `map-data-service/constants.py` — added `"residential"` and `"house"` to `VALID_BUILDING_TYPES`.
- `trafficjam-fe/src/types/network.ts` — `BuildingType` union includes `"residential" | "house"`.
- `trafficjam-fe/src/constants/building.ts` — colours and labels for new types.

**Minor fixes**
- `trafficjam-fe/src/presentation/editor/index.tsx` — removed duplicate `<SaveIndicator>`.

**Belfast OSM data loaded into PostGIS**
- `map-data-service/load_belfast.py` — new script using OSMnx + Overpass API (kumi.systems mirror).
- Loaded: 12,968 nodes, 29,323 links, 120,817 buildings, 16,283 transport route segments.
- SQL migrations run: `map-data-service/migrations/001_create_tables.sql` and `002_add_indexes_and_constraints.sql`.
- `docker-compose.local.yml` — fixed `map-data` service `DATABASE_URL` from `${DATABASE_URL}` (broken host-only env var) to hardcoded `postgresql+asyncpg://admin:admin@db:5432/bims5` matching the backend pattern.

**SimEngine fixes**
- `simengine/src/main/resources/config-template.xml` — changed `writeEventsInterval` from `0` (disabled) to `1` so `output_events.xml.gz` is generated; SimWrapper needs this file for post-simulation analytics.

### End-to-end verification (API level)

Simulation pipeline tested via direct API calls:
1. `GET /network` → 3,381 nodes, 7,873 links, 29,652 buildings for central Belfast bbox ✓
2. `POST /scenarios/{id}/runs/start` with MATSim XML + buildings → HTTP 200, `status: RUNNING` ✓
3. Run polled to `completed` status ✓
4. SimWrapper files uploaded to NATS: `output_events.xml.gz`, `ITERS/it.0/0.events.xml.gz`, `ITERS/it.1/1.events.xml.gz` ✓

Key DTD note: MATSim `network_v2.dtd` uses `modes="car"` (not `allowedModes`). The frontend serializer was already correct; a mistaken "fix" was reverted.

### All follow-ups resolved — no outstanding items
