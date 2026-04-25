# Draft: 2036 Simulation Feasibility

## Requirements (confirmed)
- assess the entire current codebase
- determine how the current implementation would simulate data into 2036
- determine how to do so with minimal mistakes
- determine whether it is possible at all
- hackathon goal is future-focused Belfast problem-solving
- intended product is a project where users place buildings and roads and observe impacts on jobs, air pollution, economy, and population over time

## Technical Decisions
- start with repository exploration before answering
- treat repository as a data asset repo unless executable simulation code is found

## Research Findings
- workspace root includes `data/`, `readme.md`, `belfast_air_quality.csv`, and `Belfast-Population-Total-Population-By-Year-2026-04-25-14-06.csv`
- no application, ETL, scheduler, schema, migration, or forecast code was found in the repository
- yearly population data ends at 2025; no 2036 projection artifact exists
- 2026 geospatial files are static exports with fixed timestamps and Overpass-style generator metadata
- validation/test infrastructure is absent; no executable checks for time-series continuity, rollover handling, or forecast quality were found
- dataset geography is inconsistent: some files point to Belfast, Northern Ireland while several 2026 geospatial files point to Belfast, Maine

## Open Questions
- which Belfast is the intended target dataset: Northern Ireland or Maine?
- what external pipeline generated the 2026 snapshot files, since it is not present in this repo?
- should the hackathon MVP use simple rules/heuristics, a calibrated forecast model, or a hybrid approach?
- is the primary deliverable an interactive map UI, a simulation engine, or both?
- what year range should the MVP support: 2026-2036, 2026-2040, or user-selectable?

## Scope Boundaries
- INCLUDE: current repository behavior, feasibility, likely error sources, validation paths
- EXCLUDE: implementation changes until a work plan is requested
