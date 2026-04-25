const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const manifestPath = path.join(rootDir, "api", "replay-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const modeASummaryPath = path.join(rootDir, "web", "data", "mode-a", "summary.json");
const modeA = JSON.parse(fs.readFileSync(modeASummaryPath, "utf8"));

const failures = [];

function fail(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), "utf8"));
}

function exists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

assert(manifest.kind === "belfast.replay.manifest", "Manifest kind is incorrect.");
assert(manifest.schemaVersion, "Manifest schemaVersion is required.");
assert(Array.isArray(manifest.years), "Manifest years must be an array.");
assert(manifest.years[0] === 2016 && manifest.years.at(-1) === 2026, "Manifest must cover 2016 through 2026.");
assert(manifest.mapbox?.token?.startsWith("pk."), "Mapbox public token is missing.");
assert(manifest.viewport?.center?.[0] > -6.2 && manifest.viewport.center[0] < -5.7, "Viewport longitude is not Belfast NI.");
assert(manifest.viewport?.center?.[1] > 54.4 && manifest.viewport.center[1] < 54.8, "Viewport latitude is not Belfast NI.");
assert(exists("web/assets/belfast-3d-replay-banner.png"), "Generated UI banner asset is missing.");
assert(exists("web/data/mode-a/summary.json"), "Mode A summary is missing.");

const idsByYear = new Set();
let totalInteractiveFeatures = 0;

for (const layer of manifest.layers || []) {
  assert(layer.id && /^[a-z0-9_-]+$/.test(layer.id), `Layer id is not URL-safe: ${layer.id}`);
  assert(Number.isInteger(layer.year), `Layer ${layer.id} is missing an integer year.`);
  assert(manifest.years.includes(layer.year), `Layer ${layer.id} has year outside timeline.`);
  assert(layer.label, `Layer ${layer.id} is missing label.`);
  assert(layer.type, `Layer ${layer.id} is missing type.`);
  assert(layer.path, `Layer ${layer.id} is missing path.`);

  const yearKey = `${layer.year}:${layer.id}`;
  assert(!idsByYear.has(yearKey), `Duplicate layer id for year: ${yearKey}`);
  idsByYear.add(yearKey);

  const absolutePath = path.join(rootDir, layer.path);
  assert(fs.existsSync(absolutePath), `Layer source does not exist: ${layer.path}`);

  if (layer.type === "geojson") {
    const source = readJson(layer.path);
    assert(source.type === "FeatureCollection", `Layer ${layer.id} is not a FeatureCollection.`);
    assert(Array.isArray(source.features), `Layer ${layer.id} has no features array.`);
    assert(source.features.length === layer.featureCount, `Layer ${layer.id} feature count mismatch: manifest ${layer.featureCount}, file ${source.features.length}.`);
    assert(layer.apiPath === `/api/layers/${layer.year}/${layer.id}`, `Layer ${layer.id} apiPath does not match contract.`);
    totalInteractiveFeatures += source.features.length;
  }
}

for (const artifact of manifest.sourceArtifacts || []) {
  assert(artifact.path, `Source artifact ${artifact.id} is missing path.`);
  assert(fs.existsSync(path.join(rootDir, artifact.path)), `Source artifact does not exist: ${artifact.path}`);
}

const buildingLayer = manifest.layers.find((layer) => layer.id === "belfast-ni-buildings-3d");
assert(buildingLayer, "3D Belfast NI building layer is required.");
assert(buildingLayer?.mode === "fill-extrusion", "Building layer must render as fill-extrusion.");
assert((buildingLayer?.featureCount || 0) >= 10000, "Building layer should include a substantial interactive feature set.");

const artifactPaths = new Set((manifest.sourceArtifacts || []).map((artifact) => artifact.path));
assert(artifactPaths.has("data/2026/exportbuildings.geojson"), "Raw full building export must remain catalogued.");
assert([...artifactPaths].some((item) => item.includes("belfast_rgb_2016.tif")), "2016 RGB raster must remain catalogued.");
assert([...artifactPaths].some((item) => item.includes("belfast_census_2021_dataset.csv")), "2021 census CSV must remain catalogued.");
assert([...artifactPaths].some((item) => item.includes("belfast_air_quality.csv")), "Air quality CSV must remain catalogued.");

assert(modeA.kind === "belfast.modeA.summary", "Mode A summary kind is incorrect.");
assert(modeA.years?.[0] === 2016 && modeA.years?.at(-1) === 2026, "Mode A summary must cover 2016-2026.");
assert(modeA.cellCount >= 100, "Mode A grid should have enough cells for a city replay.");
for (const year of modeA.years) {
  const gridPath = `web/data/mode-a/grid_${year}.geojson`;
  assert(exists(gridPath), `Mode A grid missing for ${year}.`);
  const grid = readJson(gridPath);
  assert(grid.type === "FeatureCollection", `Mode A grid ${year} is not a FeatureCollection.`);
  assert(grid.features.length === modeA.cellCount, `Mode A grid ${year} cell count mismatch.`);
  const first = grid.features[0]?.properties || {};
  for (const metric of ["development_pressure", "green_cover", "mobility_access", "air_quality", "deprivation_weighted_opportunity"]) {
    assert(Number.isFinite(first[metric]), `Mode A grid ${year} missing metric ${metric}.`);
  }
  assert(Array.isArray(modeA.commitsByYear[String(year)]) && modeA.commitsByYear[String(year)].length >= 4, `Mode A commits missing for ${year}.`);
  assert(Array.isArray(modeA.metricsByYear[String(year)]) && modeA.metricsByYear[String(year)].length >= 5, `Mode A metric cards missing for ${year}.`);
}

if (failures.length) {
  console.error("Manifest verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Manifest OK: ${manifest.layers.length} interactive layer(s), ${totalInteractiveFeatures.toLocaleString()} renderable features, ${manifest.sourceArtifacts.length} source artifact(s), ${modeA.cellCount} Mode A cells.`);
