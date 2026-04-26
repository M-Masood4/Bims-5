const REQUIRED_METRICS = ["traffic", "jobs", "electricity", "buildings", "services"];

const emptyFeatureCollection = { type: "FeatureCollection", features: [] };
const BELFAST_FOCUS_BBOX = [-6.055, 54.535, -5.795, 54.648];
const HISTORICAL_START_YEAR = 2016;
const PRESENT_BASELINE_YEAR = 2026;
const SIMULATION_START_YEAR = 2027;
const SIMULATION_END_YEAR = 2036;
const SIMULATION_YEARS = Array.from({ length: SIMULATION_END_YEAR - HISTORICAL_START_YEAR + 1 }, (_item, index) => HISTORICAL_START_YEAR + index);
const BELFAST_POSTCODE_AREAS = {
  BT1: { label: "BT1 City Centre", center: [-5.9296, 54.5994], zoom: 14.4 },
  BT2: { label: "BT2 Linen Quarter", center: [-5.9334, 54.5946], zoom: 14.3 },
  BT3: { label: "BT3 Titanic Quarter / Harbour", center: [-5.9008, 54.6118], zoom: 13.6 },
  BT4: { label: "BT4 Ballyhackamore / Sydenham", center: [-5.8726, 54.5992], zoom: 13.7 },
  BT5: { label: "BT5 Castlereagh / Bloomfield", center: [-5.8856, 54.5877], zoom: 13.7 },
  BT6: { label: "BT6 Ravenhill / Cregagh", center: [-5.9065, 54.5785], zoom: 13.7 },
  BT7: { label: "BT7 Queen's / Ormeau", center: [-5.9282, 54.5847], zoom: 13.9 },
  BT8: { label: "BT8 Newtownbreda / Carryduff edge", center: [-5.9062, 54.5385], zoom: 12.9 },
  BT9: { label: "BT9 Malone / Stranmillis", center: [-5.9491, 54.5767], zoom: 13.7 },
  BT10: { label: "BT10 Finaghy", center: [-5.9822, 54.5666], zoom: 13.5 },
  BT11: { label: "BT11 Andersonstown", center: [-5.9976, 54.5846], zoom: 13.5 },
  BT12: { label: "BT12 Falls / Sandy Row", center: [-5.9555, 54.5947], zoom: 13.8 },
  BT13: { label: "BT13 Shankill / Springfield", center: [-5.9578, 54.6078], zoom: 13.7 },
  BT14: { label: "BT14 Ardoyne / Ballysillan", center: [-5.948, 54.627], zoom: 13.5 },
  BT15: { label: "BT15 North Belfast / Shore Road", center: [-5.9264, 54.6266], zoom: 13.5 },
  BT16: { label: "BT16 Dundonald / East Belfast edge", center: [-5.8068, 54.5946], zoom: 13.2 },
  BT17: { label: "BT17 Twinbrook / West Belfast edge", center: [-6.0286, 54.5607], zoom: 13.1 }
};

const state = {
  manifest: null,
  modeA: null,
  map: null,
  year: SIMULATION_END_YEAR,
  metric: "traffic",
  activeView: "overview",
  changeFilter: "all",
  selectedCommit: null,
  selectedCellId: null,
  selectedCellFeature: null,
  playing: false,
  timer: null,
  pitch3d: true,
  labelsVisible: true,
  legendVisible: true,
  layers: {
    change_heatmap: true,
    roads: true,
    buildings: false,
    services_context: false,
    electricity_context: false,
    boundaries: false,
    transit: false,
    green: false,
    water: false
  }
};

const els = {
  layerToggles: document.querySelector("#layerToggles"),
  lensTabs: document.querySelector("#lensTabs"),
  sourceTotal: document.querySelector("#sourceTotal"),
  lightMap: document.querySelector("#lightMap"),
  darkMap: document.querySelector("#darkMap"),
  toggle3d: document.querySelector("#toggle3d"),
  fitTool: document.querySelector("#fitTool"),
  yearSlider: document.querySelector("#yearSlider"),
  yearTicks: document.querySelector("#yearTicks"),
  currentYearLabel: document.querySelector("#currentYearLabel"),
  playButton: document.querySelector("#playButton"),
  presentButton: document.querySelector("#presentButton"),
  manifestStatus: document.querySelector("#manifestStatus"),
  metricCards: document.querySelector("#metricCards"),
  cityCommits: document.querySelector("#cityCommits"),
  selectedChange: document.querySelector("#selectedChange"),
  evidencePanel: document.querySelector("#evidencePanel"),
  evidencePopover: document.querySelector("#evidencePopover"),
  legendMetric: document.querySelector("#legendMetric"),
  commitYearSelect: document.querySelector("#commitYearSelect"),
  app: document.querySelector(".replay-app"),
  iconNav: document.querySelector(".icon-nav"),
  rightPanel: document.querySelector(".right-panel"),
  layerCard: document.querySelector(".layer-card"),
  viewPanel: document.querySelector("#viewPanel"),
  labelsToggle: document.querySelector("#labelsToggle"),
  legendToggle: document.querySelector("#legendToggle"),
  mapLegend: document.querySelector(".map-legend"),
  layersTool: document.querySelector("#layersTool"),
  settingsTool: document.querySelector("#settingsTool"),
  selectTool: document.querySelector("#selectTool"),
  resetSelection: document.querySelector("#resetSelection"),
  postcodeSearch: document.querySelector("#postcodeSearch"),
  postcodeInput: document.querySelector("#postcodeInput"),
  postcodeStatus: document.querySelector("#postcodeStatus")
};

const LENS_REGISTRY = [
  {
    id: "traffic",
    label: "Traffic",
    icon: "TR",
    description: "corridor strain, road pressure and access disruption",
    goodDirection: "down",
    palette: ["#fff7ed", "#fb923c", "#ea580c"],
    tone: "orange"
  },
  {
    id: "jobs",
    label: "Jobs",
    icon: "JB",
    description: "employment, education and commercial access",
    goodDirection: "up",
    palette: ["#faf5ff", "#a855f7", "#6d28d9"],
    tone: "purple"
  },
  {
    id: "electricity",
    label: "Electricity",
    icon: "EL",
    description: "grid load, headroom and reinforcement pressure",
    goodDirection: "down",
    palette: ["#ecfeff", "#14b8a6", "#0f766e"],
    tone: "teal"
  },
  {
    id: "buildings",
    label: "Buildings",
    icon: "BD",
    description: "footprint additions and architectural-period shifts",
    goodDirection: "up",
    palette: ["#eff6ff", "#60a5fa", "#1d4ed8"],
    tone: "blue"
  },
  {
    id: "services",
    label: "Services",
    icon: "SV",
    description: "health, education, civic and commercial access",
    goodDirection: "up",
    palette: ["#f0fdf4", "#4ade80", "#15803d"],
    tone: "green"
  }
];

const CONTEXT_REGISTRY = [
  { id: "change_heatmap", label: "Signal heatmap", icon: "HT", description: "selected signal intensity", signals: REQUIRED_METRICS, always: true },
  { id: "roads", label: "Road additions", icon: "RD", description: "OSM roads, bridges and access corridors", signals: ["traffic", "jobs"] },
  { id: "buildings", label: "Building additions", icon: "BD", description: "3D building skeleton by replay year", signals: ["buildings", "electricity"] },
  { id: "services_context", label: "Service access", icon: "SV", description: "health, education and civic anchors", signals: ["jobs", "services"] },
  { id: "electricity_context", label: "Electricity network", icon: "EL", description: "power lines, substations and load proxy", signals: ["electricity"] },
  { id: "boundaries", label: "Grid boundaries", icon: "BX", description: "replay grid and local context", signals: REQUIRED_METRICS, advanced: true }
];

