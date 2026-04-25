const fs = require("fs");
const path = require("path");

const SIZE_PRESETS = {
  small: {
    footprintSqm: 600,
    floors: 4,
    units: 40
  },
  medium: {
    footprintSqm: 1500,
    floors: 8,
    units: 120
  },
  large: {
    footprintSqm: 3500,
    floors: 15,
    units: 300
  }
};

const TYPE_PRESETS = {
  apartments: {
    residentialShare: 1.0,
    commercialShare: 0.0,
    communityShare: 0.0
  },
  mixed_use: {
    residentialShare: 0.6,
    commercialShare: 0.3,
    communityShare: 0.1
  },
  office: {
    residentialShare: 0.0,
    commercialShare: 1.0,
    communityShare: 0.0
  },
  community: {
    residentialShare: 0.0,
    commercialShare: 0.0,
    communityShare: 1.0
  }
};

const AFFORDABILITY_PRESETS = {
  market: {
    affordabilityRatio: 0.0,
    fairnessMultiplier: 0.4
  },
  affordable: {
    affordabilityRatio: 0.3,
    fairnessMultiplier: 0.8
  },
  social: {
    affordabilityRatio: 0.6,
    fairnessMultiplier: 1.2
  },
  student: {
    affordabilityRatio: 0.1,
    fairnessMultiplier: 0.6
  }
};

const BASELINE_YEAR = 2025;
const START_YEAR = 2026;
const HORIZON_YEAR = 2036;
const MODEL_VERSION_FALLBACK = "bims5-forecast-v1-2025-baseline";

const FORECAST_METRICS = [
  "traffic",
  "population",
  "jobs",
  "economy",
  "housingPressure",
  "services",
  "electricity",
  "environmentAir",
  "greenScore",
  "fairness",
  "fiscalBalance",
  "planningViability"
];

const FORECAST_YEARS = Array.from({ length: HORIZON_YEAR - START_YEAR + 1 }, (_item, index) => START_YEAR + index);

const POSTCODE_OUTCODE_CENTRES = {
  BT1: { lng: -5.9284, lat: 54.6002, label: "Belfast City Centre" },
  BT2: { lng: -5.9322, lat: 54.5944, label: "Belfast Linenhall" },
  BT3: { lng: -5.8944, lat: 54.6173, label: "Belfast Harbour" },
  BT4: { lng: -5.8687, lat: 54.6023, label: "East Belfast" },
  BT5: { lng: -5.8848, lat: 54.5908, label: "East Belfast" },
  BT6: { lng: -5.9078, lat: 54.5792, label: "Ormeau / Castlereagh" },
  BT7: { lng: -5.9348, lat: 54.5845, label: "Queen's Quarter" },
  BT8: { lng: -5.9184, lat: 54.5485, label: "South Belfast" },
  BT9: { lng: -5.9568, lat: 54.5724, label: "Malone / Stranmillis" },
  BT10: { lng: -5.9828, lat: 54.5629, label: "Finaghy" },
  BT11: { lng: -5.9854, lat: 54.5886, label: "Andersonstown" },
  BT12: { lng: -5.9598, lat: 54.5945, label: "Falls / Village" },
  BT13: { lng: -5.9511, lat: 54.6056, label: "Shankill" },
  BT14: { lng: -5.9589, lat: 54.6269, label: "North Belfast" },
  BT15: { lng: -5.9315, lat: 54.6238, label: "North Belfast" },
  BT16: { lng: -5.8055, lat: 54.5959, label: "Dundonald edge" },
  BT17: { lng: -6.0232, lat: 54.5524, label: "Dunmurry edge" }
};

const HEADLINE_METRICS = [
  "populationPressure",
  "mobilityStrain",
  "economicOpportunity",
  "environmentalExposure",
  "fairnessScore"
];

const ALL_SIMULATION_METRICS = [
  ...HEADLINE_METRICS,
  "electricityDemand",
  "servicePressure",
  "roadPressure",
  "transportAccess",
  "greenScore",
  "jobAccess"
];

const BELFAST_PLACES = {
  "titanic quarter": { lng: -5.8976, lat: 54.6079 },
  "cathedral quarter": { lng: -5.9261, lat: 54.6032 },
  "city centre": { lng: -5.9301, lat: 54.5973 },
  "queen's quarter": { lng: -5.9362, lat: 54.5845 },
  "queens quarter": { lng: -5.9362, lat: 54.5845 },
  "lagan": { lng: -5.9176, lat: 54.5968 },
  "waterfront": { lng: -5.9161, lat: 54.5991 },
  "belfast harbour": { lng: -5.9025, lat: 54.6158 },
  "falls": { lng: -5.962, lat: 54.596 },
  "shankill": { lng: -5.9484, lat: 54.606 },
  "east belfast": { lng: -5.884, lat: 54.596 }
};

const dataCache = new Map();

function clamp(value, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalize(value, min, max) {
  if (!Number.isFinite(value) || max === min) return 0;
  return clamp((value - min) / (max - min));
}

function round(value, places = 3) {
  return Number(clamp(value, -10, 10).toFixed(places));
}

function roundCoord(value, places = 6) {
  return Number(Number(value).toFixed(places));
}

function canonicalSize(size) {
  if (String(size).toLowerCase() === "custom") return "custom";
  return SIZE_PRESETS[size] ? size : "medium";
}

function canonicalBuildingType(value) {
  const normalized = String(value || "apartments").toLowerCase().replace(/[-\s]+/g, "_");
  if (normalized === "mixeduse") return "mixed_use";
  return TYPE_PRESETS[normalized] ? normalized : "apartments";
}

function canonicalAffordability(value) {
  const normalized = String(value || "affordable").toLowerCase().replace(/[-\s]+/g, "_");
  if (normalized === "market_rate" || normalized === "marketrate") return "market";
  if (normalized === "social_housing") return "social";
  return AFFORDABILITY_PRESETS[normalized] ? normalized : "affordable";
}

function normalizeBuildingConfig(config = {}) {
  const size = canonicalSize(config.size);
  const buildingType = canonicalBuildingType(config.buildingType || config.building_type || config.type);
  const affordabilityMix = canonicalAffordability(config.affordabilityMix || config.affordability_mix || config.affordability);
  const sizePreset = SIZE_PRESETS[size] || { footprintSqm: 1500, floors: 8 };
  return {
    size,
    buildingType,
    affordabilityMix,
    energyStandard: String(config.energyStandard || config.energy_standard || "standard"),
    parkingTransitAssumption: String(config.parkingTransitAssumption || config.parking_transit_assumption || config.transportAssumption || "balanced"),
    mitigation: {
      green: Boolean(config.mitigation?.green || config.greenMitigation || config.addGreenMitigation),
      mobility: Boolean(config.mitigation?.mobility || config.mobilityMitigation || config.addMobilityMitigation),
      energy: Boolean(config.mitigation?.energy || config.energyMitigation || config.addEnergyMitigation)
    },
    floors: Number(config.floors || sizePreset.floors),
    footprintSqm: Number(config.footprintSqm || config.footprint_sqm || sizePreset.footprintSqm),
    units: Number(config.units || 0) || undefined,
    estimatedResidents: Number(config.estimatedResidents || config.estimated_residents || 0) || undefined,
    estimatedJobs: Number(config.estimatedJobs || config.estimated_jobs || 0) || undefined,
    estimatedElectricityDemand: Number(config.estimatedElectricityDemand || config.estimated_electricity_demand || 0) || undefined
  };
}

function deriveBuildingStats(config = {}) {
  const normalized = normalizeBuildingConfig(config);
  const type = TYPE_PRESETS[normalized.buildingType];
  const grossFloorAreaSqm = normalized.footprintSqm * normalized.floors;
  const residentialArea = grossFloorAreaSqm * type.residentialShare;
  const commercialArea = grossFloorAreaSqm * type.commercialShare;
  const communityArea = grossFloorAreaSqm * type.communityShare;
  const units = Math.round(Number(config.units) || residentialArea / 85);
  const estimatedResidents = Math.round(Number(config.estimatedResidents) || units * 2.2);
  const estimatedJobs = Math.round(Number(config.estimatedJobs) || commercialArea / 18);
  const estimatedElectricityDemand = Math.round(
    Number(config.estimatedElectricityDemand) ||
      residentialArea * 0.035 +
        commercialArea * 0.08 +
        communityArea * 0.05
  );

  return {
    ...normalized,
    grossFloorAreaSqm: Math.round(grossFloorAreaSqm),
    units,
    estimatedResidents,
    estimatedJobs,
    estimatedElectricityDemand
  };
}

function metersPerLng(lat) {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

function buildSquareFootprint(location, footprintSqm = 1500) {
  const lng = Number(location?.lng);
  const lat = Number(location?.lat);
  const sideM = Math.sqrt(Math.max(100, Number(footprintSqm) || 1500));
  const halfLat = sideM / 2 / 111_320;
  const halfLng = sideM / 2 / Math.max(1, metersPerLng(lat));
  return {
    type: "Polygon",
    coordinates: [[
      [lng - halfLng, lat - halfLat],
      [lng + halfLng, lat - halfLat],
      [lng + halfLng, lat + halfLat],
      [lng - halfLng, lat + halfLat],
      [lng - halfLng, lat - halfLat]
    ]]
  };
}

function geometryBbox(geometry) {
  const points = [];
  collectCoordinates(geometry?.coordinates, points);
  if (!points.length) return null;
  return points.reduce(
    (bbox, point) => [
      Math.min(bbox[0], point[0]),
      Math.min(bbox[1], point[1]),
      Math.max(bbox[2], point[0]),
      Math.max(bbox[3], point[1])
    ],
    [Infinity, Infinity, -Infinity, -Infinity]
  );
}

function bboxIntersects(a, b, buffer = 0) {
  if (!a || !b) return false;
  return !(a[2] + buffer < b[0] || a[0] - buffer > b[2] || a[3] + buffer < b[1] || a[1] - buffer > b[3]);
}

function collectCoordinates(coordinates, out) {
  if (!Array.isArray(coordinates)) return;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    out.push(coordinates);
    return;
  }
  for (const item of coordinates) collectCoordinates(item, out);
}

function polygonCentroid(geometry) {
  const points = [];
  collectCoordinates(geometry?.coordinates, points);
  if (!points.length) return [0, 0];
  const sums = points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
  return [sums[0] / points.length, sums[1] / points.length];
}

function pointFromLocation(location) {
  return [Number(location?.lng), Number(location?.lat)];
}

function haversineMeters(a, b) {
  const radius = 6_371_000;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const deltaLat = ((b[1] - a[1]) * Math.PI) / 180;
  const deltaLng = ((b[0] - a[0]) * Math.PI) / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const q = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return radius * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}

function project(point, originLat) {
  return [point[0] * metersPerLng(originLat), point[1] * 111_320];
}

function distanceToSegmentMeters(point, a, b) {
  const originLat = point[1];
  const p = project(point, originLat);
  const pa = project(a, originLat);
  const pb = project(b, originLat);
  const dx = pb[0] - pa[0];
  const dy = pb[1] - pa[1];
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return haversineMeters(point, a);
  const t = clamp(((p[0] - pa[0]) * dx + (p[1] - pa[1]) * dy) / lengthSquared);
  const closest = [pa[0] + t * dx, pa[1] + t * dy];
  const diffX = p[0] - closest[0];
  const diffY = p[1] - closest[1];
  return Math.sqrt(diffX * diffX + diffY * diffY);
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, coordinates) {
  if (!Array.isArray(coordinates?.[0])) return false;
  if (!pointInRing(point, coordinates[0])) return false;
  for (let i = 1; i < coordinates.length; i += 1) {
    if (pointInRing(point, coordinates[i])) return false;
  }
  return true;
}

function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") return pointInPolygon(point, geometry.coordinates);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
  if (geometry.type === "Point") return haversineMeters(point, geometry.coordinates) < 2;
  if (geometry.type === "MultiPoint") return geometry.coordinates.some((coord) => haversineMeters(point, coord) < 2);
  return false;
}

