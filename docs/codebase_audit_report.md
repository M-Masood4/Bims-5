# BIMS-5 Codebase Audit Report

## 1. Executive Summary

This repository is a Belfast city replay and planning-simulation application with three major product layers:

1. Historical replay:
   A deterministic 2016-2026 Belfast timeline built from local geospatial, planning, population, air-quality, transit, and infrastructure-event data.
2. Scenario planning:
   A 2026-2036 "what-if" branch simulator where the user stages buildings, roads, parks, and transformers, then runs forecast comparisons.
3. Live visual simulation:
   In-browser traffic, public-transport, map interaction, and event-similarity overlays that make the planning outputs feel interactive rather than static.

At a high level, this is not a classical machine-learning application. It uses the language of "models", but most of the numeric logic is deterministic, heuristic, or trend-based:

- `scripts/train_forecast_model.py` produces a deterministic forecast artifact, not a learned ML model.
- `scripts/build_transformer_model.py` produces a planning-grade transformer screening model, not a trained neural/statistical predictor in the usual ML sense.
- `web/impact-predictor.js` is a distance-and-recency-weighted kNN-style deterministic regressor over the local event catalog.
- `web/traffic-sim.js` is an in-browser agent/microsimulation.
- `web/transit-engine.js` is a rule-based transport network renderer/forecaster.
- Gemini, if configured, is used only for parsing, branch generation, critique, and explanation. It does not own the numeric planning outputs.

The shipped app is currently centered on:

- `server.js` for the Node server and API
- `web/index.html` for the production page
- `web/dashboard.js` for the main frontend runtime
- `lib/scenario-studio.js` for the deterministic simulation engine
- `scripts/build_mode_a_replay.py`, `scripts/train_forecast_model.py`, and `scripts/build_transformer_model.py` for data/model artifact generation

The current frontend has a single production entrypoint: `web/index.html` loading `web/dashboard.js` plus the active map, traffic, transit, and impact modules.

## 2. What The App Actually Is

The product is best understood as a hybrid of:

- A spatial replay viewer for Belfast
- A lightweight digital-twin-style planning sandbox
- A local static-data application with no external database
- A deterministic planning calculator with optional LLM explainability

The app title in the live HTML is `Belfast 2016-2036 - Simulation Studio`, which is accurate in product terms:

- `2016-2026` covers the historical replay
- `2026-2036` covers the forward simulation horizon

The repository is structured to keep everything local:

- raw and derived data in `data/`
- generated browser-ready artifacts in `web/data/mode-a/`
- a static-first manifest in `api/replay-manifest.json`
- a simple dependency-light Node HTTP server in `server.js`
- no SQL runtime database even though SQL contracts exist under `schemas/`

## 3. Repository Structure And Responsibilities

### 3.1 Runtime entrypoints

- `server.js`
  Main Node server. Serves static assets, JSON APIs, layer files, and the Scenario Studio endpoints.
- `web/index.html`
  Current production UI shell.
- `web/dashboard.js`
  Current main frontend controller.

### 3.2 Frontend modules in active use

- `web/dashboard.js`
  Main product runtime.
- `web/impact-predictor.js`
  Event-based deterministic impact predictor and similar-events engine.
- `web/traffic-sim.js`
  Road/vehicle/agent traffic simulation engine.
- `web/transit-engine.js`
  Public-transport overlay and forecast logic.
- `web/map-ux.js`
  Drag/drop and map editing UX helper.
- `web/styles.css`
  Main styling.

### 3.3 Backend / runtime logic

- `server.js`
  API routing, static serving, Gemini integration, Scenario Studio orchestration.
- `lib/scenario-studio.js`
  Core deterministic simulation and planning engine.

### 3.4 Data and artifact builders

- `scripts/build_mode_a_replay.py`
  Builds replay grids, hotspots, summary, metrics, commits, and electricity layer outputs.
- `scripts/train_forecast_model.py`
  Builds the forecast artifact for 2026-2036.
- `scripts/build_transformer_model.py`
  Builds transformer capacity and impact artifacts.
- `scripts/build_ui_manifest.py`
  Builds the API/browser manifest and optimized 3D building/context layers.
