const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MODE_A = path.join(ROOT, "web", "data", "mode-a");
const START_YEAR = 2026;
const HORIZON_YEAR = 2036;
const BASELINE_YEAR = 2025;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
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
  return Math.max(1, 111320 * Math.cos((Number(lat) * Math.PI) / 180));
}

function offsetCoord(coord, eastM, northM) {
  const lng = Number(coord[0]);
  const lat = Number(coord[1]);
  return [
    roundCoord(lng + Number(eastM || 0) / metersPerLng(lat)),
    roundCoord(lat + Number(northM || 0) / 111320)
  ];
}

function distanceKm(a, b) {
  const lat = (Number(a[1]) + Number(b[1])) / 2;
  const dx = (Number(a[0]) - Number(b[0])) * metersPerLng(lat);
  const dy = (Number(a[1]) - Number(b[1])) * 111320;
  return Math.hypot(dx, dy) / 1000;
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

function getMetric(row, metric) {
  return Number(row && row[metric]) || 0;
}

function summarizeHistoricalGrowth(summary) {
  const metricsByYear = summary.metricsByYear || {};
  const years = Object.keys(metricsByYear)
    .map((year) => Number(year))
    .filter((year) => year >= 2016 && year <= 2025)
    .sort((a, b) => a - b);
  const metricIds = ["traffic", "jobs", "electricity", "buildings", "services"];
  const result = {};
  for (const metric of metricIds) {
    const series = years
      .map((year) => {
        const row = (metricsByYear[String(year)] || []).find((item) => item.metric === metric);
        return row ? Number(row.value) : null;
      })
      .filter((value) => Number.isFinite(value));
    if (series.length < 2) continue;
    const deltas = [];
    for (let i = 1; i < series.length; i += 1) deltas.push(series[i] - series[i - 1]);
    const longRun = (series[series.length - 1] - series[0]) / Math.max(1, series.length - 1);
    const recent = deltas.slice(-3).reduce((sum, value) => sum + value, 0) / Math.max(1, Math.min(3, deltas.length));
    const blended = longRun * 0.45 + recent * 0.55;
    result[metric] = {
      from2016: round(series[0], 4),
      to2025: round(series[series.length - 1], 4),
      averageYearlyGrowth: round(longRun, 4),
      recentYearlyGrowth: round(recent, 4),
      blendedYearlyGrowth: round(blended, 4),
      projected2036Index: round(clamp(series[series.length - 1] + blended * (HORIZON_YEAR - BASELINE_YEAR), 0, 1.25), 4)
    };
  }
  return result;
}

function cellRows(baseline) {
  return (baseline.cells || []).map((cell) => {
    const base = cell.baseline2025 || {};
    const future = (cell.forecastByYear || {})[String(HORIZON_YEAR)] || {};
    const coord = Array.isArray(cell.centroid) ? cell.centroid.map(Number) : null;
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
      row: cell.row,
      col: cell.col,
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
  }).filter((row) => row.coord);
}

function buildingPresetForCell(row, index) {
  const jobsDelta = row.deltas.jobs || 0;
  const housingDelta = row.deltas.housingPressure || 0;
  const populationDelta = row.deltas.population || 0;
  if (jobsDelta > 0.042 && index % 4 === 0) return "commercial";
  if (jobsDelta > 0.035 && populationDelta > 0.18) return "mixed_use";
  if (housingDelta > 0.18 || populationDelta > 0.22) return "residential";
  return index % 3 === 0 ? "mixed_use" : "residential";
}

function buildingConfig(preset, pressure) {
  if (preset === "commercial") {
    return {
      size: "medium",
      buildingType: "office",
      affordabilityMix: "market",
      floors: pressure > 0.18 ? 12 : 9,
      footprintSqm: pressure > 0.18 ? 2300 : 1700,
      energyStandard: "net_zero_ready",
      parkingTransitAssumption: "transit_first",
      mitigation: { green: false, mobility: true, energy: true }
    };
  }
  if (preset === "mixed_use") {
    return {
      size: "medium",
      buildingType: "mixed_use",
      affordabilityMix: "affordable",
      floors: pressure > 0.2 ? 11 : 8,
      footprintSqm: pressure > 0.2 ? 2100 : 1500,
      energyStandard: "net_zero_ready",
      parkingTransitAssumption: "transit_first",
      mitigation: { green: true, mobility: true, energy: true }
    };
  }
  return {
    size: "medium",
    buildingType: "apartments",
    affordabilityMix: "affordable",
    floors: pressure > 0.22 ? 10 : 7,
    footprintSqm: pressure > 0.22 ? 1800 : 1350,
    energyStandard: "net_zero_ready",
    parkingTransitAssumption: "transit_first",
    mitigation: { green: true, mobility: true, energy: true }
  };
}

function createBuildings(rows) {
  const ranked = rows.slice().sort((a, b) => b.growthPressure - a.growthPressure);
  const picked = uniqueByDistance(ranked, 0.9, 24);
  return picked.map((row, index) => {
    const preset = buildingPresetForCell(row, index);
    const config = buildingConfig(preset, row.growthPressure);
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
      buildingConfig: config,
      color,
      label,
      height: preset === "commercial" ? 66 : preset === "mixed_use" ? 48 : 34,
      trendBaseline: {
        sourceCellId: row.cellId,
        reason: "High population, housing, traffic and electricity growth pressure if current trend continues.",
        growthPressure: round(row.growthPressure, 4),
        delta2036: {
          population: round(row.deltas.population, 4),
          traffic: round(row.deltas.traffic, 4),
          housingPressure: round(row.deltas.housingPressure, 4),
          electricity: round(row.deltas.electricity, 4)
        }
      }
    };
  });
}