function minDistanceToCoordinateTree(point, coordinates, best = Infinity) {
  if (!Array.isArray(coordinates) || best <= 0) return best;
  if (typeof coordinates[0]?.[0] === "number") {
    for (let i = 0; i < coordinates.length; i += 1) {
      best = Math.min(best, haversineMeters(point, coordinates[i]));
      if (i > 0) best = Math.min(best, distanceToSegmentMeters(point, coordinates[i - 1], coordinates[i]));
    }
    return best;
  }
  for (const item of coordinates) best = minDistanceToCoordinateTree(point, item, best);
  return best;
}

function distanceToFeatureMeters(point, feature) {
  const geometry = feature?.geometry;
  if (!geometry) return Infinity;
  if (pointInGeometry(point, geometry)) return 0;
  return minDistanceToCoordinateTree(point, geometry.coordinates);
}

function readJson(rootDir, relativePath) {
  const fullPath = path.join(rootDir, relativePath);
  const cached = dataCache.get(fullPath);
  if (cached) return cached;
  const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  dataCache.set(fullPath, parsed);
  return parsed;
}

function readJsonIfExists(rootDir, relativePath, fallback = null) {
  const fullPath = path.join(rootDir, relativePath);
  if (!fs.existsSync(fullPath)) return fallback;
  return readJson(rootDir, relativePath);
}

function loadForecastArtifacts(rootDir) {
  const cacheKey = path.join(rootDir, "web", "data", "mode-a", "baseline_2025_forecast.json");
  const cached = dataCache.get(`${cacheKey}:forecast-artifacts`);
  if (cached) return cached;
  const model = readJsonIfExists(rootDir, path.join("web", "data", "mode-a", "forecast_model.json"), null);
  const baseline = readJsonIfExists(rootDir, path.join("web", "data", "mode-a", "baseline_2025_forecast.json"), null);
  const cellsById = new Map();
  for (const cell of baseline?.cells || []) {
    if (cell?.cellId) cellsById.set(cell.cellId, cell);
  }
  const artifacts = {
    model: model || {
      modelVersion: MODEL_VERSION_FALLBACK,
      baselineYear: BASELINE_YEAR,
      startYear: START_YEAR,
      horizonYear: HORIZON_YEAR,
      metrics: FORECAST_METRICS
    },
    baseline,
    cellsById
  };
  dataCache.set(`${cacheKey}:forecast-artifacts`, artifacts);
  return artifacts;
}

function metricFromProps(props, populationProxy = 0.5) {
  const traffic = clamp(Number(props.traffic ?? 0));
  const jobs = clamp(Number(props.jobs ?? 0));
  const electricity = clamp(Number(props.electricity ?? 0));
  const services = clamp(Number(props.services ?? 0));
  const buildings = clamp(Number(props.buildings ?? 0));
  const development = clamp(Number(props.development_pressure ?? 0));
  const greenScore = clamp(Number(props.green_cover ?? props.tree_canopy_context ?? 0.35));
  const transit = clamp(Number(props.transit_access ?? 0.18));
  const planning = clamp(Number(props.planning_intensity ?? 0.08));
  const deprivation = clamp(Number(props.deprivation_weight ?? 0));
  const environmentAir = clamp(traffic * 0.42 + electricity * 0.24 + (1 - greenScore) * 0.22 + Number(props.traffic_pressure ?? traffic) * 0.12);
  const population = clamp(buildings * 0.48 + development * 0.3 + services * 0.07 + populationProxy * 0.15);
  const economy = clamp(jobs * 0.58 + services * 0.17 + planning * 0.15 + transit * 0.1);
  const housingPressure = clamp(population * 0.42 + development * 0.28 + (1 - services) * 0.16 + buildings * 0.14);
  const fairness = clamp(services * 0.25 + transit * 0.2 + jobs * 0.18 + (1 - environmentAir) * 0.17 + deprivation * 0.2);
  const fiscalBalance = clamp(economy * 0.42 + jobs * 0.23 + planning * 0.16 + services * 0.11 - traffic * 0.05 - electricity * 0.04 + 0.08);
  const planningViability = clamp(planning * 0.32 + transit * 0.18 + services * 0.15 + greenScore * 0.13 + (1 - environmentAir) * 0.15 + jobs * 0.07);
  return normalizeForecastMetrics({
    traffic,
    population,
    jobs,
    economy,
    housingPressure,
    services,
    electricity,
    environmentAir,
    greenScore,
    fairness,
    fiscalBalance,
    planningViability
  });
}

function normalizeForecastMetrics(metrics = {}) {
  const out = {};
  for (const metric of FORECAST_METRICS) out[metric] = round(clamp(Number(metrics[metric] ?? 0)), 3);
  return out;
}

function zeroForecastDiff() {
  return Object.fromEntries(FORECAST_METRICS.map((metric) => [metric, 0]));
}

function diffForecastMetrics(metrics, baseline) {
  return Object.fromEntries(FORECAST_METRICS.map((metric) => [metric, round((metrics?.[metric] || 0) - (baseline?.[metric] || 0), 3)]));
}

function legacyMetricsFromForecast(metrics = {}, props = {}) {
  return {
    populationPressure: clamp(Number(metrics.population ?? metrics.housingPressure ?? props.buildings ?? 0)),
    mobilityStrain: clamp(Number(metrics.traffic ?? props.traffic ?? 0)),
    economicOpportunity: clamp(Number(metrics.economy ?? metrics.jobs ?? props.jobs ?? 0)),
    environmentalExposure: clamp(Number(metrics.environmentAir ?? 0)),
    fairnessScore: clamp(Number(metrics.fairness ?? 0)),
    electricityDemand: clamp(Number(metrics.electricity ?? props.electricity ?? 0)),
    servicePressure: clamp(Number(metrics.housingPressure ?? 0) * 0.55 + (1 - Number(metrics.services ?? props.services ?? 0)) * 0.45),
    roadPressure: clamp(Number(props.traffic_pressure ?? metrics.traffic ?? 0)),
    transportAccess: clamp(Number(props.transit_access ?? 0.18)),
    greenScore: clamp(Number(metrics.greenScore ?? props.green_cover ?? 0.35)),
    jobAccess: clamp(Number(metrics.jobs ?? props.jobs ?? 0))
  };
}

function safeFeatureCollection(data) {
  return data?.type === "FeatureCollection" && Array.isArray(data.features) ? data : { type: "FeatureCollection", features: [] };
}

function loadCityData(rootDir) {
  return {
    grid2025: safeFeatureCollection(readJson(rootDir, path.join("web", "data", "mode-a", "grid_2025.geojson"))),
    grid2026: safeFeatureCollection(readJson(rootDir, path.join("web", "data", "mode-a", "grid_2026.geojson"))),
    boundary: safeFeatureCollection(readJsonIfExists(rootDir, path.join("data", "2026", "belfastboudnary2026.geojson"), { type: "FeatureCollection", features: [] })),
    buildings: safeFeatureCollection(readJson(rootDir, path.join("data", "2026", "belfast_buildings_2026.geojson"))),
    majorRoads: safeFeatureCollection(readJson(rootDir, path.join("data", "2026", "belfast_major_roads_2026.geojson"))),
    water: safeFeatureCollection(readJson(rootDir, path.join("data", "2026", "belfast_water_2026.geojson"))),
    green: safeFeatureCollection(readJson(rootDir, path.join("data", "2026", "belfast_green_spaces_2026.geojson"))),
    development: safeFeatureCollection(readJson(rootDir, path.join("data", "2026", "belfastdevelopmentland2026.geojson"))),
    transit: safeFeatureCollection(readJson(rootDir, path.join("data", "derived", "2026", "belfast_ni_transport_stops_osm_2026.geojson"))),
    services: safeFeatureCollection(readJson(rootDir, path.join("data", "derived", "2026", "belfast_ni_services_osm_2026.geojson")))
  };
}

function closestFeature(features, point, maxDistance = Infinity) {
  let closest = null;
  let distanceM = maxDistance;
  for (const feature of features || []) {
    const distance = distanceToFeatureMeters(point, feature);
    if (distance < distanceM) {
      closest = feature;
      distanceM = distance;
    }
  }
  return { feature: closest, distanceM };
}

function toCityCell(feature, rootDir = process.cwd()) {
  const props = feature.properties || {};
  const forecastCell = loadForecastArtifacts(rootDir).cellsById.get(props.cell_id || feature.id);
  const baseline2025 = normalizeForecastMetrics(forecastCell?.baseline2025 || metricFromProps(props));
  const forecastByYear = forecastCell?.forecastByYear || {};
  const horizonMetrics = normalizeForecastMetrics(forecastByYear[String(HORIZON_YEAR)] || baseline2025);
  const centroid = polygonCentroid(feature.geometry);
  const traffic2036 = horizonMetrics.traffic;
  const jobs2036 = horizonMetrics.jobs;
  const electricity2036 = horizonMetrics.electricity;
  const buildings2036 = horizonMetrics.population;
  const services2036 = horizonMetrics.services;
  const greenScore = clamp(Number(props.green_cover ?? props.tree_canopy_context ?? 0.3));
  const deprivationWeight = clamp(Number(props.deprivation_weight ?? 0));
  const transportAccess = clamp(Number(props.transit_access ?? 0.18));
  const roadPressure = clamp(Number(props.traffic_pressure ?? traffic2036));
  const jobAccess = jobs2036;
  const populationPressure = horizonMetrics.population;
  const environmentalExposure = horizonMetrics.environmentAir;
  const fairnessScore = clamp(
    horizonMetrics.fairness ||
      services2036 * 0.28 +
        jobAccess * 0.24 +
        transportAccess * 0.24 +
        (1 - environmentalExposure) * 0.14 -
        deprivationWeight * 0.1
  );

  return {
    id: props.cell_id || feature.id,
    geometry: feature.geometry,
    centroid,
    district: props.district || "Belfast",
    deprivationWeight,
    sourceProperties: props,
    baseline2025,
    forecastByYear,
    confidence: forecastCell?.confidence || props.confidence || "medium",
    evidence: forecastCell?.evidence || props.evidence || [],
    baseline2036: {
      populationPressure,
      mobilityStrain: traffic2036,
      economicOpportunity: jobs2036,
      environmentalExposure,
      fairnessScore,
      electricityDemand: electricity2036,
      servicePressure: clamp(1 - services2036 + populationPressure * 0.12),
      roadPressure,
      transportAccess,
      greenScore,
      jobAccess
    },
    forecast2036: horizonMetrics
  };
}

function trendMetric(props, metric) {
  return clamp(Number(props[metric] ?? 0) + Number(props[`${metric}_delta_2016`] ?? 0));
}

function cityCells(rootDir) {
  return loadCityData(rootDir).grid2025.features.map((feature) => toCityCell(feature, rootDir));
}

function findNearestCell(cells, location) {
  const point = pointFromLocation(location);
  let containing = null;
  for (const cell of cells) {
    if (pointInGeometry(point, cell.geometry)) {
      containing = cell;
      break;
    }
  }
  if (containing) return containing;
  return cells
    .map((cell) => ({ cell, distanceM: haversineMeters(point, cell.centroid) }))
    .sort((a, b) => a.distanceM - b.distanceM)[0]?.cell;
}

function getCellsWithin(cells, location, radiusM = 800) {
  const point = pointFromLocation(location);
  return cells
    .map((cell) => ({ cell, distanceM: haversineMeters(point, cell.centroid) }))
    .filter((item) => item.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);
}

