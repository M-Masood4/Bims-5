# Deterministic Planners Technical Q&A

## Scope

This document answers the most important technical questions someone could ask about the deterministic planners in BIMS-5. It focuses on the active simulation engine in:

- `lib/scenario-studio.js`

And the artifacts it consumes:

- `web/data/mode-a/forecast_model.json`
- `web/data/mode-a/baseline_2025_forecast.json`
- `web/data/mode-a/transformer_impact_model.json`
- `web/data/mode-a/transformer_capacity_by_cell.json`

It is not literally every question that could ever be asked, but it is intended to be a near-complete practical reference.

---

## 1. Core Concept

### Q1. What is a deterministic planner in this codebase?

A deterministic planner is a rule-based simulation function that takes a baseline forecast state and applies fixed mathematical adjustments to it. The output is deterministic because the same inputs always produce the same outputs.

### Q2. Where do the deterministic planners live?

In [scenario-studio.js](C:/Users/ayush/Bims-5/lib/scenario-studio.js).

### Q3. Why are they called planners?

Because they model planning interventions such as:

- adding a building
- removing a building
- adding a mobility corridor
- adding a road
- adding a transformer
- adding green mitigation
- adding an opportunity hub

They are "planners" in the sense of planning-policy simulators, not AI planning agents.

### Q4. Are the deterministic planners machine learning models?

No, not in the conventional sense. They are hand-authored formula systems.

### Q5. Are they stochastic?

No. There is no randomness in the planner calculations themselves.

### Q6. If I run the same scenario twice, do I get the same result?

Yes, assuming the same artifacts and same inputs.

### Q7. What do the planners operate on?

They operate on nearby replay-grid cells and their baseline forecast metrics.

### Q8. What is the planning horizon?

The deterministic forecast planners currently support:

- baseline year: `2025`
- start year: `2026`
- horizon year: `2036`

This is enforced by `runForecastScenario`.

### Q9. Can they simulate arbitrary years?

Not currently. The runtime explicitly rejects unsupported baseline/horizon combinations.

### Q10. Why is that restriction there?

Because the checked-in forecast artifacts are built specifically for `2025 -> 2026-2036`, and the planner logic assumes that structure.

---

## 2. Main Runtime Flow

### Q11. What function runs the full deterministic planning workflow?

`runForecastScenario`

### Q12. What does `runForecastScenario` do at a high level?

It:

1. validates input years
2. resolves postcode/location
3. builds a building intervention
4. validates placement
5. computes site context
6. assembles scenario variants
7. selects nearby context cells
8. builds a no-build baseline branch
9. simulates each scenario branch year-by-year
10. scores branches
11. returns metrics, affected cells, evidence, warnings, and concrete impacts

### Q13. What is the first real input to the planner system?

Usually a building proposal, either from:

- a precise postcode
- a map point
- a frontend-staged building object

### Q14. Why is a building treated as the anchor input?

Because the main Scenario Studio flow is centered on development proposals, even though additional interventions like roads and transformers can be layered in.

### Q15. Can the system run with only a road or only a transformer?

At the engine level, user interventions can include those types, but the main scenario flow is built around a base building proposal.

### Q16. How are nearby cells chosen?

Using `getCellsWithin`, which selects replay cells within a radius around the intervention location.

### Q17. What if no cells fall within the radius?

The engine falls back to the nearest cell via `findNearestCell`.

### Q18. What radius is used by default?

The scenario context defaults to around `950m`, though some planners use their own internal effect radii.

### Q19. What is the no-build branch?

It is the baseline forecast branch built by `baselineForecastBranch`, representing what happens if no new intervention is applied.

### Q20. What are scenario branches?

They are alternative intervention packages like:

- user proposal
- traffic mitigation
- green mitigation
- fairness-first
- jobs-optimised
- balanced growth

---

## 3. Input Normalization

### Q21. How does the engine normalize building inputs?

With `normalizeBuildingConfig`.

### Q22. What building sizes are supported?

- `small`
- `medium`
- `large`
- `custom`

### Q23. What building types are supported?

- `apartments`
- `mixed_use`
- `office`
- `community`

### Q24. What affordability mixes are supported?

- `market`
- `affordable`
- `social`
- `student`

