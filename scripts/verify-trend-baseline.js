const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const artifactPath = path.join(rootDir, "web", "data", "mode-a", "trend_baseline_branch.json");
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

const artifact = readJson(artifactPath);
const branch = artifact.branch || {};
const items = Array.isArray(branch.items) ? branch.items : [];
const counts = items.reduce((acc, item) => {
  acc[item.type] = (acc[item.type] || 0) + 1;
  return acc;
}, {});

assert(artifact.kind === "belfast.trendBaselineBranch", "Trend baseline kind is incorrect.");
assert(artifact.startYear === 2026 && artifact.horizonYear === 2036, "Trend baseline must cover 2026-2036.");
assert(branch.id === "baseline", "Trend baseline must update the in-app baseline branch.");
assert(branch.locked === true, "Trend baseline branch must stay locked.");
assert(branch.trendBaseline === true, "Trend baseline branch must be marked as a trend baseline.");
assert(items.length >= 40, "Trend baseline needs many projected additions.");
assert((counts.building || 0) >= 20, "Trend baseline needs multiple projected buildings.");
assert((counts.infrastructure || 0) >= 8, "Trend baseline needs multiple transformer additions.");
assert((counts.road || 0) >= 7, "Trend baseline needs multiple road additions.");
assert((counts.park || 0) >= 5, "Trend baseline needs support/green-space additions.");

for (const item of items) {
  assert(item.id, "Projected item missing id.");
  assert(item.trendBaseline, `Projected item ${item.id} missing trend metadata.`);
  assert(Number.isFinite(item.year) && item.year >= 2026 && item.year <= 2036, `Projected item ${item.id} has invalid year.`);
  if (item.type === "road") {
    assert(Array.isArray(item.path) && item.path.length >= 2, `Road ${item.id} missing path.`);
  } else {
    assert(Number.isFinite(item.lng) && Number.isFinite(item.lat), `Item ${item.id} missing coordinates.`);
  }
}

if (failures.length) {
  console.error("Trend baseline verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Trend baseline OK: ${items.length} projected additions (${JSON.stringify(counts)}).`);
