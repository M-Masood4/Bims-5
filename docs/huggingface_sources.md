# Hugging Face Source Notes

The Hugging Face plugin was checked for directly usable Belfast/Northern Ireland geospatial datasets during this implementation pass.

Queries attempted:

- `Belfast Northern Ireland geospatial roads buildings census`
- `OpenStreetMap Belfast`
- `satellite imagery urban buildings roads geojson`

No direct Belfast-specific geospatial dataset repository was returned by the Hub search. The app therefore does not depend on a fragile or unrelated Hugging Face dataset.

Future HF-hosted data can still be added through the normal source workflow:

1. Add the dataset repo ID and licence to `config/source_inventory.json`.
2. Download or export only the needed Belfast subset into `data/manual_drops/hugging_face/<year>/` or a purpose-named `data/<year>/` folder.
3. Run `python .\scripts\index_sources.py --output .\manifests\provenance_manifest.json`.
4. Run `python .\scripts\build_ui_manifest.py`.
