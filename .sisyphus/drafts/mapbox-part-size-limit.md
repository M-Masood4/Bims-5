# Draft: Mapbox Part Size Limit

## Requirements (confirmed)
- mapbox simulation currently fails with: `Part exceeded maximum size of 1024KB`
- need a plan for keeping parts under 1 MB so simulation can proceed reliably

## Technical Decisions
- planning only; implementation decisions pending repo exploration
- prioritize preserving geometry/data fidelity; prefer chunking/splitting and use simplification only as fallback

## Research Findings
- external docs lookup via librarian failed due workspace billing restriction

## Open Questions
- which code path builds the Mapbox simulation payload or multipart upload
- whether the correct mitigation is chunking, geometry simplification, payload compression, request splitting, or pre-submit validation

## Scope Boundaries
- INCLUDE: request-size control, guardrails to stay below Mapbox part limits, verification approach
- EXCLUDE: unrelated simulation feature changes unless required by the limit fix