function buildabilityScore(status, warnings, positives) {
  if (status === "invalid") return 0.18;
  return round(clamp(0.76 - warnings.length * 0.075 + positives.length * 0.035), 2);
}

function normalizePostcode(value = "") {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) {
    return { input: value, normalized: "", outcode: "", incode: "", precision: "invalid", isBt: false, isFull: false };
  }
  const full = compact.match(/^(BT\d{1,2})(\d[A-Z]{2})$/);
  if (full) {
    return {
      input: value,
      normalized: `${full[1]} ${full[2]}`,
      compact,
      outcode: full[1],
      incode: full[2],
      precision: "full_postcode",
      isBt: true,
      isFull: true
    };
  }
  const outcode = compact.match(/^(BT\d{1,2})$/);
  if (outcode) {
    return {
      input: value,
      normalized: outcode[1],
      compact,
      outcode: outcode[1],
      incode: "",
      precision: "outcode",
      isBt: true,
      isFull: false
    };
  }
  return { input: value, normalized: compact, compact, outcode: compact.slice(0, 4), incode: "", precision: "invalid", isBt: compact.startsWith("BT"), isFull: false };
}

function postcodeHash(value = "") {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function jitterPostcodeLocation(base, normalized) {
  if (!normalized.isFull) return { lng: base.lng, lat: base.lat };
  const hash = postcodeHash(normalized.compact);
  const angle = ((hash % 360) * Math.PI) / 180;
  const radiusM = 90 + ((hash >>> 9) % 260);
  const latOffset = (Math.sin(angle) * radiusM) / 111_320;
  const lngOffset = (Math.cos(angle) * radiusM) / Math.max(1, metersPerLng(base.lat));
  return {
    lng: roundCoord(base.lng + lngOffset, 6),
    lat: roundCoord(base.lat + latOffset, 6)
  };
}

function pointInsideReplayGrid(location, rootDir) {
  const data = loadCityData(rootDir);
  const point = pointFromLocation(location);
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return false;
  const cityBbox = geometryBbox(data.grid2025);
  return bboxIntersects([point[0], point[1], point[0], point[1]], cityBbox || [-6.2, 54.4, -5.7, 54.8]);
}

function isBuildablePoint(location, rootDir, footprintSqm = 900) {
  const data = loadCityData(rootDir);
  const point = pointFromLocation(location);
  const geometry = buildSquareFootprint(location, footprintSqm);
  const footprintBbox = geometryBbox(geometry);
  if (!pointInsideReplayGrid(location, rootDir)) return false;
  if (intersectsLayerAtPointOrBbox(data.water.features, point, footprintBbox, 0.00002)) return false;
  if (intersectsLayerAtPointOrBbox(data.buildings.features, point, footprintBbox, 0.00001)) return false;
  if (closestFeature(data.majorRoads.features, point, 18).feature) return false;
  return true;
}

function findBuildablePointNear(location, rootDir) {
  if (isBuildablePoint(location, rootDir)) return location;
  const radii = [80, 140, 220, 340, 460, 620];
  const bearings = [0, 45, 90, 135, 180, 225, 270, 315];
  for (const radiusM of radii) {
    for (const bearing of bearings) {
      const angle = (bearing * Math.PI) / 180;
      const candidate = {
        lng: roundCoord(location.lng + (Math.cos(angle) * radiusM) / Math.max(1, metersPerLng(location.lat)), 6),
        lat: roundCoord(location.lat + (Math.sin(angle) * radiusM) / 111_320, 6)
      };
      if (isBuildablePoint(candidate, rootDir)) return candidate;
    }
  }
  return location;
}

function postcodeBbox(location, precision) {
  const radiusM = precision === "outcode" ? 900 : 140;
  const latDelta = radiusM / 111_320;
  const lngDelta = radiusM / Math.max(1, metersPerLng(location.lat));
  return [
    roundCoord(location.lng - lngDelta, 6),
    roundCoord(location.lat - latDelta, 6),
    roundCoord(location.lng + lngDelta, 6),
    roundCoord(location.lat + latDelta, 6)
  ];
}

function resolvePostcode(postcode, rootDir = process.cwd()) {
  const parsed = normalizePostcode(postcode);
  const centre = POSTCODE_OUTCODE_CENTRES[parsed.outcode];
  const warnings = [];
  if (!parsed.isBt) warnings.push("Only Belfast BT postcodes are supported for placement.");
  if (parsed.precision === "invalid") warnings.push("Enter a Belfast postcode such as BT7 1NN.");
  if (!centre) warnings.push("This BT outcode is outside the local Belfast placement index.");
  const initialLocation = centre ? jitterPostcodeLocation(centre, parsed) : null;
  const location = initialLocation && parsed.isFull ? findBuildablePointNear(initialLocation, rootDir) : initialLocation;
  const inBelfast = Boolean(location && pointInsideReplayGrid(location, rootDir));
  if (parsed.precision === "outcode") warnings.push("Outcode search can zoom the map, but a full postcode is required to add a building.");
  if (location && !inBelfast) warnings.push("Resolved point is outside the Belfast replay grid.");
  const canPlace = Boolean(parsed.isFull && parsed.isBt && centre && inBelfast);
  return {
    input: postcode,
    normalizedPostcode: parsed.normalized,
    postcode: parsed.normalized,
    outcode: parsed.outcode,
    incode: parsed.incode,
    location,
    bbox: location ? postcodeBbox(location, parsed.precision) : null,
    precision: parsed.precision,
    isBelfast: inBelfast,
    withinBelfastBoundary: inBelfast,
    canPlace,
    source: "local_bt_outcode_index",
    label: centre?.label || "Belfast",
    warnings,
    evidence: [
      "Local BT outcode centroid index for Belfast placement gating",
      "Replay-grid boundary check against 2025 Mode A grid",
      "Full-postcode placement uses deterministic local offset and buildable-point search"
    ]
  };
}

function validatePlacement(payload = {}, rootDir = process.cwd()) {
  const resolvedPostcode = payload.resolvedPostcode || payload.postcodeResolution || (payload.postcode ? resolvePostcode(payload.postcode, rootDir) : null);
  const config = deriveBuildingStats(payload.config || payload.building_config || {});
  const location = payload.location || resolvedPostcode?.location || locationFromGeometry(payload.geometry);
  const geometry = payload.geometry || buildSquareFootprint(location, config.footprintSqm);
  const point = location ? pointFromLocation(location) : polygonCentroid(geometry);
  const data = loadCityData(rootDir);
  const cells = cityCells(rootDir);
  const nearestCell = findNearestCell(cells, { lng: point[0], lat: point[1] });
  const warnings = [];
  const positiveFactors = [];
  const invalidReasons = [];
  const footprintBbox = geometryBbox(geometry);
  const cityBbox = geometryBbox(data.grid2025);

  if (payload.requireResolvedPostcode && !resolvedPostcode?.canPlace) {
    invalidReasons.push(resolvedPostcode?.precision === "outcode"
      ? "A full Belfast postcode is required before placing a building"
      : "Postcode could not be resolved to a placeable Belfast site");
  }

  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1]) || !bboxIntersects([point[0], point[1], point[0], point[1]], cityBbox || [-6.2, 54.4, -5.7, 54.8])) {
    invalidReasons.push("Outside the Belfast replay grid");
  }

  if (intersectsLayerAtPointOrBbox(data.water.features, point, footprintBbox, 0.00002)) {
    invalidReasons.push("Overlaps mapped water");
  }
  if (intersectsLayerAtPointOrBbox(data.buildings.features, point, footprintBbox, 0.00001)) {
    invalidReasons.push("Overlaps existing buildings");
  }
  if (closestFeature(data.majorRoads.features, point, 18).feature) {
    invalidReasons.push("Overlaps or sits too close to a major road corridor");
  }

  const greenDistance = closestFeature(data.green.features, point, 120).distanceM;
  if (greenDistance <= 45) warnings.push("May reduce local green score");
  else if (greenDistance <= 120) warnings.push("Close to existing green space");

  const waterDistance = closestFeature(data.water.features, point, 160).distanceM;
  if (waterDistance <= 160 && !invalidReasons.some((reason) => reason.includes("water"))) {
    warnings.push("Moderate flood-risk context");
  }

  const transitDistance = closestFeature(data.transit.features, point, 650).distanceM;
  if (transitDistance <= 500 || Number(nearestCell?.baseline2036.transportAccess) >= 0.45) {
    positiveFactors.push("Near public transport");
  } else {
    warnings.push("Transport access is moderate");
  }

  if (closestFeature(data.services.features, point, 700).feature) {
    positiveFactors.push("Near civic or local services");
  }

  if (intersectsLayerAtPointOrBbox(data.development.features, point, footprintBbox, 0.0008)) {
    positiveFactors.push("Near planned development area");
  }

  if ((nearestCell?.deprivationWeight || 0) >= 0.45) {
    positiveFactors.push("Fairness opportunity in a higher-need area");
  }

  if ((nearestCell?.baseline2036.economicOpportunity || 0) >= 0.5 || (nearestCell?.baseline2036.jobAccess || 0) >= 0.5) {
    positiveFactors.push("Strong access to city-centre jobs");
  }

  if ((nearestCell?.baseline2036.environmentalExposure || 0) >= 0.62) {
    warnings.push("High environmental exposure context");
  }
  if ((nearestCell?.baseline2036.servicePressure || 0) >= 0.72) {
    warnings.push("High service pressure context");
  }

  const status = invalidReasons.length ? "invalid" : warnings.length ? "warning" : "valid";
  const confidence = invalidReasons.length ? "high" : warnings.length > 2 ? "medium" : "medium-high";
  return {
    status,
    siteStatus: status,
    site_status: status,
    siteLabel: status === "invalid" ? "Not buildable with current constraints" : status === "warning" ? "Good candidate with environmental constraints" : "Good candidate site",
    site_label: status === "invalid" ? "Not buildable with current constraints" : status === "warning" ? "Good candidate with environmental constraints" : "Good candidate site",
    warnings: [...invalidReasons, ...warnings],
    invalidReasons,
    positiveFactors,
    positive_factors: positiveFactors,
    confidence,
    buildabilityScore: buildabilityScore(status, warnings, positiveFactors),
    nearestCellId: nearestCell?.id,
    location: { lng: point[0], lat: point[1] },
    geometry,
    postcode: resolvedPostcode || null
  };
}

function intersectsLayerAtPointOrBbox(features, point, bbox, buffer) {
  return features.some((feature) => {
    const featureBbox = geometryBbox(feature.geometry);
    if (bbox && featureBbox && !bboxIntersects(bbox, featureBbox, buffer)) return false;
    return pointInGeometry(point, feature.geometry) || (bbox && bboxIntersects(bbox, featureBbox, buffer));
  });
}

function locationFromGeometry(geometry) {
  if (!geometry) return null;
  const [lng, lat] = polygonCentroid(geometry);
  return { lng, lat };
}

function getSiteContext(payload = {}, rootDir = process.cwd()) {
  const validation = payload.validation || validatePlacement(payload, rootDir);
  const location = validation.location || payload.location || locationFromGeometry(payload.geometry);
  const point = pointFromLocation(location);
  const data = loadCityData(rootDir);
  const cells = cityCells(rootDir);
  const nearestCell = findNearestCell(cells, location);
  const nearbyCells = getCellsWithin(cells, location, 800).map((item) => item.cell.id);
  const transit = closestFeature(data.transit.features, point, 1200);
  const services = closestFeature(data.services.features, point, 1200);
  const green = closestFeature(data.green.features, point, 1200);
  const water = closestFeature(data.water.features, point, 1200);

  return {
    location,
    validation,
    nearestCellId: nearestCell?.id,
    nearbyCellIds: nearbyCells,
    deprivationWeight: round(nearestCell?.deprivationWeight || 0),
    baselineMetrics: nearestCell?.baseline2036 || {},
    nearbyTransport: {
      distanceM: Math.round(transit.distanceM || 9999),
      label: transit.feature?.properties?.name || transit.feature?.properties?.highway || "Transit stop"
    },
    nearbyServices: {
      distanceM: Math.round(services.distanceM || 9999),
      label: services.feature?.properties?.name || services.feature?.properties?.amenity || "Local service"
    },
    greenContext: {
      distanceM: Math.round(green.distanceM || 9999),
      greenScore: round(nearestCell?.baseline2036.greenScore || 0)
    },
    floodOrWaterContext: {
      distanceM: Math.round(water.distanceM || 9999),
      proxy: water.distanceM <= 160 ? "moderate" : "low"
    }
  };
}

