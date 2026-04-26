const fs = require("fs");
const path = require("path");
const scenarioStudio = require("../lib/scenario-studio");

const rootDir = path.resolve(__dirname, "..");
const modelPath = path.join(rootDir, "web", "data", "mode-a", "forecast_model.json");
const baselinePath = path.join(rootDir, "web", "data", "mode-a", "baseline_2025_forecast.json");
const failures = [];

function fail(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const model = readJson(modelPath);
const baseline = readJson(baselinePath);
const requiredMetrics = scenarioStudio.FORECAST_METRICS;

assert(model.kind === "belfast.forecastModel", "Forecast model kind is incorrect.");
assert(baseline.kind === "belfast.baseline2025Forecast", "Baseline forecast kind is incorrect.");
assert(model.baselineYear === 2025, "Model baseline year must be 2025.");
assert(baseline.baselineYear === 2025, "Baseline forecast year must be 2025.");
assert(baseline.years?.[0] === 2026 && baseline.years?.at(-1) === 2036, "Forecast must cover 2026-2036.");
assert(JSON.stringify(model.metrics) === JSON.stringify(requiredMetrics), "Model metric list does not match runtime metrics.");
assert(JSON.stringify(baseline.metrics) === JSON.stringify(requiredMetrics), "Baseline metric list does not match runtime metrics.");
assert((baseline.cells || []).length >= 100, "Baseline forecast needs city grid cells.");

for (const year of baseline.years || []) {
  const summary = baseline.summaryByYear?.[String(year)];
  assert(summary, `Missing forecast summary for ${year}.`);
  for (const metric of requiredMetrics) {
    assert(Number.isFinite(summary?.[metric]), `Summary ${year} missing metric ${metric}.`);
    assert(summary[metric] >= 0 && summary[metric] <= 1, `Summary ${year} ${metric} outside 0-1.`);
  }
}

for (const cell of (baseline.cells || []).slice(0, 25)) {
  assert(cell.cellId, "Forecast cell missing cellId.");
  assert(cell.baseline2025, `Cell ${cell.cellId} missing 2025 baseline.`);
  assert(cell.forecastByYear, `Cell ${cell.cellId} missing forecastByYear.`);
  for (const year of baseline.years || []) {
    const row = cell.forecastByYear[String(year)];
    assert(row, `Cell ${cell.cellId} missing ${year}.`);
    for (const metric of requiredMetrics) {
      assert(Number.isFinite(row?.[metric]), `Cell ${cell.cellId} ${year} missing ${metric}.`);
      assert(row[metric] >= 0 && row[metric] <= 1, `Cell ${cell.cellId} ${year} ${metric} outside 0-1.`);
    }
  }
}

const broad = scenarioStudio.resolvePostcode("BT7", rootDir);
assert(broad.precision === "outcode", "BT7 should resolve as an outcode.");
assert(broad.canPlace === false, "BT7 outcode must not enable placement.");

const full = scenarioStudio.resolvePostcode("BT7 1NN", rootDir);
assert(full.precision === "full_postcode", "BT7 1NN should resolve as a full postcode.");
assert(full.canPlace === true, "BT7 1NN should enable placement.");

const scenario = scenarioStudio.runForecastScenario({
  postcode: "BT7 1NN",
  building: {
    config: {
      size: "small",
      buildingType: "mixed_use",
      affordabilityMix: "social",
      energyStandard: "net_zero_ready",
      parkingTransitAssumption: "transit_first"
    }
  },
  startYear: 2026,
  baselineYear: 2025,
  horizonYear: 2036
}, rootDir);

assert(scenario.ok === true, "Scenario run should succeed.");
assert(scenario.baselineBranch, "Scenario response missing baselineBranch.");
assert((scenario.scenarioBranches || []).length >= 5, "Scenario response should include branch variants.");
assert(Object.keys(scenario.timelineByYear || {}).length === 11, "Scenario timeline should include 11 forecast years.");
assert(scenario.affectedCellsByYear?.["2036"]?.features?.length > 0, "Scenario should include affected cells for 2036.");
for (const [year, row] of Object.entries(scenario.timelineByYear || {})) {
  assert(Number(year) >= 2026 && Number(year) <= 2036, `Unexpected timeline year ${year}.`);
  for (const metric of requiredMetrics) {
    assert(Number.isFinite(row.baseline?.[metric]), `Timeline baseline ${year} missing ${metric}.`);
    assert(row.baseline[metric] >= 0 && row.baseline[metric] <= 1, `Timeline baseline ${year} ${metric} outside 0-1.`);
  }
  for (const branch of row.branches || []) {
    for (const metric of requiredMetrics) {
      assert(Number.isFinite(branch.metrics?.[metric]), `Timeline branch ${branch.name} ${year} missing ${metric}.`);
      assert(branch.metrics[metric] >= 0 && branch.metrics[metric] <= 1, `Timeline branch ${branch.name} ${year} ${metric} outside 0-1.`);
    }
  }
}

const delayedScenario = scenarioStudio.runForecastScenario({
  postcode: "BT7 1NN",
  building: {
    year: 2027,
    config: {
      size: "small",
      buildingType: "apartments",
      affordabilityMix: "affordable",
      energyStandard: "standard",
      parkingTransitAssumption: "balanced"
    }
  },
  branches: {
    scenario_variants: [{
      branchName: "Delayed User Proposal",
      objective: "user_proposal",
      description: "Building starts in 2027.",
      interventions: [{
        type: "building",
        year: 2027,
        startYear: 2027
      }],
      assumptions: []
    }]
  },
  startYear: 2026,
  baselineYear: 2025,
  horizonYear: 2036
}, rootDir);

const delayedBranch = (delayedScenario.scenarioBranches || []).find((branch) => branch.objective === "user_proposal");
const delayed2026 = delayedBranch?.timelineByYear?.["2026"]?.diffFromBaseline || {};
const delayedConcrete2027 = delayedBranch?.timelineByYear?.["2027"]?.concreteImpacts || {};
assert(Math.abs(delayed2026.population || 0) < 0.0001, "A 2027 building must not change the 2026 forecast.");
assert(Math.abs(delayedConcrete2027.traffic?.netDailyTrips || 0) > 0, "A 2027 building must affect the 2027 concrete forecast.");

if (failures.length) {
  console.error("Forecast verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Forecast OK: ${baseline.cells.length} cells, ${baseline.years.length} years, ${scenario.scenarioBranches.length} scenario branches.`);
