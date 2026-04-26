# BelfastGit Mode A: Replay Belfast 2016-2026

This branch implements Mode A: a 2016-2026 city changelog for Belfast. It combines a Mapbox replay map, deterministic grid metrics, Git-style city commits, evidence/confidence panels, data provenance, and the current local source files.

## What It Does

- Scrub a timeline from `2016` to `2026`.
- See a 2D/2.5D time-lapse city diff across development, mobility, green cover, air quality, opportunity, and fairness.
- Read deterministic “City commits” such as `+`, `-`, `~`, and `!` changes.
- Click a grid cell or commit to inspect evidence and confidence.
- Use local OSM, raster, census, population, air-quality, and source-inventory data without needing a remote database.

## Run The Product

Requires Node.js 18 or newer. No package install is required.

```powershell
npm start
```

Open `http://localhost:5173`.

## Build Data Manifests

```powershell
python .\scripts\index_sources.py --output .\manifests\provenance_manifest.json
python .\scripts\spatial_replay_etl.py --input data --output build\spatial_replay --pretty
python .\scripts\build_ui_manifest.py
python .\scripts\build_mode_a_replay.py
```

## Verify

```powershell
python -m unittest discover tests
npm run verify
```

## Source And ETL Docs

- `docs/data_acquisition.md`
- `docs/spatial_replay_etl.md`
- `api/README.md`
