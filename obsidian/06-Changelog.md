## 2026-04-25 — Full Google Maps light-theme UI redesign

### What changed

**Converted entire app UI from dark theme to Google Maps-style white/light theme**

`trafficjam-fe/src/components/sidebar/sidebar.module.css` — Complete rewrite
- White/light background, `box-shadow` right edge instead of border
- Width 320px (up from 280px)
- Google palette: `#1a73e8` blue, `#202124` text, `#f1f3f4` hover, `#e8f0fe` active, `#e8eaed` dividers
- Header: brand mark square + "BIMS 5" name + "Urban Intelligence Lab" sub-label + blue pill "New" button
- Scenario items: MapPin icon left, active = blue text + tint bg, chevron right on inactive
- Run history: left-border color strips (green=completed, blue=running, red=failed, yellow=pending), pulse animation on running
- Simulation Tools: three-tier button hierarchy — `btnPrimary` (blue filled) / `btnSecondary` (outlined) / `btnText` (ghost)
- Footer: 4-tab horizontal nav row with blue active top-border indicator; compact project info

`trafficjam-fe/src/components/sidebar/sidebar.tsx`
- Added `MapPin`, `ChevronRight` icons to scenario items
- Updated header to show brand mark + name + subtitle
- Updated simulation tool buttons to use 3 distinct CSS classes
- Replaced run status icons with `RunStatusDot` (dot for pending, colored icons for others)

`trafficjam-fe/src/components/dialog/dialog.module.css` — Complete rewrite
- White card, `border-radius: 16px`, soft shadow, light header/footer

`trafficjam-fe/src/presentation/editor/components/run-simulation/launch-dialog/launch-dialog.module.css` — Complete rewrite
- Light stat strip, Google-blue primary button, light inputs with focus ring

`trafficjam-fe/src/components/compare-dialog/compare-dialog.module.css` — Complete rewrite
- White card, light selects and stat cards, blue "Open in Visualizer" button

`trafficjam-fe/src/components/confirm-dialog/confirm-dialog.module.css` — Complete rewrite
- Google-blue primary, Google-red danger, light cancel, focus rings

`trafficjam-fe/src/presentation/editor/components/run-simulation/run-simulation-fab.module.css` — Rewrite
- Google-blue FAB with elevation shadow, disabled state

### Follow-up
- Link attribute panel, building attribute panel, and agent config modal still use dark theme — migrate to light theme for full consistency

---

## 2026-04-25 — Google Maps-style editor toolbar + contextual type picker

### What changed

**Replaced the old 5-button top-left toolbar with a Google Maps-style right-side panel and bottom-left contextual type picker**

`trafficjam-fe/src/presentation/editor/components/editor-map-view/editor-tool.ts` *(new)*
- Defines `EditorTool` union type: `"select" | "roads" | "buildings" | "electricity" | "transport" | "demolish"`

`trafficjam-fe/src/presentation/editor/components/editor-map-view/map-toolbar/map-toolbar.tsx` *(new)*
- White card panel, right side of map, vertically centered
- Primary tools group: Select, Add Roads, Buildings, Electricity, Transport, Demolish — each highlighted when active
- Utility group: Layers toggle (buildings visibility), Undo, Export, Clear all (danger-styled)

`trafficjam-fe/src/presentation/editor/components/editor-map-view/map-toolbar/map-toolbar.module.css` *(new)*

`trafficjam-fe/src/presentation/editor/components/editor-map-view/type-picker/type-picker.tsx` *(new)*
- White card panel, bottom-left of map
- Roads tool → 12 road type chips (Motorway→Path) each with road color dot
- Buildings tool → 8 building type chips (House, Residential, Apartments…) with type color dot
- Electricity tool → Power Lines / Substations / Consumption Map / Fault Zones chips + "connect backend" hint
- Transport tool → Bus Routes / Tram / Heavy Rail / Pedestrian Zones chips
- Hidden when Select or Demolish tool is active

`trafficjam-fe/src/presentation/editor/components/editor-map-view/type-picker/type-picker.module.css` *(new)*

