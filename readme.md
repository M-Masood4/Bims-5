# Belfast Historical Replay Data Sources

This branch owns the data acquisition and provenance layer for a Belfast historical replay covering 2016-2026. It does not run the replay model and it does not download large external datasets by default.

## What is here

- `config/source_inventory.json` records the planned and current sources, years, access pattern, licensing/provenance notes, automation status, and ingestion status.
- `scripts/index_sources.py` scans local data, computes stable file fingerprints, extracts lightweight GeoJSON metadata where practical, and writes a normalized provenance manifest.
- `manifests/provenance_manifest.json` is the current small manifest for data already present in this repository.
- `data/manual_drops/` is the landing area for Google Earth exports, imagery-derived annotations, FOI results, and other manually acquired source files.
- `docs/data_acquisition.md` explains the source refresh workflow and how to add future manual drops.

## Quick verification

Run a deterministic dry run without writing files:

```powershell
python .\scripts\index_sources.py --dry-run
```

Refresh the manifest after adding or changing local data:

```powershell
python .\scripts\index_sources.py --output .\manifests\provenance_manifest.json
```

The indexer intentionally avoids downloading remote datasets. Use it after source files have been placed under `data/` or `data/manual_drops/`.
