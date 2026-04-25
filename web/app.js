const REQUIRED_METRICS = ["traffic", "jobs", "electricity", "buildings", "services"];

const emptyFeatureCollection = { type: "FeatureCollection", features: [] };

const state = {
  manifest: null,
  modeA: null,
  map: null,
  year: 2026,
  metric: "traffic",
  activeView: "overview",
  selectedCommit: null,
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
  selectTool: document.querySelector("#selectTool")
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
  if (["layers", "settings"].includes(state.activeView)) return CONTEXT_REGISTRY;
  return CONTEXT_REGISTRY.filter((item) => layerBelongsToSignal(item));
}

function signalCommit(metric = state.metric) {
  return (state.modeA?.commitsByYear?.[String(state.year)] || []).find((commit) => commit.type === metric);
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
  state.year = modeA.years.at(-1);

  els.yearSlider.min = modeA.years[0];
  els.yearSlider.max = modeA.years.at(-1);
  els.yearSlider.value = state.year;
  updateLayerCount();
  els.manifestStatus.textContent = `${modeA.cellCount} cells`;
  if (els.commitYearSelect) {
    els.commitYearSelect.innerHTML = modeA.years.map((year) => `<option value="${year}">${year}</option>`).join("");
    els.commitYearSelect.value = state.year;
  }
}

function initMap() {
  mapboxgl.accessToken = state.manifest.mapbox.token;
  state.map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/light-v11",
    center: state.manifest.viewport.center,
    zoom: 11.85,
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
    if (feature) showCellEvidence(feature, event.lngLat);
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
      data: `/data/mode-a/grid_${state.year}.geojson`,
      promoteId: "cell_id"
    });
  }

  addVectorContextLayers();

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
      data: `/data/mode-a/electricity_${state.year}.geojson`
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
  setView(state.activeView);
}

