const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MODE_A = path.join(ROOT, "web", "data", "mode-a");
const BOUNDARY_PATH = path.join(ROOT, "data", "2026", "_raw_osm", "belfast_boundary_nominatim.json");
const START_YEAR = 2026;
const BASELINE_YEAR = 2025;
const HORIZON_YEAR = 2036;
const BELFAST_CENTRE = [-5.9301829, 54.596391];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function clamp(value, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value, places = 4) {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

function roundCoord(value) {
  return round(Number(value), 6);
}

function metersPerLng(lat) {
  return Math.max(1, 111320 * Math.cos(Number(lat) * Math.PI / 180));
}

function offsetCoord(coord, eastM, northM) {
  const lng = Number(coord[0]);
  const lat = Number(coord[1]);
  return [
    roundCoord(lng + Number(eastM || 0) / metersPerLng(lat)),
    roundCoord(lat + Number(northM || 0) / 111320)
  ];
}

function offsetInside(coord, eastM, northM, boundary) {
  for (const factor of [1, 0.7, 0.45, 0.25, 0]) {
    const next = offsetCoord(coord, eastM * factor, northM * factor);
    if (pointInBoundary(next, boundary)) return next;
  }
  return coord.map(roundCoord);
}

function distanceKm(a, b) {
  const lat = (Number(a[1]) + Number(b[1])) / 2;
  const dx = (Number(a[0]) - Number(b[0])) * metersPerLng(lat);
  const dy = (Number(a[1]) - Number(b[1])) * 111320;
  return Math.hypot(dx, dy) / 1000;
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
  if (!Array.isArray(polygon) || !polygon.length) return false;
  if (!pointInRing(point, polygon[0])) return false;
  for (const hole of polygon.slice(1)) {
    if (pointInRing(point, hole)) return false;
  }
  return true;
}

function pointInBoundary(point, boundary) {
  if (!boundary || !point) return false;
  if (boundary.type === "Polygon") return pointInPolygon(point, boundary.coordinates);
  if (boundary.type === "MultiPolygon") {
    return boundary.coordinates.some((polygon) => pointInPolygon(point, polygon));
  }
  return false;
}

function loadBelfastBoundary() {
  const rows = readJson(BOUNDARY_PATH);
  const belfast = rows.find((row) =>
    row && row.geojson &&
    /Belfast, Northern Ireland/i.test(String(row.display_name || ""))
  ) || rows.find((row) => row && row.geojson);
  if (!belfast || !belfast.geojson) {
    throw new Error(`Could not load Belfast NI boundary from ${BOUNDARY_PATH}`);
  }
  return belfast.geojson;
}

function getMetric(row, metric) {
  return Number(row && row[metric]) || 0;
}

function uniqueByDistance(rows, minKm, limit) {
  const out = [];
  for (const row of rows) {
    if (!row.coord) continue;
    if (out.every((picked) => distanceKm(row.coord, picked.coord) >= minKm)) {
      out.push(row);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function summarizeHistoricalGrowth(summary) {
  const metricsByYear = summary.metricsByYear || {};
  const years = Object.keys(metricsByYear)
    .map(Number)
    .filter((year) => year >= 2016 && year <= 2025)
    .sort((a, b) => a - b);
  const result = {};
  for (const metric of ["traffic", "jobs", "electricity", "buildings", "services"]) {
    const values = years
      .map((year) => (metricsByYear[String(year)] || []).find((row) => row.metric === metric))
      .map((row) => row ? Number(row.value) : null)
      .filter(Number.isFinite);
    if (values.length < 2) continue;
    const deltas = values.slice(1).map((value, index) => value - values[index]);
    const longRun = (values.at(-1) - values[0]) / Math.max(1, values.length - 1);
    const recent = deltas.slice(-3).reduce((sum, value) => sum + value, 0) / Math.max(1, Math.min(3, deltas.length));
    const blended = longRun * 0.45 + recent * 0.55;
    result[metric] = {
      from2016: round(values[0]),
      to2025: round(values.at(-1)),
      averageYearlyGrowth: round(longRun),
      recentYearlyGrowth: round(recent),
      blendedYearlyGrowth: round(blended),
      projected2036Index: round(clamp(values.at(-1) + blended * (HORIZON_YEAR - BASELINE_YEAR), 0, 1.25))
    };
  }
  return result;
}

function forecastRows(baseline, boundary) {
  return (baseline.cells || []).map((cell) => {
    const coord = Array.isArray(cell.centroid) ? cell.centroid.map(Number) : null;
    if (!coord || !pointInBoundary(coord, boundary)) return null;
    const base = cell.baseline2025 || {};
    const future = (cell.forecastByYear || {})[String(HORIZON_YEAR)] || {};
    const deltas = {};
    for (const metric of baseline.metrics || []) {
      deltas[metric] = getMetric(future, metric) - getMetric(base, metric);
    }
    const growthPressure =
      Math.max(0, deltas.population) * 0.28 +
      Math.max(0, deltas.housingPressure) * 0.2 +
      Math.max(0, deltas.traffic) * 0.17 +
      Math.max(0, deltas.electricity) * 0.16 +
      Math.max(0, deltas.jobs) * 0.1 +
      Math.max(0, -deltas.greenScore) * 0.07 +
      getMetric(future, "planningViability") * 0.02;
    return {
      cellId: cell.cellId,
      coord,
      base,
      future,
      deltas,
      growthPressure,
      trafficPressure: Math.max(0, deltas.traffic) * 0.7 + getMetric(future, "traffic") * 0.3,
      housingPressure: Math.max(0, deltas.housingPressure) * 0.6 + getMetric(future, "housingPressure") * 0.4,
      electricityPressure: Math.max(0, deltas.electricity) * 0.45 + getMetric(future, "electricity") * 0.35 + Math.max(0, deltas.population) * 0.2,
      servicePressure: Math.max(0, deltas.population) * 0.45 + Math.max(0, deltas.services) * 0.2 + Math.max(0, deltas.housingPressure) * 0.35,
      greenLossPressure: Math.max(0, -deltas.greenScore) * 0.75 + Math.max(0, deltas.environmentAir) * 0.25
    };
  }).filter(Boolean);
}

function buildingPresetFor(row, index) {
  if ((row.deltas.jobs || 0) > 0.04 && index % 4 === 0) return "commercial";
  if ((row.deltas.jobs || 0) > 0.032 && (row.deltas.population || 0) > 0.16) return "mixed_use";
  return index % 3 === 0 ? "mixed_use" : "residential";
}

function buildingConfig(preset, pressure) {
  if (preset === "commercial") {
    return { size: "medium", buildingType: "office", affordabilityMix: "market", floors: pressure > 0.18 ? 12 : 9, footprintSqm: pressure > 0.18 ? 2300 : 1700, energyStandard: "net_zero_ready", parkingTransitAssumption: "transit_first", mitigation: { green: false, mobility: true, energy: true } };
  }
  if (preset === "mixed_use") {
    return { size: "medium", buildingType: "mixed_use", affordabilityMix: "affordable", floors: pressure > 0.2 ? 11 : 8, footprintSqm: pressure > 0.2 ? 2100 : 1500, energyStandard: "net_zero_ready", parkingTransitAssumption: "transit_first", mitigation: { green: true, mobility: true, energy: true } };
  }
  return { size: "medium", buildingType: "apartments", affordabilityMix: "affordable", floors: pressure > 0.22 ? 10 : 7, footprintSqm: pressure > 0.22 ? 1800 : 1350, energyStandard: "net_zero_ready", parkingTransitAssumption: "transit_first", mitigation: { green: true, mobility: true, energy: true } };
}

function createBuildings(rows) {
  const picked = uniqueByDistance(rows.slice().sort((a, b) => b.growthPressure - a.growthPressure), 0.55, 24);
  return picked.map((row, index) => {
    const preset = buildingPresetFor(row, index);
    const year = START_YEAR + Math.min(HORIZON_YEAR - START_YEAR, Math.floor(index * (HORIZON_YEAR - START_YEAR + 1) / picked.length));
    const color = preset === "commercial" ? "#06b6d4" : preset === "mixed_use" ? "#22c55e" : "#a855f7";
    const label = preset === "commercial" ? "Trend jobs hub" : preset === "mixed_use" ? "Trend mixed-use block" : "Trend homes";
    return {
      id: `trend-building-${index + 1}`,
      type: "building",
      year,
      lng: roundCoord(row.coord[0]),
      lat: roundCoord(row.coord[1]),
      location: { lng: roundCoord(row.coord[0]), lat: roundCoord(row.coord[1]) },
      preset,
      buildingConfig: buildingConfig(preset, row.growthPressure),
      color,
      label,
      height: preset === "commercial" ? 66 : preset === "mixed_use" ? 48 : 34,
      trendBaseline: {
        sourceCellId: row.cellId,
        reason: "High Belfast growth pressure if the current year-to-year trend continues.",
        growthPressure: round(row.growthPressure),
        delta2036: {
          population: round(row.deltas.population),
          traffic: round(row.deltas.traffic),
          housingPressure: round(row.deltas.housingPressure),
          electricity: round(row.deltas.electricity)
        }
      }
    };
  });
}

function createTransformers(rows, transformerForecast, boundary) {
  const byId = new Map(rows.map((row) => [row.cellId, row]));
  const ranked = (transformerForecast.cells || []).map((cell) => {
    const row = byId.get(cell.cellId);
    const target = (cell.forecastByYear || {})[String(HORIZON_YEAR)] || {};
    const risk = Number(target.overloadRisk) || 0;
    const headroom = Number(target.headroomKwProxy) || 0;
    const pressure = risk * 0.72 + Math.max(0, -headroom) / 3500 + (row ? row.electricityPressure * 0.22 : 0);
    return row ? { ...row, target, pressure } : null;
  }).filter(Boolean).sort((a, b) => b.pressure - a.pressure);
  const picked = uniqueByDistance(ranked, 0.7, 10);
  return picked.map((row, index) => {
    const coord = offsetInside(row.coord, (index % 2 ? 80 : -80), (index % 3 - 1) * 70, boundary);
    const risk = Number(row.target.overloadRisk) || 0;
    const year = START_YEAR + Math.min(HORIZON_YEAR - START_YEAR, Math.floor(index * 1.15));
    return {
      id: `trend-transformer-${index + 1}`,
      type: "infrastructure",
      year,
      lng: coord[0],
      lat: coord[1],
      color: "#f59e0b",
      label: risk >= 0.7 ? "Trend transformer reinforcement" : "Trend transformer node",
      assetClass: risk >= 0.7 ? "primary" : "secondary",
      capacityKva: risk >= 0.7 ? 1000 : 500,
      voltageKv: risk >= 0.7 ? 33 : 11,
      serviceRadiusM: risk >= 0.7 ? 950 : 700,
      radiusM: risk >= 0.7 ? 950 : 700,
      trendBaseline: {
        sourceCellId: row.cellId,
        reason: "Transformer pressure rises inside Belfast as peak demand outpaces local headroom.",
        overloadRisk2036: round(risk),
        headroomKwProxy2036: round(Number(row.target.headroomKwProxy) || 0, 1),
        peakKwProxy2036: round(Number(row.target.peakKwProxy) || 0, 1)
      }
    };
  });
}

function createRoads(rows, boundary) {
  const picked = uniqueByDistance(rows.slice().sort((a, b) => b.trafficPressure - a.trafficPressure), 0.65, 9);
  return picked.map((row, index) => {
    const angle = index % 2 === 0 ? 1 : -1;
    const scale = row.trafficPressure > 0.5 ? 520 : 420;
    const path = [
      offsetInside(row.coord, -scale, -130 * angle, boundary),
      offsetInside(row.coord, -scale * 0.25, -45 * angle, boundary),
      offsetInside(row.coord, scale * 0.25, 50 * angle, boundary),
      offsetInside(row.coord, scale, 135 * angle, boundary)
    ];
    const year = START_YEAR + Math.min(HORIZON_YEAR - START_YEAR, Math.floor(index * 1.25));
    const transitPriority = index % 3 === 2;
    return {
      id: `trend-road-${index + 1}`,
      type: "road",
      year,
      start: path[0],
      end: path[path.length - 1],
      path,
      color: transitPriority ? "#22c55e" : "#f59e0b",
      label: transitPriority ? "Trend transit priority corridor" : "Trend road capacity corridor",
      plannerMode: transitPriority ? "transit_priority" : "road_capacity",
      trendBaseline: {
        sourceCellId: row.cellId,
        reason: "Traffic pressure keeps rising in this Belfast corridor under the 2016-2025 growth pattern.",
        trafficPressure: round(row.trafficPressure),
        trafficDelta2036: round(row.deltas.traffic)
      }
    };
  });
}

function createSupportSpaces(rows, boundary) {
  const ranked = rows.slice().sort((a, b) => (b.greenLossPressure + b.servicePressure) - (a.greenLossPressure + a.servicePressure));
  const picked = uniqueByDistance(ranked, 0.75, 7);
  return picked.map((row, index) => {
    const coord = offsetInside(row.coord, (index % 2 ? -100 : 100), (index % 3 - 1) * 75, boundary);
    const year = START_YEAR + Math.min(HORIZON_YEAR - START_YEAR, 2 + Math.floor(index * 1.35));
    return {
      id: `trend-park-${index + 1}`,
      type: "park",
      year,
      lng: coord[0],
      lat: coord[1],
      color: "#22c55e",
      label: index % 2 === 0 ? "Trend green buffer" : "Trend service space",
      trendBaseline: {
        sourceCellId: row.cellId,
        reason: "Green and service support is added inside Belfast where growth raises service pressure.",
        servicePressure: round(row.servicePressure),
        greenLossPressure: round(row.greenLossPressure)
      }
    };
  });
}

function countByType(items) {
  return items.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});
}

function assertInside(items, boundary) {
  const outside = [];
  for (const item of items) {
    if (item.type === "road") {
      for (const coord of item.path || []) {
        if (!pointInBoundary(coord, boundary)) outside.push(`${item.id}:${coord.join(",")}`);
      }
    } else if (!pointInBoundary([item.lng, item.lat], boundary)) {
      outside.push(`${item.id}:${item.lng},${item.lat}`);
    }
  }
  if (outside.length) throw new Error(`Projected items outside Belfast NI boundary: ${outside.slice(0, 8).join("; ")}`);
}

function main() {
  const boundary = loadBelfastBoundary();
  const baseline = readJson(path.join(MODE_A, "baseline_2025_forecast.json"));
  const summary = readJson(path.join(MODE_A, "summary.json"));
  const transformerForecast = readJson(path.join(MODE_A, "transformer_capacity_forecast.json"));
  const rows = forecastRows(baseline, boundary);
  if (rows.length < 40) throw new Error(`Only ${rows.length} forecast cells are inside Belfast NI boundary.`);

  const items = [
    ...createBuildings(rows),
    ...createTransformers(rows, transformerForecast, boundary),
    ...createRoads(rows, boundary),
    ...createSupportSpaces(rows, boundary)
  ].sort((a, b) => (a.year - b.year) || a.id.localeCompare(b.id));
  assertInside(items, boundary);

  const start = baseline.summaryByYear[String(START_YEAR)] || {};
  const horizon = baseline.summaryByYear[String(HORIZON_YEAR)] || {};
  const forecastDeltas = {};
  for (const metric of baseline.metrics || []) {
    forecastDeltas[metric] = round(getMetric(horizon, metric) - getMetric(start, metric));
  }

  const now = new Date().toISOString();
  const payload = {
    schemaVersion: "1.0.0",
    kind: "belfast.trendBaselineBranch",
    modelVersion: "bims5-trend-continuation-branch-v2-belfast-boundary",
    generatedAt: now,
    baselineYear: BASELINE_YEAR,
    startYear: START_YEAR,
    horizonYear: HORIZON_YEAR,
    geography: {
      name: "Belfast, Northern Ireland",
      boundarySource: "data/2026/_raw_osm/belfast_boundary_nominatim.json",
      candidateCellsInsideBoundary: rows.length
    },
    method: "Rank only forecast cells whose centroids fall inside the Belfast NI boundary, then place representative trend-continuation additions with all point and road coordinates kept inside that polygon.",
    summary: {
      itemCount: items.length,
      itemCountsByType: countByType(items),
      forecastDeltas2026To2036: forecastDeltas,
      historicalGrowth: summarizeHistoricalGrowth(summary),
      transformerCapacity2036: transformerForecast.summaryByYear[String(HORIZON_YEAR)] || null,
      evidence: [
        "web/data/mode-a/summary.json",
        "web/data/mode-a/baseline_2025_forecast.json",
        "web/data/mode-a/transformer_capacity_forecast.json",
        "data/2026/_raw_osm/belfast_boundary_nominatim.json"
      ]
    },
    branch: {
      id: "baseline",
      name: "Baseline: current trends",
      color: "#3b82f6",
      parentId: null,
      locked: true,
      trendBaseline: true,
      forecastObjective: "baseline_trend_continuation",
      description: "Projected no-extra-policy baseline inside Belfast NI: if Belfast keeps following the observed year-to-year growth pattern, these representative buildings, transformers, roads and support spaces appear through 2036.",
      items,
      activityLog: [{
        id: "trend-baseline-method",
        type: "simulation",
        title: "Trend baseline generated",
        detail: "Representative additions are constrained to the Belfast NI boundary and derived from year-to-year forecast pressure.",
        year: START_YEAR,
        createdAt: now,
        data: { source: "trend_baseline_branch.json" }
      }]
    }
  };

  writeJson(path.join(MODE_A, "trend_baseline_branch.json"), payload);
  console.log(`Trend baseline OK: ${items.length} Belfast-only additions (${JSON.stringify(countByType(items))}).`);
}

main();
