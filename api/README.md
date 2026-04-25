# Belfast Replay API Contract

This branch exposes a static-first Mapbox 3D replay contract for the 2016-2026 Belfast historical replay.

## Endpoints

- `GET /api/manifest` returns `api/replay-manifest.json`.
- `GET /api/layers/{year}/{layerId}` streams the source file for a layer declared in the manifest.
- `GET /api/health` returns a tiny local server health check.

The included `server.js` implements those endpoints without third-party dependencies.

## Manifest Shape

Each layer should provide:

- `id`: stable URL-safe layer id.
- `year`: replay year from `2016` through `2026`.
- `label`: display name.
- `type`: `geojson`, `geotiff`, `csv`, or a future ETL type such as `raster-tilejson`.
- `mode`: render mode such as `fill-extrusion` for Mapbox 3D buildings.
- `path`: repository-relative source path.
- `apiPath`: optional local endpoint for directly loading the layer.
- `status`: `ready`, `pending-etl`, `source-available`, or a more specific source status.
- `featureCount`, `byteSize`, `bbox`, `geometryTypes`: generated ETL summary fields.
- `provenance`: source name, license, and source status.

The UI is intentionally tolerant of missing years. It shows the timeline year and source status even when no renderable layer exists yet.

`scripts/build_ui_manifest.py` owns the generated manifest and optimized `data/derived/2026/belfast_ni_buildings_3d_core.geojson` file. Re-run it after adding new source files.