function createBuildingIntervention(payload = {}, rootDir = process.cwd()) {
  const resolvedPostcode = payload.resolvedPostcode || payload.postcodeResolution || (payload.postcode ? resolvePostcode(payload.postcode, rootDir) : null);
  const config = deriveBuildingStats(payload.config || payload.building_config || payload);
  const location = payload.location || resolvedPostcode?.location || locationFromGeometry(payload.geometry);
  const geometry = payload.geometry || buildSquareFootprint(location, config.footprintSqm);
  const validation = payload.validation || validatePlacement({
    location,
    geometry,
    config,
    postcode: resolvedPostcode?.postcode || payload.postcode,
    resolvedPostcode,
    requireResolvedPostcode: payload.requireResolvedPostcode
  }, rootDir);
  const id = payload.id || `building-${Date.now().toString(36)}`;
  return {
    id,
    scenarioId: payload.scenarioId || payload.scenario_id || "housing_growth",
    interventionType: "building",
    type: "building",
    postcode: resolvedPostcode?.postcode || payload.postcode || null,
    resolvedPostcode: resolvedPostcode || null,
    location,
    geometry,
    config,
    delivery: {
      startYear: Number(payload.delivery?.startYear || payload.startYear || START_YEAR),
      completionYear: Number(payload.delivery?.completionYear || payload.completionYear || HORIZON_YEAR)
    },
    validation: {
      status: validation.status,
      warnings: validation.warnings || [],
      confidence: validation.confidence === "medium-high" ? "high" : validation.confidence || "medium"
    }
  };
}

function buildingInterventionFrom(baseBuilding, overrides = {}) {
  const overrideConfig = overrides.config || {};
  return {
    type: "building",
    location: overrides.location || baseBuilding.location,
    geometry: overrides.geometry || baseBuilding.geometry,
    config: {
      ...baseBuilding.config,
      ...overrideConfig,
      size: overrides.size || overrideConfig.size || baseBuilding.config.size,
      buildingType: overrides.buildingType || overrides.building_type || overrideConfig.buildingType || baseBuilding.config.buildingType,
      affordabilityMix: overrides.affordabilityMix || overrides.affordability_mix || overrideConfig.affordabilityMix || baseBuilding.config.affordabilityMix,
      energyStandard: overrides.energyStandard || overrideConfig.energyStandard || baseBuilding.config.energyStandard
    },
    rationale: overrides.rationale || "Tests the configured building proposal."
  };
}

function generateFallbackVariants(input = {}, rootDir = process.cwd()) {
  const building = input.building?.interventionType === "building" ? input.building : createBuildingIntervention(input.building || input, rootDir);
  const siteContext = input.siteContext || getSiteContext({ location: building.location, geometry: building.geometry, config: building.config, validation: building.validation }, rootDir);
  const needsTransit = siteContext.validation?.warnings?.some((warning) => /transport|road|traffic/i.test(warning)) || siteContext.baselineMetrics?.mobilityStrain >= 0.52;
  const greenWarning = siteContext.validation?.warnings?.some((warning) => /green|flood|environmental/i.test(warning));
  const variants = [
    {
      branchName: "Original Housing Proposal",
      objective: "user_proposal",
      description: describeBuilding(building.config, "at the selected site"),
      interventions: [buildingInterventionFrom(building, { rationale: "Runs exactly what the user placed." })],
      assumptions: ["Building impact is modelled as a proxy over nearby 2036 grid cells.", "No mitigation is added in this branch."]
    },
    {
      branchName: "Traffic-Safe Housing",
      objective: "traffic_mitigation",
      description: "Same building, paired with a transit-first mobility corridor.",
      interventions: [
        buildingInterventionFrom(building, { rationale: "Keeps the user proposal fixed." }),
        {
          type: "mobility_corridor",
          mode: "transit_first",
          radiusM: needsTransit ? 800 : 650,
          radius_m: needsTransit ? 800 : 650,
          location: building.location,
          rationale: "Tests whether transit priority can offset local mobility strain."
        }
      ],
      assumptions: ["Mobility mitigation reduces strain as an accessibility proxy, not an exact congestion forecast."]
    },
    {
      branchName: "Jobs-Optimised Mixed Use",
      objective: "jobs_optimised",
      description: "Converts the proposal into a mixed-use branch with employment and community space.",
      interventions: [
        buildingInterventionFrom(building, {
          buildingType: "mixed_use",
          rationale: "Tests whether mixed use improves local opportunity without moving the building."
        }),
        {
          type: "opportunity_hub",
          radiusM: 650,
          radius_m: 650,
          location: building.location,
          rationale: "Adds local opportunity uplift around the proposal."
        }
      ],
      assumptions: ["Commercial floorspace is treated as job-access opportunity rather than guaranteed employment."]
    },
    {
      branchName: "Fairness-First Housing",
      objective: "fairness_first",
      description: "Increases the affordability mix to test benefit for higher-need areas.",
      interventions: [
        buildingInterventionFrom(building, {
          affordabilityMix: "social",
          rationale: "Tests a stronger affordability and access mix."
        })
      ],
      assumptions: ["Fairness benefit is weighted by local deprivation and access proxies."]
    },
    {
      branchName: "Green-Mitigation Housing",
      objective: "green_mitigation",
      description: "Keeps the building but adds a green buffer to reduce exposure.",
      interventions: [
        buildingInterventionFrom(building, { rationale: "Keeps the user proposal fixed." }),
        {
          type: "green_corridor",
          bufferRadiusM: greenWarning ? 700 : 600,
          buffer_radius_m: greenWarning ? 700 : 600,
          location: building.location,
          rationale: "Tests whether green mitigation can reduce exposure and protect local green score."
        }
      ],
      assumptions: ["Green mitigation is modelled as exposure reduction and green-score uplift."]
    },
    {
      branchName: "Balanced Growth",
      objective: "balanced",
      description: "Combines the building with mobility and green mitigation.",
      interventions: [
        buildingInterventionFrom(building, { rationale: "Starts from the user's building." }),
        {
          type: "mobility_corridor",
          mode: "transit_first",
          radiusM: 700,
          radius_m: 700,
          location: building.location,
          rationale: "Offsets corridor strain."
        },
        {
          type: "green_corridor",
          bufferRadiusM: 600,
          buffer_radius_m: 600,
          location: building.location,
          rationale: "Offsets exposure and green-score pressure."
        }
      ],
      assumptions: ["Balanced branch stacks supported mitigations without changing the selected site."]
    }
  ];
  return { scenarioVariants: variants, scenario_variants: variants };
}

function describeBuilding(config, suffix) {
  const size = String(config.size || "medium").replace(/_/g, " ");
  const type = String(config.buildingType || "apartments").replace(/_/g, " ");
  const mix = String(config.affordabilityMix || "affordable").replace(/_/g, " ");
  return `${size} ${mix} ${type} ${suffix}.`;
}

function sanitizeScenarioVariants(variants, baseBuilding, rootDir = process.cwd(), options = {}) {
  const list = Array.isArray(variants?.scenario_variants)
    ? variants.scenario_variants
    : Array.isArray(variants?.scenarioVariants)
      ? variants.scenarioVariants
      : Array.isArray(variants?.variants)
        ? variants.variants
        : Array.isArray(variants)
          ? variants
          : [];
  const allowedObjectives = new Set(["user_proposal", "traffic_mitigation", "jobs_optimised", "fairness_first", "green_mitigation", "balanced"]);
  const allowedTypes = new Set(["building", "mobility_corridor", "green_corridor", "opportunity_hub"]);
  const sanitized = [];

  for (const item of list.slice(0, 6)) {
    const objective = allowedObjectives.has(item.objective) ? item.objective : inferObjective(item.branchName || item.branch_name || item.name);
    const interventions = [];
    for (const rawIntervention of item.interventions || []) {
      const type = rawIntervention.type || rawIntervention.interventionType || rawIntervention.intervention_type;
      if (!allowedTypes.has(type)) continue;
      if (type === "building") {
        interventions.push(buildingInterventionFrom(baseBuilding, rawIntervention));
      } else {
        interventions.push({
          ...rawIntervention,
          type,
          location: rawIntervention.location || baseBuilding.location,
          radiusM: Number(rawIntervention.radiusM || rawIntervention.radius_m || rawIntervention.bufferRadiusM || rawIntervention.buffer_radius_m || 650),
          rationale: rawIntervention.rationale || `Tests ${type.replace(/_/g, " ")} mitigation.`
        });
      }
    }
    if (!interventions.length) interventions.push(buildingInterventionFrom(baseBuilding, {}));
    sanitized.push({
      branchName: String(item.branchName || item.branch_name || item.name || labelForObjective(objective)).slice(0, 80),
      objective,
      description: String(item.description || item.rationale || labelForObjective(objective)).slice(0, 220),
      interventions,
      assumptions: Array.isArray(item.assumptions) ? item.assumptions.slice(0, 5).map(String) : ["Generated branch uses supported deterministic interventions."]
    });
  }

  if (!sanitized.length && options.strict) {
    throw new Error("Gemini did not return any executable scenario variants.");
  }
  if (!sanitized.some((variant) => variant.objective === "user_proposal") && options.strict) {
    throw new Error("Gemini variants must include a user_proposal branch.");
  }
  if (!sanitized.some((variant) => variant.objective === "user_proposal")) {
    sanitized.unshift(generateFallbackVariants({ building: baseBuilding }, rootDir).scenarioVariants[0]);
  }
  return sanitized.length ? sanitized : generateFallbackVariants({ building: baseBuilding }, rootDir).scenarioVariants;
}

function inferObjective(value = "") {
  const name = String(value).toLowerCase();
  if (name.includes("traffic") || name.includes("mobility")) return "traffic_mitigation";
  if (name.includes("job") || name.includes("econom")) return "jobs_optimised";
  if (name.includes("fair") || name.includes("social")) return "fairness_first";
  if (name.includes("green") || name.includes("exposure")) return "green_mitigation";
  if (name.includes("balanced") || name.includes("recommend")) return "balanced";
  return "user_proposal";
}

function labelForObjective(objective) {
  return {
    user_proposal: "Original Housing Proposal",
    traffic_mitigation: "Traffic-Safe Housing",
    jobs_optimised: "Jobs-Optimised Mixed Use",
    fairness_first: "Fairness-First Housing",
    green_mitigation: "Green-Mitigation Housing",
    balanced: "Balanced Growth"
  }[objective] || "Scenario Branch";
}

function buildCoordinatorPlan(payload = {}) {
  return {
    next_steps: [
      "validate_site",
      "gather_site_context",
      "generate_scenario_variants",
      "run_simulations",
      "critique_results",
      "summarise"
    ],
    required_agents: [
      "Site Agent",
      "Mobility Agent",
      "Economy Agent",
      "Energy Agent",
      "Fairness Agent",
      "Environment Agent",
      "Critic Agent",
      "Reporter Agent"
    ],
    active_scenario: payload.active_scenario || payload.activeScenario || "Housing Growth"
  };
}