function createTransformers(rows, capacityForecast) {
  const byId = new Map(rows.map((row) => [row.cellId, row]));
  const ranked = (capacityForecast.cells || []).map((cell) => {
    const row = byId.get(cell.cellId);
    const target = (cell.forecastByYear || {})[String(HORIZON_YEAR)] || {};
    const risk = Number(target.overloadRisk) || 0;
    const headroom = Number(target.headroomKwProxy) || 0;
    const pressure = risk * 0.72 + Math.max(0, -headroom) / 3500 + (row ? row.electricityPressure * 0.22 : 0);
    return { cellId: cell.cellId, row, target, pressure };
  }).filter((item) => item.row && item.row.coord);
  ranked.sort((a, b) => b.pressure - a.pressure);
  const picked = uniqueByDistance(ranked.map((item) => ({ ...item, coord: item.row.coord })), 1.2, 10);
  return picked.map((item, index) => {
    const coord = offsetCoord(item.row.coord, (index % 2 ? 90 : -90), (index % 3 - 1) * 80);
    const risk = Number(item.target.overloadRisk) || 0;
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
        sourceCellId: item.cellId,
        reason: "Transformer pressure rises as peak demand outpaces local headroom in the current trend forecast.",
        overloadRisk2036: round(risk, 4),
        headroomKwProxy2036: round(Number(item.target.headroomKwProxy) || 0, 1),
        peakKwProxy2036: round(Number(item.target.peakKwProxy) || 0, 1)
      }
    };
  });
}

function createRoads(rows) {
  const ranked = rows.slice().sort((a, b) => b.trafficPressure - a.trafficPressure);
  const picked = uniqueByDistance(ranked, 1.1, 9);
  return picked.map((row, index) => {
    const angle = index % 2 === 0 ? 1 : -1;
    const scale = row.trafficPressure > 0.5 ? 720 : 560;
    const path = [
      offsetCoord(row.coord, -scale, -180 * angle),
      offsetCoord(row.coord, -scale * 0.28, -65 * angle),
      offsetCoord(row.coord, scale * 0.28, 70 * angle),
      offsetCoord(row.coord, scale, 190 * angle)
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
        reason: "Traffic pressure keeps rising in this corridor under the 2016-2025 growth pattern.",
        trafficPressure: round(row.trafficPressure, 4),
        trafficDelta2036: round(row.deltas.traffic, 4)
      }
    };
  });
}

function createSupportSpaces(rows) {
  const ranked = rows.slice().sort((a, b) => (b.greenLossPressure + b.servicePressure) - (a.greenLossPressure + a.servicePressure));
  const picked = uniqueByDistance(ranked, 1.3, 7);
  return picked.map((row, index) => {
    const coord = offsetCoord(row.coord, (index % 2 ? -130 : 130), (index % 3 - 1) * 95);
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
        reason: "Green/service support is added where growth otherwise increases service pressure and reduces green score.",
        servicePressure: round(row.servicePressure, 4),
        greenLossPressure: round(row.greenLossPressure, 4)
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

function main() {
  const baseline = readJson(path.join(MODE_A, "baseline_2025_forecast.json"));
  const summary = readJson(path.join(MODE_A, "summary.json"));
  const transformerForecast = readJson(path.join(MODE_A, "transformer_capacity_forecast.json"));
  const rows = cellRows(baseline);
  const items = [
    ...createBuildings(rows),
    ...createTransformers(rows, transformerForecast),
    ...createRoads(rows),
    ...createSupportSpaces(rows)
  ].sort((a, b) => (a.year - b.year) || a.id.localeCompare(b.id));

  const forecast2026 = baseline.summaryByYear[String(START_YEAR)] || {};
  const forecast2036 = baseline.summaryByYear[String(HORIZON_YEAR)] || {};
  const forecastDeltas = {};
  for (const metric of baseline.metrics || []) {
    forecastDeltas[metric] = round(getMetric(forecast2036, metric) - getMetric(forecast2026, metric), 4);
  }

  const payload = {
    schemaVersion: "1.0.0",
    kind: "belfast.trendBaselineBranch",
    modelVersion: "bims5-trend-continuation-branch-v1",
    generatedAt: new Date().toISOString(),
    baselineYear: BASELINE_YEAR,
    startYear: START_YEAR,
    horizonYear: HORIZON_YEAR,
    method: "Rank 2025-baseline forecast cells by 2016-2025 year-to-year growth pressure, then place representative baseline additions in high-pressure cells.",
    summary: {
      itemCount: items.length,
      itemCountsByType: countByType(items),
      forecastDeltas2026To2036: forecastDeltas,
      historicalGrowth: summarizeHistoricalGrowth(summary),
      transformerCapacity2036: transformerForecast.summaryByYear[String(HORIZON_YEAR)] || null,
      evidence: [
        "web/data/mode-a/summary.json",
        "web/data/mode-a/baseline_2025_forecast.json",
        "web/data/mode-a/transformer_capacity_forecast.json"
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
      description: "Projected no-extra-policy baseline: if Belfast keeps following the observed year-to-year growth pattern, these representative buildings, transformers, roads and support spaces appear through 2036.",
      items,
      activityLog: [
        {
          id: "trend-baseline-method",
          type: "simulation",
          title: "Trend baseline generated",
          detail: "Representative additions are derived from year-to-year forecast pressure, not hand-placed user edits.",
          year: START_YEAR,
          createdAt: new Date().toISOString(),
          data: { source: "trend_baseline_branch.json" }
        }
      ]
    }
  };

  writeJson(path.join(MODE_A, "trend_baseline_branch.json"), payload);
  console.log(`Trend baseline OK: ${items.length} additions (${JSON.stringify(countByType(items))}).`);
}

main();