const METRIC_BY_ID = Object.fromEntries(LENS_REGISTRY.map((metric) => [metric.id, metric]));
const CONTEXT_LAYER_IDS = new Map();
const SIGNAL_LAYER_PRESETS = {
  traffic: { change_heatmap: true, roads: true, buildings: false, services_context: false, electricity_context: false, boundaries: false, transit: false, green: false, water: false },
  jobs: { change_heatmap: true, roads: false, buildings: false, services_context: true, electricity_context: false, boundaries: false, transit: true, green: false, water: false },
  electricity: { change_heatmap: true, roads: false, buildings: false, services_context: false, electricity_context: true, boundaries: false, transit: false, green: false, water: false },
  buildings: { change_heatmap: true, roads: false, buildings: true, services_context: false, electricity_context: false, boundaries: true, transit: false, green: false, water: false },
  services: { change_heatmap: true, roads: false, buildings: false, services_context: true, electricity_context: false, boundaries: false, transit: false, green: true, water: false }
};

const IMPACT_LENSES = REQUIRED_METRICS;
const CHANGE_TYPES = {
  traffic: {
    type: "road",
    label: "Road / corridor change",
    headline: "Road network change",
    icon: "RD",
    detail: "Road additions, reconfiguration, or corridor disruption are interpreted through traffic strain and access effects."
  },
  buildings: {
    type: "building",
    label: "Building change",
    headline: "Building expansion",
    icon: "BD",
    detail: "Mapped footprint additions and development pressure are analysed as demand on roads, services, jobs and grid headroom."
  },
  electricity: {
    type: "power",
    label: "Grid / energy change",
    headline: "Data centre / grid load",
    icon: "EL",
    detail: "GRID-style load and headroom scoring estimates how data centres, substations, wind farms or reinforcement change electricity pressure."
  },
  jobs: {
    type: "employment",
    label: "Jobs / opportunity change",
    headline: "Employment access change",
    icon: "JB",
    detail: "Commercial activity and job access are tested against road pressure, service reach and electricity demand."
  },
  services: {
    type: "service",
    label: "Service change",
    headline: "Service access change",
    icon: "SV",
    detail: "Health, education, civic and recreation changes are analysed for access, traffic draw and grid/service demand."
  }
};

function formatNumber(value) {
  return Number.isFinite(value) ? value.toLocaleString() : "0";
}

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

function signedPct(value) {
  const rounded = Math.round(value * 100);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function json(url, options) {
  const response = await fetch(url, { cache: "no-store", ...options });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function createLayerGroup(category) {
  if (!CONTEXT_LAYER_IDS.has(category)) CONTEXT_LAYER_IDS.set(category, []);
  return CONTEXT_LAYER_IDS.get(category);
}

function applySignalPreset(metric) {
  const preset = SIGNAL_LAYER_PRESETS[metric] || SIGNAL_LAYER_PRESETS.traffic;
  state.layers = { ...state.layers, ...preset };
}

function layerBelongsToSignal(item) {
  return item.always || item.signals?.includes(state.metric);
}

function visibleContextItems() {
  return CONTEXT_REGISTRY.filter((item) => layerBelongsToSignal(item));
}

function signalCommit(metric = state.metric) {
  return (state.modeA?.commitsByYear?.[String(dataYear())] || []).find((commit) => commit.type === metric);
}

function infrastructureChanges() {
  if (isFutureYear()) return [];
  return (state.modeA?.commitsByYear?.[String(dataYear())] || []).map((commit) => {
    const type = CHANGE_TYPES[commit.type] || CHANGE_TYPES.traffic;
    const intensity = Math.min(100, Math.max(6, Math.round(Math.abs(commit.delta || 0) * 100)));
    const mw = commit.type === "electricity" ? Math.max(15, Math.round((0.35 + Math.abs(commit.delta || 0)) * 140)) : 0;
    const scenario = commit.type === "electricity" ? "Mapped grid asset event" : type.headline;
    return {
      ...commit,
      changeType: type.type,
      changeLabel: type.label,
      headline: type.headline,
      icon: type.icon,
      detail: commit.subtitle || type.detail,
      scenario,
      intensity,
      estimatedMw: mw,
    };
  });
}

function filteredChanges() {
  const changes = infrastructureChanges();
  if (state.changeFilter === "all") return changes;
  return changes.filter((change) => change.changeType === state.changeFilter);
}

function impactCopy(change, metric) {
  const affected = (change.affectedSignals || []).find((item) => item.signal === metric);
  const delta = affected?.delta ?? change.delta ?? 0;
  const direction = delta >= 0 ? "increases" : "reduces";
  const area = change.area || "Belfast";
  if (metric === "traffic") {
    return `${change.headline} around ${area} ${direction} the traffic pressure signal by ${signedPct(delta)} against 2016. The highlighted cells show the congestion surface most likely to change first.`;
  }
  if (metric === "jobs") {
    return `${area} shows a ${signedPct(delta)} opportunity/job-access shift. Use this to see whether the change improves reach to employment or concentrates demand in already busy corridors.`;
  }
  if (metric === "electricity") {
    const load = change.estimatedMw ? ` Estimated load: ${change.estimatedMw} MW.` : "";
    return `${change.scenario} changes grid headroom by ${signedPct(delta)} in the selected cells.${load} The event is backed by ${change.eventSourceBasis || "a public source record"}; electricity impact is derived from the GRID-style load/headroom proxy and OSM power assets.`;
  }
  if (metric === "buildings") {
    return `${change.headline} shifts mapped building pressure by ${signedPct(delta)} around ${area}. Building footprints visible on the map are filtered by replay year so later mapped/proxy additions appear as the slider moves.`;
  }
  if (metric === "services") {
    return `Service access around ${area} shifts ${signedPct(delta)}. This shows whether the infrastructure change helps practical access to civic, health, education, and recreation services.`;
  }
  return change.explanation || change.subtitle || "";
}

function focusRightPanel(selector) {
  const target = document.querySelector(selector);
  if (!target || !els.rightPanel) return;
  const top = Math.max(0, target.offsetTop - els.rightPanel.offsetTop - 12);
  els.rightPanel.scrollTo({ top, behavior: "smooth" });
}

async function loadData() {
  const [manifest, modeA] = await Promise.all([
    json("/api/manifest"),
    json("/data/mode-a/summary.json")
  ]);

  state.manifest = manifest;
  state.modeA = modeA;
  state.timelineYears = SIMULATION_YEARS;
  state.year = SIMULATION_END_YEAR;

  els.yearSlider.min = HISTORICAL_START_YEAR;
  els.yearSlider.max = SIMULATION_END_YEAR;
  els.yearSlider.value = state.year;
  updateLayerCount();
  els.manifestStatus.textContent = `${modeA.cellCount} cells`;
  if (els.commitYearSelect) {
    els.commitYearSelect.innerHTML = state.timelineYears.map((year) => `<option value="${year}">${year}${year >= SIMULATION_START_YEAR ? " simulation" : ""}</option>`).join("");
    els.commitYearSelect.value = state.year;
  }
}

function initMap() {
  mapboxgl.accessToken = state.manifest.mapbox.token;
  const focusBbox = BELFAST_FOCUS_BBOX;
  state.map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/dark-v11",
    center: state.manifest.viewport.center,
    zoom: 11.85,
    minZoom: 10.8,
    maxBounds: focusBbox,
    pitch: 54,
    bearing: -20,
    antialias: true
  });

  state.map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "bottom-right");
  state.map.on("load", () => {
    addModeALayers();
    renderAll();
  });
  state.map.on("click", "mode-a-grid-fill", (event) => {
    const feature = event.features?.[0];
    if (feature) selectGridCell(feature, event.lngLat);
  });
  for (const layer of ["electricity-line", "electricity-circle", "electricity-fill"]) {
    state.map.on("click", layer, (event) => {
      const feature = event.features?.[0];
      if (feature) showElectricityEvidence(feature, event.lngLat);
    });
  }
  state.map.on("mouseenter", "mode-a-grid-fill", () => {
    state.map.getCanvas().style.cursor = "pointer";
  });
  state.map.on("mouseleave", "mode-a-grid-fill", () => {
    state.map.getCanvas().style.cursor = "";
  });
}