- `scripts/build_infrastructure_events.js`
  Builds the event catalog that feeds replay and explainability.
- `scripts/build_translink_transit_layers.js`
  Builds local bus-stop and route-layer artifacts.
- `scripts/spatial_replay_etl.py`
  Builds generic catalog/timeline ETL indexes.
- `scripts/index_sources.py`
  Builds provenance/source manifests.

### 3.5 Tests and verifiers

- `tests/`
  Python unit tests for ETL, forecast artifacts, and transformer artifacts.
- `scripts/verify-manifest.js`
  Node validation of manifest and replay outputs.
- `scripts/verify-forecast.js`
  Node validation of forecast artifacts and scenario runtime.
- `scripts/verify-transformer-model.js`
  Node validation of transformer artifacts.

### 3.6 Removed legacy frontend code

Older alternate entrypoints were removed because the live page does not load them and they made it easy to audit the wrong UI path. The active browser runtime is now centered on `web/dashboard.js`.

## 4. Active Runtime Architecture

### 4.1 Server model

The backend is a single-file Node HTTP server in `server.js` using built-in modules:

- `fs`
- `http`
- `path`
- `child_process`

There is no Express, no database client, and no ORM.

The server does five things:

1. Serves the static web app from `web/`
2. Serves `web/data/mode-a/*` and other data files
3. Serves manifest/layer APIs
4. Serves scenario/planning APIs
5. Optionally talks to Gemini for natural-language tasks

### 4.2 Frontend model

The frontend is not React/Vue/Angular. It is a large imperative browser application built around:

- plain JavaScript modules loaded via `<script>`
- direct DOM manipulation
- Mapbox GL JS
- browser `fetch`
- localStorage persistence
- GeoJSON layer updates

### 4.3 Data flow

The normal data flow is:

1. Source data lives in `data/`
2. Build scripts generate replay/model artifacts into `web/data/mode-a/`, `data/derived/2026/`, and `api/`
3. `server.js` serves those artifacts
4. `web/dashboard.js` fetches:
   - `summary.json`
   - `baseline_2025_forecast.json`
   - `/api/manifest`
   - event endpoints
   - map layers
5. User stages scenario edits
6. Frontend POSTs to `/api/scenario-studio/run`
7. `server.js` calls deterministic planners in `lib/scenario-studio.js`
8. Frontend renders returned scenario metrics, branch comparisons, affected cells, and concrete impacts

## 5. User-Facing Features

This section describes the actual product features visible in the live app driven by `web/index.html` and `web/dashboard.js`.

### 5.1 Historical replay timeline

The timeline spans 2016 through 2036, but the modes differ:

- `2016-2025`: historical replay
- `2026`: baseline bridge year used by current scenario tooling
- `2026-2036`: forecast/simulation years

The UI can:

- scrub by year
- play through the timeline
- switch between historical and simulation interpretation
- relabel panels and overlays based on the active year

### 5.2 Historical lenses

The surfaced replay lenses in the current live dashboard are:

- `traffic`
- `jobs`
- `buildings`
- `electricity`
- `services` shown in the UI as Public Transit

These are distinct from the older five-lens conceptual contract in `docs/mode_a_replay_contract.md`, which discusses:

- `population_pressure`
- `mobility_strain`
- `economic_opportunity`
- `environmental_exposure`
- `fairness_score`

What is happening is:

- the historical replay asset set presents the five "product" signals used in the UI
- the future scenario engine works with a richer forecast metric set and maps those into displayed cards

### 5.3 2D / 3D map

The map supports:

- 2D view
- 3D view
- Mapbox pitch/bearing transitions
- extruded 3D building layer
- contextual layers for roads, services, transport, electricity, water, and green space

The 3D building layer is lazily loaded for performance.

### 5.4 Postcode search

The app resolves Belfast postcodes via `/api/postcode/resolve`.

Behavior:

- broad outcodes like `BT7` can be used for search/zoom
- full postcodes like `BT7 1NN` are required for scenario placement
- the resolved postcode becomes a placement anchor for buildings and road planning

### 5.5 Events sidebar

The left sidebar changes by mode:

- historical mode: event list
- simulation mode: branch activity log

Historical event behavior:

- filter by category/lens
- list event cards
- click into event evidence
- show similar event context

Simulation activity behavior:

- branch actions are recorded
- road simulation completions are recorded
- planner-generated variations are recorded

### 5.6 Branching

The app includes Git-like scenario branching in the UI:

- baseline branch
- new branch creation
- branch duplication
- branch rename
- branch recolor
- branch deletion
- parent-branch inheritance
- branch-specific staged items

Default branches include:

- Baseline (locked)
- Green Belfast Vision
- Transport First
- High Density Growth

### 5.7 Staging tools

The current toolbar exposes tools for:

- `Select`
- `Buildings`
- `Roads`
- `Park`
- `Transformer`
- `Remove`

Meaning:

- Buildings:
  Stages a proposed building intervention at a valid Belfast location or selected postcode.
- Roads:
  Lets the user select two junctions and plan a road snapped to real OSM geometry.
- Park:
  Stages a green intervention.
- Transformer:
  Stages an electricity infrastructure intervention.
- Remove:
  Removes staged items or stages deletion of an existing mapped building.

### 5.8 Existing-building deletion

This is an important feature: the user can click existing city buildings and stage their removal from a scenario branch.

The system:

- detects existing building footprints from context layers
- converts them into `building_removal` interventions
- simulates removal effects in the same planning engine

### 5.9 Buildable-area support

The server exposes `/api/building/buildable-areas`, which computes buildability over the 2026 replay grid using:

- placement validation
- green cover
- existing buildings
- traffic pressure
- development pressure
- planning intensity
- transit access

This helps identify candidate placement areas rather than allowing arbitrary map clicks everywhere.

### 5.10 Simulation run

When a staged building exists, the user can click Run Simulation.

The simulation:

- validates placement
- resolves local context
- generates scenario branches
- runs deterministic forecast planners
- returns annual timeline outputs 2026-2036
- returns affected grid cells
- returns concrete impacts
- marks a recommended branch

### 5.11 Impact overview

The right-side impact stack displays:

- population
- traffic congestion
- air quality index
- housing demand
- economic output

These are display metrics derived from the deeper scenario/forecast metrics.

### 5.12 Concrete simulation data panel

The app also renders a planning-data card with concrete values, including:

- traffic:
  daily trips, relief, induced demand, peak-hour change, delay
- jobs:
  direct jobs, accessibility-supported jobs, temporary construction jobs, operations jobs, capacity-enabled jobs
- electricity:
  annual MWh change, peak kW change, transformer relief, headroom change, overload risk delta
- services:
  resident/worker demand, service capacity equivalent, net service demand

This is one of the most important product features because it turns abstract 0-1 indices into something a planner can discuss.

### 5.13 Branch compare modal

The app can compare branches:

- at a given year
- across multiple forecast metrics
- with winners by metric
- with recommended branch summary
- with agent trace summary

### 5.14 Scenario diff / split view

The app supports before/after visual comparison:

- no-build vs with-build
- 3D diff modal
- split-map style comparison

### 5.15 Traffic simulation controls

The traffic-sim section includes:

- Start/Stop
- density slider
- speed slider
- live stats

Displayed stats include:

- vehicles
- average speed
- congested share

### 5.16 Road impact comparison modal

When a road is staged, the user can run a dedicated road comparison:

- simulate baseline without the new road
- simulate with the new road
- compute network deltas
- show average speed, congested time, distance moved, and candidate-road usage
- render mini-maps and a persistent congestion-delta overlay

### 5.17 Public transport network and forecast overlay

The transit engine supports:

- current stop overlays
- route overlays
- forecast route/station effects
- corridor logic for major routes
- service-strength visualization

### 5.18 Similar past events overlay

The app can surface similar historical events for a placed scenario item. This is driven by the impact predictor and event catalog.

### 5.19 Export

The Export button downloads branch/scenario JSON including:

- branch metadata
- staged items
- active year
- metrics
- baseline
- scenario result payload

## 6. Backend API Surface

The backend API is broader than the small `api/README.md` suggests.

### 6.1 Static replay APIs

- `GET /api/manifest`
- `GET /api/replay-manifest.json`
- `GET /api/layers/{year}/{layerId}`
- `GET /api/health`
- `GET /api/events`

