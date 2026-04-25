# Belfast Spatial Replay ETL

This branch owns the ETL/model layer for a Belfast historical replay from 2016
through 2026. It does not render the replay and does not depend on the future
data-source branch being merged.

## Files

- `schemas/replay_spatial_model.sql` defines the relational/PostGIS-oriented
  replay model: source provenance, annual snapshots, event tables, spatial
  deltas, indicators, public transport, bike, planning, air, and scenario edits.
- `schemas/source_manifest.schema.json` defines the future handoff contract for
  source manifests produced by the data-source branch.
- `scripts/spatial_replay_etl.py` scans available raw data and writes compact
  deterministic JSON indexes.
- `build/spatial_replay/catalog.json` is the generated source catalog.
- `build/spatial_replay/timeline_manifest.json` is the generated replay timeline
  contract for 2016-2026.

## Run

From the repository root:

```powershell
python scripts/spatial_replay_etl.py --input data --output build/spatial_replay --pretty
```

Optional future source manifests can be included without changing the script:

```powershell
python scripts/spatial_replay_etl.py `
  --input data `
  --output build/spatial_replay `
  --source-manifest path\to\source_manifest.json `
  --pretty
```

By default, SHA-256 checksums are computed only for files up to 10 MiB. Larger
files are recorded by path, size, year, layer kind, and parsed metadata where
safe. To change that threshold:

```powershell
python scripts/spatial_replay_etl.py --hash-max-bytes 52428800
```

## Verification

Run the unit-level smoke test:

```powershell
python -m unittest discover tests
```

Run the ETL against the checked-in data:

```powershell
python scripts/spatial_replay_etl.py --input data --output build/spatial_replay --pretty
```

The script uses only the Python standard library. GeoJSON feature collections
are summarized by feature count, geometry type counts, common property keys,
sample feature IDs, and bbox. TIFF rasters are summarized by file stats and
classic TIFF header tags only; raster pixel contents are not processed.

## Merge Expectations

The data-source branch should provide one or more manifest JSON files matching
`schemas/source_manifest.schema.json`. This ETL branch expects each manifest to
name source paths, temporal coverage, layer kinds, media types, optional
checksums, spatial coverage, licenses, and target table hints.

When that branch is merged, keep this boundary:

- Source acquisition and raw download logic stays in the data-source branch.
- Replay table contracts and derived catalog/timeline generation stay here.
- New source types should first be represented as `layer_kind` values in source
  manifests, then mapped into snapshot or event tables in SQL.
- Derived outputs should remain compact and deterministic enough for review.

## Timeline Output Contract

`timeline_manifest.json` contains:

- `annual_snapshots`: one entry per year from 2016 through 2026, with source
  dataset IDs, layer-kind counts, status, and expected snapshot tables.
- `event_tables`: the event streams needed to reconstruct yearly states.
- `spatial_delta_jobs`: adjacent-year delta jobs and readiness status.
- `static_replay_exports`: named export contracts for later renderer/static
  asset branches.
- `source_manifest_contract`: the schema path and merge expectation for future
  source manifests.