function runMultipleSimulations(input = {}, rootDir = process.cwd()) {
  return runForecastScenario(input, rootDir);
}

function firstInterventionLocation(variants) {
  for (const variant of variants || []) {
    for (const intervention of variant.interventions || []) {
      if (intervention.location) return intervention.location;
    }
  }
  return { lng: -5.93, lat: 54.597 };
}

function zeroDiff() {
  return Object.fromEntries(ALL_SIMULATION_METRICS.map((metric) => [metric, 0]));
}

function simulateVariant(variant, baseCells, contextIds, baselineMetrics, baseBuilding, rootDir) {
  const cells = cloneSimulationCells(baseCells);
  const agentNotes = [];
  for (const intervention of variant.interventions || []) {
    const type = intervention.type || intervention.interventionType || intervention.intervention_type;
    if (type === "building") {
      const building = createBuildingIntervention({
        ...baseBuilding,
        ...intervention,
        config: {
          ...baseBuilding.config,
          ...(intervention.config || {}),
          size: intervention.size || intervention.config?.size || baseBuilding.config.size,
          buildingType: intervention.buildingType || intervention.building_type || intervention.config?.buildingType || baseBuilding.config.buildingType,
          affordabilityMix: intervention.affordabilityMix || intervention.affordability_mix || intervention.config?.affordabilityMix || baseBuilding.config.affordabilityMix,
          energyStandard: intervention.energyStandard || intervention.config?.energyStandard || baseBuilding.config.energyStandard
        }
      }, rootDir);
      applyBuildingToCells(cells, building);
      agentNotes.push({
        agent: "Population Agent",
        risk: building.config.estimatedResidents > 550 ? "medium-high" : "medium",
        reason: `Adds about ${building.config.estimatedResidents} residents and ${building.config.estimatedJobs} jobs as a proxy estimate.`
      });
    } else if (type === "mobility_corridor") {
      applyMobilityCorridor(cells, intervention);
      agentNotes.push({
        agent: "Mobility Agent",
        risk: "medium",
        reason: "Transit-first corridor reduces local mobility-strain and road-pressure proxies."
      });
    } else if (type === "green_corridor") {
      applyGreenCorridor(cells, intervention);
      agentNotes.push({
        agent: "Environment Agent",
        risk: "medium",
        reason: "Green mitigation reduces environmental exposure and lifts green-score proxy."
      });
    } else if (type === "opportunity_hub") {
      applyOpportunityHub(cells, intervention);
      agentNotes.push({
        agent: "Economy Agent",
        risk: "low",
        reason: "Opportunity hub raises job access and local economic-opportunity proxies."
      });
    }
  }
  const metrics = summarizeMetrics(cells, contextIds);
  const diffFromBaseline = diffMetrics(metrics, baselineMetrics);
  const affectedCells = cellsToFeatureCollection(
    cells.filter((cell) => contextIds.has(cell.id)),
    diffFromBaseline
  );
  return {
    name: variant.branchName || variant.name,
    branchName: variant.branchName || variant.name,
    objective: variant.objective,
    description: variant.description,
    interventions: variant.interventions,
    assumptions: variant.assumptions || [],
    metrics,
    diffFromBaseline,
    affectedCells,
    agentNotes,
    score: scoreBranch({ metrics, diffFromBaseline })
  };
}

function cloneSimulationCells(cells) {
  return cells.map((cell) => ({
    ...cell,
    values: { ...cell.baseline2036 }
  }));
}

function distanceWeight(distanceM, radiusM) {
  return Math.max(0, 1 - distanceM / radiusM);
}

function applyBuildingToCells(cells, building) {
  const radiusM = 800;
  const residents = building.config.estimatedResidents;
  const jobs = building.config.estimatedJobs;
  const electricity = building.config.estimatedElectricityDemand;
  const popImpact = normalize(residents, 0, 800);
  const jobImpact = normalize(jobs, 0, 1000);
  const energyImpact = normalize(electricity, 0, 1000);
  const fairnessMultiplier = AFFORDABILITY_PRESETS[building.config.affordabilityMix]?.fairnessMultiplier || 0.8;
  const warningText = (building.validation?.warnings || []).join(" ");

  for (const cell of cells) {
    const distanceM = haversineMeters(pointFromLocation(building.location), cell.centroid);
    const w = distanceWeight(distanceM, radiusM);
    if (!w) continue;
    cell.values.populationPressure += 0.14 * popImpact * w;
    cell.values.mobilityStrain += 0.09 * popImpact * w;
    cell.values.roadPressure += 0.08 * popImpact * w;
    cell.values.electricityDemand += 0.12 * energyImpact * w;
    cell.values.economicOpportunity += 0.12 * jobImpact * w;
    cell.values.jobAccess += 0.1 * jobImpact * w;
    cell.values.servicePressure += 0.05 * popImpact * w;

    if (building.config.energyStandard === "low_energy") {
      cell.values.electricityDemand -= 0.035 * energyImpact * w;
    }

    if (building.config.buildingType === "mixed_use") {
      cell.values.economicOpportunity += 0.06 * w;
      cell.values.jobAccess += 0.045 * w;
      cell.values.servicePressure -= 0.03 * w;
    }

    if (building.config.buildingType === "community") {
      cell.values.economicOpportunity += 0.04 * w;
      cell.values.fairnessScore += 0.08 * cell.deprivationWeight * w;
      cell.values.servicePressure -= 0.04 * w;
    }

    if (building.config.buildingType === "office") {
      cell.values.economicOpportunity += 0.05 * w;
      cell.values.mobilityStrain += 0.035 * w;
    }

    cell.values.fairnessScore += 0.07 * fairnessMultiplier * Math.max(0.2, cell.deprivationWeight) * w;

    if (/green score|green space/i.test(warningText)) {
      cell.values.environmentalExposure += 0.05 * w;
      cell.values.greenScore -= 0.04 * w;
    }

    clampCellValues(cell.values);
  }
}

function applyMobilityCorridor(cells, intervention) {
  const location = intervention.location;
  const radiusM = Number(intervention.radiusM || intervention.radius_m || 700);
  for (const cell of cells) {
    const w = distanceWeight(haversineMeters(pointFromLocation(location), cell.centroid), radiusM);
    if (!w) continue;
    cell.values.mobilityStrain -= 0.075 * w;
    cell.values.roadPressure -= 0.06 * w;
    cell.values.transportAccess += 0.1 * w;
    cell.values.fairnessScore += 0.035 * Math.max(0.25, cell.deprivationWeight) * w;
    clampCellValues(cell.values);
  }
}

function applyGreenCorridor(cells, intervention) {
  const location = intervention.location;
  const radiusM = Number(intervention.bufferRadiusM || intervention.buffer_radius_m || intervention.radiusM || intervention.radius_m || 600);
  for (const cell of cells) {
    const w = distanceWeight(haversineMeters(pointFromLocation(location), cell.centroid), radiusM);
    if (!w) continue;
    cell.values.environmentalExposure -= 0.08 * w;
    cell.values.greenScore += 0.1 * w;
    cell.values.fairnessScore += 0.025 * Math.max(0.25, cell.deprivationWeight) * w;
    clampCellValues(cell.values);
  }
}

function applyOpportunityHub(cells, intervention) {
  const location = intervention.location;
  const radiusM = Number(intervention.radiusM || intervention.radius_m || 650);
  for (const cell of cells) {
    const w = distanceWeight(haversineMeters(pointFromLocation(location), cell.centroid), radiusM);
    if (!w) continue;
    cell.values.economicOpportunity += 0.085 * w;
    cell.values.jobAccess += 0.08 * w;
    cell.values.servicePressure -= 0.015 * w;
    cell.values.mobilityStrain += 0.018 * w;
    clampCellValues(cell.values);
  }
}

function clampCellValues(values) {
  for (const key of ALL_SIMULATION_METRICS) values[key] = clamp(values[key]);
  return values;
}

function summarizeMetrics(cells, contextIds = null) {
  const selected = cells.filter((cell) => !contextIds || contextIds.has(cell.id));
  const source = selected.length ? selected : cells;
  const metrics = {};
  for (const key of ALL_SIMULATION_METRICS) {
    const total = source.reduce((sum, cell) => sum + Number((cell.values || cell.baseline2036)[key] || 0), 0);
    metrics[key] = round(total / source.length);
  }
  return metrics;
}

function diffMetrics(metrics, baseline) {
  return Object.fromEntries(ALL_SIMULATION_METRICS.map((metric) => [metric, round((metrics[metric] || 0) - (baseline[metric] || 0))]));
}

function cellsToFeatureCollection(cells, diff) {
  return {
    type: "FeatureCollection",
    features: cells.map((cell) => {
      const values = cell.values || cell.baseline2036;
      const intensity = Math.max(
        Math.abs(diff.populationPressure || 0),
        Math.abs(diff.mobilityStrain || 0),
        Math.abs(diff.economicOpportunity || 0),
        Math.abs(diff.environmentalExposure || 0),
        Math.abs(diff.fairnessScore || 0),
        0.08
      );
      return {
        type: "Feature",
        id: cell.id,
        properties: {
          cell_id: cell.id,
          intensity: round(intensity),
          populationPressure: round(values.populationPressure),
          mobilityStrain: round(values.mobilityStrain),
          economicOpportunity: round(values.economicOpportunity),
          transportAccess: round(values.transportAccess),
          electricityDemand: round(values.electricityDemand),
          environmentalExposure: round(values.environmentalExposure),
          fairnessScore: round(values.fairnessScore)
        },
        geometry: cell.geometry
      };
    })
  };
}

function scoreBranch(branch) {
  const diff = branch.diffFromBaseline || {};
  return round(
    (diff.economicOpportunity || 0) * 1.2 +
      (diff.fairnessScore || 0) * 1.35 +
      (diff.transportAccess || 0) * 0.6 +
      (diff.greenScore || 0) * 0.75 -
      Math.max(0, diff.populationPressure || 0) * 0.65 -
      Math.max(0, diff.mobilityStrain || 0) * 0.9 -
      Math.max(0, diff.environmentalExposure || 0) * 1.15 -
      Math.max(0, diff.electricityDemand || 0) * 0.45,
    4
  );
}

function chooseRecommendedBranch(branches) {
  const candidates = branches.filter((branch) => branch.objective !== "baseline");
  return candidates.sort((a, b) => scoreBranch(b) - scoreBranch(a))[0] || branches[0];
}

function forecastForCellYear(cell, year) {
  if (Number(year) <= BASELINE_YEAR) return normalizeForecastMetrics(cell.baseline2025 || metricFromProps(cell.sourceProperties || {}));
  return normalizeForecastMetrics(cell.forecastByYear?.[String(year)] || cell.forecast2036 || cell.baseline2025 || {});
}

function summarizeForecastRows(rows, year, valuesByCell = null) {
  const source = rows.length ? rows : [];
  const metrics = {};
  for (const metric of FORECAST_METRICS) {
    const total = source.reduce((sum, item) => {
      const cell = item.cell || item;
      const values = valuesByCell?.get(cell.id) || forecastForCellYear(cell, year);
      return sum + Number(values[metric] || 0);
    }, 0);
    metrics[metric] = round(total / Math.max(1, source.length), 3);
  }
  return metrics;
}

function operationRamp(year, startYear = START_YEAR, horizonYear = HORIZON_YEAR) {
  if (year < startYear) return 0;
  const t = clamp((year - startYear) / Math.max(1, horizonYear - startYear));
  const smooth = t * t * (3 - 2 * t);
  return round(0.12 + smooth * 0.88, 4);
}

function plannerWeight(distanceM, radiusM) {
  const linear = distanceWeight(distanceM, radiusM);
  return linear <= 0 ? 0 : linear * linear * (3 - 2 * linear);
}

