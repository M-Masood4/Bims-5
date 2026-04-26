# Transformer Impact Model Card

- Model version: `bims5-transformer-impact-v1-2026-screening`
- Forecast horizon: 2026-2036
- Geography: Belfast replay grid (308 cells)
- Intended use: planning-grade screening of transformer interventions in Scenario Studio.
- Not intended for: NIE engineering approval, feeder connection offers, protection studies, or statutory network design.

## Data Sources

- Mode A replay grids: `web/data/mode-a/grid_{2016..2026}.geojson`
- Existing forecast artifacts: `web/data/mode-a/forecast_model.json` and `web/data/mode-a/baseline_2025_forecast.json`
- OSM power asset layer: `data/derived/2026/belfast_ni_power_grid_osm_2026.geojson`
- SONI quarter-hourly system spreadsheets present in the repository are source anchors for demand/peak calibration.
- NIE official metadata anchors: primary and secondary transformer datasets on the NIE Open Data Hub.
- Employment calibration anchors: NISRA BRES and Census 2021 labour-market tables.

## Official Transformer Data Status

- Source mode used in this build: `osm-proxy-with-official-metadata`
- Asset features written: 312
- primary: 58 features
- secondary: 254 features

The builder records the official NIE schema and will use manual official drops from `data/manual_drops` when present. If the record API is unavailable, it falls back to OSM transformer/substation proxies and marks confidence accordingly.

## Outputs

- `data/derived/2026/belfast_ni_transformers_official.geojson`
- `data/derived/2026/belfast_transformer_grid_features.csv`
- `web/data/mode-a/transformer_capacity_by_cell.json`
- `web/data/mode-a/transformer_impact_model.json`
- `web/data/mode-a/transformer_capacity_forecast.json`

## Runtime Behavior

Scenario Studio reads the transformer impact model first. If the artifact is missing or invalid, the existing deterministic transformer planner remains the fallback.

## Uncertainty

Outputs include p10/p50/p90 bands for electricity and jobs estimates. Wider bands are applied where ratings, geocodes, or local transformer coverage are weak.

## Limitations

- OSM timestamps and first-visible years are visibility evidence, not commissioning dates.
- Public data does not expose true LV/MV feeder loading, phase balance, fault level, or protection constraints.
- Capacity-enabled jobs are constrained by local commercial/development demand; headroom alone is not treated as a large permanent employment creator.
- Any low-support local result should be treated as medium or low confidence and escalated for engineering review.
