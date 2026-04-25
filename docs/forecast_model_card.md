# BIMS 5 Forecast Model Card

- Model version: `bims5-forecast-v1-2025-baseline`
- Baseline year: 2025
- Forecast horizon: 2026-2036
- Geography: Belfast, Northern Ireland replay grid (308 cells)
- Intended use: proxy planning comparison for building scenarios, branch tradeoffs, and evidence review.
- Not intended for: engineering-grade traffic assignment, grid-capacity approval, statutory fiscal appraisal, or site design certification.

## Inputs

- Mode A grid snapshots for 2016-2025
- Infrastructure event density from the local Belfast event catalog
- Population totals and census context
- Air-quality summaries
- Planning/development signals
- Transport and services proximity layers
- Electricity proxy layers

## Output Metrics

`traffic`, `population`, `jobs`, `economy`, `housingPressure`, `services`, `electricity`, `environmentAir`, `greenScore`, `fairness`, `fiscalBalance`, `planningViability`

Every metric is normalized to a 0-1 proxy index. Scenario deltas are computed at runtime by deterministic planners and then clamped to the same bounds.

## 2036 No-Build Summary

- `traffic`: 0.483
- `population`: 0.915
- `jobs`: 0.213
- `economy`: 0.210
- `housingPressure`: 0.852
- `services`: 0.205
- `electricity`: 0.681
- `environmentAir`: 0.570
- `greenScore`: 0.265
- `fairness`: 0.237
- `fiscalBalance`: 0.218
- `planningViability`: 0.248

## Governance

Gemini agents may propose branches, explain tradeoffs, and flag unsupported claims. They do not calculate or override numeric impacts. Numeric values come from this artifact and deterministic planners in `lib/scenario-studio.js`.

## Limitations

- Event timestamps can represent mapped visibility or public records, not always physical completion dates.
- Cell-level values are planning proxies derived from available open data and local artifacts.
- Flood, electricity, fiscal, and traffic values are screening signals that should trigger expert review rather than replace it.