### Q25. What happens if the frontend sends a malformed type string?

The engine canonicalizes it using helper functions like:

- `canonicalSize`
- `canonicalBuildingType`
- `canonicalAffordability`

### Q26. What does `deriveBuildingStats` do?

It derives a normalized building profile including:

- floors
- footprint
- total floor area
- units
- estimated residents
- estimated jobs
- estimated electricity demand

### Q27. Are resident/job/electricity values directly entered by users?

They can be, but if not provided they are inferred from preset building characteristics.

### Q28. How are residents estimated?

Primarily from unit count, using an average residents-per-unit proxy.

### Q29. How are jobs estimated?

Primarily from commercial floor area.

### Q30. How is electricity demand estimated?

From area-weighted demand proxies for residential, commercial, and community space.

---

## 4. Placement Validation

### Q31. What validates whether a site can be used?

`validatePlacement`

### Q32. What does placement validation check?

It checks things like:

- whether the location is inside the replay area
- whether the postcode is sufficiently specific
- whether the point is buildable
- whether there are conflicts with existing buildings
- whether there are warnings related to roads, flood, green context, etc.

### Q33. Does validation only return valid/invalid?

No. It can return warning-level states too.

### Q34. What kinds of outputs come from validation?

Typically:

- status
- warnings
- positive factors
- confidence
- site label
- buildability score

### Q35. Why does validation matter for planners?

Because validation influences:

- whether the scenario can run
- warning text
- branch confidence
- planning viability adjustments

### Q36. Can validation allow deletion scenarios more freely?

Yes. Building-removal scenarios relax some overlap/proximity checks.

---

## 5. Site Context

### Q37. What computes local site context?

`getSiteContext`

### Q38. What is included in site context?

It includes:

- nearest cell ID
- deprivation weight
- baseline metrics
- nearby transport
- nearby services
- green context
- flood or water context
- validation context

### Q39. Why is deprivation weight important?

Because fairness impacts are explicitly weighted by deprivation.

### Q40. Why do nearby transport/services matter?

Because they affect:

- mobility assumptions
- fairness uplift
- planning viability
- service pressure

### Q41. Is flood or water context used in a hydrological model?

No. It is a planning screening input, not a physical flood simulation.

---

## 6. Baseline Forecast Inputs

### Q42. What forecast artifacts are loaded?

The engine loads forecast artifacts via `loadForecastArtifacts`.

### Q43. What is in `forecast_model.json`?

A per-cell deterministic forecast model description and metadata.

### Q44. What is in `baseline_2025_forecast.json`?

The actual baseline forecast rows for cells and years from `2026` to `2036`.

### Q45. Does the planner recompute the baseline forecast from scratch?

No. It consumes the prebuilt artifact.

### Q46. What function gets a cell’s baseline/forecast values for a year?

`forecastForCellYear`

### Q47. What if a year is before 2025?

The forecast logic normalizes against baseline representations, but the active scenario runtime is intended for `2026-2036`.

### Q48. Are metrics normalized?

Yes. Forecast metrics are normalized to a 0-1 planning index scale.

### Q49. Why normalize everything?

Because it makes it easier to:

- combine effects
- compare across metrics
- clamp outputs consistently
- build cross-domain branch scores

### Q50. What metrics are forecasted?

- `traffic`
- `population`
- `jobs`
- `economy`
- `housingPressure`
- `services`
- `electricity`
- `environmentAir`
- `greenScore`
- `fairness`
- `fiscalBalance`
- `planningViability`

---

## 7. Planner Weighting And Time Dynamics

### Q51. How do planners fade effects by distance?

Using `plannerWeight(distanceM, radiusM)`.

### Q52. Is the distance effect linear?

Not exactly. It uses a smoothed weighting curve rather than a plain hard cutoff.

### Q53. What is `distanceWeight` used for?

It is a lower-level linear distance-decay helper used by some simulation paths.

### Q54. How do effects grow over time?

Using `operationRamp(year, startYear, horizonYear)`.

### Q55. What shape is the year ramp?

A smooth ramp from low initial effect toward full effect over the horizon.

### Q56. Why not make full impact happen immediately?

Because many interventions only partially operate at the beginning and scale up over time.

### Q57. Do all planner effects use the same radius?

No. Each planner type has its own radius assumptions.

