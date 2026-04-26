const fs = require("fs");
const https = require("https");
const path = require("path");
const childProcess = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const rawDir = path.join(rootDir, "data", "raw", "translink");
const outDir = path.join(rootDir, "data", "derived", "2026");

const BELFAST_BBOX = [-6.09, 54.50, -5.77, 54.71];

const SOURCES = [
  {
    name: "Translink Metro and Glider routes",
    archive: "metro-glider-routes-2025-09-23.zip",
    extractDir: "metro_routes",
    url: "https://admin.opendatani.gov.uk/dataset/6f40b323-1933-40db-97f2-835382029a1f/resource/66a40505-3606-47ed-90fe-72af32fa33be/download/metro-glider-routes-updated-23092025.zip",
    updated: "2025-09-23",
    family: "metro",
    routeBase: ["metro_routes", "PtLinks_mtt.ptl"],
    stopsBase: ["metro_routes", "Stops.stp"],
  },
  {
    name: "Translink Ulsterbus and Goldliner routes",
    archive: "ulsterbus-goldliner-routes-2025-09-23.zip",
    extractDir: "ulsterbus_routes",
    url: "https://admin.opendatani.gov.uk/dataset/18659985-114c-4dbf-8a2d-9ca3e1a782d9/resource/5c266580-70ea-4640-960f-7089c0dd19d2/download/ulsterbus-goldliner-routes-updated-23092025.zip",
    updated: "2025-09-23",
    family: "ulsterbus",
    routeBase: ["ulsterbus_routes", "Ulsterbus Goldliner Routes 01 July 2025", "PtLinks_y20.ptl"],
    stopsBase: ["ulsterbus_routes", "Ulsterbus Goldliner Routes 01 July 2025", "Stops.stp"],
  },
];

