# Belfast Historical Replay UI/API

This branch adds a lightweight local UI/API scaffold for replaying Belfast data from 2016 through 2026.

The current repository data supports immediate 2026 vector map display. The 2016 GeoTIFF rasters are catalogued in the manifest as source assets and will be previewable once a future ETL branch emits browser-ready tiles or Cloud Optimized GeoTIFF metadata.

## Run Locally

Requires Node.js 18 or newer. No package install is required.

```powershell
npm start
```

Open http://localhost:5173.

You can also set a custom port:

```powershell
$env:PORT=5180; npm start
```

## Verify

```powershell
npm run verify
```

The verifier checks that the manifest covers 2016-2026, declared layer files exist, 2026 GeoJSON feature counts match the manifest, and 2016 raster metadata is present.

## API Contract

- `GET /api/manifest` returns `api/replay-manifest.json`.
- `GET /api/layers/{year}/{layerId}` streams a declared layer source file.

See `api/README.md` for the manifest fields expected from future ETL outputs.