### Q58. Do all planner effects use the same coefficients?

No. Each intervention type has its own metric-specific coefficients.

---

## 8. Building Planner

### Q59. What function applies a building intervention?

`applyBuildingPlanner`

### Q60. What is the main idea of the building planner?

It translates a building’s residents, units, jobs, floor area, energy standard, affordability, and mitigation settings into metric deltas on nearby cells.

### Q61. What helper computes building scalar values for the planner?

`plannerScalars`

### Q62. What normalized scalars does `plannerScalars` produce?

Examples include:

- normalized residents
- normalized units
- normalized jobs
- normalized electricity demand
- normalized footprint/floor area
- parking factor
- energy factor
- fairness multiplier
- transit goodness
- mitigation flags

### Q63. What does parking factor do?

It changes the traffic burden depending on whether the scheme is:

- parking-heavy
- balanced
- transit-first

### Q64. What does energy factor do?

It scales electricity and environmental impacts depending on the energy standard.

### Q65. What metrics does the building planner directly affect?

All 12 forecast metrics.

### Q66. How does it affect population?

By increasing the `population` metric in proportion to normalized resident intensity and residential share.

### Q67. How does it affect traffic?

By adding trip load based on residents, jobs, and parking assumptions.

### Q68. How does it affect jobs and economy?

Through direct jobs, commercial share, and activity uplift.

### Q69. How does it affect housing pressure?

It can reduce pressure if unit delivery offsets demand, but increase pressure if growth exceeds relief.

### Q70. How does it affect services?

It increases local demand pressure, partially offset by community or commercial provision.

### Q71. How does it affect electricity?

It increases electricity demand based on estimated energy use and energy standard.

### Q72. How does it affect environmentAir?

It increases exposure via trips, electricity use, and footprint-related pressure.

### Q73. How does it affect greenScore?

Typically negatively, because footprint consumes or pressures green context.

### Q74. How does it affect fairness?

Fairness improves more when:

- affordability is higher
- deprivation is higher
- community value is present

### Q75. How does it affect fiscalBalance?

It adds revenue-like uplift from jobs and units, then subtracts infrastructure-like costs.

### Q76. How does it affect planningViability?

It reflects warnings, transit quality, and some mitigation/community benefits.

### Q77. Do mitigations change the building planner?

Yes.

### Q78. What happens with energy mitigation?

It reduces electricity and environmental impacts and slightly improves viability.

### Q79. What happens with green mitigation?

It improves green score, lowers environmental exposure, and boosts fairness somewhat.

### Q80. What happens with mobility mitigation?

It reduces traffic/exposure and can improve fairness.

### Q81. Does building type matter?

Yes.

### Q82. How does mixed-use differ from apartments?

Mixed-use adds more jobs/opportunity and may soften service pressure.

### Q83. How does community differ?

Community space can improve fairness and reduce service pressure more directly.

### Q84. How does office differ?

Office boosts jobs/economy but can add mobility strain.

---

## 9. Building Removal Planner

### Q85. What function handles removal?

`applyBuildingRemovalPlanner`

### Q86. What is its purpose?

To simulate removing an existing building footprint or development burden.

### Q87. Does it just negate the building planner?

Conceptually yes, but not always with perfectly symmetric coefficients.

### Q88. What usually happens when a building is removed?

Likely outcomes:

- lower population pressure
- lower traffic
- lower electricity demand
- lower service pressure
- reduced jobs/opportunity
- some green relief

### Q89. Why isn’t the effect perfectly symmetric?

Because planners are designed for plausible scenario screening rather than physical conservation.

---

## 10. Mobility Corridor Planner

### Q90. What function handles a mobility corridor?

`applyMobilityPlanner`

### Q91. What is the intent of a mobility corridor?

To represent transit-first or movement-improvement interventions near the site.

### Q92. What metrics does it mostly affect?

Mostly:

- traffic
- services
- fairness
- environmentAir
- planningViability

### Q93. Does it reduce mobility strain or traffic pressure?

Yes, that is one of its main roles.

### Q94. Does it improve fairness?

Usually, especially in higher-deprivation nearby cells.

### Q95. Why does mobility affect fairness?

Because access improvements benefit underserved areas disproportionately in the proxy logic.

