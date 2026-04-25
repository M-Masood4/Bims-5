# Mode A Replay Contract

Mode A is the historical replay product for Belfast, 2016-2026. It is a spatial changelog, not a perfect year-by-year reconstruction.

## Product Lenses

The UI, generated grids, metric cards, and city commits are anchored to exactly five lenses:

- `population_pressure`: density, housing, development and service pressure.
- `mobility_strain`: road pressure, transit gaps, walkability and bike access.
- `economic_opportunity`: access to jobs, education, services and growth corridors.
- `environmental_exposure`: air quality, green cover, road exposure and River Lagan/flood context.
- `fairness_score`: whether improvements reach deprived or underserved areas.

Supporting signals such as `development_pressure`, `green_cover`, `bike_access`, `transit_access`, `planning_intensity`, and `deprivation_weight` remain in grid-cell properties as evidence, but they are not top-level product metrics.

## Generated Files

The frontend expects:

```text
web/data/mode-a/summary.json
web/data/mode-a/grid_2016.geojson
web/data/mode-a/grid_2017.geojson
...
web/data/mode-a/grid_2026.geojson
web/data/mode-a/hotspots_2016.geojson
...
web/data/mode-a/hotspots_2026.geojson
```

## Grid Feature Properties

Each grid cell stores yearly lens scores, supporting signals, delta fields, confidence and evidence:

```json
{
  "cell_id": "belfast_00_00",
  "year": 2026,
  "population_pressure": 0.62,
  "mobility_strain": 0.54,
  "economic_opportunity": 0.71,
  "environmental_exposure": 0.42,
  "fairness_score": 0.57,
  "population_pressure_delta_2016": 0.18,
  "development_pressure": 0.66,
  "green_cover": 0.39,
  "bike_access": 0.44,
  "transit_access": 0.69,
  "dominant_metric": "population_pressure",
  "dominant_change": "worsened",
  "confidence": "medium",
  "evidence": [
    "NISRA population/census totals",
    "OSM building density and development-zone proxy",
    "Planning/local development source inventory"
  ]
}
```

Metric values are normalized from `0` to `1`. For pressure/exposure lenses, higher means more strain. For opportunity/fairness, higher means better access or distribution.

## Summary Shape

`summary.json` contains:

- `years[]`: 2016-2026
- `coreMetrics[]`: the five required lens definitions
- `metricsByYear[year][]`: bottom at-a-glance metric cards
- `commitsByYear[year][]`: deterministic five-item city changelog
- `sources[]`: evidence/provenance entries

Commit directions:

- `+`: appeared or improved
- `-`: decreased or improved pressure/exposure
- `~`: changed/mixed
- `!`: risk, fairness gap, or confidence warning

The product must not invent unsupported certainty. Proxy-based values need visible evidence and confidence language.