### 6.2 Scenario / planning APIs

- `GET /api/postcode/resolve`
- `POST /api/building/validate-placement`
- `GET|POST /api/building/buildable-areas`
- `POST /api/simulation/run-multiple`
- `POST /api/scenario-studio/run`

### 6.3 Gemini helper APIs

- `POST /api/gemini/commit-explanation`
- `POST /api/agents/parse-building-intent`
- `POST /api/agents/generate-building-variants`
- `POST /api/agents/explain-simulation`

These Gemini routes only augment UX. Numeric results still come from deterministic logic.

## 7. Data Inventory And Provenance

### 7.1 Inventory counts observed in the repo

From the current checked-in outputs:

- source inventory entries: `17`
- replay manifest interactive layers: `8`
- replay manifest source artifacts: `48`
- Mode A replay grid cells: `308`
- transformer asset features: `312`
- infrastructure event catalog size: `29,324` events

### 7.2 Event catalog composition

Current event catalog counts:

- `traffic`: `17,122`
- `buildings`: `10,000`
- `electricity`: `851`
- `services`: `678`
- `jobs`: `673`

Per-year counts currently present:

- 2016: 3,330
- 2017: 2,153
- 2018: 1,924
- 2019: 917
- 2020: 1,406
- 2021: 2,405
- 2022: 3,192
- 2023: 2,699
- 2024: 4,523
- 2025: 4,853
- 2026: 1,922

### 7.3 Major local source families

The repo includes or references:

- Belfast population CSV
- Belfast air-quality CSV
- Belfast census CSV
- Belfast Bikes historical JSON
- planning-statistics CSVs
- 2016/2026 raster TIFFs
- 2026 OSM-derived GeoJSON layers
- Translink route and stop data
- SONI quarter-hourly electricity spreadsheets
- manual-drop structure for future official data

### 7.4 Provenance philosophy

The codebase is strongly provenance-aware. Evidence appears in:

- `config/source_inventory.json`
- `manifests/provenance_manifest.json`
- generated summary/event outputs
- model cards
- commit/event evidence objects
- validation and confidence language

This is one of the better-designed parts of the repo.

## 8. Historical Replay System

The historical replay is primarily produced by `scripts/build_mode_a_replay.py`.

### 8.1 What it builds

It generates:

- `web/data/mode-a/summary.json`
- `web/data/mode-a/grid_2016.geojson` through `grid_2026.geojson`
- `web/data/mode-a/hotspots_2016.geojson` through `hotspots_2026.geojson`
- `web/data/mode-a/electricity_2016.geojson` through `electricity_2026.geojson`

### 8.2 Grid structure

The replay grid is a fixed 22 x 14 grid over Belfast:

- `22 * 14 = 308` cells

Each cell stores normalized metrics and supporting context.

### 8.3 Historical replay method

This is not learned from ML training. It is a deterministic spatial scoring pipeline using:

- population totals
- census totals
- air-quality trends
- bike activity
- transit anchors
- green anchors
- deprivation anchors
- development zones
- local points-of-interest density
- raster availability flags
- infrastructure event evidence

The core logic combines fixed formulas and distance-based scoring into yearly per-cell values.

### 8.4 Core metrics generated in replay

The replay output tracks five top-level product metrics:

- traffic
- jobs
- electricity
- buildings
- services

Supporting values include things like:

- development pressure
- green cover
- bike access
- transit access
- planning intensity
- deprivation weight

### 8.5 Historical commits / city changelog

The replay does not just show maps. It also generates city "commits":

- title
- subtitle
- explanation
- event ID
- event source URL
- confidence
- affected signals
- affected cell IDs
- audit trail

This is conceptually one of the core product ideas: turning spatial change into a Git-like changelog.

### 8.6 Electricity yearly replay

The app also generates annual electricity geojson layers with per-feature properties such as:

- `grid_load_pct`
- `replay_first_visible_year`
- `visibility_basis`

These are used in the replay and later inform transformer planning.

## 9. UI Manifest And Layer System

The browser map contract is assembled by `scripts/build_ui_manifest.py`.

### 9.1 Main responsibilities

This script:

- builds the optimized 3D building layer
- builds the map/browser manifest
- catalogs source artifacts
- assigns style metadata

### 9.2 Interactive layers

The current manifest exposes 8 interactive 2026 layers:

- Belfast NI buildings 3D
- NI cycleways OSM
- NI green spaces OSM
- NI power grid OSM
- NI roads OSM
- NI services OSM
- NI transport stops OSM
- NI water OSM

### 9.3 3D building optimization

The building layer builder:

- reads `data/2026/exportbuildings.geojson`
- clips to a Belfast core bbox
- computes area and height proxies
- limits to `22,000` max interactive buildings
- adds replay metadata like first visible year and architecture period

This is a performance optimization and also a storytelling mechanism.

## 10. Event-Catalog Builder

The event catalog is generated by `scripts/build_infrastructure_events.js`.

### 10.1 Purpose

It creates `data/derived/2026/belfast_infrastructure_events_2016_2026.json`, which drives:

- historical replay event lists
- event evidence panels
- similar-events logic
- historical context for the impact predictor

### 10.2 Source logic

It combines:

- OSM-derived asset layers
- planning statistics
- explicit official curated events
- category-to-signal mapping
- Overpass metadata where available

### 10.3 Signals

The event builder uses these core signal families:

- traffic
- buildings
- electricity
- services
- jobs

## 11. Transit Data Builder

The transit layer builder is `scripts/build_translink_transit_layers.js`.

### 11.1 Purpose

It downloads or uses local Translink route/stop datasets, parses MIF/MID files, and builds:

- `data/derived/2026/translink_belfast_bus_stops_2026.geojson`
- `data/derived/2026/translink_belfast_route_segments_2026.geojson`

### 11.2 What it is not

It is not a timetable optimizer or routing backend. It is a local layer builder that supports map context and forecast visualization.

## 12. Spatial Replay ETL Layer

The ETL system in `scripts/spatial_replay_etl.py` and `schemas/replay_spatial_model.sql` is more of a data-contract and summarization layer than a runtime dependency.

### 12.1 What it provides

- a generic compact catalog of local source files
- a timeline manifest of availability/readiness by year
- SQL/PostGIS contracts for what a fuller data platform could look like

### 12.2 SQL schema intent

The SQL model defines tables for:

- source batches and source files
- replay zones and yearly zone snapshots
- indicator definitions and yearly indicators
- OSM features and annual OSM snapshots
- planning applications and their events
- bike stations and bike trip events
- public transport stops, routes, and timetable events
- air zones and air observations
- scenario branches, scenario edits, scenario edit events
- spatial feature deltas
- zone indicator deltas

This schema is architectural intent. The live app does not currently run on this SQL database.

## 13. Forecast Model

This is one of the most important sections because the repo calls it a model.

### 13.1 Artifact

Built by:

- `scripts/train_forecast_model.py`

Outputs:

- `web/data/mode-a/forecast_model.json`
- `web/data/mode-a/baseline_2025_forecast.json`
- `docs/forecast_model_card.md`

### 13.2 What method is used?

The forecast model is not classical ML.

It is explicitly described in code as:

- `family: deterministic trend plus planner-response model`

Its method is:

1. Read observed annual grid values from `2016-2025`
2. Derive per-cell source metrics from existing replay properties
3. Compute recent slope and long-run slope per metric
4. Apply small event-density continuation boosts
5. Extrapolate forward annually from the 2025 baseline through 2036
6. Clamp every metric to a `0-1` normalized planning index

This is closer to:

- heuristic trend extrapolation
- hand-built feature engineering
- deterministic rules

It is not:

- linear regression fit on labeled targets
- random forest
- gradient boosting
- neural net
- transformer
- Bayesian model
- reinforcement learning

### 13.3 Forecast metrics

The forecast model tracks 12 metrics:

- `traffic`
- `population`
- `jobs`
- `economy`
- `housingPressure`
- `services`
- `electricity`
- `environmentAir`
- `greenScore`
- `fairness`
- `fiscalBalance`
- `planningViability`

### 13.4 Confidence behavior

Cell confidence is currently assigned from event density, not estimated from a trained uncertainty model.

### 13.5 Runtime use

