const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const outDir = path.join(rootDir, "data", "raw", "overpass");
const bbox = "54.52,-6.08,54.70,-5.78";
const endpoint = process.env.OVERPASS_ENDPOINT || "https://overpass-api.de/api/interpreter";

const categories = [
  {
    id: "roads",
    output: "belfast_road_assets_overpass_meta_2026.json",
    query: `[out:json][timeout:220];(way["highway"](${bbox});relation["highway"](${bbox}););out tags meta center;`
  },
  {
    id: "buildings",
    output: "belfast_building_assets_overpass_meta_2026.json",
    query: `[out:json][timeout:260];(way["building"](${bbox});relation["building"](${bbox}););out tags meta center;`
  },
  {
    id: "services",
    output: "belfast_service_assets_overpass_meta_2026.json",
    sourcePath: path.join(rootDir, "data", "derived", "2026", "belfast_ni_services_osm_2026.geojson"),
    batchSize: 250
  }
];

async function postOverpass(query) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "user-agent": "ReplayBelfast/1.0 infrastructure-event-audit contact=local-codex"
    },
    body: `data=${encodeURIComponent(query)}`
  });
  if (!response.ok) {
    throw new Error(`Overpass ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function queryFromIds(ids) {
  const grouped = new Map();
  for (const sourceId of ids) {
    const [type, id] = String(sourceId).split("/");
    if (!["node", "way", "relation"].includes(type) || !/^\d+$/.test(id || "")) continue;
    if (!grouped.has(type)) grouped.set(type, []);
    grouped.get(type).push(id);
  }
  const parts = [...grouped.entries()].map(([type, values]) => `${type}(id:${values.join(",")});`);
  return `[out:json][timeout:160];(${parts.join("")});out tags meta center;`;
}

async function fetchBySourceIds(category) {
  const source = JSON.parse(fs.readFileSync(category.sourcePath, "utf8"));
  const ids = [...new Set(source.features.map((feature) => feature.properties?.source_id).filter(Boolean))];
  const elements = [];
  for (let index = 0; index < ids.length; index += category.batchSize) {
    const batch = ids.slice(index, index + category.batchSize);
    const payload = await postOverpass(queryFromIds(batch));
    elements.push(...(payload.elements || []));
    console.log(`${category.id}: ${Math.min(index + batch.length, ids.length)}/${ids.length}`);
  }
  return {
    version: 0.6,
    generator: "Replay Belfast Overpass metadata fetch",
    osm3s: {},
    elements,
  };
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const only = new Set(String(process.env.ONLY || "").split(",").map((item) => item.trim()).filter(Boolean));
  for (const category of categories) {
    if (only.size && !only.has(category.id)) continue;
    const outputPath = path.join(outDir, category.output);
    if (fs.existsSync(outputPath) && process.env.FORCE !== "1") {
      const cached = JSON.parse(fs.readFileSync(outputPath, "utf8"));
      console.log(`${category.id}: cached ${cached.elements?.length || 0} element(s)`);
      continue;
    }
    console.log(`${category.id}: querying Overpass`);
    const payload = category.sourcePath ? await fetchBySourceIds(category) : await postOverpass(category.query);
    payload.metadata = {
      category: category.id,
      source: endpoint,
      bbox,
      fetchedAt: new Date().toISOString(),
      note: "OSM metadata timestamp/version/changeset is used as a public mapped-event record, not as proof of construction or opening date."
    };
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
    console.log(`${category.id}: wrote ${payload.elements?.length || 0} element(s)`);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
