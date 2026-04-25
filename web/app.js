const REQUIRED_METRICS = [
  "population_pressure",
  "mobility_strain",
  "economic_opportunity",
  "environmental_exposure",
  "fairness_score"
];

const state = {
  manifest: null,
  modeA: null,
  map: null,
  year: 2026,
  metric: "population_pressure",
  playing: false,
  timer: null,
  pitch3d: true,
  layers: {
    population_pressure: true,
    mobility_strain: true,
    economic_opportunity: true,
    environmental_exposure: true,
    fairness_score: true,
    change_heatmap: true,
    boundaries: true,
    buildings: true,
    roads: true,
    transit: true,
    green: true,
    water: true,
    electricity: true,
    services: false
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
  evidencePanel: document.querySelector("#evidencePanel"),
  evidencePopover: document.querySelector("#evidencePopover"),
  legendMetric: document.querySelector("#legendMetric")
};

const LENS_REGISTRY = [
  {
    id: "population_pressure",
    label: "Population Pressure",
    icon: "P",
    description: "density, housing and service pressure",
    goodDirection: "down",
    palette: ["#f8fafc", "#f59e0b", "#dc2626"]
  },
  {
    id: "mobility_strain",
    label: "Mobility Strain",
    icon: "M",
    description: "traffic pressure, transit gaps, bike access",
    goodDirection: "down",
    palette: ["#eff6ff", "#60a5fa", "#1d4ed8"]
  },
  {
    id: "economic_opportunity",
    label: "Economic Opportunity",
    icon: "O",
    description: "jobs, education, services and access",
    goodDirection: "up",
    palette: ["#fff7ed", "#facc15", "#0f766e"]
  },
  {
    id: "environmental_exposure",
    label: "Environmental Exposure",
    icon: "E",
    description: "air, road, green-cover and flood exposure",
    goodDirection: "down",
    palette: ["#faf5ff", "#c084fc", "#7e22ce"]
  },
  {
    id: "fairness_score",
    label: "Fairness Score",
    icon: "F",
    description: "who benefits and underserved gaps",
    goodDirection: "up",
    palette: ["#fff1f2", "#38bdf8", "#0f766e"]
  }
];

const CONTEXT_REGISTRY = [
  { id: "change_heatmap", label: "Heatmap", icon: "H", description: "selected lens and traffic intensity" },
  { id: "boundaries", label: "District Grid", icon: "B", description: "replay cell boundaries" },
  { id: "buildings", label: "3D Buildings", icon: "3D", description: "OSM building skeleton" },
  { id: "roads", label: "Roads", icon: "R", description: "major streets and access corridors" },
  { id: "transit", label: "Transit", icon: "T", description: "routes and stops" },
  { id: "green", label: "Parks", icon: "G", description: "green-space context" },
  { id: "water", label: "River", icon: "W", description: "River Lagan and water" },
  { id: "electricity", label: "Electricity", icon: "E", description: "power grid lines and headroom" },
  { id: "services", label: "Services", icon: "S", description: "health, education, civic, commercial" }
];

const METRIC_BY_ID = Object.fromEntries(LENS_REGISTRY.map((metric) => [metric.id, metric]));
const CONTEXT_LAYER_IDS = new Map();

function formatNumber(value) {
  return Number.isFinite(value) ? value.toLocaleString() : "0";
}

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function json(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function createLayerGroup(category) {
  if (!CONTEXT_LAYER_IDS.has(category)) CONTEXT_LAYER_IDS.set(category, []);
  return CONTEXT_LAYER_IDS.get(category);
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
  els.sourceTotal.textContent = `${modeA.sources.length} active`;
  els.manifestStatus.textContent = `${modeA.cellCount} cells, ${manifest.sourceArtifacts.length} source artifacts`;
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
  state.map.addSource("mode-a-grid", {
    type: "geojson",
    data: `/data/mode-a/grid_${state.year}.geojson`,
    promoteId: "cell_id"
  });

  addVectorContextLayers();

  state.map.addLayer({
    id: "mode-a-grid-fill",
    type: "fill",
    source: "mode-a-grid",
    paint: gridPaint()
  });
  state.map.addLayer({
    id: "mode-a-grid-line",
    type: "line",
    source: "mode-a-grid",
    paint: {
      "line-color": "rgba(15,23,42,0.26)",
      "line-width": 0.35
    }
  });
  addElectricityLayers();

  const buildingLayer = state.manifest.layers.find((layer) => layer.id === "belfast-ni-buildings-3d");
  if (buildingLayer) {
    state.map.addSource("replay-buildings", {
      type: "geojson",
      data: buildingLayer.apiPath
    });
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
        "fill-extrusion-opacity": 0.44
      }
    });
    createLayerGroup("buildings").push("replay-buildings");
  }
}