The forecast artifact provides the no-build baseline and cell/year forecast tables. Scenario interventions are applied at runtime in `lib/scenario-studio.js`.

### 13.6 Bottom line

The forecast "model" is a deterministic planning forecast artifact, not an ML-trained predictor in the usual sense.

## 14. Transformer Impact Model

### 14.1 Artifact

Built by:

- `scripts/build_transformer_model.py`

Outputs:

- `data/derived/2026/belfast_ni_transformers_official.geojson`
- `data/derived/2026/belfast_transformer_grid_features.csv`
- `web/data/mode-a/transformer_capacity_by_cell.json`
- `web/data/mode-a/transformer_impact_model.json`
- `web/data/mode-a/transformer_capacity_forecast.json`

### 14.2 What method is used?

Again, this is not classical ML.

The code explicitly defines three conceptual components:

- `DemandModel`
- `SpatialLoadAllocator`
- `TransformerScenarioModel`

But these are deterministic, formula-driven components, not separately trained statistical models.

The method is:

1. Fetch or inspect NIE metadata if available
2. Load manual official records if present
3. Fall back to OSM transformer/substation proxies if needed
4. Convert ratings to kVA/kW proxy values
5. Allocate capacity and demand to replay grid cells using distance decay
6. Estimate peak load/headroom/overload risk per cell
7. Forecast those values annually through 2036 with simple growth/drift formulas
8. Apply uncertainty widening bands based on data confidence

### 14.3 Data status in current repo

Current build characteristics:

- source mode: `osm-proxy-with-official-metadata`
- asset features: `312`
- primary transformers: `58`
- secondary transformers: `254`

### 14.4 Why it looks like ML even though it mostly is not

The transformer artifact uses words like:

- training windows
- validation
- test
- spatial holdout

But in the code that is metadata/documentation for screening governance, not evidence of a conventional fitted predictive model in the repository.

### 14.5 Bottom line

This is a planning-grade transformer screening artifact with deterministic formulas and uncertainty bands, not a classical ML model.

## 15. Impact Predictor

### 15.1 File

- `web/impact-predictor.js`

### 15.2 Method

This is the one place where an ML-like idea is used most directly.

The file describes itself as:

- `Distance + recency-weighted kNN over the past-events catalog`

That means:

1. For a proposed building, load nearby historical events by signal
2. Weight them by:
   - spatial distance
   - event recency
   - event confidence
3. Turn those weighted event neighborhoods into context scores
4. Combine context scores with preset building profiles
5. Produce deterministic per-year deltas and heatmap samples

### 15.3 Is this actual machine learning?

It is a nearest-neighbors-style deterministic regressor, but:

- there is no training step in the usual optimization sense
- there is no learned parameter fitting at runtime
- it is better described as a closed-form heuristic kNN-style model

### 15.4 Product role

It powers:

- ripple heatmaps
- similar-past-events overlay
- explainability for staged development

## 16. Scenario Simulation Engine

The heart of forward planning is `lib/scenario-studio.js`.

### 16.1 Role

This file does the real numerical work for future simulations.

It handles:

- building normalization
- postcode resolution
- placement validation
- site-context extraction
- variant generation fallback
- intervention parsing/merging
- scenario branch scoring
- annual forecast intervention application
- concrete impact generation

### 16.2 Supported intervention types

The engine supports at least:

- `building`
- `building_removal`
- `mobility_corridor`
- `green_corridor`
- `opportunity_hub`
- `road`
- `transformer` or `infrastructure`

### 16.3 Scenario branch variants

A sample runtime call currently generates:

- `2025 Baseline / No-Build Forecast`
- `Jobs-Optimised Mixed Use`
- `Green-Mitigation Housing`
- `Balanced Growth`
- `Traffic-Safe Housing`
- `Fairness-First Housing`
- `Original Housing Proposal`

### 16.4 How interventions are applied

The engine applies interventions per cell and per year using functions such as:

- building planner
- building-removal planner
- mobility planner
- road planner
- transformer planner
- green planner
- opportunity planner

These planners work by:

- finding relevant nearby cells
- computing distance weights
- applying year ramps from 2026 to 2036
- adjusting the 12 forecast metrics
- clamping outputs

