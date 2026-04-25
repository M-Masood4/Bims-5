# Belfast Replay API Contract

This branch exposes a small static-first contract for the future ETL branch.

## Endpoints

- `GET /api/manifest` returns `api/replay-manifest.json`.
- `GET /api/layers/{year}/{layerId}` streams the source file for a layer declared in the manifest.

The included `server.js` implements those endpoints without third-party dependencies.

## Manifest Shape

Each layer should provide:

- `id`: stable URL-safe layer id.
- `year`: replay year from `2016` through `2026`.
- `label`: display name.
- `type`: `geojson`, `geotiff`, or a future ETL type such as `raster-tilejson`.
- `path`: repository-relative source path.
- `apiPath`: optional local endpoint for directly loading the layer.
- `status`: `ready`, `pending-etl`, `source-available`, or a more specific source status.
- `featureCount`, `byteSize`, `bbox`, `geometryTypes`: generated ETL summary fields.
- `provenance`: source name, license, and source status.

The UI is intentionally tolerant of missing years. It shows the timeline year and source status even when no renderable layer exists yet.