function addVectorContextLayers() {
  const layers = state.manifest.layers.filter((layer) => layer.id !== "belfast-ni-buildings-3d");
  for (const layer of layers) {
    if (!["roads", "transit", "green", "water", "services", "boundary"].includes(layer.category)) continue;
    const sourceId = `source-${layer.id}`;
    state.map.addSource(sourceId, { type: "geojson", data: layer.apiPath });
    const color = layer.render?.color || "#64748b";
    const category = layer.category === "boundary" ? "water" : layer.category;
    const group = createLayerGroup(category);

    if ((layer.geometryTypes || []).some((type) => type.includes("Polygon"))) {
      const id = `${layer.id}-fill`;
      state.map.addLayer({
        id,
        type: "fill",
        source: sourceId,
        filter: ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false],
        paint: {
          "fill-color": color,
          "fill-opacity": layer.category === "water" ? 0.42 : layer.category === "green" ? 0.3 : 0.18
        }
      });
      group.push(id);
    }

    if ((layer.geometryTypes || []).some((type) => type.includes("LineString"))) {
      const id = `${layer.id}-line`;
      state.map.addLayer({
        id,
        type: "line",
        source: sourceId,
        filter: ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": color,
          "line-width": layer.category === "roads" ? 2.2 : layer.category === "transit" ? 2.8 : 1.6,
          "line-opacity": layer.category === "roads" ? 0.76 : 0.82
        }
      });
      group.push(id);
    }

    if ((layer.geometryTypes || []).some((type) => type === "Point" || type === "MultiPoint")) {
      const id = `${layer.id}-circle`;
      state.map.addLayer({
        id,
        type: "circle",
        source: sourceId,
        filter: ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false],
        paint: {
          "circle-color": color,
          "circle-radius": layer.category === "transit" ? 4.5 : 3.3,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1,
          "circle-opacity": 0.86
        }
      });
      group.push(id);
    }
  }
}

function addElectricityLayers() {
  state.map.addSource("electricity-replay", {
    type: "geojson",
    data: `/data/mode-a/electricity_${state.year}.geojson`
  });
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
  state.map.addLayer({
    id: "electricity-line",
    type: "line",
    source: "electricity-replay",
    filter: ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": electricityColorExpression(),
      "line-width": ["interpolate", ["linear"], ["coalesce", ["to-number", ["get", "grid_load_pct"]], 50], 0, 1.2, 65, 2.4, 90, 4.6],
      "line-opacity": 0.82
    }
  });
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
      "circle-opacity": 0.9
    }
  });
  createLayerGroup("electricity").push("electricity-fill", "electricity-line", "electricity-circle");
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

function gridPaint() {
  const metric = METRIC_BY_ID[state.metric] || METRIC_BY_ID.population_pressure;
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
    "fill-opacity": state.layers.change_heatmap === false ? 0 : 0.38
  };
}

function renderAll() {
  renderLensTabs();
  renderToggles();
  renderTimeline();
  renderYear();
}

function renderLensTabs() {
  if (!els.lensTabs) return;
  els.lensTabs.innerHTML = "";
  for (const metric of LENS_REGISTRY) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `lens-tab${state.metric === metric.id ? " active" : ""}`;
    button.innerHTML = `<span>${escapeHtml(metric.icon)}</span>${escapeHtml(metric.label)}`;
    button.addEventListener("click", () => {
      state.metric = metric.id;
      state.layers.change_heatmap = true;
      updateMapStyles();
      renderLensTabs();
      renderMetrics();
    });
    els.lensTabs.append(button);
  }
}

function renderToggles() {
  els.layerToggles.innerHTML = "";
  renderSwitchGroup("Map Layers", CONTEXT_REGISTRY, false);
}