### 16.5 This is not an ML simulation

The scenario engine is deterministic policy/planning logic. It is an engineered scoring model, not a learned agentic planning system.

## 17. Concrete Impact Calculator

Within `lib/scenario-studio.js`, the engine also produces concrete planning estimates.

### 17.1 Purpose

This module translates normalized forecast deltas into auditable planning-style quantities.

### 17.2 Output domains

- traffic
- jobs
- electricity
- services

### 17.3 Example methods used

- trip generation plus induced-demand logic
- building employment density assumptions
- transformer relief/headroom effects
- resident and worker service-demand assumptions
- annual operation ramping

### 17.4 Important caveat

All of these are planning proxies. The code and model cards explicitly warn that they are not engineering-grade or statutory approvals.

## 18. Gemini Agent Layer

The app optionally uses Gemini in `server.js`.

### 18.1 What Gemini does

If configured, Gemini can:

- parse a natural-language building request
- generate scenario variants
- generate short commit explanations
- critique simulations
- report/summarize scenario results
- produce coordinator/site/specialist agent-style reasoning

### 18.2 What Gemini does not do

Gemini does not calculate the core numeric scenario outputs. When Gemini is unavailable, the app falls back to deterministic local logic.

### 18.3 Why this matters for audit

You should think of Gemini as:

- a UX augmentation layer
- a natural-language orchestration/explanation layer

not as the source of truth for planning metrics.

## 19. Traffic Simulation

### 19.1 File

- `web/traffic-sim.js`

### 19.2 What simulation type is this?

This is a lightweight in-browser traffic microsimulation / agent swarm.

It simulates:

- road segments
- moving vehicles
- occupancy/congestion feedback
- route choice on a road graph

### 19.3 Inputs

- user-staged roads from the active branch
- Belfast OSM road network loaded from `/api/layers/2026/source-ni-roads-osm`

### 19.4 Capabilities

- live running vehicle animation
- congestion metrics
- whole-city sampling
- pathfinding over OSM graph
- candidate-road comparison
- persistent congestion overlays

### 19.5 Is this calibrated traffic engineering?

No. It is a lightweight visual simulation for comparative scenario exploration.

## 20. Transit Engine

### 20.1 File

- `web/transit-engine.js`

### 20.2 What it does

This module renders and forecasts public transport access using:

- OSM transport stops
- derived Translink stops/routes
- historical services events
- forecast branch/service deltas

### 20.3 Simulation style

This is not a timetable solver or network assignment model. It is a rule-based overlay engine that maps route/station context into forecast-visible transport features.

## 21. Validation And Placement Logic

Placement validation in `lib/scenario-studio.js` is a major product capability.

It checks things like:

- whether a postcode is precise enough
- whether the point is inside the replay grid
- overlap/buildability issues
- local transit/services context
- green/flood/environmental context
- local deprivation weighting

This validation strongly affects:

- whether a scenario can run
- warnings shown to the user
- branch confidence
- site agent outputs

## 22. Persistence And UX State

The app persists state in localStorage under:

- `belfast-dashboard-v1`

Persisted values include:

- active year
- active branch
- branches and their items
- active building preset
- view mode
- bottom-panel state
- selected postcode

Scenario numeric results are intentionally not all persisted directly in the same way.

## 23. Verification Status

I ran the built-in verification and tests in this repository.

### 23.1 `npm run verify`

Result:

- Manifest OK: 8 interactive layers, 68,516 renderable features, 48 source artifacts, 308 Mode A cells
- Forecast OK: 308 cells, 11 years, 6 scenario branches
- Transformer model OK: 308 cells, 312 assets, 11 years

### 23.2 `python -m unittest discover tests`

Result:

- 7 tests run
- all passed

### 23.3 What is actually tested

The tests cover:

- ETL summarization behavior
- forecast artifact shape and normalization
- transformer artifact existence and units
- scenario runtime with road and transformer interventions

### 23.4 What is not deeply tested

There is relatively limited direct automated testing of:

- DOM/UI behavior
- Mapbox interactions
- branch UX edge cases
- legacy frontend files
- Gemini workflows

There are browser smoke scripts under `scripts/`, but this repo’s most formal checks are still artifact- and engine-focused.