function addMetricDelta(values, metric, delta) {
  values[metric] = clamp(Number(values[metric] || 0) + delta);
}

function plannerScalars(building, siteContext = {}) {
  const config = building.config || {};
  const type = TYPE_PRESETS[config.buildingType] || TYPE_PRESETS.apartments;
  const affordability = AFFORDABILITY_PRESETS[config.affordabilityMix] || AFFORDABILITY_PRESETS.affordable;
  const residentsN = normalize(Number(config.estimatedResidents || 0), 0, 1400);
  const unitsN = normalize(Number(config.units || 0), 0, 650);
  const jobsN = normalize(Number(config.estimatedJobs || 0), 0, 1100);
  const electricityN = normalize(Number(config.estimatedElectricityDemand || 0), 0, 1200);
  const footprintN = normalize(Number(config.footprintSqm || 0) * Number(config.floors || 1), 0, 55_000);
  const transitDistance = Number(siteContext.nearbyTransport?.distanceM || 9999);
  const transitGood = transitDistance <= 500 || Number(siteContext.baselineMetrics?.transportAccess || 0) >= 0.42;
  const parkingAssumption = String(config.parkingTransitAssumption || "balanced");
  const parkingFactor = parkingAssumption === "parking_heavy" ? 1.22 : parkingAssumption === "transit_first" || transitGood ? 0.82 : 1.0;
  const energyFactor = config.energyStandard === "low_energy" || config.energyStandard === "passive" ? 0.68 : config.energyStandard === "net_zero_ready" ? 0.52 : 1.0;
  return {
    type,
    affordability,
    residentsN,
    unitsN,
    jobsN,
    electricityN,
    footprintN,
    parkingFactor,
    energyFactor,
    transitGood,
    hasGreenMitigation: Boolean(config.mitigation?.green),
    hasMobilityMitigation: Boolean(config.mitigation?.mobility),
    hasEnergyMitigation: Boolean(config.mitigation?.energy),
    validationWarningCount: building.validation?.warnings?.length || 0
  };
}

function applyBuildingPlanner(values, context, building, siteContext, year, distanceM) {
  const s = plannerScalars(building, siteContext);
  const ramp = operationRamp(year, START_YEAR, HORIZON_YEAR);
  const w = plannerWeight(distanceM, 850) * ramp;
  if (!w) return;
  const deprivation = clamp(Number(context.cell?.deprivationWeight || siteContext.deprivationWeight || 0));
  const communityShare = s.type.communityShare || 0;
  const commercialShare = s.type.commercialShare || 0;
  const residentialShare = s.type.residentialShare || 0;
  const affordabilityRatio = s.affordability.affordabilityRatio || 0;
  const fairnessMultiplier = s.affordability.fairnessMultiplier || 0.8;
  const tripLoad = (s.residentsN * 0.65 + s.jobsN * 0.45) * s.parkingFactor;
  const serviceDemand = s.residentsN * 0.055 + s.jobsN * 0.018;
  const localRevenue = s.jobsN * 0.04 + s.unitsN * 0.018 + commercialShare * 0.026;
  const infraCost = s.electricityN * 0.018 + tripLoad * 0.014 + s.validationWarningCount * 0.004;

  addMetricDelta(values, "population", 0.115 * s.residentsN * residentialShare * w);
  addMetricDelta(values, "traffic", 0.072 * tripLoad * w);
  addMetricDelta(values, "jobs", (0.105 * s.jobsN + commercialShare * 0.035 + communityShare * 0.012) * w);
  addMetricDelta(values, "economy", (0.095 * s.jobsN + 0.025 * s.unitsN + commercialShare * 0.03) * w);
  addMetricDelta(values, "housingPressure", (0.035 * s.residentsN - 0.095 * s.unitsN * (0.65 + affordabilityRatio)) * w);
  addMetricDelta(values, "services", (-serviceDemand + communityShare * 0.07 + commercialShare * 0.016) * w);
  addMetricDelta(values, "electricity", 0.108 * s.electricityN * s.energyFactor * w);
  addMetricDelta(values, "environmentAir", (0.038 * tripLoad + 0.045 * s.electricityN * s.energyFactor + 0.02 * s.footprintN) * w);
  addMetricDelta(values, "greenScore", -0.036 * s.footprintN * w);
  addMetricDelta(values, "fairness", 0.07 * fairnessMultiplier * Math.max(0.25, deprivation) * (s.unitsN + affordabilityRatio * 0.65) * w);
  addMetricDelta(values, "fiscalBalance", (localRevenue - infraCost) * w);
  addMetricDelta(values, "planningViability", (0.035 - s.validationWarningCount * 0.012 + (s.transitGood ? 0.018 : -0.01) + communityShare * 0.012) * w);

  if (s.hasEnergyMitigation || building.config.energyStandard === "net_zero_ready") {
    addMetricDelta(values, "electricity", -0.035 * s.electricityN * w);
    addMetricDelta(values, "environmentAir", -0.025 * s.electricityN * w);
    addMetricDelta(values, "planningViability", 0.012 * w);
  }
  if (s.hasGreenMitigation) {
    addMetricDelta(values, "greenScore", 0.045 * w);
    addMetricDelta(values, "environmentAir", -0.035 * w);
    addMetricDelta(values, "fairness", 0.014 * Math.max(0.25, deprivation) * w);
  }
  if (s.hasMobilityMitigation || building.config.parkingTransitAssumption === "transit_first") {
    addMetricDelta(values, "traffic", -0.035 * tripLoad * w);
    addMetricDelta(values, "environmentAir", -0.012 * tripLoad * w);
    addMetricDelta(values, "fairness", 0.018 * Math.max(0.25, deprivation) * w);
  }
}

function applyMobilityPlanner(values, context, intervention, year, distanceM) {
  const radiusM = Number(intervention.radiusM || intervention.radius_m || 700);
  const ramp = operationRamp(year, START_YEAR, HORIZON_YEAR);
  const w = plannerWeight(distanceM, radiusM) * ramp;
  if (!w) return;
  const mode = String(intervention.mode || "transit_first");
  const disruptiveRoad = mode === "car_first" || mode === "road_capacity";
  const deprivation = clamp(Number(context.cell?.deprivationWeight || 0));
  if (disruptiveRoad) {
    addMetricDelta(values, "traffic", -0.035 * w);
    addMetricDelta(values, "economy", 0.012 * w);
    addMetricDelta(values, "environmentAir", 0.032 * w);
    addMetricDelta(values, "fairness", -0.045 * Math.max(0.35, deprivation) * w);
    addMetricDelta(values, "planningViability", -0.025 * w);
    return;
  }
  addMetricDelta(values, "traffic", -0.082 * w);
  addMetricDelta(values, "environmentAir", -0.03 * w);
  addMetricDelta(values, "services", 0.014 * w);
  addMetricDelta(values, "fairness", 0.04 * Math.max(0.25, deprivation) * w);
  addMetricDelta(values, "planningViability", 0.026 * w);
  addMetricDelta(values, "fiscalBalance", -0.006 * w);
}

function applyGreenPlanner(values, context, intervention, year, distanceM) {
  const radiusM = Number(intervention.bufferRadiusM || intervention.buffer_radius_m || intervention.radiusM || intervention.radius_m || 600);
  const ramp = operationRamp(year, START_YEAR, HORIZON_YEAR);
  const w = plannerWeight(distanceM, radiusM) * ramp;
  if (!w) return;
  const deprivation = clamp(Number(context.cell?.deprivationWeight || 0));
  addMetricDelta(values, "greenScore", 0.092 * w);
  addMetricDelta(values, "environmentAir", -0.071 * w);
  addMetricDelta(values, "fairness", 0.026 * Math.max(0.25, deprivation) * w);
  addMetricDelta(values, "planningViability", 0.022 * w);
  addMetricDelta(values, "fiscalBalance", -0.004 * w);
}

function applyOpportunityPlanner(values, context, intervention, year, distanceM) {
  const radiusM = Number(intervention.radiusM || intervention.radius_m || 650);
  const ramp = operationRamp(year, START_YEAR, HORIZON_YEAR);
  const w = plannerWeight(distanceM, radiusM) * ramp;
  if (!w) return;
  const deprivation = clamp(Number(context.cell?.deprivationWeight || 0));
  addMetricDelta(values, "jobs", 0.075 * w);
  addMetricDelta(values, "economy", 0.079 * w);
  addMetricDelta(values, "services", 0.022 * w);
  addMetricDelta(values, "fiscalBalance", 0.041 * w);
  addMetricDelta(values, "fairness", 0.028 * Math.max(0.25, deprivation) * w);
  addMetricDelta(values, "traffic", 0.012 * w);
}

function applyForecastInterventions(contextRows, variant, baseBuilding, siteContext, year, rootDir) {
  const valuesByCell = new Map();
  for (const item of contextRows) {
    valuesByCell.set(item.cell.id, { ...forecastForCellYear(item.cell, year) });
  }
  for (const intervention of variant.interventions || []) {
    const type = intervention.type || intervention.interventionType || intervention.intervention_type;
    const location = intervention.location || baseBuilding.location;
    for (const item of contextRows) {
      const distanceM = haversineMeters(pointFromLocation(location), item.cell.centroid);
      const values = valuesByCell.get(item.cell.id);
      if (type === "building") {
        const building = createBuildingIntervention({
          ...baseBuilding,
          ...intervention,
          location: intervention.location || baseBuilding.location,
          geometry: intervention.geometry || baseBuilding.geometry,
          postcode: baseBuilding.postcode,
          resolvedPostcode: baseBuilding.resolvedPostcode,
          config: {
            ...baseBuilding.config,
            ...(intervention.config || {}),
            size: intervention.size || intervention.config?.size || baseBuilding.config.size,
            buildingType: intervention.buildingType || intervention.building_type || intervention.config?.buildingType || baseBuilding.config.buildingType,
            affordabilityMix: intervention.affordabilityMix || intervention.affordability_mix || intervention.config?.affordabilityMix || baseBuilding.config.affordabilityMix,
            energyStandard: intervention.energyStandard || intervention.config?.energyStandard || baseBuilding.config.energyStandard,
            parkingTransitAssumption: intervention.parkingTransitAssumption || intervention.config?.parkingTransitAssumption || baseBuilding.config.parkingTransitAssumption,
            mitigation: {
              ...(baseBuilding.config.mitigation || {}),
              ...(intervention.config?.mitigation || {})
            }
          }
        }, rootDir);
        applyBuildingPlanner(values, item, building, siteContext, year, distanceM);
      } else if (type === "mobility_corridor") {
        applyMobilityPlanner(values, item, intervention, year, distanceM);
      } else if (type === "green_corridor") {
        applyGreenPlanner(values, item, intervention, year, distanceM);
      } else if (type === "opportunity_hub") {
        applyOpportunityPlanner(values, item, intervention, year, distanceM);
      } else if (type === "road" || type === "road_corridor") {
        applyMobilityPlanner(values, item, { ...intervention, mode: intervention.mode || "road_capacity" }, year, distanceM);
      }
      valuesByCell.set(item.cell.id, normalizeForecastMetrics(values));
    }
  }
  return valuesByCell;
}

function forecastCellsToFeatureCollection(contextRows, year, valuesByCell = null, baselineByCell = null, branchName = "No-Build Forecast") {
  return {
    type: "FeatureCollection",
    features: contextRows.map((item) => {
      const cell = item.cell || item;
      const values = normalizeForecastMetrics(valuesByCell?.get(cell.id) || forecastForCellYear(cell, year));
      const baseline = normalizeForecastMetrics(baselineByCell?.get(cell.id) || forecastForCellYear(cell, year));
      const diff = diffForecastMetrics(values, baseline);
      const intensity = Math.max(...FORECAST_METRICS.map((metric) => Math.abs(diff[metric] || 0)), 0.035);
      return {
        type: "Feature",
        id: `${cell.id}-${year}-${branchName}`.replace(/\s+/g, "-").toLowerCase(),
        properties: {
          cell_id: cell.id,
          year,
          branch: branchName,
          distanceM: Math.round(item.distanceM || 0),
          intensity: round(intensity, 3),
          confidence: cell.confidence || "medium",
          evidence: cell.evidence || [],
          ...values,
          deltas: diff
        },
        geometry: cell.geometry
      };
    })
  };
}

