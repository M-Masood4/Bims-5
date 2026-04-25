const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const manifestPath = path.join(rootDir, "api", "replay-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

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

assert(manifest.kind === "belfast.replay.manifest", "Manifest kind is incorrect.");
assert(manifest.schemaVersion, "Manifest schemaVersion is required.");
assert(Array.isArray(manifest.years), "Manifest years must be an array.");
assert(manifest.years[0] === 2016 && manifest.years.at(-1) === 2026, "Manifest must cover 2016 through 2026.");
assert(Array.isArray(manifest.layers) && manifest.layers.length > 0, "Manifest must declare layers.");

const idsByYear = new Set();

for (const layer of manifest.layers) {
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
  }
}

for (const artifact of manifest.sourceArtifacts || []) {
  assert(artifact.path, `Source artifact ${artifact.id} is missing path.`);
  assert(fs.existsSync(path.join(rootDir, artifact.path)), `Source artifact does not exist: ${artifact.path}`);
}

const ready2026 = manifest.layers.filter((layer) => layer.year === 2026 && layer.status === "ready" && !layer.metadataOnly);
const raster2016 = manifest.layers.filter((layer) => layer.year === 2016 && layer.type === "geotiff" && layer.metadataOnly);
assert(ready2026.length >= 6, "Expected several ready 2026 vector layers.");
assert(raster2016.length >= 3, "Expected 2016 raster source metadata.");

if (failures.length) {
  console.error("Manifest verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Manifest OK: ${manifest.layers.length} layers, ${ready2026.length} ready 2026 vectors, ${raster2016.length} 2016 raster sources.`);