---

## 11. Road Planner

### Q96. What function handles a road intervention?

`applyRoadPlanner`

### Q97. What is the road planner trying to capture?

It tries to capture:

- congestion relief
- induced demand
- accessibility changes
- severance/equity effects
- environmental/fiscal tradeoffs

### Q98. Can a road improve traffic but worsen environment?

Yes.

### Q99. Why?

Because added capacity can relieve congestion locally while still increasing vehicle activity, emissions exposure, or severance effects.

### Q100. Can a road hurt fairness?

Yes. If it increases severance or if benefits do not align with deprived areas, fairness can worsen.

### Q101. Does the road planner use actual road geometry?

Yes, user roads are staged geometrically, and frontend road planning is snapped to OSM routes before scenario use.

### Q102. Does the deterministic planner itself perform network routing?

No. The planning impact uses rule-based metric effects. Separate live traffic microsimulation handles route-level visual traffic behavior.

---

## 12. Transformer Planner

### Q103. What function handles transformer interventions?

`applyTransformerPlanner`

### Q104. What does it use under the hood?

It uses `transformerPlannerImpact`, which consults the transformer model artifacts if available.

### Q105. What if the transformer artifact is missing?

It falls back to `fallbackTransformerPlannerImpact`.

### Q106. What is the transformer planner trying to model?

It models:

- additional usable local electrical capacity
- headroom increase
- overload-risk reduction
- some jobs/services/economy benefit from improved capacity

### Q107. Is this an engineering-grade network model?

No.

### Q108. Does it know feeder topology, phase balance, or protection constraints?

No. The model card explicitly says it does not.

### Q109. What confidence system does transformer planning use?

Confidence comes from the transformer artifacts and support quality, such as:

- official data support
- manual record support
- OSM fallback
- distance to assets

### Q110. What fields from transformer artifacts are especially relevant?

Examples:

- available capacity proxy
- peak load proxy
- headroom proxy
- overload risk
- nearest primary/secondary distance
- confidence

### Q111. Can transformer interventions enable jobs?

Yes, the planner includes capacity-enabled jobs logic.

### Q112. Can transformer interventions reduce electricity burden?

They mainly reduce local overload/headroom pressure rather than reducing raw demand.

### Q113. Why can electricity diff go down after a transformer intervention?

Because the metric represents load-pressure or load-stress proxy, not just raw consumption.

---

## 13. Green Planner

### Q114. What function handles green interventions?

`applyGreenPlanner`

### Q115. What is a green intervention conceptually?

A corridor or mitigation package that improves environmental conditions.

### Q116. What metrics does it mainly affect?

- greenScore
- environmentAir
- fairness
- planningViability

### Q117. Does it reduce traffic directly?

Usually not as strongly as mobility interventions.

### Q118. Why can green mitigation improve fairness?

Because environmental improvements are given extra weight in higher-need areas.

---

## 14. Opportunity Planner

### Q119. What function handles opportunity hubs?

`applyOpportunityPlanner`

### Q120. What is an opportunity hub?

A localized economic/access intervention that lifts jobs and opportunity.

### Q121. What metrics does it mainly improve?

- jobs
- economy
- services access
- fairness in some contexts

### Q122. Can it increase mobility pressure a little?

Yes, because more activity can attract more movement demand.

---

## 15. Metric Clamping And Stability

### Q123. What prevents metrics from exploding numerically?

`addMetricDelta` and `clamp`, plus final normalization behavior.

### Q124. Why clamp to 0-1?

To keep metrics within a bounded planning index scale.

### Q125. Does clamping lose information?

Potentially yes, but it keeps the scenario outputs stable and comparable.

### Q126. Is clamping done after every intervention?

Yes, planners frequently re-clamp values as they update cells.

---

## 16. Branch Scoring

### Q127. How are branches ranked?

Using `scoreForecastBranch` and related scoring logic.

### Q128. What kinds of metrics are rewarded?

Generally:

- higher economy
- higher fairness
- higher transport access
- higher green score

### Q129. What kinds of metrics are penalized?

Generally:

- higher traffic
- higher environmental exposure
- higher electricity pressure
- higher population pressure when it creates excess strain

### Q130. Is branch scoring learned from user preferences?

No.

