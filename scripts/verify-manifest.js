const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const manifestPath = path.join(rootDir, "api", "replay-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const modeASummaryPath = path.join(rootDir, "web", "data", "mode-a", "summary.json");
const modeA = JSON.parse(fs.readFileSync(modeASummaryPath, "utf8"));

const failures = [];
const requiredModeAMetrics = ["traffic", "jobs", "electricity", "buildings", "services"];

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
const buildingSource = readJson(buildingLayer.path);
const buildingProps = buildingSource.features[0]?.properties || {};
assert(Number.isInteger(buildingProps.replay_first_visible_year), "Building features must include replay_first_visible_year.");
assert(buildingProps.architecture_period, "Building features must include architecture_period.");
assert(buildingSource.features.some((feature) => feature.properties?.replay_first_visible_year > 2016), "Building replay should include later-year mapped/proxy additions.");
const electricityLayer = manifest.layers.find((layer) => layer.category === "electricity");
assert(electricityLayer, "Belfast electricity OSM context layer is required.");

const artifactPaths = new Set((manifest.sourceArtifacts || []).map((artifact) => artifact.path));
assert(artifactPaths.has("data/2026/exportbuildings.geojson"), "Raw full building export must remain catalogued.");
assert([...artifactPaths].some((item) => item.includes("belfast_rgb_2016.tif")), "2016 RGB raster must remain catalogued.");
assert([...artifactPaths].some((item) => item.includes("belfast_census_2021_dataset.csv")), "2021 census CSV must remain catalogued.");
assert([...artifactPaths].some((item) => item.includes("belfast_air_quality.csv")), "Air quality CSV must remain catalogued.");

assert(modeA.kind === "belfast.modeA.summary", "Mode A summary kind is incorrect.");
assert(modeA.years?.[0] === 2016 && modeA.years?.at(-1) === 2026, "Mode A summary must cover 2016-2026.");
assert(modeA.cellCount >= 100, "Mode A grid should have enough cells for a city replay.");
assert(JSON.stringify((modeA.coreMetrics || []).map((metric) => metric.id)) === JSON.stringify(requiredModeAMetrics), "Mode A core metrics must match the requested five-signal product brief.");
for (const year of modeA.years) {
  const gridPath = `web/data/mode-a/grid_${year}.geojson`;
  const electricityPath = `web/data/mode-a/electricity_${year}.geojson`;
  assert(exists(gridPath), `Mode A grid missing for ${year}.`);
  assert(exists(electricityPath), `Mode A electricity replay missing for ${year}.`);
  const grid = readJson(gridPath);
  assert(grid.type === "FeatureCollection", `Mode A grid ${year} is not a FeatureCollection.`);
  assert(grid.features.length === modeA.cellCount, `Mode A grid ${year} cell count mismatch.`);
  const first = grid.features[0]?.properties || {};
  for (const metric of requiredModeAMetrics) {
    assert(Number.isFinite(first[metric]), `Mode A grid ${year} missing metric ${metric}.`);
    assert(Number.isFinite(first[`${metric}_delta_2016`]), `Mode A grid ${year} missing 2016 delta for ${metric}.`);
  }
  const electricity = readJson(electricityPath);
  assert(electricity.type === "FeatureCollection", `Mode A electricity ${year} is not a FeatureCollection.`);
  assert(electricity.features.length >= 100, `Mode A electricity ${year} needs Belfast power assets.`);
  assert(Number.isFinite(electricity.features[0]?.properties?.grid_load_pct), `Mode A electricity ${year} missing grid_load_pct.`);
  const metricCards = modeA.metricsByYear[String(year)] || [];
  const commits = modeA.commitsByYear[String(year)] || [];
  assert(Array.isArray(commits) && commits.length === 5, `Mode A commits must include exactly five signals for ${year}.`);
  assert(JSON.stringify(commits.map((commit) => commit.type)) === JSON.stringify(requiredModeAMetrics), `Mode A commit order is incorrect for ${year}.`);
  for (const commit of commits) {
    assert(commit.title && commit.subtitle && commit.explanation, `Commit ${commit.id} needs planning copy.`);
    assert(Array.isArray(commit.cellIds) && commit.cellIds.length >= 5, `Commit ${commit.id} must carry affected replay cell ids.`);
    assert(Array.isArray(commit.affectedSignals) && commit.affectedSignals.length >= 3, `Commit ${commit.id} must explain affected signals.`);
    assert(Array.isArray(commit.auditTrail) && commit.auditTrail.length >= 2, `Commit ${commit.id} must include an audit trail.`);
  }
  assert(Array.isArray(metricCards) && metricCards.length === 5, `Mode A metric cards must include exactly five lenses for ${year}.`);
  assert(JSON.stringify(metricCards.map((card) => card.metric)) === JSON.stringify(requiredModeAMetrics), `Mode A metric card order is incorrect for ${year}.`);
}

if (failures.length) {
  console.error("Manifest verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Manifest OK: ${manifest.layers.length} interactive layer(s), ${totalInteractiveFeatures.toLocaleString()} renderable features, ${manifest.sourceArtifacts.length} source artifact(s), ${modeA.cellCount} Mode A cells.`);