function addModeALayers() {
  CONTEXT_LAYER_IDS.clear();
  if (!state.map.getSource("mode-a-grid")) {
    state.map.addSource("mode-a-grid", {
      type: "geojson",
      data: `/data/mode-a/grid_${dataYear()}.geojson`,
      promoteId: "cell_id"
    });
  }

  addVectorContextLayers();
  addBelfastMaskLayer();
  addPostcodeSearchLayer();

  if (!state.map.getLayer("mode-a-grid-fill")) {
    state.map.addLayer({
      id: "mode-a-grid-fill",
      type: "fill",
      source: "mode-a-grid",
      paint: gridPaint()
    });
  }
  if (!state.map.getLayer("mode-a-grid-line")) {
    state.map.addLayer({
      id: "mode-a-grid-line",
      type: "line",
      source: "mode-a-grid",
      paint: {
        "line-color": "rgba(37,99,235,0.42)",
        "line-width": 0.65,
        "line-dasharray": [2, 2]
      }
    });
  }

  if (!state.map.getSource("commit-selection")) {
    state.map.addSource("commit-selection", {
      type: "geojson",
      data: emptyFeatureCollection,
      promoteId: "cell_id"
    });
  }
  if (!state.map.getLayer("commit-selection-fill")) {
    state.map.addLayer({
      id: "commit-selection-fill",
      type: "fill",
      source: "commit-selection",
      paint: {
        "fill-color": activeMetricColor(),
        "fill-opacity": 0.48
      }
    });
  }
  if (!state.map.getLayer("commit-selection-line")) {
    state.map.addLayer({
      id: "commit-selection-line",
      type: "line",
      source: "commit-selection",
      paint: {
        "line-color": "#0f172a",
        "line-width": 2.4
      }
    });
  }

  addElectricityLayers();
  addBuildingLayer();
}

function addBelfastMaskLayer() {
  const bbox = BELFAST_FOCUS_BBOX;
  const mask = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-180, -85],
          [180, -85],
          [180, 85],
          [-180, 85],
          [-180, -85]
        ], [
          [bbox[0], bbox[1]],
          [bbox[0], bbox[3]],
          [bbox[2], bbox[3]],
          [bbox[2], bbox[1]],
          [bbox[0], bbox[1]]
        ]]
      }
    }]
  };
  if (!state.map.getSource("belfast-outside-mask")) {
    state.map.addSource("belfast-outside-mask", { type: "geojson", data: mask });
  }
  if (!state.map.getLayer("belfast-outside-mask")) {
    state.map.addLayer({
      id: "belfast-outside-mask",
      type: "fill",
      source: "belfast-outside-mask",
      paint: {
        "fill-color": "#020817",
        "fill-opacity": 0.72
      }
    });
  }
}

function addPostcodeSearchLayer() {
  if (!state.map.getSource("postcode-search-result")) {
    state.map.addSource("postcode-search-result", {
      type: "geojson",
      data: emptyFeatureCollection
    });
  }
  if (!state.map.getLayer("postcode-search-result-ring")) {
    state.map.addLayer({
      id: "postcode-search-result-ring",
      type: "circle",
      source: "postcode-search-result",
      paint: {
        "circle-radius": 18,
        "circle-color": "#38bdf8",
        "circle-opacity": 0.18,
        "circle-stroke-color": "#bfdbfe",
        "circle-stroke-width": 2
      }
    });
  }
  if (!state.map.getLayer("postcode-search-result-core")) {
    state.map.addLayer({
      id: "postcode-search-result-core",
      type: "circle",
      source: "postcode-search-result",
      paint: {
        "circle-radius": 5,
        "circle-color": "#ffffff",
        "circle-stroke-color": "#38bdf8",
        "circle-stroke-width": 3
      }
    });
  }
}

function addVectorContextLayers() {
  const layers = state.manifest.layers.filter((layer) => layer.id !== "belfast-ni-buildings-3d");
  for (const layer of layers) {
    if (!["roads", "transit", "green", "water", "services", "boundary"].includes(layer.category)) continue;
    const sourceId = `source-${layer.id}`;
    if (!state.map.getSource(sourceId)) {
      state.map.addSource(sourceId, { type: "geojson", data: layer.apiPath });
    }
    const color = layer.render?.color || "#64748b";
    const category = layer.category === "boundary" ? "boundaries" : layer.category === "services" ? "services_context" : layer.category;
    const group = createLayerGroup(category);

    if ((layer.geometryTypes || []).some((type) => type.includes("Polygon"))) {
      const id = `${layer.id}-fill`;
      if (!state.map.getLayer(id)) {
        state.map.addLayer({
          id,
          type: "fill",
          source: sourceId,
          filter: ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false],
          paint: {
            "fill-color": color,
            "fill-opacity": layer.category === "water" ? 0.34 : layer.category === "green" ? 0.24 : 0.13
          }
        });
      }
      group.push(id);
    }

    if ((layer.geometryTypes || []).some((type) => type.includes("LineString"))) {
      const id = `${layer.id}-line`;
      if (!state.map.getLayer(id)) {
        state.map.addLayer({
          id,
          type: "line",
          source: sourceId,
          filter: ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": color,
            "line-width": layer.category === "roads" ? 1.45 : layer.category === "transit" ? 2.1 : 1.25,
            "line-opacity": layer.category === "roads" ? 0.48 : 0.58
          }
        });
      }
      group.push(id);
    }

    if ((layer.geometryTypes || []).some((type) => type === "Point" || type === "MultiPoint")) {
      const id = `${layer.id}-circle`;
      if (!state.map.getLayer(id)) {
        state.map.addLayer({
          id,
          type: "circle",
          source: sourceId,
          filter: ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false],
          paint: {
            "circle-color": color,
            "circle-radius": layer.category === "services" ? 3.6 : layer.category === "transit" ? 3.3 : 2.8,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 0.8,
            "circle-opacity": 0.68
          }
        });
      }
      group.push(id);
    }
  }
}

function addBuildingLayer() {
  const buildingLayer = state.manifest.layers.find((layer) => layer.id === "belfast-ni-buildings-3d");
  if (!buildingLayer) return;
  if (!state.map.getSource("replay-buildings")) {
    state.map.addSource("replay-buildings", {
      type: "geojson",
      data: buildingLayer.apiPath
    });
  }
  if (!state.map.getLayer("replay-buildings")) {
    state.map.addLayer({
      id: "replay-buildings",
      type: "fill-extrusion",
      source: "replay-buildings",
      minzoom: 10,
      paint: {
        "fill-extrusion-color": [
          "match",
          ["get", "architecture_period"],
          "waterfront-contemporary",
          "#0f766e",
          "city-centre-infill",
          "#2563eb",
          "mixed-use-infill",
          "#7c3aed",
          "large-commercial-industrial",
          "#f97316",
          "civic-commercial-block",
          "#64748b",
          "established-mid-rise",
          "#475569",
          "traditional-low-rise",
          "#94a3b8",
          "#64748b"
        ],
        "fill-extrusion-height": ["*", ["coalesce", ["to-number", ["get", "replay_height_m"]], 8], 1],
        "fill-extrusion-opacity": 0.5
      }
    });
  }
  createLayerGroup("buildings").push("replay-buildings");
}