function scoreForecastBranch(branch) {
  const diff = branch.diffFromBaseline || {};
  return round(
    (diff.jobs || 0) * 0.95 +
      (diff.economy || 0) * 1.15 +
      (diff.fairness || 0) * 1.35 +
      (diff.greenScore || 0) * 0.8 +
      (diff.fiscalBalance || 0) * 0.75 +
      (diff.planningViability || 0) * 1.0 -
      Math.max(0, diff.traffic || 0) * 1.05 -
      Math.max(0, diff.electricity || 0) * 0.65 -
      Math.max(0, diff.environmentAir || 0) * 1.1 -
      Math.max(0, diff.housingPressure || 0) * 0.45,
    4
  );
}

function branchAgentNotes(variant, building, siteContext) {
  const config = building.config || {};
  const notes = [
    {
      agent: "Population Agent",
      risk: config.estimatedResidents > 650 ? "medium-high" : "medium",
      reason: `Uses ${config.units} units and ${config.estimatedResidents} residents as deterministic demand inputs.`
    },
    {
      agent: "Mobility Agent",
      risk: siteContext.baselineMetrics?.mobilityStrain > 0.55 ? "medium-high" : "medium",
      reason: "Trips, transit access, induced demand and corridor stress are applied through planner weights."
    },
    {
      agent: "Economy Agent",
      risk: "medium",
      reason: "Jobs, activity uplift, infrastructure cost and annual balance are normalized proxy indices."
    },
    {
      agent: "Energy Agent",
      risk: config.estimatedElectricityDemand > 700 ? "medium-high" : "medium",
      reason: "Electricity is demand-side load pressure; it does not assert available capacity."
    },
    {
      agent: "Fairness Agent",
      risk: config.affordabilityMix === "market" ? "medium-high" : "medium",
      reason: "Equity weights combine deprivation, affordability, access and retention-risk proxies."
    }
  ];
  if ((variant.interventions || []).some((item) => (item.type || item.interventionType) === "green_corridor")) {
    notes.push({ agent: "Environment Agent", risk: "medium", reason: "Green mitigation offsets exposure and green-score loss deterministically." });
  }
  return notes;
}

function simulateForecastVariant(variant, contextRows, baselineTimeline, baseBuilding, siteContext, rootDir) {
  const timelineByYear = {};
  const affectedCellsByYear = {};
  const baselineByYearCell = {};
  for (const year of FORECAST_YEARS) {
    baselineByYearCell[year] = new Map(contextRows.map((item) => [item.cell.id, forecastForCellYear(item.cell, year)]));
    const valuesByCell = applyForecastInterventions(contextRows, variant, baseBuilding, siteContext, year, rootDir);
    const metrics = summarizeForecastRows(contextRows, year, valuesByCell);
    const baselineMetrics = baselineTimeline[String(year)].metrics;
    const diffFromBaseline = diffForecastMetrics(metrics, baselineMetrics);
    timelineByYear[String(year)] = {
      year,
      metrics,
      diffFromBaseline,
      confidence: confidenceForBranch(diffFromBaseline, baseBuilding.validation)
    };
    affectedCellsByYear[String(year)] = forecastCellsToFeatureCollection(contextRows, year, valuesByCell, baselineByYearCell[year], variant.branchName || variant.name);
  }
  const horizon = timelineByYear[String(HORIZON_YEAR)];
  const branch = {
    name: variant.branchName || variant.name,
    branchName: variant.branchName || variant.name,
    objective: variant.objective,
    description: variant.description,
    interventions: variant.interventions,
    assumptions: variant.assumptions || [],
    metrics: horizon.metrics,
    diffFromBaseline: horizon.diffFromBaseline,
    timelineByYear,
    affectedCellsByYear,
    affectedCells: affectedCellsByYear[String(HORIZON_YEAR)],
    agentNotes: branchAgentNotes(variant, baseBuilding, siteContext),
    confidence: horizon.confidence,
    evidence: evidenceForScenarioBranch(variant, baseBuilding),
    score: scoreForecastBranch(horizon)
  };
  return branch;
}

function confidenceForBranch(diff, validation = {}) {
  const pressure = Math.max(
    Math.abs(diff.traffic || 0),
    Math.abs(diff.electricity || 0),
    Math.abs(diff.environmentAir || 0),
    Math.abs(diff.housingPressure || 0)
  );
  if (validation.status === "warning" || pressure > 0.08) return "medium";
  if (pressure > 0.04) return "medium-high";
  return "high";
}

function evidenceForScenarioBranch(variant, building) {
  const evidence = [
    "Trained 2025-baseline forecast artifact",
    "Runtime deterministic planners in lib/scenario-studio.js",
    "2026-2036 annual ramp from user intervention year"
  ];
  for (const intervention of variant.interventions || []) {
    const type = intervention.type || intervention.interventionType;
    if (type === "building") evidence.push(`${building.config.size} ${building.config.buildingType} building planner`);
    if (type === "mobility_corridor") evidence.push("Mobility planner: trips, transit access, induced demand, corridor stress and severance penalty");
    if (type === "green_corridor") evidence.push("Energy/environment planner: exposure, green mitigation and flood/water context");
    if (type === "opportunity_hub") evidence.push("Economy/fiscal planner: jobs, activity uplift, infrastructure cost and net balance");
  }
  return [...new Set(evidence)];
}

function baselineForecastBranch(contextRows) {
  const timelineByYear = {};
  const affectedCellsByYear = {};
  for (const year of FORECAST_YEARS) {
    const metrics = summarizeForecastRows(contextRows, year);
    timelineByYear[String(year)] = {
      year,
      metrics,
      diffFromBaseline: zeroForecastDiff(),
      confidence: "medium-high"
    };
    affectedCellsByYear[String(year)] = forecastCellsToFeatureCollection(contextRows, year, null, null, "No-Build Forecast");
  }
  const horizon = timelineByYear[String(HORIZON_YEAR)];
  return {
    name: "2025 Baseline / No-Build Forecast",
    branchName: "2025 Baseline / No-Build Forecast",
    objective: "baseline",
    description: "No-build forecast from the 2025 baseline through 2036.",
    interventions: [],
    assumptions: ["No new building intervention is applied.", "Forecast starts from 2025 Mode A local grid state."],
    metrics: horizon.metrics,
    diffFromBaseline: zeroForecastDiff(),
    timelineByYear,
    affectedCellsByYear,
    affectedCells: affectedCellsByYear[String(HORIZON_YEAR)],
    agentNotes: [],
    confidence: horizon.confidence,
    evidence: ["baseline_2025_forecast.json", "forecast_model.json"],
    score: 0
  };
}

function createTimelineByYear(baselineBranch, scenarioBranches) {
  const timeline = {};
  for (const year of FORECAST_YEARS) {
    timeline[String(year)] = {
      year,
      baseline: baselineBranch.timelineByYear[String(year)].metrics,
      branches: scenarioBranches.map((branch) => ({
        name: branch.name,
        objective: branch.objective,
        metrics: branch.timelineByYear[String(year)].metrics,
        diffFromBaseline: branch.timelineByYear[String(year)].diffFromBaseline,
        confidence: branch.timelineByYear[String(year)].confidence,
        score: scoreForecastBranch(branch.timelineByYear[String(year)])
      }))
    };
  }
  return timeline;
}

function runForecastScenario(input = {}, rootDir = process.cwd()) {
  const baselineYear = Number(input.baselineYear || input.baseline_year || BASELINE_YEAR);
  const startYear = Number(input.startYear || input.start_year || START_YEAR);
  const horizonYear = Number(input.horizonYear || input.horizon_year || HORIZON_YEAR);
  if (baselineYear !== BASELINE_YEAR || startYear !== START_YEAR || horizonYear !== HORIZON_YEAR) {
    const error = new Error(`Scenario Studio currently supports baseline ${BASELINE_YEAR} and forecast ${START_YEAR}-${HORIZON_YEAR}.`);
    error.statusCode = 400;
    throw error;
  }
  const postcodeValue = input.postcode || input.building?.postcode || input.resolvedPostcode?.postcode;
  const resolvedPostcode = input.resolvedPostcode || input.postcodeResolution || resolvePostcode(postcodeValue, rootDir);
  if (!resolvedPostcode.canPlace) {
    const error = new Error(resolvedPostcode.warnings?.[0] || "A full Belfast postcode is required before placing a building.");
    error.statusCode = 422;
    error.postcode = resolvedPostcode;
    throw error;
  }
  const buildingPayload = {
    ...(input.building || {}),
    postcode: resolvedPostcode.postcode,
    resolvedPostcode,
    location: input.building?.location || resolvedPostcode.location,
    startYear,
    completionYear: horizonYear,
    requireResolvedPostcode: true
  };
  const building = createBuildingIntervention(buildingPayload, rootDir);
  const validation = validatePlacement({
    location: building.location,
    geometry: building.geometry,
    config: building.config,
    postcode: resolvedPostcode.postcode,
    resolvedPostcode,
    requireResolvedPostcode: true
  }, rootDir);
  building.validation = {
    status: validation.status,
    warnings: validation.warnings || [],
    confidence: validation.confidence === "medium-high" ? "high" : validation.confidence || "medium"
  };
  if (validation.status === "invalid") {
    const error = new Error(validation.warnings?.[0] || "Placement is invalid.");
    error.statusCode = 422;
    error.validation = validation;
    error.postcode = resolvedPostcode;
    throw error;
  }
  const siteContext = input.siteContext || getSiteContext({ location: building.location, geometry: building.geometry, config: building.config, validation }, rootDir);
  const variants = sanitizeScenarioVariants(input.branches || input.variants || generateFallbackVariants({ building, siteContext }, rootDir), building, rootDir, { strict: false });
  const cells = cityCells(rootDir);
  let contextRows = getCellsWithin(cells, building.location, Number(input.radiusM || input.radius_m || 950));
  if (!contextRows.length) {
    const nearest = findNearestCell(cells, building.location);
    if (nearest) contextRows = [{ cell: nearest, distanceM: 0 }];
  }
  const baselineBranch = baselineForecastBranch(contextRows);
  const scenarioBranches = variants.map((variant) => simulateForecastVariant(variant, contextRows, baselineBranch.timelineByYear, building, siteContext, rootDir));
  const recommendedBranch = scenarioBranches.sort((a, b) => b.score - a.score)[0] || scenarioBranches[0];
  for (const branch of scenarioBranches) branch.recommended = branch.name === recommendedBranch?.name;
  const timelineByYear = createTimelineByYear(baselineBranch, scenarioBranches);
  const affectedCellsByYear = recommendedBranch?.affectedCellsByYear || baselineBranch.affectedCellsByYear;
  const artifacts = loadForecastArtifacts(rootDir);
  const warnings = [
    ...(resolvedPostcode.warnings || []).filter((warning) => !/full postcode/i.test(warning)),
    ...(validation.warnings || []),
    "Forecast values are proxy planning estimates, not engineering guarantees."
  ];
  const allBranches = [baselineBranch, ...scenarioBranches];
  return {
    ok: true,
    scenarioId: input.scenarioId || input.scenario_id || "housing_growth",
    generatedAt: new Date().toISOString(),
    baselineYear: BASELINE_YEAR,
    startYear: START_YEAR,
    horizonYear: HORIZON_YEAR,
    modelVersion: artifacts.model?.modelVersion || MODEL_VERSION_FALLBACK,
    postcode: resolvedPostcode,
    building,
    validation,
    siteContext,
    baselineBranch,
    scenarioBranches,
    timelineByYear,
    affectedCellsByYear,
    affectedCellsByYearByBranch: Object.fromEntries(allBranches.map((branch) => [branch.name, branch.affectedCellsByYear])),
    recommendedBranch: recommendedBranch?.name || baselineBranch.name,
    branches: allBranches,
    baselineMetrics: baselineBranch.metrics,
    contextCellIds: contextRows.map((item) => item.cell.id),
    context: {
      location: building.location,
      radiusM: Number(input.radiusM || input.radius_m || 950),
      cells: contextRows.length
    },
    agentTrace: deterministicAgentTrace({ building, siteContext, scenarioBranches, recommendedBranch }),
    evidence: [
      "web/data/mode-a/forecast_model.json",
      "web/data/mode-a/baseline_2025_forecast.json",
      ...(artifacts.baseline?.evidence || [])
    ],
    warnings,
    simulation: {
      scenarioId: input.scenarioId || input.scenario_id || "housing_growth",
      generatedAt: new Date().toISOString(),
      baselineMetrics: baselineBranch.metrics,
      branches: allBranches,
      recommendedBranch: recommendedBranch?.name || baselineBranch.name,
      timelineByYear,
      contextCellIds: contextRows.map((item) => item.cell.id),
      context: {
        location: building.location,
        radiusM: Number(input.radiusM || input.radius_m || 950),
        cells: contextRows.length
      }
    }
  };
}

