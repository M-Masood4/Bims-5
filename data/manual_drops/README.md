# Manual Data Drops

Use this directory for Google Earth exports, hand-digitized observations, FOI returns, screenshots, notes, and other manually acquired data that supports the 2016-2026 Belfast replay.

Recommended layout:

```text
data/manual_drops/<source_or_provider>/<year>/<descriptive_file>
```

After adding files, run:

```powershell
python .\scripts\index_sources.py --dry-run
python .\scripts\index_sources.py --output .\manifests\provenance_manifest.json
```

When terms, capture dates, or interpretation methods are not clear from the file itself, add a small `.provenance.json` sidecar next to the drop.