function addElectricityLayers() {
  if (!state.map.getSource("electricity-replay")) {
    state.map.addSource("electricity-replay", {
      type: "geojson",
      data: `/data/mode-a/electricity_${dataYear()}.geojson`
    });
  }
  if (!state.map.getLayer("electricity-fill")) {
    state.map.addLayer({
      id: "electricity-fill",
      type: "fill",
      source: "electricity-replay",
      filter: ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false],
      paint: {
        "fill-color": electricityColorExpression(),
        "fill-opacity": 0.22
      }
    });
  }
  if (!state.map.getLayer("electricity-line")) {
    state.map.addLayer({
      id: "electricity-line",
      type: "line",
      source: "electricity-replay",
      filter: ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": electricityColorExpression(),
        "line-width": ["interpolate", ["linear"], ["coalesce", ["to-number", ["get", "grid_load_pct"]], 50], 0, 1.2, 65, 2.4, 90, 4.8],
        "line-opacity": 0.88
      }
    });
  }
  if (!state.map.getLayer("electricity-circle")) {
    state.map.addLayer({
      id: "electricity-circle",
      type: "circle",
      source: "electricity-replay",
      filter: ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false],
      paint: {
        "circle-color": electricityColorExpression(),
        "circle-radius": ["interpolate", ["linear"], ["coalesce", ["to-number", ["get", "grid_load_pct"]], 50], 0, 3, 65, 5.5, 90, 9],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.2,
        "circle-opacity": 0.92
      }
    });
  }
  createLayerGroup("electricity_context").push("electricity-fill", "electricity-line", "electricity-circle");
}

function electricityColorExpression() {
  return [
    "interpolate",
    ["linear"],
    ["coalesce", ["to-number", ["get", "grid_load_pct"]], 50],
    0,
    "#16a34a",
    55,
    "#facc15",
    75,
    "#f97316",
    92,
    "#dc2626"
  ];
}

function activeMetricColor() {
  return METRIC_BY_ID[state.metric]?.palette?.[2] || "#2563eb";
}

function gridPaint() {
  const metric = METRIC_BY_ID[state.metric] || METRIC_BY_ID.traffic;
  const [low, mid, high] = metric.palette;
  return {
    "fill-color": [
      "interpolate",
      ["linear"],
      ["coalesce", ["to-number", ["get", state.metric]], 0.5],
      0,
      low,
      0.52,
      mid,
      1,
      high
    ],
    "fill-opacity": state.layers.change_heatmap === false ? 0 : 0.30
  };
}

function renderAll() {
  renderLensTabs();
  renderToggles();
  renderTimeline();
  renderYear();
}

function setView(view) {
  state.activeView = view;
  els.app?.setAttribute("data-view", view);
  els.app?.classList.remove("show-layer-card");
  els.app?.classList.toggle("focus-map", view === "overview");
  document.querySelectorAll(".icon-nav button[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  renderToggles();
  renderViewPanel();
  renderCommits();

  if (view === "overview") {
    fitBelfast();
  } else if (view === "commits") {
    focusRightPanel(".panel-header");
  } else if (view === "diff") {
    const commit = state.selectedCommit || signalCommit();
    if (commit) selectCommit(commit, { keepView: true });
    focusRightPanel(".selected-card");
  } else if (view === "compare") {
    renderComparePanel();
  } else if (view === "evidence") {
    if (!state.selectedCommit) {
      const commit = signalCommit();
      if (commit) selectCommit(commit, { keepView: true });
    }
    focusRightPanel(".evidence-card");
  }
}

function renderViewPanel() {
  if (!els.viewPanel) return;
  if (state.activeView === "compare") {
    renderComparePanel();
  } else {
    els.viewPanel.hidden = true;
    els.viewPanel.innerHTML = "";
  }
}

function renderComparePanel() {
  if (!els.viewPanel || !state.modeA) return;
  const cards = metricCardsForYear();
  els.viewPanel.hidden = false;
  els.viewPanel.innerHTML = `
    <strong>${isFutureYear() ? "Compare futures" : "Compare years"}</strong>
    <p>${isFutureYear() ? `${escapeHtml(state.year)} is a simulated future against the 2026 baseline.` : `Current view compares ${escapeHtml(state.year)} against the 2016 baseline.`}</p>
    <div class="compare-grid">
      ${cards.map((card) => `
        <button type="button" data-metric="${escapeHtml(card.metric)}" class="${state.metric === card.metric ? "active" : ""}">
          <span>${escapeHtml(card.label)}</span>
          <b>${escapeHtml(card.deltaDisplay)}%</b>
          <em>${escapeHtml(card.trend)}</em>
        </button>
      `).join("")}
    </div>
  `;
}

function renderLensTabs() {
  if (!els.lensTabs) return;
  els.lensTabs.innerHTML = "";
  for (const metric of LENS_REGISTRY) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `lens-tab tone-${metric.tone}${state.metric === metric.id ? " active" : ""}`;
    button.style.setProperty("--metric-color", metric.palette[2]);
    button.innerHTML = `<span>${escapeHtml(metric.icon)}</span>${escapeHtml(metric.label)}`;
    button.addEventListener("click", () => {
      state.metric = metric.id;
      applySignalPreset(metric.id);
      updateMapStyles();
      if (state.selectedCommit) {
        updateSelectedCommitLayer();
      } else if (state.selectedCellFeature) {
        setSelectionCollection({ type: "FeatureCollection", features: [state.selectedCellFeature] });
        renderAreaSelection(state.selectedCellFeature.properties || {});
        showCellEvidence(state.selectedCellFeature, null);
      }
      renderLensTabs();
      renderToggles();
      renderMetrics();
      renderCommits();
      renderViewPanel();
    });
    els.lensTabs.append(button);
  }
}

function renderToggles() {
  els.layerToggles.innerHTML = "";
  updateLayerCount();
  for (const item of visibleContextItems()) {
    const enabled = state.layers[item.id] !== false;
    const row = document.createElement("button");
    row.type = "button";
    row.className = `switch-row${enabled ? " active" : ""}${item.advanced ? " advanced" : ""}`;
    row.innerHTML = `
      <span class="switch-icon">${escapeHtml(item.icon)}</span>
      <span class="switch-copy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.description)}</small></span>
      <span class="switch-knob"></span>
    `;
    row.addEventListener("click", () => {
      state.layers[item.id] = !enabled;
      updateMapStyles();
      renderToggles();
      renderMetrics();
    });
    els.layerToggles.append(row);
  }
}

function updateLayerCount() {
  if (!els.sourceTotal) return;
  const visible = visibleContextItems();
  const activeCount = visible.filter((item) => state.layers[item.id] !== false).length;
  const visibleCount = visible.length;
  els.sourceTotal.textContent = `${activeCount}/${visibleCount} on`;
}

function renderTimeline() {
  els.yearTicks.innerHTML = "";
  const tickYears = timelineTickYears();
  els.yearTicks.style.setProperty("--tick-count", tickYears.length);
  for (const year of tickYears) {
    const tick = document.createElement("button");
    tick.type = "button";
    tick.textContent = year;
    tick.dataset.year = year;
    tick.className = `${year === state.year ? "active" : ""}${year >= SIMULATION_START_YEAR ? " simulation-year" : ""}`;
    tick.addEventListener("click", () => {
      state.year = year;
      state.selectedCommit = null;
      renderYear();
    });
    els.yearTicks.append(tick);
  }
}

function renderYear() {
  els.currentYearLabel.textContent = state.year;
  els.yearSlider.value = state.year;
  if (els.commitYearSelect) els.commitYearSelect.value = state.year;
  document.querySelectorAll("#yearTicks button").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.year) === state.year);
  });
  const source = state.map?.getSource("mode-a-grid");
  if (source) source.setData(`/data/mode-a/grid_${dataYear()}.geojson`);
  const electricitySource = state.map?.getSource("electricity-replay");
  if (electricitySource) electricitySource.setData(`/data/mode-a/electricity_${dataYear()}.geojson`);
  if (state.selectedCommit && state.selectedCommit.year !== dataYear()) state.selectedCommit = null;
  state.selectedCellId = null;
  state.selectedCellFeature = null;
  updateMapStyles();
  renderMetrics();
  renderCommits();
  renderViewPanel();
  updateSelectedCommitLayer();
  if (!state.selectedCommit) renderEmptySelectedChange();
}

