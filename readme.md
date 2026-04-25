# Belfast Historical Replay 2016-2026

This branch combines the data-source, spatial ETL, and replay UI/API work for an end-to-end Belfast historical replay.

## What It Does

- Shows Belfast source data through a 2016-2026 timeline.
- Uses the current 2026 OpenStreetMap/OpenData GeoJSON layers immediately.
- Catalogues the 2016/2018/2020 raster assets, 2021 census input, population CSV, and air-quality CSV for ETL.
- Separates layers into practical categories such as buildings, roads, transit, water, green space, landmarks, civic services, and environment.
- Keeps provenance visible so future Google Earth/manual drops and external sources can be added safely.

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