function renderSwitchGroup(title, items, metrics) {
  const heading = document.createElement("div");
  heading.className = "switch-subtitle";
  heading.textContent = title;
  els.layerToggles.append(heading);

  for (const item of items) {
    const enabled = state.layers[item.id] !== false;
    const row = document.createElement("button");
    row.type = "button";
    row.className = `switch-row${enabled ? " active" : ""}${state.metric === item.id ? " selected" : ""}`;
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

function renderTimeline() {
  els.yearTicks.innerHTML = "";
  for (const year of state.modeA.years) {
    const tick = document.createElement("button");
    tick.type = "button";
    tick.textContent = year;
    tick.className = year === state.year ? "active" : "";
    tick.addEventListener("click", () => {
      state.year = year;
      renderYear();
    });
    els.yearTicks.append(tick);
  }
}

function renderYear() {
  els.currentYearLabel.textContent = state.year;
  els.yearSlider.value = state.year;
  document.querySelectorAll("#yearTicks button").forEach((button) => {
    button.classList.toggle("active", Number(button.textContent) === state.year);
  });
  const source = state.map?.getSource("mode-a-grid");
  if (source) source.setData(`/data/mode-a/grid_${state.year}.geojson`);
  const electricitySource = state.map?.getSource("electricity-replay");
  if (electricitySource) electricitySource.setData(`/data/mode-a/electricity_${state.year}.geojson`);
  updateMapStyles();
  renderMetrics();
  renderCommits();
}

function updateMapStyles() {
  if (!state.map?.getLayer("mode-a-grid-fill")) return;
  const metricMeta = METRIC_BY_ID[state.metric] || METRIC_BY_ID.population_pressure;
  els.legendMetric.textContent = metricMeta.label;
  state.map.setPaintProperty("mode-a-grid-fill", "fill-color", gridPaint()["fill-color"]);
  state.map.setPaintProperty("mode-a-grid-fill", "fill-opacity", gridPaint()["fill-opacity"]);
  if (state.map.getLayer("mode-a-grid-line")) {
    state.map.setLayoutProperty("mode-a-grid-line", "visibility", state.layers.boundaries === false ? "none" : "visible");
  }

  for (const [category, ids] of CONTEXT_LAYER_IDS.entries()) {
    for (const id of ids) {
      if (state.map.getLayer(id)) {
        state.map.setLayoutProperty(id, "visibility", state.layers[category] === false ? "none" : "visible");
      }
    }
  }
  for (const id of ["electricity-fill", "electricity-line", "electricity-circle"]) {
    if (state.map.getLayer(id)) {
      state.map.setLayoutProperty(id, "visibility", state.layers.electricity === false ? "none" : "visible");
    }
  }

  if (state.map.getLayer("replay-buildings")) {
    state.map.setFilter("replay-buildings", ["<=", ["to-number", ["get", "replay_first_visible_year"]], state.year]);
    state.map.setLayoutProperty("replay-buildings", "visibility", state.layers.buildings ? "visible" : "none");
    state.map.setPaintProperty("replay-buildings", "fill-extrusion-height", [
      "*",
      ["coalesce", ["to-number", ["get", "replay_height_m"]], 8],
      state.pitch3d ? 1.0 : 0.18
    ]);
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
    const series = card.sparkline.map((point, index) => `${index * 12},${42 - point * 34}`).join(" ");
    node.innerHTML = `
      <button type="button" class="metric-select" aria-label="Show ${escapeHtml(card.label)}">
        <span class="metric-icon">${escapeHtml(meta.icon || card.label[0])}</span>
        <span class="metric-copy">
          <strong>${escapeHtml(card.label)}</strong>
          <span class="metric-value">${escapeHtml(card.display)}</span>
          <small>${escapeHtml(card.deltaDisplay)} vs 2016, ${escapeHtml(card.trend)}</small>
        </span>
        <svg viewBox="0 0 120 44" aria-hidden="true"><polyline points="${series}" /></svg>
      </button>
      <p>${escapeHtml(card.mapShows || meta.description || "")}</p>
    `;
    node.querySelector("button").addEventListener("click", () => {
      state.metric = card.metric;
      state.layers[card.metric] = true;
      updateMapStyles();
      renderToggles();
      renderLensTabs();
      renderMetrics();
    });
    els.metricCards.append(node);
  }
}

function renderCommits() {
  const commits = state.modeA.commitsByYear[String(state.year)] || [];
  els.cityCommits.innerHTML = "";
  for (const commit of commits) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `commit ${commit.tone}`;
    row.innerHTML = `
      <span class="commit-symbol">${escapeHtml(commit.symbol)}</span>
      <span><strong>${escapeHtml(commit.title)}</strong><small>${escapeHtml(labelFor(commit.type))}, ${escapeHtml(commit.confidence)} confidence, delta ${escapeHtml(commit.delta)}</small></span>
    `;
    row.addEventListener("click", () => {
      state.metric = commit.type;
      state.layers[commit.type] = true;
      updateMapStyles();
      renderToggles();
      renderLensTabs();
      renderMetrics();
      showCommitEvidence(commit);
    });
    els.cityCommits.append(row);
  }
}

function labelFor(metric) {
  return METRIC_BY_ID[metric]?.label || metric.replace(/_/g, " ");
}

function showCommitEvidence(commit) {
  els.evidencePanel.innerHTML = `
    <strong>${escapeHtml(commit.title)}</strong>
    <dl>
      <dt>Lens</dt><dd>${escapeHtml(labelFor(commit.type))}</dd>
      <dt>Diff</dt><dd>${escapeHtml(commit.symbol)} ${escapeHtml(commit.tone)} since 2016, delta ${escapeHtml(commit.delta)}</dd>
      <dt>Confidence</dt><dd>${escapeHtml(commit.confidence)}</dd>
      <dt>Evidence</dt><dd>${commit.evidence.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</dd>
    </dl>
  `;
}

function showCellEvidence(feature, lngLat) {
  const props = feature.properties;
  const evidence = Array.isArray(props.evidence) ? props.evidence : JSON.parse(props.evidence || "[]");
  const value = Number(props[state.metric]);
  const delta = props[`${state.metric}_delta_2016`];
  els.evidencePanel.innerHTML = `
    <strong>Grid cell ${escapeHtml(props.cell_id)}</strong>
    <dl>
      <dt>Selected Lens</dt><dd>${escapeHtml(labelFor(state.metric))}: ${pct(value)}, delta ${escapeHtml(delta)}</dd>
      <dt>Dominant Change</dt><dd>${escapeHtml(labelFor(props.dominant_metric))} ${escapeHtml(props.dominant_change)}</dd>
      <dt>Supporting Signals</dt><dd>
        <span>Development pressure ${pct(Number(props.development_pressure))}</span>
        <span>Traffic pressure ${pct(Number(props.traffic_pressure))}</span>
        <span>Green cover ${pct(Number(props.green_cover))}</span>
        <span>Tree canopy context ${pct(Number(props.tree_canopy_context))}</span>
        <span>Transit access ${pct(Number(props.transit_access))}</span>
        <span>Bike access ${pct(Number(props.bike_access))}</span>
        <span>Bike trip index ${pct(Number(props.bike_trip_index))}</span>
        <span>Civic service context ${pct(Number(props.civic_service_context))}</span>
      </dd>
      <dt>Confidence</dt><dd>${escapeHtml(props.confidence)}</dd>
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
  const evidence = Array.isArray(props.evidence) ? props.evidence : JSON.parse(props.evidence || "[]");
  els.evidencePanel.innerHTML = `
    <strong>${escapeHtml(props.name || props.power || "Electricity asset")}</strong>
    <dl>
      <dt>Grid Status</dt><dd>${escapeHtml(props.status)} load, ${escapeHtml(props.grid_load_pct)}% estimated load, ${escapeHtml(props.headroom_pct)}% headroom</dd>
      <dt>Asset</dt><dd>${escapeHtml(props.power || "power")} ${props.voltage ? `, ${escapeHtml(props.voltage)} volts` : ""}</dd>
      <dt>Confidence</dt><dd>${escapeHtml(props.confidence)} for location, proxy for load</dd>
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
    renderYear();
  }, 1050);
}

els.yearSlider.addEventListener("input", (event) => {
  state.year = Number(event.target.value);
  renderYear();
});
els.playButton.addEventListener("click", togglePlay);
els.presentButton.addEventListener("click", () => {
  state.year = 2026;
  renderYear();
});
els.fitTool.addEventListener("click", fitBelfast);
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
    renderYear();
  },
  setMetric: (metric) => {
    if (!REQUIRED_METRICS.includes(metric)) return;
    state.metric = metric;
    state.layers[metric] = true;
    updateMapStyles();
    renderToggles();
    renderLensTabs();
    renderMetrics();
  }
};