function updateMapStyles() {
  if (!state.map?.getLayer("mode-a-grid-fill")) return;
  const metricMeta = METRIC_BY_ID[state.metric] || METRIC_BY_ID.traffic;
  els.legendMetric.textContent = metricMeta.label;
  state.map.setPaintProperty("mode-a-grid-fill", "fill-color", gridPaint()["fill-color"]);
  state.map.setPaintProperty("mode-a-grid-fill", "fill-opacity", gridPaint()["fill-opacity"]);
  if (state.map.getLayer("commit-selection-fill")) {
    state.map.setPaintProperty("commit-selection-fill", "fill-color", activeMetricColor());
  }
  if (state.map.getLayer("mode-a-grid-line")) {
    state.map.setLayoutProperty("mode-a-grid-line", "visibility", state.layers.boundaries === false ? "none" : "visible");
  }

  for (const [category, ids] of CONTEXT_LAYER_IDS.entries()) {
    let key = category;
    if (category === "services_context") key = "services_context";
    if (category === "electricity_context") key = "electricity_context";
    for (const id of ids) {
      if (state.map.getLayer(id)) {
        state.map.setLayoutProperty(id, "visibility", state.layers[key] === false ? "none" : "visible");
      }
    }
  }

  setMapLabels(state.labelsVisible);

  if (state.map.getLayer("replay-buildings")) {
    state.map.setFilter("replay-buildings", ["<=", ["to-number", ["get", "replay_first_visible_year"]], state.year]);
    state.map.setLayoutProperty("replay-buildings", "visibility", state.layers.buildings === false ? "none" : "visible");
    state.map.setPaintProperty("replay-buildings", "fill-extrusion-height", [
      "*",
      ["coalesce", ["to-number", ["get", "replay_height_m"]], 8],
      state.pitch3d ? 1.0 : 0.18
    ]);
  }
}

function setMapLabels(visible) {
  if (!state.map?.getStyle) return;
  const visibility = visible ? "visible" : "none";
  for (const layer of state.map.getStyle().layers || []) {
    if (layer.type === "symbol" && /label|place|poi|road/i.test(layer.id)) {
      state.map.setLayoutProperty(layer.id, "visibility", visibility);
    }
  }
}

function renderMetrics() {
  const cards = metricCardsForYear();
  els.metricCards.innerHTML = "";
  for (const card of cards) {
    const meta = METRIC_BY_ID[card.metric] || {};
    const node = document.createElement("article");
    node.className = `metric-card ${card.trend}${state.metric === card.metric ? " selected" : ""}`;
    node.style.setProperty("--metric-color", card.color || meta.palette?.[2] || "#0f766e");
    const series = normalizeSparkline(card.sparkline || []);
    node.innerHTML = `
      <button type="button" class="metric-select" aria-label="Show ${escapeHtml(card.label)}">
        <span class="metric-icon">${escapeHtml(meta.icon || card.label[0])}</span>
        <span class="metric-copy">
          <strong>${escapeHtml(card.label)}</strong>
          <span class="metric-value">${escapeHtml(card.display)}%</span>
          <small>${escapeHtml(card.caption || `${card.deltaDisplay} vs 2016, ${card.trend}`)}</small>
        </span>
        <svg viewBox="0 0 120 44" aria-hidden="true"><polyline points="${series}" /></svg>
      </button>
    `;
    node.querySelector("button").addEventListener("click", () => {
      state.metric = card.metric;
      applySignalPreset(card.metric);
      updateMapStyles();
      if (state.selectedCellFeature) {
        setSelectionCollection({ type: "FeatureCollection", features: [state.selectedCellFeature] });
        renderAreaSelection(state.selectedCellFeature.properties || {});
        showCellEvidence(state.selectedCellFeature, null);
      }
      renderToggles();
      renderLensTabs();
      renderMetrics();
      renderCommits();
      renderViewPanel();
    });
    els.metricCards.append(node);
  }
}

function normalizeSparkline(values) {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((point, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 118 + 1;
      const y = 40 - ((point - min) / span) * 32;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function renderCommits() {
  const changes = filteredChanges();
  els.cityCommits.innerHTML = "";
  if (!changes.length) {
    const empty = document.createElement("div");
    empty.className = "commit-filter-note";
    empty.textContent = isFutureYear()
      ? "Future simulation mode is active. Drop a building to create post-2026 scenario branches and impact stories."
      : "No changes match this filter for the selected year.";
    els.cityCommits.append(empty);
    return;
  }
  for (const commit of changes) {
    const meta = METRIC_BY_ID[commit.type] || METRIC_BY_ID.traffic;
    const active = state.selectedCommit?.id === commit.id;
    const row = document.createElement("button");
    row.type = "button";
    row.className = `commit ${commit.tone}${active ? " selected" : ""}`;
    row.style.setProperty("--metric-color", meta.palette[2]);
    row.innerHTML = `
      <span class="commit-symbol">${escapeHtml(meta.icon)}</span>
      <span class="commit-body">
        <span class="commit-meta"><strong>${escapeHtml(commit.changeLabel)}</strong><em>${escapeHtml(commit.month || dataYear())}</em></span>
        <strong>${escapeHtml(commit.title || commit.headline)} in ${escapeHtml(commit.area || "Belfast")}</strong>
        <small>${escapeHtml(commit.detail)}</small>
        <span class="commit-foot"><span>${escapeHtml(commit.eventSourceBasis || commit.severity || "Source-backed")}</span><span>Analyse impacts</span></span>
      </span>
    `;
    row.addEventListener("click", () => selectCommit(commit));
    els.cityCommits.append(row);
  }
}

function labelFor(metric) {
  return METRIC_BY_ID[metric]?.label || metric.replace(/_/g, " ");
}

function cloneFeature(feature) {
  return JSON.parse(JSON.stringify(feature));
}

function extendBounds(bounds, value) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    bounds.extend(value);
    return;
  }
  for (const item of value) extendBounds(bounds, item);
}

function fitFeatureCollection(collection, options = {}) {
  if (!state.map || !collection?.features?.length) return;
  const bounds = new mapboxgl.LngLatBounds();
  for (const feature of collection.features) {
    extendBounds(bounds, feature.geometry?.coordinates);
  }
  if (bounds.isEmpty()) return;
  state.map.fitBounds(bounds, {
    padding: options.padding || { top: 88, right: 90, bottom: 132, left: 90 },
    maxZoom: options.maxZoom || 14.8,
    pitch: state.pitch3d ? 52 : 18,
    bearing: state.pitch3d ? -20 : 0,
    duration: options.duration || 850
  });
}

function setSelectionCollection(collection, options = {}) {
  const source = state.map?.getSource("commit-selection");
  const hasSelection = Boolean(collection?.features?.length);
  if (source) source.setData(hasSelection ? collection : { type: "FeatureCollection", features: [] });
  for (const layerId of ["commit-selection-fill", "commit-selection-line"]) {
    if (state.map?.getLayer(layerId)) {
      state.map.setLayoutProperty(layerId, "visibility", hasSelection ? "visible" : "none");
    }
  }
  if (hasSelection && options.zoom) fitFeatureCollection(collection, options);
}

function affectedCellList(cellIds = []) {
  return `
    <section class="cell-list" aria-label="Affected cells">
      <header><span>Affected cells</span><span>${cellIds.length}</span></header>
      ${cellIds.map((cellId) => `
        <button type="button" data-cell-id="${escapeHtml(cellId)}" class="${state.selectedCellId === cellId ? "active" : ""}">
          <span>${escapeHtml(cellId)}</span>
          <b>Zoom</b>
        </button>
      `).join("")}
    </section>
  `;
}

function areaMetricCards(props) {
  return LENS_REGISTRY.map((metric) => {
    const value = Number(props[metric.id]);
    const delta = props[`${metric.id}_delta_2016`];
    return `
      <article class="area-metric">
        <strong>${escapeHtml(metric.label)}</strong>
        <span>${escapeHtml(pct(value))} / ${escapeHtml(delta)} vs 2016</span>
      </article>
    `;
  }).join("");
}

function changesForCell(cellId) {
  return infrastructureChanges().filter((change) => (change.cellIds || []).includes(cellId));
}

function selectCommit(commit, options = {}) {
  state.selectedCommit = { ...commit, year: state.year };
  state.selectedCellId = null;
  state.selectedCellFeature = null;
  state.metric = commit.type;
  applySignalPreset(commit.type);
  if (commit.type === "electricity") state.layers.electricity_context = true;
  if (commit.type === "buildings") state.layers.buildings = true;
  if (commit.type === "services") state.layers.services_context = true;
  if (commit.type === "traffic") state.layers.roads = true;
  if (!options.keepView && state.activeView === "overview") {
    state.activeView = "diff";
    els.app?.setAttribute("data-view", "diff");
    document.querySelectorAll(".icon-nav button[data-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === "diff");
    });
  }
  updateMapStyles();
  renderToggles();
  renderLensTabs();
  renderMetrics();
  renderCommits();
  renderViewPanel();
  updateSelectedCommitLayer({ zoom: options.zoom !== false });
  showCommitEvidence(commit);
}