`trafficjam-fe/src/presentation/editor/components/editor-map-view/editor-map-view.tsx`
- Replaced `EditorControls` with `MapToolbar` + `TypePicker`
- New state: `activeTool`, `selectedRoadType`, `selectedBuildingType`, `selectedElecLayer`, `selectedTransportLayer`
- `editorMode` (node add/drag) now derived from `activeTool === "roads"`
- Demolish tool posts a status message; electricity/transport show the picker UI

`trafficjam-fe/src/presentation/editor/components/editor-map-view/hooks/use-node-add.ts`
- Added `roadType?: string` param (defaults to `"residential"`)
- New links — both the live draft preview and the committed link — now use the selected road type

`trafficjam-fe/src/style.css`
- Removed unused `.map-controls` and `.map-control-btn` global classes

### Follow-up
- Demolish mode: wire map click handler to delete the hovered link/node
- Electricity Consumption Map: pass an `electricityMode` prop to `BuildingLayer` to color buildings by consumption proxy based on `BuildingType`
- Buildings tool: implement a building-placement interaction (click on map to place a building footprint)
- Transport layer: filter visible routes by the selected transport chip

---

## 2026-04-25 — Urban Intelligence Lab UI: Simulation Tools + Footer

### What changed

**Added Simulation Tools section and footer to the sidebar, plus a Compare Branches dialog**

`trafficjam-fe/src/components/sidebar/sidebar.tsx`
- Added `onRunSimulationClick` and `onCompareBranches` props
- Added `exportResults()` utility (downloads run metadata + agent config as JSON)
- Added **Simulation Tools** section (below run history): Run Simulation, Compare Branches, Export Results buttons — each disabled until prerequisites are met
- Added **footer**: 2×2 nav grid (Map Explorer active; Analytics, Community Insights, Reports disabled/coming soon) + Urban Intelligence Lab project info blurb

`trafficjam-fe/src/components/sidebar/sidebar.module.css`
- New classes: `toolsSection`, `toolBtn`, `sidebarFooter`, `footerNav`, `footerNavBtn`, `footerNavBtnActive`, `projectInfo`, `projectInfoDesc`

`trafficjam-fe/src/components/compare-dialog/compare-dialog.tsx` *(new)*
- Two-column run selector dialog — pick Branch A and Branch B from completed runs, see stats card for each (scenario, iterations, seed, created), "Open in Visualizer" navigates to that run

`trafficjam-fe/src/components/compare-dialog/compare-dialog.module.css` *(new)*

`trafficjam-fe/src/presentation/editor/index.tsx`
- Lifted launch-dialog open/close state to optional props (`isLaunchDialogOpen`, `onOpenLaunchDialog`, `onCloseLaunchDialog`) so the sidebar's Run Simulation button and the FAB share one controlled state
- Kept `localDialogOpen` fallback so Editor still works standalone

`trafficjam-fe/src/app.tsx`
- Added `isLaunchDialogOpen`, `isCompareOpen` state
- Added `handleRunSimulationClick` (sets mode→editor + opens launch dialog)
- Wired new props into `<Sidebar>` and `<Editor>`
- Rendered `<CompareDialog>` at app level

### Follow-up
- Analytics, Community Insights, and Reports nav buttons are stubs — implement dedicated views and enable them when ready
- Export Results currently exports run metadata JSON; extend to pull actual simulation output from the backend API when endpoints are available

---

## 2026-04-25 — NATS 1024KB fix reinforcement (16MB limits + explicit chunking)

### What changed

**Resolved "Part exceeded maximum size of 1024KB" by raising limits and forcing smaller chunks**

Despite previous attempts to raise the limit to 8MB, some simulation runs still hit the 1024KB limit. This was likely due to a combination of NATS 2.10+ default stream limits and potential chunking mismatches in the Java client.

**`simengine/src/main/java/com/bims5/service/NatsJetStreamClient.java`**
- Increased `MAX_MSG_SIZE` to 16MB.
- Added explicit `CHUNK_SIZE` of 128KB.
- Updated `uploadToObjectStore` to use `ObjectStoreOptions` with the explicit `CHUNK_SIZE`. This ensures that even if a stream defaults to 1MB, our 128KB chunks (+ headers) will always fit comfortably.
- Enhanced `ensureBucket` to force-update the underlying stream's `maxMsgSize` if it's found to be smaller than 16MB.

