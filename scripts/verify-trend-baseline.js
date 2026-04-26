const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const artifactPath = path.join(rootDir, "web", "data", "mode-a", "trend_baseline_branch.json");
const boundaryPath = path.join(rootDir, "data", "2026", "_raw_osm", "belfast_boundary_nominatim.json");
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

function pointInRing(point, ring) {
  const x = Number(point[0]);
  const y = Number(point[1]);
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = Number(ring[i][0]);
    const yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]);
    const yj = Number(ring[j][1]);
    const intersects = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  if (!pointInRing(point, polygon[0])) return false;
  return polygon.slice(1).every((hole) => !pointInRing(point, hole));
}

function pointInBoundary(point, boundary) {
  if (boundary.type === "Polygon") return pointInPolygon(point, boundary.coordinates);
  if (boundary.type === "MultiPolygon") return boundary.coordinates.some((polygon) => pointInPolygon(point, polygon));
  return false;
}

function loadBoundary() {
  const rows = readJson(boundaryPath);
  const belfast = rows.find((row) => row.geojson && /Belfast, Northern Ireland/i.test(String(row.display_name || ""))) || rows[0];
  return belfast && belfast.geojson;
}

const artifact = readJson(artifactPath);
const boundary = loadBoundary();
const branch = artifact.branch || {};
const items = Array.isArray(branch.items) ? branch.items : [];
const counts = items.reduce((acc, item) => {
  acc[item.type] = (acc[item.type] || 0) + 1;
  return acc;
}, {});

assert(artifact.kind === "belfast.trendBaselineBranch", "Trend baseline kind is incorrect.");
assert(/Belfast, Northern Ireland/i.test(artifact.geography?.name || ""), "Trend baseline geography must be Belfast NI.");
assert(artifact.startYear === 2026 && artifact.horizonYear === 2036, "Trend baseline must cover 2026-2036.");
assert(branch.id === "baseline", "Trend baseline must update the in-app baseline branch.");
assert(branch.locked === true, "Trend baseline branch must stay locked.");
assert(branch.trendBaseline === true, "Trend baseline branch must be marked as a trend baseline.");
assert(items.length >= 40, "Trend baseline needs many projected additions.");
assert((counts.building || 0) >= 20, "Trend baseline needs multiple projected buildings.");
assert((counts.infrastructure || 0) >= 8, "Trend baseline needs multiple transformer additions.");
assert((counts.road || 0) >= 7, "Trend baseline needs multiple road additions.");
assert((counts.park || 0) >= 5, "Trend baseline needs support/green-space additions.");
assert(boundary, "Belfast NI boundary is unavailable.");

for (const item of items) {
  assert(item.id, "Projected item missing id.");
  assert(item.trendBaseline, `Projected item ${item.id} missing trend metadata.`);
  assert(Number.isFinite(item.year) && item.year >= 2026 && item.year <= 2036, `Projected item ${item.id} has invalid year.`);
  if (item.type === "road") {
    assert(Array.isArray(item.path) && item.path.length >= 2, `Road ${item.id} missing path.`);
    for (const coord of item.path || []) {
      assert(pointInBoundary(coord, boundary), `Road ${item.id} has a point outside Belfast: ${coord}`);
    }
  } else {
    assert(Number.isFinite(item.lng) && Number.isFinite(item.lat), `Item ${item.id} missing coordinates.`);
    assert(pointInBoundary([item.lng, item.lat], boundary), `Item ${item.id} is outside Belfast.`);
  }
}

if (failures.length) {
  console.error("Trend baseline verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Trend baseline OK: ${items.length} Belfast-only projected additions (${JSON.stringify(counts)}).`);