async function updateSelectedCommitLayer(options = {}) {
  const source = state.map?.getSource("commit-selection");
  if (!source) return;
  if (!state.selectedCommit?.cellIds?.length) {
    setSelectionCollection(emptyFeatureCollection);
    return;
  }
  const commitId = state.selectedCommit.id;
  try {
    const grid = await json(`/data/mode-a/grid_${dataYear()}.geojson`);
    if (state.selectedCommit?.id !== commitId) return;
    const wanted = new Set(state.selectedCommit.cellIds);
    const collection = {
      type: "FeatureCollection",
      features: grid.features.filter((feature) => wanted.has(feature.properties?.cell_id))
    };
    setSelectionCollection(collection, options);
  } catch (error) {
    setSelectionCollection(emptyFeatureCollection);
  }
}

async function selectCellById(cellId, options = {}) {
  try {
    const grid = await json(`/data/mode-a/grid_${dataYear()}.geojson`);
    const feature = grid.features.find((item) => item.properties?.cell_id === cellId);
    if (feature) selectGridCell(feature, null, { zoom: options.zoom !== false });
  } catch (_error) {
    renderEmptySelectedChange();
  }
}

function selectGridCell(feature, lngLat, options = {}) {
  const cloned = cloneFeature(feature);
  const props = cloned.properties || {};
  state.selectedCommit = null;
  state.selectedCellId = props.cell_id || null;
  state.selectedCellFeature = cloned;
  const collection = { type: "FeatureCollection", features: [cloned] };
  setSelectionCollection(collection, { zoom: options.zoom !== false, maxZoom: 15.2 });
  renderCommits();
  renderAreaSelection(props);
  showCellEvidence(cloned, lngLat);
  focusRightPanel(".selected-card");
}

function resetSelection() {
  state.selectedCommit = null;
  state.selectedCellId = null;
  state.selectedCellFeature = null;
  state.changeFilter = "all";
  state.metric = "traffic";
  state.activeView = "overview";
  applySignalPreset("traffic");
  document.querySelectorAll("[data-change-filter]").forEach((item) => {
    item.classList.toggle("active", item.dataset.changeFilter === "all");
  });
  els.app?.setAttribute("data-view", "overview");
  setSelectionCollection(emptyFeatureCollection);
  updateMapStyles();
  renderLensTabs();
  renderToggles();
  renderMetrics();
  renderCommits();
  renderViewPanel();
  renderEmptySelectedChange();
  fitBelfast();
}

function renderEmptySelectedChange() {
  if (!els.selectedChange) return;
  els.selectedChange.innerHTML = `
    <div class="empty-state">
      <strong>Select an infrastructure change</strong>
      <span>Use the year slider, filter changes, then click one to inspect traffic, jobs, electricity, and service impacts.</span>
    </div>
  `;
  if (els.evidencePanel) {
    els.evidencePanel.textContent = "Select a city commit or grid cell to inspect source evidence and confidence.";
  }
}

function renderAreaSelection(props) {
  if (!els.selectedChange) return;
  const cellId = props.cell_id;
  const localChanges = changesForCell(cellId);
  const dominant = `${labelFor(props.dominant_metric)} ${props.dominant_change || ""}`.trim();
  els.selectedChange.innerHTML = `
    <header class="selected-head">
      <span class="selected-icon" style="--metric-color:${escapeHtml(activeMetricColor())}">GC</span>
      <div>
        <small>Selected grid cell / ${escapeHtml(state.year)}</small>
        <strong>${escapeHtml(cellId)}</strong>
        <span>${escapeHtml(dominant)} / ${escapeHtml(props.confidence || "medium")} confidence</span>
      </div>
    </header>
    <p>This is the exact area-level diff for the selected replay cell. The cards compare the current year against 2016, and the list shows city commits whose affected-cell set includes this cell.</p>
    <section class="area-metrics">${areaMetricCards(props)}</section>
    <section class="cell-list" aria-label="Changes affecting selected cell">
      <header><span>Changes affecting this cell</span><span>${localChanges.length}</span></header>
      ${localChanges.length ? localChanges.map((change) => `
        <button type="button" data-change-id="${escapeHtml(change.id)}">
          <span>${escapeHtml(change.changeLabel)} / ${escapeHtml(change.area || "Belfast")}</span>
          <b>${escapeHtml(signedPct(change.delta || 0))}</b>
        </button>
      `).join("") : `<span class="commit-filter-note">No headline city commit contains this cell for ${escapeHtml(state.year)}, but the local signal values above still update from the replay grid.</span>`}
    </section>
  `;
}

function showCommitEvidence(commit) {
  const meta = METRIC_BY_ID[commit.type] || METRIC_BY_ID.traffic;
  const affected = commit.affectedSignals || [];
  const evidence = commit.evidence || [];
  const auditTrail = commit.auditTrail || [];
  if (els.selectedChange) {
    els.selectedChange.innerHTML = `
      <header class="selected-head">
        <span class="selected-icon" style="--metric-color:${escapeHtml(meta.palette[2])}">${escapeHtml(meta.icon)}</span>
        <div>
          <small>${escapeHtml(commit.changeLabel || labelFor(commit.type))} / ${escapeHtml(commit.month || state.year)}</small>
          <strong>${escapeHtml(commit.title || commit.headline)} in ${escapeHtml(commit.area || "Belfast")}</strong>
          <span>${escapeHtml(commit.eventSourceBasis || "public event record")} / ${escapeHtml(commit.confidence || "Medium")} confidence, ${escapeHtml(signedPct(commit.delta || 0))} baseline shift${commit.estimatedMw ? `, ${escapeHtml(commit.estimatedMw)} MW load proxy` : ""}</span>
        </div>
      </header>
      <p>${escapeHtml(commit.detail || commit.explanation || commit.subtitle || "")}</p>
      <section class="impact-tabs" aria-label="Impact lenses">
        ${IMPACT_LENSES.map((metric) => {
          const item = METRIC_BY_ID[metric];
          return `<button type="button" data-impact-metric="${escapeHtml(metric)}" class="${state.metric === metric ? "active" : ""}" style="--metric-color:${escapeHtml(item.palette[2])}">${escapeHtml(item.label)}</button>`;
        }).join("")}
      </section>
      <section class="impact-readout">
        <strong>${escapeHtml(labelFor(state.metric))} impact</strong>
        <p>${escapeHtml(impactCopy(commit, state.metric))}</p>
      </section>
      <section class="reasoning-trace">
        <strong>Impact table</strong>
        <div class="affected-table">
          ${affected.map((row) => `
            <div class="affected-row">
              <span>${escapeHtml(row.label)}</span>
              <em>${escapeHtml(row.impact)}</em>
              <b>${escapeHtml(signedPct(row.delta || 0))}</b>
            </div>
          `).join("")}
        </div>
        <strong>Planning readout</strong>
        <div id="geminiReadout" class="ai-readout">Deterministic readout ready. Gemini summary will appear here when a local API key is available.</div>
      </section>
      ${affectedCellList(commit.cellIds || [])}
      <a class="inspect-link" href="#evidencePanel">View evidence</a>
    `;
  }
  if (els.evidencePanel) {
    els.evidencePanel.innerHTML = `
      <strong>${escapeHtml(commit.title)}</strong>
      <dl>
        <dt>Map diff</dt><dd><span>${escapeHtml(commit.mapInstruction || "Selected replay cells highlighted.")}</span></dd>
        <dt>Signal</dt><dd><span>${escapeHtml(labelFor(commit.type))} ${escapeHtml(commit.tone)}, delta ${escapeHtml(commit.delta)}</span></dd>
        <dt>Area</dt><dd><span>${escapeHtml(commit.area || "Belfast")}</span></dd>
        <dt>Source event</dt><dd>
          <span>${escapeHtml(commit.eventSourceBasis || "public event record")}</span>
          <span>${escapeHtml(commit.eventSourceName || "Source catalog")}</span>
          ${commit.eventSourceUrl ? `<span>${escapeHtml(commit.eventSourceUrl)}</span>` : ""}
          ${commit.eventOsmChangesetUrl ? `<span>${escapeHtml(commit.eventOsmChangesetUrl)}</span>` : ""}
        </dd>
        <dt>Evidence</dt><dd>${evidence.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</dd>
        <dt>Audit trail</dt><dd>${auditTrail.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</dd>
      </dl>
    `;
  }
  document.querySelector(".selected-card")?.scrollIntoView({ block: "nearest", behavior: "auto" });
  requestGeminiReadout(commit);
}

