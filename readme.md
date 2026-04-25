# Belfast Historical Replay 2016-2026

This branch combines the data-source, spatial ETL, and replay UI work for an end-to-end Belfast historical replay.

## Layers In This Branch

- `data/` contains the local 2016, 2018, 2020, 2021, and 2026 source data currently available in the repository.
- `config/source_inventory.json` documents the full source plan: local OpenStreetMap extracts, Google Earth/manual drops, Geofabrik/Overpass/ohsome, Belfast/OpenDataNI, Belfast Bikes, planning, Translink, NI Air, NISRA, and Earth observation exports.
- `scripts/index_sources.py` builds the source provenance manifest.
- `scripts/spatial_replay_etl.py` builds the derived spatial catalog and 2016-2026 replay timeline.
- `schemas/` contains the PostGIS-oriented replay model and source-manifest handoff contract.

## Quick Commands

```powershell
python .\scripts\index_sources.py --output .\manifests\provenance_manifest.json
python .\scripts\spatial_replay_etl.py --input data --output build\spatial_replay --pretty
python -m unittest discover tests
```

The UI/API commands are added in this branch after the UI merge:

```powershell
npm start
npm run verify
```