const STOP_LIST_SOURCE = {
  name: "Translink Bus Stop List",
  archive: "bus-stop-list-2026-04-16.zip",
  extractDir: "stops",
  url: "https://admin.opendatani.gov.uk/dataset/495c6964-e8d2-4bf1-9942-8d950b3a0ceb/resource/29f3f2fd-d131-4b86-8933-42b5b3763763/download/bus-stop-list-16042026.zip",
  updated: "2026-04-16",
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function download(url, filePath) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(filePath));
    const file = fs.createWriteStream(filePath);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(() => fs.unlink(filePath, () => {}));
        download(res.headers.location, filePath).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close(() => fs.unlink(filePath, () => {}));
        reject(new Error(`Download failed ${res.statusCode}: ${url}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", (err) => {
      file.close(() => fs.unlink(filePath, () => {}));
      reject(err);
    });
  });
}

async function ensureArchive(source) {
  const archivePath = path.join(rawDir, source.archive);
  if (!fs.existsSync(archivePath)) {
    console.log(`Downloading ${source.name}`);
    await download(source.url, archivePath);
  }
  const extractPath = path.join(rawDir, source.extractDir);
  if (!fs.existsSync(extractPath) || fs.readdirSync(extractPath).length === 0) {
    ensureDir(extractPath);
    childProcess.execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `Expand-Archive -Force -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${extractPath.replace(/'/g, "''")}'`],
      { stdio: "inherit" }
    );
  }
}

function readLatin1(filePath) {
  return fs.readFileSync(filePath, "latin1");
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out.map(value => value === "" ? null : value);
}

function parseMid(filePath) {
  return readLatin1(filePath)
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(parseCsvLine);
}

function parseMif(filePath) {
  const lines = readLatin1(filePath).split(/\r?\n/);
  let i = lines.findIndex(line => line.trim().toLowerCase() === "data");
  if (i < 0) return [];
  i += 1;
  const geometries = [];
  while (i < lines.length) {
    const line = lines[i].trim();
    i += 1;
    if (!line) continue;
    if (line.toLowerCase() === "none") {
      geometries.push(null);
      continue;
    }
    let match = line.match(/^POINT\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/i);
    if (match) {
      geometries.push({ type: "Point", coordinates: [Number(match[1]), Number(match[2])] });
      continue;
    }
    match = line.match(/^PLINE\s+(\d+)/i);
    if (match) {
      const count = Number(match[1]);
      const coords = [];
      for (let n = 0; n < count && i < lines.length; n += 1, i += 1) {
        const pair = lines[i].trim().split(/\s+/).map(Number);
        if (Number.isFinite(pair[0]) && Number.isFinite(pair[1])) coords.push(pair);
      }
      geometries.push(coords.length >= 2 ? { type: "LineString", coordinates: coords } : null);
      continue;
    }
    geometries.push(null);
  }
  return geometries;
}

function coordInBbox(coord, bbox = BELFAST_BBOX) {
  return coord[0] >= bbox[0] && coord[0] <= bbox[2] && coord[1] >= bbox[1] && coord[1] <= bbox[3];
}

function lineIntersectsBbox(coords) {
  return coords.some(coord => coordInBbox(coord));
}

function roundCoord(coord) {
  return `${coord[0].toFixed(5)},${coord[1].toFixed(5)}`;
}

function canonicalLineKey(coords) {
  const forward = coords.map(roundCoord).join(";");
  const reverse = coords.slice().reverse().map(roundCoord).join(";");
  return forward < reverse ? forward : reverse;
}

function lineLengthMetres(coords) {
  let total = 0;
  for (let i = 0; i + 1 < coords.length; i += 1) {
    const a = coords[i];
    const b = coords[i + 1];
    const dx = (b[0] - a[0]) * 111320 * Math.cos(54.6 * Math.PI / 180);
    const dy = (b[1] - a[1]) * 111320;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

function routeColor(families, lines) {
  const joined = Array.from(lines).join(" ").toLowerCase();
  if (joined.includes("g1") || joined.includes("g2") || joined.includes("gdr")) return "#7c3aed";
  if (families.has("metro") && families.has("ulsterbus")) return "#0891b2";
  if (families.has("metro")) return "#0284c7";
  return "#16a34a";
}

function serviceClass(coverage) {
  if (coverage >= 14) return "very frequent";
  if (coverage >= 8) return "frequent";
  if (coverage >= 4) return "regular";
  return "limited";
}

function buildRouteFeatures() {
  const corridors = new Map();
  let sourceSegmentCount = 0;

  for (const source of SOURCES) {
    const basePath = path.join(rawDir, ...source.routeBase);
    const geoms = parseMif(`${basePath}.MIF`);
    const rows = parseMid(`${basePath}.MID`);

    geoms.forEach((geom, index) => {
      if (!geom || geom.type !== "LineString" || !lineIntersectsBbox(geom.coordinates)) return;
      const row = rows[index] || [];
      const line = String(row[12] || "").trim();
      const opBranch = String(row[1] || "").trim();
      const fromStopId = Number(row[2]);
      const toStopId = Number(row[5]);
      const key = canonicalLineKey(geom.coordinates);
      if (!corridors.has(key)) {
        corridors.set(key, {
          coordinates: geom.coordinates,
          lines: new Set(),
          branches: new Set(),
          families: new Set(),
          fromStopIds: new Set(),
          toStopIds: new Set(),
          sources: new Set(),
          segmentCount: 0,
        });
      }
      const item = corridors.get(key);
      if (line) item.lines.add(line);
      if (opBranch) item.branches.add(opBranch);
      if (Number.isFinite(fromStopId)) item.fromStopIds.add(fromStopId);
      if (Number.isFinite(toStopId)) item.toStopIds.add(toStopId);
      item.families.add(source.family);
      item.sources.add(source.name);
      item.segmentCount += 1;
      sourceSegmentCount += 1;
    });
  }

  const maxCoverage = Math.max(1, ...Array.from(corridors.values()).map(item => item.lines.size || item.segmentCount));
  const features = Array.from(corridors.entries()).map(([key, item], index) => {
    const coverage = item.lines.size || item.segmentCount;
    const strength = Math.log1p(coverage) / Math.log1p(maxCoverage);
    const routeList = Array.from(item.lines).sort();
    return {
      type: "Feature",
      properties: {
        id: `translink-corridor-${index + 1}`,
        sourceKey: key,
        name: routeList.slice(0, 5).join(", ") || "Translink corridor",
        kind: item.families.has("metro") ? "metro" : "bus",
        color: routeColor(item.families, item.lines),
        strength,
        coverage,
        serviceClass: serviceClass(coverage),
        routeCount: coverage,
        routeList: routeList.slice(0, 18).join(", "),
        sourceFamilies: Array.from(item.families).sort().join(","),
        sourceDatasets: Array.from(item.sources).sort().join("; "),
        branchCodes: Array.from(item.branches).sort().join(","),
        segmentCount: item.segmentCount,
        lengthM: Math.round(lineLengthMetres(item.coordinates)),
        visibleYear: 2026,
      },
      geometry: { type: "LineString", coordinates: item.coordinates },
    };
  });

  features.sort((a, b) => a.properties.coverage - b.properties.coverage);
  return {
    collection: {
      type: "FeatureCollection",
      features,
      summary: {
        generatedAt: new Date().toISOString(),
        bbox: BELFAST_BBOX,
        sourceSegmentCount,
        corridorCount: features.length,
        maxCoverage,
        sources: SOURCES.map(source => ({
          name: source.name,
          url: source.url,
          updated: source.updated,
          license: "UK Open Government Licence v3.0",
        })),
      },
    },
    maxCoverage,
  };
}

function buildStopFeatures() {
  const stops = new Map();

  for (const source of SOURCES) {
    const basePath = path.join(rawDir, ...source.stopsBase);
    const geoms = parseMif(`${basePath}.MIF`);
    const rows = parseMid(`${basePath}.MID`);

    geoms.forEach((geom, index) => {
      if (!geom || geom.type !== "Point" || !coordInBbox(geom.coordinates)) return;
      const row = rows[index] || [];
      const stopId = String(row[1] || "").trim();
      const name = String(row[3] || row[4] || "Translink stop").trim();
      const servingLines = String(row[7] || "")
        .split(",")
        .map(value => value.trim())
        .filter(Boolean);
      const key = stopId || `${roundCoord(geom.coordinates)}:${name.toLowerCase()}`;
      if (!stops.has(key)) {
        stops.set(key, {
          id: key,
          name,
          coordinates: geom.coordinates,
          servingLines: new Set(),
          sourceFamilies: new Set(),
        });
      }
      const stop = stops.get(key);
      servingLines.forEach(line => stop.servingLines.add(line));
      stop.sourceFamilies.add(source.family);
    });
  }

  const maxLines = Math.max(1, ...Array.from(stops.values()).map(stop => stop.servingLines.size));
  const features = Array.from(stops.values()).map(stop => {
    const count = stop.servingLines.size;
    const strength = Math.log1p(count) / Math.log1p(maxLines);
    return {
      type: "Feature",
      properties: {
        source_id: `translink-stop-${stop.id}`,
        name: stop.name,
        mode: "bus",
        bus: "yes",
        public_transport: "platform",
        routeNode: count >= 10 ? 1 : 0,
        servingLineCount: count,
        servingLines: Array.from(stop.servingLines).sort().slice(0, 24).join(", "),
        weight: Math.max(0.35, strength),
        color: "#16a34a",
        sourceFamilies: Array.from(stop.sourceFamilies).sort().join(","),
        sourceName: STOP_LIST_SOURCE.name,
        sourceUpdated: STOP_LIST_SOURCE.updated,
      },
      geometry: { type: "Point", coordinates: stop.coordinates },
    };
  });

  features.sort((a, b) => a.properties.servingLineCount - b.properties.servingLineCount);
  return {
    type: "FeatureCollection",
    features,
    summary: {
      generatedAt: new Date().toISOString(),
      bbox: BELFAST_BBOX,
      stopCount: features.length,
      maxServingLineCount: maxLines,
      sources: [
        ...SOURCES.map(source => ({
          name: source.name,
          url: source.url,
          updated: source.updated,
          license: "UK Open Government Licence v3.0",
        })),
        {
          name: STOP_LIST_SOURCE.name,
          url: STOP_LIST_SOURCE.url,
          updated: STOP_LIST_SOURCE.updated,
          license: "UK Open Government Licence v3.0",
        },
      ],
    },
  };
}

async function main() {
  ensureDir(rawDir);
  ensureDir(outDir);
  for (const source of [...SOURCES, STOP_LIST_SOURCE]) await ensureArchive(source);

  const { collection: routes } = buildRouteFeatures();
  const stops = buildStopFeatures();

  const routeOut = path.join(outDir, "translink_belfast_route_segments_2026.geojson");
  const stopOut = path.join(outDir, "translink_belfast_bus_stops_2026.geojson");
  fs.writeFileSync(routeOut, JSON.stringify(routes));
  fs.writeFileSync(stopOut, JSON.stringify(stops));

  console.log(`Wrote ${path.relative(rootDir, routeOut)} (${routes.features.length} corridor segments)`);
  console.log(`Wrote ${path.relative(rootDir, stopOut)} (${stops.features.length} official stops)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