async function requestGeminiReadout(commit) {
  const target = document.querySelector("#geminiReadout");
  if (!target) return;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3500);
  try {
    const response = await json("/api/gemini/commit-explanation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        year: state.year,
        signal: commit.type,
        commit,
        metricCard: (state.modeA.metricsByYear[String(state.year)] || []).find((card) => card.metric === commit.type)
      }),
      signal: controller.signal
    });
    if (response?.explanation) {
      target.textContent = response.explanation;
      if (response.fallback) target.classList.add("fallback");
    }
  } catch (_error) {
    target.textContent = commit.explanation || "The selected diff is grounded in the replay grid and source evidence.";
    target.classList.add("fallback");
  } finally {
    window.clearTimeout(timeout);
  }
}

function parseEvidence(value) {
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value || "[]");
  } catch (_error) {
    return [];
  }
}

function showCellEvidence(feature, lngLat) {
  const props = feature.properties;
  const evidence = parseEvidence(props.evidence);
  const value = Number(props[state.metric]);
  const delta = props[`${state.metric}_delta_2016`];
  els.evidencePanel.innerHTML = `
    <strong>Grid cell ${escapeHtml(props.cell_id)}</strong>
    <dl>
      <dt>Selected Signal</dt><dd><span>${escapeHtml(labelFor(state.metric))}: ${pct(value)}, delta ${escapeHtml(delta)}</span></dd>
      <dt>Dominant Change</dt><dd><span>${escapeHtml(labelFor(props.dominant_metric))} ${escapeHtml(props.dominant_change)}</span></dd>
      <dt>Supporting Signals</dt><dd>
        <span>Development pressure ${pct(Number(props.development_pressure))}</span>
        <span>Traffic pressure ${pct(Number(props.traffic_pressure))}</span>
        <span>Transit access ${pct(Number(props.transit_access))}</span>
        <span>Bike access ${pct(Number(props.bike_access))}</span>
        <span>Service context ${pct(Number(props.civic_service_context))}</span>
        <span>Green cover ${pct(Number(props.green_cover))}</span>
      </dd>
      <dt>Confidence</dt><dd><span>${escapeHtml(props.confidence)}</span></dd>
      <dt>Evidence</dt><dd>${evidence.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</dd>
    </dl>
  `;
  if (!lngLat) return;
  els.evidencePopover.hidden = false;
  els.evidencePopover.innerHTML = `<strong>${escapeHtml(labelFor(props.dominant_metric))}</strong><span>${escapeHtml(props.dominant_change)}, ${escapeHtml(props.confidence)} confidence</span>`;
  const point = state.map.project(lngLat);
  els.evidencePopover.style.left = `${Math.min(point.x + 12, window.innerWidth - 270)}px`;
  els.evidencePopover.style.top = `${Math.max(point.y - 24, 80)}px`;
  window.clearTimeout(showCellEvidence.timer);
  showCellEvidence.timer = window.setTimeout(() => {
    els.evidencePopover.hidden = true;
  }, 2800);
}

function showElectricityEvidence(feature, lngLat) {
  const props = feature.properties;
  const evidence = parseEvidence(props.evidence);
  els.evidencePanel.innerHTML = `
    <strong>${escapeHtml(props.name || props.power || "Electricity asset")}</strong>
    <dl>
      <dt>Grid Status</dt><dd><span>${escapeHtml(props.status)} load, ${escapeHtml(props.grid_load_pct)}% estimated load, ${escapeHtml(props.headroom_pct)}% headroom</span></dd>
      <dt>Asset</dt><dd><span>${escapeHtml(props.power || "power")} ${props.voltage ? `, ${escapeHtml(props.voltage)} volts` : ""}</span></dd>
      <dt>Replay appearance</dt><dd><span>${escapeHtml(props.replay_first_visible_year || 2016)} / ${escapeHtml(props.visibility_basis || "replay baseline")}${props.osm_timestamp ? ` / OSM ${escapeHtml(props.osm_timestamp)}` : ""}</span></dd>
      <dt>Confidence</dt><dd><span>${escapeHtml(props.confidence)} for location, proxy for load</span></dd>
      <dt>Evidence</dt><dd>${evidence.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</dd>
    </dl>
  `;
  if (!lngLat) return;
  els.evidencePopover.hidden = false;
  els.evidencePopover.innerHTML = `<strong>${escapeHtml(props.status || "grid")}</strong><span>${escapeHtml(props.grid_load_pct)}% load, ${escapeHtml(props.headroom_pct)}% headroom</span>`;
  const point = state.map.project(lngLat);
  els.evidencePopover.style.left = `${Math.min(point.x + 12, window.innerWidth - 270)}px`;
  els.evidencePopover.style.top = `${Math.max(point.y - 24, 80)}px`;
  window.clearTimeout(showCellEvidence.timer);
  showCellEvidence.timer = window.setTimeout(() => {
    els.evidencePopover.hidden = true;
  }, 2800);
}

function fitBelfast() {
  state.map.fitBounds(BELFAST_FOCUS_BBOX, {
    padding: { top: 60, right: 60, bottom: 170, left: 60 },
    pitch: state.pitch3d ? 54 : 18,
    bearing: state.pitch3d ? -20 : 0,
    duration: 800
  });
}

function isFutureYear(year = state.year) {
  return Number(year) >= SIMULATION_START_YEAR;
}

function timelineTickYears() {
  return [2016, 2020, 2024, 2026, ...Array.from({ length: SIMULATION_END_YEAR - SIMULATION_START_YEAR + 1 }, (_item, index) => SIMULATION_START_YEAR + index)];
}

function dataYear(year = state.year) {
  return Math.min(PRESENT_BASELINE_YEAR, Math.max(HISTORICAL_START_YEAR, Number(year) || PRESENT_BASELINE_YEAR));
}

function simulationProgress(year = state.year) {
  if (!isFutureYear(year)) return 0;
  return Math.min(1, Math.max(0, (Number(year) - PRESENT_BASELINE_YEAR) / (SIMULATION_END_YEAR - PRESENT_BASELINE_YEAR)));
}