### Q131. Is the recommended branch deterministic?

Yes.

### Q132. Can the user proposal lose to another branch?

Yes, often.

---

## 17. Concrete Impacts

### Q133. What function produces concrete planning outputs?

`concreteImpactsForVariant`

### Q134. Why is this needed if normalized metrics already exist?

Because normalized scores are hard for humans to interpret. Concrete values make comparisons more legible.

### Q135. What domains get concrete outputs?

- traffic
- jobs
- electricity
- services

### Q136. What traffic outputs are produced?

Examples:

- daily trips added
- daily trips reduced by road
- induced daily trips
- net daily trips
- peak-hour vehicle change
- congestion index delta
- delay minutes per peak hour change

### Q137. What jobs outputs are produced?

Examples:

- direct jobs
- accessibility-supported jobs
- temporary construction jobs
- operations jobs
- capacity-enabled jobs
- net jobs estimate

### Q138. What electricity outputs are produced?

Examples:

- annual MWh change
- peak kW change
- transformer relief kW
- headroom change
- overload risk delta
- load index delta

### Q139. What services outputs are produced?

Examples:

- resident service demand
- worker service demand
- service capacity equivalent
- net service demand

### Q140. Are uncertainty bands included?

Yes, especially for transformer-related and jobs/electricity impacts.

### Q141. Are these values real-world certified forecasts?

No. They are planning estimates.

---

## 18. Evidence And Confidence

### Q142. Where does scenario evidence come from?

From:

- forecast artifacts
- transformer artifacts
- replay grid artifacts
- site validation/context
- planner type labels

### Q143. What function assembles branch evidence?

`evidenceForScenarioBranch`

### Q144. How is branch confidence assigned?

Through `confidenceForBranch`, which depends on:

- placement validation status
- magnitude of risky deltas

### Q145. What lowers confidence?

Things like:

- warning status
- high electricity burden
- high environmental burden
- strong traffic burden

### Q146. What explicit caveats does the system use?

Common caveats include:

- forecast values are proxy planning estimates
- transformer outputs are planning-grade screening only
- no engineering approval is implied

---

## 19. Variants And Fallback Logic

### Q147. How are scenario variants generated when Gemini is unavailable?

With `generateFallbackVariants`.

### Q148. Are fallback variants deterministic?

Yes.

### Q149. What is `sanitizeScenarioVariants` for?

It validates and canonicalizes variant structures so malformed or overly creative inputs still become usable scenario branches.

### Q150. Can user interventions be merged into system variants?

Yes, via:

- `extractUserInterventions`
- `mergeUserInterventionsIntoVariants`

### Q151. Why merge user interventions into variants?

So a base proposal can still be compared against planner-improved variants without losing the user’s explicit edits.

---

## 20. Data Dependency Questions

### Q152. What local files are essential for deterministic planners?

At minimum:

- `baseline_2025_forecast.json`
- `forecast_model.json`

And optionally:

- transformer artifacts
- replay grid files

### Q153. What happens if transformer artifacts are missing?

The planner falls back to deterministic local defaults.

### Q154. What happens if forecast artifacts are missing?

The main scenario runtime will not function correctly.

### Q155. Does the planner call a live database?

No.

### Q156. Does the planner require Gemini?

No.

### Q157. Does the planner need internet access?

Not for the core deterministic planning workflow once artifacts exist.

---

## 21. API Questions

### Q158. Which API route runs the deterministic planner end-to-end?

`POST /api/scenario-studio/run`

### Q159. Which route validates placement only?

`POST /api/building/validate-placement`

### Q160. Which route runs simulation on already assembled branches?

`POST /api/simulation/run-multiple`

### Q161. Which route returns buildable areas?

`GET` or `POST /api/building/buildable-areas`

### Q162. Which route resolves postcodes?

`GET /api/postcode/resolve`

---

## 22. Frontend Interaction Questions

### Q163. Does the frontend itself compute the scenario metrics?

No. The main scenario metrics come from the backend/runtime engine in `lib/scenario-studio.js`.

### Q164. What does the frontend do locally?

It:

- stages items
- manages branches
- requests scenario runs
- renders maps, timelines, panels, and overlays
- runs separate visual engines like traffic simulation and transit overlays

