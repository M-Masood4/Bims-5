# Mode A Replay Contract

Mode A is the historical replay product for Belfast, 2016-2026. It is a spatial changelog rather than a perfect year-by-year clone.

## Generated Files

The frontend expects:

```text
web/data/mode-a/summary.json
web/data/mode-a/grid_2016.geojson
web/data/mode-a/grid_2017.geojson
...
web/data/mode-a/grid_2026.geojson
```

## Grid Feature Properties

Each grid cell stores yearly metrics and diff labels:

```json
{
  "cell_id": "belfast_0001",
  "year": 2026,
  "development_pressure": 0.62,
  "green_cover": 0.44,
  "mobility_access": 0.71,
  "air_quality": 0.58,
  "opportunity_access": 0.66,
  "fairness_context": 0.73,
  "bike_activity": 0.52,
  "planning_intensity": 0.49,
  "dominant_change": "increased",
  "confidence": "medium",
  "evidence": [
    "OSM building density proxy",
    "NI Air annual trend proxy",
    "NISRA population/census context"
  ]
}
```

Metric values are normalized from `0` to `1`. For air quality, higher means better/lower exposure in the UI.

## Summary Shape

`summary.json` contains:

- `years[]`: 2016-2026
- `metricsByYear[year][]`: right-panel metric cards
- `commitsByYear[year][]`: deterministic city commits with Git-like symbols
- `layers[]`: Mode A layer registry
- `sources[]`: evidence/provenance entries

Commit directions:

- `+`: appeared or improved
- `-`: decreased or worsened
- `~`: changed/mixed
- `!`: risk, fairness gap, or confidence warning

The product should never invent unsupported certainty. When a layer is proxy-based, its evidence and confidence fields must say so.