**`docker/nats-server.conf`**
- Increased `max_payload` from 8MB to 16MB to allow for larger individual messages across the entire server.

### Follow-up
- Rebuild and restart the NATS container: `docker compose -f docker-compose.local.yml up -d --build nats --force-recreate`

---

## 2026-04-25 — NATS per-stream max_msg_size fix (definitive resolution)

### What changed

**Root cause identified and fixed: two independent NATS size limits both need raising**

NATS enforces size limits at two layers independently:
1. Server-level `max_payload` (global, all messages)
2. JetStream stream-level `max_msg_size` (per-stream, enforced separately)

NATS server 2.10+ defaults object store bucket streams to `max_msg_size = 1MB`. The NATS message (chunk bytes + JetStream headers) slightly exceeds this, causing "Part exceeded maximum size of 1024KB". Raising `max_payload` alone does not fix it.

**`simengine/src/main/java/com/bims5/service/NatsJetStreamClient.java`**
- Added `import io.nats.client.api.StreamInfo`
- Replaced inline bucket creation logic with new `ensureBucket(String bucketName)` helper (15 lines)
- `ensureBucket` creates the bucket if missing, then calls `jsm.updateStream()` on the underlying `OBJ_<bucketName>` stream to set `maxMsgSize` to 8MB via `StreamConfiguration.builder(existingConfig).maxMsgSize(8 * 1024 * 1024).build()`
- This runs before every upload, so it also heals buckets created before this fix with the old 1MB limit
- Removed the `.chunkSize()` call added in the previous session (the method does not exist on `ObjectStoreConfiguration.Builder` in jnats 2.25.1 — confirmed via bytecode analysis)

**`docker/nats-server.conf`** — `max_payload: 8MB` was already added in the previous session; container was force-recreated this session to actually apply it (Docker was reusing the cached running container). Verified via `GET /varz → max_payload: 8388608`.

### Verification
- `docker compose -f docker-compose.local.yml up -d --force-recreate nats` required (not just rebuild)
- `curl http://localhost:8222/varz | .max_payload` → 8388608 ✓
- All 6 containers healthy after restart ✓

---

## 2026-04-25 — NATS 1024KB size fix + frontend UI/UX improvements

### What changed

**NATS: raised max_payload to fix "Part exceeded maximum size of 1024KB" error**
- `docker/nats-server.conf` — added `max_payload: 8MB`; the NATS server default is 1MB, which simulation output files (events.xml.gz etc.) can exceed when chunked for the JetStream object store.
- `simengine/src/main/java/com/bims5/service/NatsJetStreamClient.java` — attempted `.chunkSize(128 * 1024)` on `ObjectStoreConfiguration` (subsequently removed by linter — method does not exist in jnats 2.25.1; see entry above for the correct fix).

**Frontend: launch dialog now shows network summary**
- `trafficjam-fe/src/presentation/editor/components/run-simulation/launch-dialog/launch-dialog.tsx` — added a stat row (Nodes / Links / Buildings) at the top of the dialog so users see what they are simulating before launching.
- `trafficjam-fe/src/presentation/editor/components/run-simulation/launch-dialog/launch-dialog.module.css` — added `.networkSummary`, `.stat`, `.statValue`, `.statLabel` styles; removed duplicate `.launchButton:disabled` and `@keyframes spin` rules.

**Frontend: sidebar UX improvements**
- `trafficjam-fe/src/components/sidebar/sidebar.tsx` — running run items now apply a pulse animation class; run timestamps changed from absolute clock time to relative ("2m ago"); empty scenarios list now shows "No scenarios yet / Press + to create one" instead of a blank list; scenario section title shows a count badge.
- `trafficjam-fe/src/components/sidebar/sidebar.module.css` — added `.runItemRunning` (blue pulse keyframe), `.emptyScenarios` / `.emptyScenariosTitle` / `.emptyScenariosHint` (empty state), `.sectionBadge`.

### Follow-up
- Rebuild and restart the NATS container after this change: `docker compose -f docker-compose.local.yml up -d --build nats`

---

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