### Q165. Is the browser traffic simulation the same thing as the deterministic road planner?

No.

### Q166. What is the difference?

- deterministic road planner:
  computes forecast metric deltas for scenario branches
- browser traffic sim:
  visually simulates vehicles moving on a road network for comparison UX

### Q167. Is the impact predictor the same thing as the deterministic planner?

No.

### Q168. What is the difference?

- impact predictor:
  local kNN-style event-context predictor for explainability and ripple visuals
- deterministic planner:
  main scenario metric engine used for branch outputs

---

## 23. Performance Questions

### Q169. Why use nearby cells instead of the entire city every time?

For performance and locality. Most interventions are assumed to have local effects.

### Q170. How many replay cells exist?

`308`

### Q171. Does every scenario simulate the whole city?

No. It usually simulates only relevant context cells near the proposal.

### Q172. Why is that acceptable?

Because the tool is meant for local planning comparisons, not full-city equilibrium modeling.

### Q173. Are planners computationally expensive?

Not especially. They are mostly arithmetic over a small number of nearby cells and years.

### Q174. Why is the system fast enough for interactive use?

Because:

- baseline artifacts are precomputed
- cells are local subsets
- formulas are simple
- there is no heavy optimization loop

---

## 24. Technical Design Questions

### Q175. Why use deterministic formulas instead of a trained ML model?

Likely reasons:

- interpretability
- repeatability
- small/local data availability
- planning-governance needs
- ability to expose evidence and caveats

### Q176. What are the benefits of this deterministic approach?

- reproducibility
- transparency
- straightforward debugging
- easier governance language
- easier artifact validation

### Q177. What are the downsides?

- coefficients are hand-tuned
- realism is limited
- interactions are approximate
- no empirical fitting to rich observed outcomes

### Q178. Why separate forecast artifact generation from runtime planners?

Because the system has two layers:

- offline baseline forecast creation
- runtime intervention application

This keeps runtime fast and simpler.

### Q179. Why have both normalized metrics and concrete impacts?

Because normalized metrics are good for comparison and aggregation, while concrete impacts are better for human explanation.

### Q180. Why does fairness use deprivation weighting?

Because the product explicitly tries to model whether benefits reach higher-need areas rather than only maximizing aggregate uplift.

---

## 25. Testing Questions

### Q181. How is planner correctness verified?

Through:

- Node verification scripts
- Python unit tests
- artifact-shape checks
- scenario smoke tests

### Q182. What does `verify-forecast.js` check?

It checks:

- forecast artifact shape
- years covered
- metric normalization
- scenario runtime behavior

### Q183. What does the forecast test prove about planners?

It proves that staged road and transformer interventions are accepted and that they produce expected kinds of deltas and concrete outputs.

### Q184. Does the test suite prove real-world accuracy?

No. It proves internal consistency and artifact validity, not external predictive truth.

---

## 26. Common Misunderstandings

### Q185. Is the planner an LLM-based simulation?

No.

### Q186. Is the planner a digital twin in the engineering sense?

Not fully. It is closer to a planning-oriented digital twin or proxy urban simulation.

### Q187. Are traffic outputs exact congestion predictions?

No.

### Q188. Are transformer outputs exact capacity approvals?

No.

### Q189. Are fairness outputs socioeconometric estimates?

No. They are deprivation-weighted planning proxies.

### Q190. Is `forecast_model.json` a neural network checkpoint?

No.

---

## 27. If You Need To Explain It In One Paragraph

### Q191. How would you explain the deterministic planners to an engineer in one paragraph?

They are a set of rule-based intervention simulators in `lib/scenario-studio.js` that start from precomputed 2025-to-2036 baseline forecast artifacts, identify nearby Belfast replay-grid cells around a proposed site, and then apply distance-weighted, year-ramped metric deltas for buildings, roads, transformers, green mitigation, mobility corridors, and opportunity hubs. The planners update 12 normalized planning metrics, score branch alternatives, and convert the resulting differences into concrete planning estimates like trips, jobs, electricity headroom, and service demand.

---

## 28. If You Need To Explain It In One Sentence

### Q192. One-sentence version?

The deterministic planners are hand-authored local-impact formulas that modify a prebuilt Belfast baseline forecast cell-by-cell and year-by-year for different planning interventions.