function metricCardsForYear() {
  if (!isFutureYear()) return state.modeA.metricsByYear[String(state.year)] || [];
  const baseline = state.modeA.metricsByYear[String(PRESENT_BASELINE_YEAR)] || [];
  const progress = simulationProgress();
  const futureAdjustments = {
    traffic: 3.8,
    jobs: 8.6,
    electricity: 10.4,
    buildings: 12.8,
    services: 4.7
  };
  return baseline.map((card) => {
    const uplift = (futureAdjustments[card.metric] || 5) * progress;
    const display = Math.round(Number(card.display || 0) + uplift);
    const delta = Math.round(Number(card.deltaDisplay || 0) + uplift);
    return {
      ...card,
      display,
      deltaDisplay: `+${delta}`,
      trend: card.metric === "traffic" || card.metric === "electricity" ? "pressure" : "simulated uplift",
      caption: `${state.year} simulated from 2026 baseline`
    };
  });
}

function normalizePostcodeQuery(value) {
  const text = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  const match = text.match(/^(BT\d{1,2})/);
  return match ? match[1] : text;
}

function searchBelfastPostcode(value) {
  const key = normalizePostcodeQuery(value);
  const area = BELFAST_POSTCODE_AREAS[key];
  if (!area) {
    if (els.postcodeStatus) els.postcodeStatus.textContent = key.startsWith("BT") ? "Use a Belfast BT1-BT17 postcode area" : "Belfast postcode areas only";
    return;
  }
  state.map.flyTo({
    center: area.center,
    zoom: area.zoom,
    pitch: state.pitch3d ? 54 : 18,
    bearing: state.pitch3d ? -18 : 0,
    duration: 850,
    essential: true
  });
  state.map.getSource("postcode-search-result")?.setData({
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { label: area.label },
      geometry: { type: "Point", coordinates: area.center }
    }]
  });
  if (els.postcodeStatus) els.postcodeStatus.textContent = area.label;
}

function setStyle(style) {
  const center = state.map.getCenter();
  const zoom = state.map.getZoom();
  const pitch = state.map.getPitch();
  const bearing = state.map.getBearing();
  state.map.setStyle(style);
  state.map.once("style.load", () => {
    state.map.jumpTo({ center, zoom, pitch, bearing });
    addModeALayers();
    renderYear();
  });
}

function togglePlay() {
  state.playing = !state.playing;
  els.playButton.textContent = state.playing ? "Pause" : "Play";
  clearInterval(state.timer);
  if (!state.playing) return;
  state.timer = setInterval(() => {
    const years = state.timelineYears || state.modeA.years;
    const index = years.indexOf(state.year);
    state.year = years[(index + 1) % years.length];
    state.selectedCommit = null;
    state.selectedCellId = null;
    state.selectedCellFeature = null;
    renderYear();
  }, 1050);
}

els.yearSlider.addEventListener("input", (event) => {
  state.year = Number(event.target.value);
  state.selectedCommit = null;
  state.selectedCellId = null;
  state.selectedCellFeature = null;
  renderYear();
});
els.iconNav?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (!button) return;
  setView(button.dataset.view);
});
els.viewPanel?.addEventListener("click", (event) => {
  const metricButton = event.target.closest("button[data-metric]");
  if (metricButton) {
    state.metric = metricButton.dataset.metric;
    applySignalPreset(state.metric);
    updateMapStyles();
    renderLensTabs();
    renderToggles();
    renderMetrics();
    renderViewPanel();
    return;
  }
  const action = event.target.closest("button[data-action]")?.dataset.action;
  if (action === "show-layers") {
    setView("layers");
  } else if (action === "select-current-commit") {
    const commit = signalCommit();
    if (commit) selectCommit(commit);
  }
});
els.selectedChange?.addEventListener("click", (event) => {
  const cellButton = event.target.closest("button[data-cell-id]");
  if (cellButton) {
    selectCellById(cellButton.dataset.cellId);
    return;
  }
  const changeButton = event.target.closest("button[data-change-id]");
  if (changeButton) {
    const change = infrastructureChanges().find((item) => item.id === changeButton.dataset.changeId);
    if (change) selectCommit(change);
    return;
  }
  const button = event.target.closest("button[data-impact-metric]");
  if (!button || !state.selectedCommit) return;
  state.metric = button.dataset.impactMetric;
  applySignalPreset(state.metric);
  updateMapStyles();
  renderLensTabs();
  renderMetrics();
  showCommitEvidence(state.selectedCommit);
});
document.querySelector(".change-filters")?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-change-filter]");
  if (!button) return;
  state.changeFilter = button.dataset.changeFilter;
  document.querySelectorAll("[data-change-filter]").forEach((item) => item.classList.toggle("active", item === button));
  renderCommits();
});
els.playButton.addEventListener("click", togglePlay);
els.presentButton.addEventListener("click", () => {
  state.year = SIMULATION_END_YEAR;
  state.selectedCommit = null;
  state.selectedCellId = null;
  state.selectedCellFeature = null;
  renderYear();
});
if (els.commitYearSelect) {
  els.commitYearSelect.addEventListener("change", (event) => {
    state.year = Number(event.target.value);
    state.selectedCommit = null;
    state.selectedCellId = null;
    state.selectedCellFeature = null;
    renderYear();
  });
}
els.fitTool.addEventListener("click", fitBelfast);
els.selectTool?.addEventListener("click", resetSelection);
els.resetSelection?.addEventListener("click", resetSelection);
els.postcodeSearch?.addEventListener("submit", (event) => {
  event.preventDefault();
  searchBelfastPostcode(els.postcodeInput?.value);
});
els.layersTool?.addEventListener("click", () => setView("layers"));
els.settingsTool?.addEventListener("click", () => setView("settings"));
els.labelsToggle?.addEventListener("change", (event) => {
  state.labelsVisible = Boolean(event.target.checked);
  updateMapStyles();
});
els.legendToggle?.addEventListener("change", (event) => {
  state.legendVisible = Boolean(event.target.checked);
  if (els.mapLegend) els.mapLegend.hidden = !state.legendVisible;
});
els.lightMap.addEventListener("click", () => {
  els.lightMap.classList.add("active");
  els.darkMap.classList.remove("active");
  setStyle("mapbox://styles/mapbox/light-v11");
});
els.darkMap.addEventListener("click", () => {
  els.darkMap.classList.add("active");
  els.lightMap.classList.remove("active");
  setStyle("mapbox://styles/mapbox/dark-v11");
});
els.toggle3d.addEventListener("click", () => {
  state.pitch3d = !state.pitch3d;
  els.toggle3d.classList.toggle("active", state.pitch3d);
  state.map.easeTo({ pitch: state.pitch3d ? 54 : 18, bearing: state.pitch3d ? -20 : 0, duration: 550 });
  updateMapStyles();
});

loadData()
  .then(() => {
    initMap();
  })
  .catch((error) => {
    els.manifestStatus.textContent = `Load failed: ${error.message}`;
  });

window.BelfastGitModeA = {
  state,
  metrics: REQUIRED_METRICS,
  setYear: (year) => {
    state.year = Number(year);
    state.selectedCommit = null;
    state.selectedCellId = null;
    state.selectedCellFeature = null;
    renderYear();
  },
  setMetric: (metric) => {
    if (!REQUIRED_METRICS.includes(metric)) return;
    state.metric = metric;
    applySignalPreset(metric);
    updateMapStyles();
    renderToggles();
    renderLensTabs();
    renderMetrics();
    renderCommits();
  },
  selectCommit: (metric) => {
    const commit = (state.modeA.commitsByYear[String(dataYear())] || []).find((item) => item.type === metric);
    if (commit) selectCommit(commit);
  },
  setChangeFilter: (filter) => {
    state.changeFilter = filter;
    document.querySelectorAll("[data-change-filter]").forEach((item) => {
      item.classList.toggle("active", item.dataset.changeFilter === filter);
    });
    renderCommits();
  },
  setView,
  resetSelection,
  selectCellById
};
