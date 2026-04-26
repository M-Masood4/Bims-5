const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const modeA = path.join(rootDir, "web", "data", "mode-a");
const derived = path.join(rootDir, "data", "derived", "2026");
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

const model = readJson(path.join(modeA, "transformer_impact_model.json"));
const capacity = readJson(path.join(modeA, "transformer_capacity_forecast.json"));
const byCell = readJson(path.join(modeA, "transformer_capacity_by_cell.json"));
const assets = readJson(path.join(derived, "belfast_ni_transformers_official.geojson"));

assert(model.kind === "belfast.transformerImpactModel", "Transformer impact model kind is incorrect.");
assert(capacity.kind === "belfast.transformerCapacityForecast", "Transformer capacity forecast kind is incorrect.");
assert(byCell.kind === "belfast.transformerCapacityByCell", "Transformer capacity-by-cell kind is incorrect.");
assert(Array.isArray(model.years) && model.years[0] === 2026 && model.years.at(-1) === 2036, "Transformer model must cover 2026-2036.");
assert(Array.isArray(capacity.years) && capacity.years[0] === 2026 && capacity.years.at(-1) === 2036, "Transformer capacity forecast must cover 2026-2036.");
assert(Object.keys(model.cellFeatures || {}).length >= 100, "Transformer model needs cell features.");
assert(Object.keys(byCell.cells || {}).length >= 100, "Transformer capacity-by-cell needs cells.");
assert(Array.isArray(assets.features) && assets.features.length > 0, "Transformer asset layer needs features.");
assert(/planning-grade/i.test(model.caveat || ""), "Transformer model caveat must be explicit.");

for (const year of capacity.years || []) {
  const row = capacity.summaryByYear?.[String(year)];
  assert(row, `Missing transformer capacity summary ${year}.`);
  for (const key of ["capacityKwProxy", "peakKwProxy", "headroomKwProxy", "meanOverloadRisk"]) {
    assert(Number.isFinite(row?.[key]), `Transformer capacity ${year} missing ${key}.`);
  }
  assert(row.meanOverloadRisk >= 0 && row.meanOverloadRisk <= 1, `Transformer overload risk ${year} outside 0-1.`);
}

for (const [cellId, cell] of Object.entries(byCell.cells || {}).slice(0, 25)) {
  assert(Number.isFinite(cell.availableCapacityKwProxy2026), `Cell ${cellId} missing available capacity.`);
  assert(Number.isFinite(cell.peakKwProxy2026), `Cell ${cellId} missing peak proxy.`);
  assert(["low", "medium", "medium-high", "high"].includes(cell.confidence), `Cell ${cellId} confidence invalid.`);
}

if (failures.length) {
  console.error("Transformer model verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Transformer model OK: ${Object.keys(byCell.cells).length} cells, ${assets.features.length} assets, ${capacity.years.length} years.`);
