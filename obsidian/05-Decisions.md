# Technical Decisions

## Why MATSim?

MATSim is an established open-source agent-based transport simulator used in academic and planning contexts. It handles large-scale city networks, supports custom event handlers, and outputs standardised XML events. Chosen over custom simulation because it handles the complex traffic dynamics out of the box.

## Why NATS JetStream?

Events from MATSim simulations are high-frequency. NATS JetStream provides durable, ordered message streams that the backend can replay to reconnecting clients. Also used for object storage of simulation output files (CSV, YAML).

## Why FastAPI for the backend?

Async Python fits the SSE streaming pattern well. FastAPI's automatic OpenAPI generation saves documentation work. The team was already familiar with Python.

## Why React + Mapbox GL?

Mapbox GL handles the WebGL-powered map rendering. deck.gl layers handle the simulation event visualisation (agent dots moving on links). TanStack Query manages server state without needing Redux.

## Why PostGIS for map data?

OSM network data has spatial relationships that need indexed bounding-box queries. PostGIS `ST_Intersects` with spatial indexes makes viewport-based queries fast. Standard PostgreSQL without PostGIS would require in-process geometry filtering.

## Database name: bims5

Changed from the original `trafficjam` to `bims5` to match the project rebranding.

## Java package: com.bims5

Changed from `com.trafficjam` to `com.bims5`. All Java source files and directories updated accordingly.

## Default city: Belfast

Changed from Cork to Belfast. Belfast is the target city for the BIMS 5 urban twin project. EPSG:2157 (Irish Transverse Mercator) is retained as the CRS — it covers all of Ireland including Northern Ireland, so MATSim coordinate handling stays consistent.

**Coordinate system note:** Frontend uses WGS84 `[longitude, latitude]`. MATSim internally uses ITM (EPSG:2157) `[x, y]` in metres. The `network_builder.py` investigation script handles the projection via OSMnx before outputting MATSim XML.