## 24. Active Vs Legacy Code

### 24.1 Clearly active

- `server.js`
- `web/index.html`
- `web/dashboard.js`
- `web/impact-predictor.js`
- `web/traffic-sim.js`
- `web/transit-engine.js`
- `web/map-ux.js`
- `lib/scenario-studio.js`
- build scripts under `scripts/`

### 24.2 Legacy UI path

The old alternate UI path has been removed. Product behavior should be audited through `web/index.html`, `web/dashboard.js`, and the active modules loaded by that page.

## 25. Architectural Strengths

The strongest qualities of this codebase are:

- strong data provenance mindset
- deterministic local execution
- clear separation between data builders and runtime app
- thoughtful distinction between evidence/confidence and false certainty
- practical planning-oriented outputs rather than just raw map layers
- good fallback behavior when Gemini is absent

## 26. Architectural Weaknesses And Risks

The main weaknesses are:

### 26.1 Large single-file frontend

`web/dashboard.js` is very large and centralizes many responsibilities:

- state management
- rendering
- simulation orchestration
- branch logic
- map behavior
- export
- modal logic

This makes the app harder to maintain and reason about.

### 26.2 Large single-file simulation library

`lib/scenario-studio.js` is also very large and mixes:

- data loading
- geometry helpers
- validation
- planners
- reporting
- forecast mechanics

### 26.3 Terminology risk around "models"

The repo uses model language heavily, but many "models" are deterministic screening artifacts. That is not wrong, but it can confuse users into assuming rigorous trained ML where there is mostly engineered planning logic.

### 26.4 Historical vs future metric mismatch

The historical replay and future forecast layers are conceptually related but not identical. The dashboard maps deeper future metrics into displayed headline cards, which is practical but can blur the distinction between measured replay values and scenario-derived display abstractions.

### 26.5 Legacy code residue

The old alternate frontend entrypoints have been removed, reducing the chance that a new engineer reads the wrong runtime first.

## 27. Direct Answers To The ML / Model Question

Because you explicitly asked what machine-learning methods were used, here is the clearest possible answer.

### 27.1 Forecast model

Method used:

- deterministic slope-based time-series extrapolation plus event-density adjustments

Not used:

- regression training
- neural networks
- transformers
- boosting

### 27.2 Transformer impact model

Method used:

- deterministic capacity conversion, distance-decay load allocation, simple annual drift/growth, uncertainty bands

Not used:

- supervised ML training in the conventional sense

### 27.3 Impact predictor

Method used:

- deterministic distance-and-recency-weighted kNN-style regressor over the event catalog

This is the closest thing in the repo to a recognizable ML-style method, but it is still closed-form and not trained in the standard optimization sense.

### 27.4 Scenario simulation

Method used:

- deterministic rule-based planning planners operating on forecast baselines

Not used:

- agentic planning AI for numeric outputs
- reinforcement learning
- learned simulator

### 27.5 Traffic simulation

Method used:

- browser-based agent/microsimulation over a road graph

### 27.6 Transit simulation

Method used:

- heuristic/public-transport network overlay and branch delta projection

### 27.7 Gemini

Method used:

- LLM reasoning/generation for UX, parsing, critique, and explanation

Not used:

- numeric truth engine

## 28. Final Understanding Of The Product

The best concise mental model for this repository is:

"A local, deterministic Belfast replay-and-planning digital twin with optional LLM explanation, where historical evidence is turned into map layers and changelog events, then projected into future scenario branches using engineered forecast and screening models rather than heavy machine learning."

If you want to understand the codebase in the fastest possible order, read it in this sequence:

1. `readme.md`
2. `web/index.html`
3. `web/dashboard.js`
4. `server.js`
5. `lib/scenario-studio.js`
6. `scripts/build_mode_a_replay.py`
7. `scripts/train_forecast_model.py`
8. `scripts/build_transformer_model.py`
9. `scripts/build_ui_manifest.py`
10. `scripts/build_infrastructure_events.js`
11. `docs/forecast_model_card.md`
12. `docs/transformer_impact_model_card.md`
13. `tests/`

That path gives the best balance between product understanding and numeric/model understanding.