function setView(view) {
  state.activeView = view;
  els.app?.setAttribute("data-view", view);
  els.app?.classList.toggle("show-layer-card", ["signals", "layers", "settings"].includes(view));
  els.app?.classList.toggle("focus-map", view === "overview");
  document.querySelectorAll(".icon-nav button[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  renderToggles();
  renderViewPanel();
  renderCommits();

  if (view === "overview") {
    fitBelfast();
  } else if (view === "signals") {
    els.layerCard?.focus?.();
  } else if (view === "commits") {
    focusRightPanel(".panel-header");
  } else if (view === "diff") {
    const commit = state.selectedCommit || signalCommit();
    if (commit) selectCommit(commit, { keepView: true });
    focusRightPanel(".selected-card");
  } else if (view === "layers" || view === "settings") {
    renderToggles();
  } else if (view === "compare") {
    renderComparePanel();
  } else if (view === "evidence") {
    if (!state.selectedCommit) {
      const commit = signalCommit();
      if (commit) selectCommit(commit, { keepView: true });
    }
    focusRightPanel(".evidence-card");
  } else if (view === "scenarios") {
    state.year = 2026;
    renderYear();
  }
}

function renderViewPanel() {
  if (!els.viewPanel) return;
  if (state.activeView === "signals") {
    const metric = METRIC_BY_ID[state.metric];
    els.viewPanel.hidden = false;
    els.viewPanel.innerHTML = `
      <strong>${escapeHtml(metric.label)} signal</strong>
      <p>${escapeHtml(metric.description)}. The map only shows this signal plus the filters that support it.</p>
      <div class="view-actions">
        <button type="button" data-action="select-current-commit">Open ${escapeHtml(metric.label)} commit</button>
        <button type="button" data-action="show-layers">Adjust filters</button>
      </div>
    `;
  } else if (state.activeView === "layers") {
    els.viewPanel.hidden = false;
    els.viewPanel.innerHTML = `
      <strong>Layer filters</strong>
      <p>Use the Signal Layers card to add context. Switching signals resets to a clean, signal-specific preset.</p>
    `;
  } else if (state.activeView === "settings") {
    els.viewPanel.hidden = false;
    els.viewPanel.innerHTML = `
      <strong>Display settings</strong>
      <p>Use the sidebar checkboxes for labels and legend, or the map buttons for basemap and 3D height.</p>
    `;
  } else if (state.activeView === "scenarios") {
    const metric = METRIC_BY_ID[state.metric];
    els.viewPanel.hidden = false;
    els.viewPanel.innerHTML = `
      <strong>2036 baseline preview</strong>
      <p>The simulation baseline starts from the 2026 ${escapeHtml(metric.label)} trend. Select a commit to inspect what would carry forward into Mode B.</p>
      <div class="view-actions"><button type="button" data-action="select-current-commit">Inspect 2026 trend</button></div>
    `;
  } else if (state.activeView === "compare") {
    renderComparePanel();
  } else {
    els.viewPanel.hidden = true;
    els.viewPanel.innerHTML = "";
  }
}

function renderComparePanel() {
  if (!els.viewPanel || !state.modeA) return;
  const cards = state.modeA.metricsByYear[String(state.year)] || [];
  els.viewPanel.hidden = false;
  els.viewPanel.innerHTML = `
    <strong>Compare years</strong>
    <p>Current view compares ${escapeHtml(state.year)} against the 2016 baseline.</p>
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
      updateSelectedCommitLayer();
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
  for (const year of state.modeA.years) {
    const tick = document.createElement("button");
    tick.type = "button";
    tick.textContent = year;
    tick.className = year === state.year ? "active" : "";
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
    button.classList.toggle("active", Number(button.textContent) === state.year);
  });
  const source = state.map?.getSource("mode-a-grid");
  if (source) source.setData(`/data/mode-a/grid_${state.year}.geojson`);
  const electricitySource = state.map?.getSource("electricity-replay");
  if (electricitySource) electricitySource.setData(`/data/mode-a/electricity_${state.year}.geojson`);
  if (state.selectedCommit && state.selectedCommit.year !== state.year) state.selectedCommit = null;
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
  const cards = state.modeA.metricsByYear[String(state.year)] || [];
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
          <small>${escapeHtml(card.deltaDisplay)} vs 2016, ${escapeHtml(card.trend)}</small>
        </span>
        <svg viewBox="0 0 120 44" aria-hidden="true"><polyline points="${series}" /></svg>
      </button>
    `;
    node.querySelector("button").addEventListener("click", () => {
      state.metric = card.metric;
      applySignalPreset(card.metric);
      updateMapStyles();
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
  const allCommits = state.modeA.commitsByYear[String(state.year)] || [];
  const showAll = ["commits", "compare"].includes(state.activeView);
  const commits = showAll ? allCommits : allCommits.filter((commit) => commit.type === state.metric);
  els.cityCommits.innerHTML = "";
  if (!showAll) {
    const notice = document.createElement("div");
    notice.className = "commit-filter-note";
    notice.innerHTML = `Showing ${escapeHtml(labelFor(state.metric))}. Open Commit Log for all ${allCommits.length} signals.`;
    els.cityCommits.append(notice);
  }
  for (const commit of commits) {
    const meta = METRIC_BY_ID[commit.type] || METRIC_BY_ID.traffic;
    const active = state.selectedCommit?.id === commit.id;
    const row = document.createElement("button");
    row.type = "button";
    row.className = `commit ${commit.tone}${active ? " selected" : ""}`;
    row.style.setProperty("--metric-color", meta.palette[2]);
    row.innerHTML = `
      <span class="commit-symbol">${escapeHtml(meta.icon)}</span>
      <span class="commit-body">
        <span class="commit-meta"><strong>${escapeHtml(labelFor(commit.type))}</strong><em>${escapeHtml(commit.month || state.year)}</em></span>
        <strong>${escapeHtml(commit.title)}</strong>
        <small>${escapeHtml(commit.subtitle || "")}</small>
        <span class="commit-foot"><span>${escapeHtml(commit.severity || "Medium")}</span><span>View diff</span></span>
      </span>
    `;
    row.addEventListener("click", () => selectCommit(commit));
    els.cityCommits.append(row);
  }
}

function labelFor(metric) {
  return METRIC_BY_ID[metric]?.label || metric.replace(/_/g, " ");
}

function selectCommit(commit, options = {}) {
  state.selectedCommit = { ...commit, year: state.year };
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
  updateSelectedCommitLayer();
  showCommitEvidence(commit);
}

async function updateSelectedCommitLayer() {
  const source = state.map?.getSource("commit-selection");
  if (!source) return;
  if (!state.selectedCommit?.cellIds?.length) {
    source.setData(emptyFeatureCollection);
    return;
  }
  const commitId = state.selectedCommit.id;
  try {
    const grid = await json(`/data/mode-a/grid_${state.year}.geojson`);
    if (state.selectedCommit?.id !== commitId) return;
    const wanted = new Set(state.selectedCommit.cellIds);
    source.setData({
      type: "FeatureCollection",
      features: grid.features.filter((feature) => wanted.has(feature.properties?.cell_id))
    });
  } catch (error) {
    source.setData(emptyFeatureCollection);
  }
}

function renderEmptySelectedChange() {
  if (!els.selectedChange) return;
  els.selectedChange.innerHTML = `
    <div class="empty-state">
      <strong>Select a commit</strong>
      <span>Click a city commit to highlight the affected map cells, inspect the evidence trail and see the signal impact.</span>
    </div>
  `;
  if (els.evidencePanel) {
    els.evidencePanel.textContent = "Select a city commit or grid cell to inspect source evidence and confidence.";
  }
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
          <small>${escapeHtml(labelFor(commit.type))} / ${escapeHtml(commit.month || state.year)}</small>
          <strong>${escapeHtml(commit.title)}</strong>
          <span>${escapeHtml(commit.severity || "Medium")} confidence focus, ${escapeHtml(signedPct(commit.delta || 0))} vs 2016</span>
        </div>
      </header>
      <p>${escapeHtml(commit.explanation || commit.subtitle || "")}</p>
      <section class="affected-table" aria-label="Affected signals">
        <strong>Affected signals</strong>
        ${affected.map((row) => `
          <div class="affected-row">
            <span>${escapeHtml(row.label)}</span>
            <em>${escapeHtml(row.impact)}</em>
            <b>${escapeHtml(signedPct(row.delta || 0))}</b>
          </div>
        `).join("")}
      </section>
      <section class="reasoning-trace">
        <strong>Planning readout</strong>
        <div id="geminiReadout" class="ai-readout">Deterministic readout ready. Gemini summary will appear here when a local API key is available.</div>
      </section>
      <a class="inspect-link" href="#evidencePanel">Inspect impact in detail</a>
    `;
  }
  if (els.evidencePanel) {
    els.evidencePanel.innerHTML = `
      <strong>${escapeHtml(commit.title)}</strong>
      <dl>
        <dt>Map diff</dt><dd><span>${escapeHtml(commit.mapInstruction || "Selected replay cells highlighted.")}</span></dd>
        <dt>Signal</dt><dd><span>${escapeHtml(labelFor(commit.type))} ${escapeHtml(commit.tone)}, delta ${escapeHtml(commit.delta)}</span></dd>
        <dt>Area</dt><dd><span>${escapeHtml(commit.area || "Belfast")}</span></dd>
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
      <dt>Confidence</dt><dd><span>${escapeHtml(props.confidence)} for location, proxy for load</span></dd>
      <dt>Evidence</dt><dd>${evidence.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</dd>
    </dl>
  `;
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
  state.map.fitBounds(state.modeA.bbox, {
    padding: { top: 60, right: 60, bottom: 170, left: 60 },
    pitch: state.pitch3d ? 54 : 18,
    bearing: state.pitch3d ? -20 : 0,
    duration: 800
  });
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
    const index = state.modeA.years.indexOf(state.year);
    state.year = state.modeA.years[(index + 1) % state.modeA.years.length];
    state.selectedCommit = null;
    renderYear();
  }, 1050);
}

els.yearSlider.addEventListener("input", (event) => {
  state.year = Number(event.target.value);
  state.selectedCommit = null;
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
els.playButton.addEventListener("click", togglePlay);
els.presentButton.addEventListener("click", () => {
  state.year = 2026;
  state.selectedCommit = null;
  renderYear();
});
if (els.commitYearSelect) {
  els.commitYearSelect.addEventListener("change", (event) => {
    state.year = Number(event.target.value);
    state.selectedCommit = null;
    renderYear();
  });
}
els.fitTool.addEventListener("click", fitBelfast);
els.selectTool?.addEventListener("click", () => {
  state.selectedCommit = null;
  updateSelectedCommitLayer();
  renderCommits();
  renderEmptySelectedChange();
  setView("overview");
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
    const commit = (state.modeA.commitsByYear[String(state.year)] || []).find((item) => item.type === metric);
    if (commit) selectCommit(commit);
  },
  setView
};
