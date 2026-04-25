# Data Acquisition and Provenance

This branch keeps the Belfast replay data-source layer small, inspectable, and deterministic. The default workflow is metadata-first: record where data should come from, place source files under a clear local path, then index them into a normalized manifest.

## Source Inventory

The source catalogue is `config/source_inventory.json`. Each source entry records:

- coverage years for the 2016-2026 replay window
- access pattern, such as local repo, manual drop, API query, portal download, or feed
- licence and attribution notes
- ingestion status
- expected local paths and formats
- refresh notes for future automation

The inventory covers current repo rasters and vectors plus the recommended future sources: Google Earth/manual drops, OpenStreetMap via Overpass, Geofabrik and ohsome, Belfast City Council/OpenDataNI, Belfast Bikes, NI Planning Portal, Translink, Northern Ireland Air, NISRA population/deprivation/statistical boundaries, and Sentinel/Landsat/Copernicus products.

## Manifest Script

Run the indexer from the repository root:

```powershell
python .\scripts\index_sources.py --dry-run
```

To write or refresh the manifest:

```powershell
python .\scripts\index_sources.py --output .\manifests\provenance_manifest.json
```

The script scans `data/` by default and records:

- relative path
- sha256 checksum
- file size
- file extension and broad media type
- inferred layer name
- observed years, folder year, filename year, and primary year
- detected source ID and evidence
- lightweight GeoJSON metadata where practical, including feature count, geometry types, bbox, generator, copyright, and timestamp
- quality flags such as folder/filename year mismatch, skipped metadata for large files, and bbox outside the approximate Belfast, Northern Ireland validation envelope

The script does not download remote data. It can safely run in dry-run mode to validate inventory and preview counts.

## Adding Google Earth or Manual Drops

Place new manually acquired files under:

```text
data/manual_drops/<source_or_provider>/<year>/
```

Examples:

```text
data/manual_drops/google_earth/2019/cathedral_quarter_change_points.kml
data/manual_drops/manual_digitising/2024/york_street_notes.geojson
data/manual_drops/foi/2021/planning_reference_extract.csv
```

For each drop, add a small sidecar note when the source terms or interpretation method are not obvious:

```text
data/manual_drops/google_earth/2019/cathedral_quarter_change_points.provenance.json
```

Suggested sidecar fields:

```json
{
  "source_id": "manual_google_earth",
  "provider": "Google Earth",
  "capture_or_observation_date": "2019-06-15",
  "created_by": "name or initials",
  "method": "hand-digitized placemarks from visual inspection",
  "licence_or_terms_url": "https://www.google.com/permissions/geoguidelines/",
  "notes": "Describe what changed and any uncertainty."
}
```

Do not overwrite an earlier manual drop. Add a new dated file and refresh the manifest.

## Refreshing External Source Metadata

For external sources, commit small metadata and manifests before large data. A useful refresh cycle is:

1. Check `config/source_inventory.json` for the source path and licence notes.
2. Save only lightweight exports, query files, or metadata first.
3. Put large downloaded files outside git unless the project explicitly approves them.
4. Record source URL, query parameters, retrieval date, licence, checksum, and any clipping/filtering steps.
5. Run `python .\scripts\index_sources.py --dry-run`.
6. Run `python .\scripts\index_sources.py --output .\manifests\provenance_manifest.json`.

For OpenStreetMap-derived files, preserve the Overpass QL query or ohsome request body. For official open-data files, preserve the dataset landing page and resource ID. For remote-sensing products, preserve catalogue/STAC metadata and scene IDs before deriving small rasters.

## Known Data Quality Checks

The current indexer is deliberately conservative. It flags evidence; it does not change source files. In particular:

- `outside_target_belfast_ni_bbox` means a parsed GeoJSON bbox does not intersect the approximate Belfast, Northern Ireland envelope.
- `folder_filename_year_mismatch` means the year in the folder and the year in the filename disagree.
- `metadata_skipped` means the file was too large for lightweight GeoJSON parsing under the configured size limit.

Review these flags before using a layer in replay analysis.
