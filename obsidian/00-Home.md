# BIMS 5 Knowledge Base

Building and Infrastructure Management Simulator — project context, architecture, and planning notes.

## Quick Links

- [[01-Architecture]] — Service overview and data flows
- [[02-Services]] — Per-service reference
- [[03-Simulation]] — How the MATSim simulation works
- [[04-Roadmap]] — Features planned and in progress
- [[05-Decisions]] — Key technical decisions and rationale
- [[06-Changelog]] — Session-by-session change log

## Current City: Belfast
Default city is **Belfast, Northern Ireland**. Center `[-5.93, 54.597]`, bounds south 54.55 / west -6.05 / north 54.65 / east -5.81.

## Project At a Glance

BIMS 5 lets users plan urban changes — new roads, new buildings — and see the economic and traffic impact through simulation.

**Two main modes:**
1. **Building Simulation Planner** — model how housing/commercial additions affect population, jobs, and revenue
2. **Road Planner** — model how new roads affect traffic via MATSim agent-based simulation

## Running the Stack

```bash
make run          # start PostgreSQL + PostGIS
cd map-data-service && uvicorn main:app --reload       # :8000
cd trafficjam-be  && uvicorn main:app --reload --port 8001 # :8001
cd simengine      && mvn spring-boot:run               # :8080
cd trafficjam-fe  && bun dev                           # :5173
```