function deterministicAgentTrace({ building, siteContext, scenarioBranches, recommendedBranch }) {
  return [
    { agent: "Coordinator", status: "complete", summary: "Validated postcode-first scenario workflow and sent branch proposals to deterministic planners." },
    { agent: "Site/Zoning", status: building.validation?.status || "warning", summary: `${siteContext.validation?.siteLabel || "Site checked"} near ${building.postcode}.` },
    { agent: "Population", status: "complete", summary: `${building.config.units} units and ${building.config.estimatedResidents} residents are applied through annual ramping.` },
    { agent: "Mobility", status: "complete", summary: "Trips, transit access, induced demand, corridor stress and severance penalties are deterministic." },
    { agent: "Economy", status: "complete", summary: "Jobs, activity, tax/revenue uplift, infrastructure cost and annual balance are proxy indices." },
    { agent: "Energy", status: "complete", summary: "Electricity demand is demand-side only; capacity is not asserted." },
    { agent: "Environment", status: "complete", summary: "Air exposure, green loss/mitigation and water proximity are applied as normalized indices." },
    { agent: "Fairness", status: "complete", summary: "Deprivation, affordability, access and retention-risk weights shape fairness outcomes." },
    { agent: "Critic", status: "complete", summary: "Unsupported exact congestion, grid-capacity and fiscal claims are rejected." },
    { agent: "Reporter", status: "complete", summary: `${recommendedBranch?.name || scenarioBranches[0]?.name || "A scenario branch"} is the strongest deterministic branch by score.` }
  ];
}

function buildSpecialistRecommendations(input = {}) {
  const building = input.building;
  const siteContext = input.siteContext || {};
  const baseline = siteContext.baselineMetrics || {};
  const config = building?.config || {};
  const residents = Number(config.estimatedResidents || 0);
  const electricity = Number(config.estimatedElectricityDemand || 0);
  const marketRate = config.affordabilityMix === "market";
  return [
    {
      agent: "Mobility Agent",
      risk: baseline.mobilityStrain > 0.55 || residents > 350 ? "medium" : "low",
      reason: baseline.mobilityStrain > 0.55
        ? "The selected site is near cells already showing mobility strain."
        : "The building adds trips, but the local mobility proxy is not already extreme.",
      recommended_variant: {
        add_mobility_corridor: true,
        mode: "transit_first",
        radius_m: 700
      }
    },
    {
      agent: "Economy Agent",
      risk: "low",
      opportunity: config.buildingType === "office" || config.buildingType === "mixed_use" ? "high" : "medium",
      reason: "Mixed-use or opportunity-hub branches can improve job-access without moving the building.",
      recommended_variant: {
        buildingType: "mixed_use",
        commercialShare: 0.25,
        communityShare: 0.1
      }
    },
    {
      agent: "Energy Agent",
      risk: electricity > 750 ? "medium-high" : electricity > 350 ? "medium" : "low",
      reason: "Electricity is a demand-side estimate only; local grid capacity is not asserted.",
      recommended_variant: {
        energyStandard: "low_energy",
        solarOrStorageAssumption: true
      }
    },
    {
      agent: "Fairness Agent",
      risk: marketRate ? "medium" : "low",
      reason: marketRate
        ? "Market-rate housing has limited fairness uplift in the deprivation-weighted proxy."
        : "Affordable or social mix improves benefit for higher-need cells.",
      recommended_variant: {
        affordabilityMix: "social",
        connectToOpportunityHub: true
      }
    },
    {
      agent: "Environment Agent",
      risk: siteContext.validation?.warnings?.some((warning) => /green|flood|environmental/i.test(warning)) ? "medium" : "low",
      reason: "Green mitigation is useful when exposure or green-space warnings appear.",
      recommended_variant: {
        addGreenCorridor: true,
        bufferRadiusM: 600
      }
    }
  ];
}

function critiqueSimulation(input = {}) {
  const branches = input.branches || [];
  const siteContext = input.siteContext || {};
  const recommended = input.recommendedBranch || chooseRecommendedBranch(branches)?.name || "Balanced Growth";
  const userBranch = branches.find((branch) => branch.objective === "user_proposal") || branches[1];
  const warnings = [
    "Traffic effect is a mobility-strain proxy, not an exact congestion forecast.",
    "Electricity effect is a demand-side estimate only.",
    "Fairness depends on deprivation weighting and affordability assumptions."
  ];
  if (siteContext.validation?.warnings?.length) warnings.unshift(...siteContext.validation.warnings.slice(0, 3));
  const diff = userBranch?.diffFromBaseline || {};
  const humanReviewRequired = Boolean(
    siteContext.validation?.status === "warning" ||
      (diff.populationPressure ?? diff.population ?? 0) > 0.04 ||
      (diff.environmentalExposure ?? diff.environmentAir ?? 0) > 0.012 ||
      (diff.electricityDemand ?? diff.electricity ?? 0) > 0.025 ||
      (diff.fairnessScore ?? diff.fairness ?? 0) < 0
  );
  return {
    confidenceLabel: siteContext.validation?.confidence || "medium",
    confidence_label: siteContext.validation?.confidence || "medium",
    humanReviewRequired,
    human_review_required: humanReviewRequired,
    best_branch: recommended,
    recommendedBranch: recommended,
    rejected_claims: [
      "Do not claim exact congestion reduction.",
      "Do not claim exact electricity capacity availability."
    ],
    unsupportedClaims: [
      "Exact congestion reduction is not supported by this proxy model.",
      "Electricity capacity availability is not validated by this demand-side estimate."
    ],
    warnings,
    recommendations: [
      "Pair larger residential proposals with transit-first mobility mitigation.",
      "Use affordable or social mix to improve fairness outcomes.",
      "Add green mitigation when exposure or green-score warnings appear."
    ],
    human_review_reason: humanReviewRequired
      ? "Planner Review Gate triggered by growth pressure, site warnings, or infrastructure demand."
      : "No major review trigger was detected by the proxy thresholds."
  };
}

function reportSimulation(input = {}) {
  const branches = input.branches || [];
  const critic = input.criticNotes || input.critic || {};
  const recommendedName = critic.recommendedBranch || critic.best_branch || chooseRecommendedBranch(branches)?.name || "Balanced Growth";
  const recommended = branches.find((branch) => branch.name === recommendedName) || branches.find((branch) => branch.recommended) || branches[1];
  const userBranch = branches.find((branch) => branch.objective === "user_proposal") || branches[1];
  const diff = recommended?.diffFromBaseline || {};
  const userDiff = userBranch?.diffFromBaseline || {};
  const headline = `${recommendedName} is the strongest branch`;
  const popDelta = userDiff.populationPressure ?? userDiff.population ?? 0;
  const mobilityDelta = diff.mobilityStrain ?? diff.traffic ?? 0;
  const userMobilityDelta = userDiff.mobilityStrain ?? userDiff.traffic ?? 0;
  const summary = `The original proposal changes the population proxy ${formatDelta(popDelta)} against the no-build forecast. ${recommendedName} keeps the proposal testable while balancing mobility, fairness, and environmental exposure. Planner review is ${critic.humanReviewRequired || critic.human_review_required ? "recommended" : "not automatically required"} because these are proxy estimates, not engineering guarantees.`;
  return {
    headline,
    summary,
    city_commits: [
      `+ Added ${describeBuildingFromBranch(userBranch)} near the selected Belfast site`,
      `+ Compared ${Math.max(0, branches.length - 1)} scenario branches against the 2025-baseline no-build forecast`,
      `${mobilityDelta <= userMobilityDelta ? "+" : "!"} Tested mobility mitigation for corridor strain`,
      `${critic.humanReviewRequired || critic.human_review_required ? "!" : "+"} Planner Review Gate ${critic.humanReviewRequired || critic.human_review_required ? "recommended" : "not triggered"}`
    ],
    recommendations: critic.recommendations || [],
    warnings: critic.warnings || []
  };
}

function describeBuildingFromBranch(branch) {
  const intervention = branch?.interventions?.find((item) => (item.type || item.interventionType) === "building");
  const config = deriveBuildingStats(intervention?.config || {});
  return `${config.size} ${config.affordabilityMix} ${config.buildingType.replace(/_/g, " ")}`;
}

function formatDelta(value) {
  const rounded = Math.round((value || 0) * 100);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

function parseBuildingIntentFallback(prompt = "") {
  const text = String(prompt).toLowerCase();
  const size = text.includes("large") ? "large" : text.includes("small") ? "small" : "medium";
  const buildingType = text.includes("mixed") ? "mixed_use" : text.includes("office") ? "office" : text.includes("community") ? "community" : "apartments";
  const affordabilityMix = text.includes("social")
    ? "social"
    : text.includes("student")
      ? "student"
      : text.includes("market")
        ? "market"
        : text.includes("affordable")
          ? "affordable"
          : "affordable";
  const place = Object.keys(BELFAST_PLACES).find((name) => text.includes(name));
  return {
    type: "building",
    location_name: place ? titleCase(place) : "Selected Belfast site",
    location: place ? BELFAST_PLACES[place] : null,
    size,
    buildingType,
    affordabilityMix
  };
}

function titleCase(value) {
  return String(value).replace(/\b\w/g, (match) => match.toUpperCase());
}

module.exports = {
  BASELINE_YEAR,
  START_YEAR,
  HORIZON_YEAR,
  FORECAST_METRICS,
  SIZE_PRESETS,
  TYPE_PRESETS,
  AFFORDABILITY_PRESETS,
  HEADLINE_METRICS,
  ALL_SIMULATION_METRICS,
  buildCoordinatorPlan,
  buildSquareFootprint,
  buildSpecialistRecommendations,
  canonicalAffordability,
  canonicalBuildingType,
  cityCells,
  clamp,
  critiqueSimulation,
  deriveBuildingStats,
  distanceWeight,
  generateFallbackVariants,
  getSiteContext,
  loadForecastArtifacts,
  normalizeBuildingConfig,
  normalizePostcode,
  parseBuildingIntentFallback,
  reportSimulation,
  resolvePostcode,
  runForecastScenario,
  runMultipleSimulations,
  sanitizeScenarioVariants,
  validatePlacement,
  createBuildingIntervention
};
