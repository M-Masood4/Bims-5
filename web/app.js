const state = {
  manifest: null,
  modeA: null,
  map: null,
  year: 2026,
  metric: "development_pressure",
  playing: false,
  timer: null,
  pitch3d: false,
  layers: {
    buildings: true,
    development_pressure: true,
    mobility_access: true,
    green_cover: true,
    air_quality: true,
    deprivation_weighted_opportunity: true,
    fairness_context: false
  }
};

const els = {
  layerToggles: document.querySelector("#layerToggles"),
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

const LAYER_REGISTRY = [
  { id: "buildings", label: "Buildings", icon: "▥", metric: null },
  { id: "development_pressure", label: "Development", icon: "▦", metric: "development_pressure" },
  { id: "mobility_access", label: "Mobility", icon: "⌁", metric: "mobility_access" },
  { id: "green_cover", label: "Green cover", icon: "♧", metric: "green_cover" },
  { id: "air_quality", label: "Air quality", icon: "☁", metric: "air_quality" },
  { id: "deprivation_weighted_opportunity", label: "Opportunity", icon: "★", metric: "deprivation_weighted_opportunity" },
  { id: "fairness_context", label: "Fairness", icon: "⚖", metric: "fairness_context" }
];

const METRIC_LABELS = {
  development_pressure: "Development pressure",
  mobility_access: "Mobility access",
  green_cover: "Green cover",
  air_quality: "Air quality",
  deprivation_weighted_opportunity: "Opportunity fairness",
  fairness_context: "Fairness context"
};

const METRIC_COLOURS = {
  development_pressure: ["#2166ac", "#f7f7f7", "#b2182b"],
  mobility_access: ["#f97316", "#f7f7f7", "#2563eb"],
  green_cover: ["#b45309", "#f7f7f7", "#16a34a"],
  air_quality: ["#7c2d12", "#f7f7f7", "#7c3aed"],
  deprivation_weighted_opportunity: ["#9f1239", "#f7f7f7", "#0f766e"],
  fairness_context: ["#334155", "#f7f7f7", "#e11d48"]
};

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
  els.manifestStatus.textContent = `${modeA.cellCount} grid cells · ${manifest.sourceArtifacts.length} source artifacts`;
}

function initMap() {
  mapboxgl.accessToken = state.manifest.mapbox.token;
  state.map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/light-v11",
    center: state.manifest.viewport.center,
    zoom: 11.8,
    pitch: 24,
    bearing: -16,
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
  state.map.on("mouseenter", "mode-a-grid-fill", () => {
    state.map.getCanvas().style.cursor = "pointer";
  });
  state.map.on("mouseleave", "mode-a-grid-fill", () => {
    state.map.getCanvas().style.cursor = "";
  });
}

function addModeALayers() {
  state.map.addSource("mode-a-grid", {
    type: "geojson",
    data: `/data/mode-a/grid_${state.year}.geojson`,
    promoteId: "cell_id"
  });
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
      "line-color": "rgba(15,23,42,0.24)",
      "line-width": 0.45
    }
  });

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
        "fill-extrusion-color": "#0f766e",
        "fill-extrusion-height": ["*", ["coalesce", ["to-number", ["get", "replay_height_m"]], 8], 0.72],
        "fill-extrusion-opacity": 0.36
      }
    });
  }
}

function gridPaint() {
  const [low, mid, high] = METRIC_COLOURS[state.metric] || METRIC_COLOURS.development_pressure;
  return {
    "fill-color": [
      "interpolate",
      ["linear"],
      ["coalesce", ["to-number", ["get", state.metric]], 0.5],
      0,
      low,
      0.5,
      mid,
      1,
      high
    ],
    "fill-opacity": [
      "case",
      ["boolean", ["feature-state", "hover"], false],
      0.72,
      state.layers[state.metric] === false ? 0 : 0.54
    ]
  };
}

function renderAll() {
  renderToggles();
  renderTimeline();
  renderYear();
}

function renderToggles() {
  els.layerToggles.innerHTML = "";
  for (const layer of LAYER_REGISTRY) {
    const enabled = state.layers[layer.id] !== false;
    const row = document.createElement("button");
    row.type = "button";
    row.className = `switch-row${enabled ? " active" : ""}`;
    row.innerHTML = `
      <span class="switch-icon">${escapeHtml(layer.icon)}</span>
      <span class="switch-copy"><strong>${escapeHtml(layer.label)}</strong><small>${layer.metric ? "grid diff overlay" : "3D context"}</small></span>
      <span class="switch-knob"></span>
    `;
    row.addEventListener("click", () => {
      state.layers[layer.id] = !enabled;
      if (layer.metric && state.layers[layer.id]) state.metric = layer.metric;
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
  updateMapStyles();
  renderMetrics();
  renderCommits();
}

function updateMapStyles() {
  if (!state.map?.getLayer("mode-a-grid-fill")) return;
  els.legendMetric.textContent = METRIC_LABELS[state.metric] || state.metric;
  state.map.setPaintProperty("mode-a-grid-fill", "fill-color", gridPaint()["fill-color"]);
  state.map.setPaintProperty("mode-a-grid-fill", "fill-opacity", gridPaint()["fill-opacity"]);
  if (state.map.getLayer("replay-buildings")) {
    state.map.setLayoutProperty("replay-buildings", "visibility", state.layers.buildings ? "visible" : "none");
    state.map.setPaintProperty("replay-buildings", "fill-extrusion-height", [
      "*",
      ["coalesce", ["to-number", ["get", "replay_height_m"]], 8],
      state.pitch3d ? 1.0 : 0.28
    ]);
    state.map.easeTo({ pitch: state.pitch3d ? 58 : 24, bearing: state.pitch3d ? -24 : -12, duration: 550 });
  }
}

function renderMetrics() {
  const cards = state.modeA.metricsByYear[String(state.year)] || [];
  els.metricCards.innerHTML = "";
  for (const card of cards) {
    const node = document.createElement("article");
    node.className = `metric-card ${card.trend}`;
    const series = card.sparkline.map((point, index) => `${index * 12},${42 - point * 34}`).join(" ");
    node.innerHTML = `
      <div class="metric-icon">${iconForMetric(card.metric)}</div>
      <div class="metric-copy">
        <strong>${escapeHtml(card.label)}</strong>
        <span class="metric-value">${escapeHtml(card.display)}</span>
        <small>${escapeHtml(card.deltaDisplay)} vs 2016 · ${escapeHtml(card.trend)}</small>
      </div>
      <svg viewBox="0 0 120 44" aria-hidden="true"><polyline points="${series}" /></svg>
    `;
    els.metricCards.append(node);
  }
}

function iconForMetric(metric) {
  if (metric.includes("development")) return "▦";
  if (metric.includes("mobility")) return "⌁";
  if (metric.includes("air")) return "☁";
  if (metric.includes("green")) return "♧";
  return "★";
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
      <span><strong>${escapeHtml(commit.title)}</strong><small>${escapeHtml(commit.type)} · ${escapeHtml(commit.confidence)} confidence · Δ ${escapeHtml(commit.delta)}</small></span>
    `;
    row.addEventListener("click", () => showCommitEvidence(commit));
    els.cityCommits.append(row);
  }
}

function showCommitEvidence(commit) {
  els.evidencePanel.innerHTML = `
    <strong>${escapeHtml(commit.title)}</strong>
    <dl>
      <dt>Diff</dt><dd>${escapeHtml(commit.symbol)} ${escapeHtml(commit.tone)} · Δ ${escapeHtml(commit.delta)}</dd>
      <dt>Confidence</dt><dd>${escapeHtml(commit.confidence)}</dd>
      <dt>Evidence</dt><dd>${commit.evidence.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</dd>
    </dl>
  `;
}

function showCellEvidence(feature, lngLat) {
  const props = feature.properties;
  const evidence = JSON.parse(props.evidence || "[]");
  els.evidencePanel.innerHTML = `
    <strong>Grid cell ${escapeHtml(props.cell_id)}</strong>
    <dl>
      <dt>Dominant change</dt><dd>${escapeHtml(props.dominant_change)}</dd>
      <dt>Confidence</dt><dd>${escapeHtml(props.confidence)}</dd>
      <dt>${escapeHtml(METRIC_LABELS[state.metric])}</dt><dd>${pct(Number(props[state.metric]))} · Δ ${escapeHtml(props[`${state.metric}_delta_2016`])}</dd>
      <dt>Evidence</dt><dd>${evidence.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</dd>
    </dl>
  `;
  els.evidencePopover.hidden = false;
  els.evidencePopover.innerHTML = `<strong>${escapeHtml(props.dominant_change)}</strong><span>${escapeHtml(props.confidence)} confidence</span>`;
  const point = state.map.project(lngLat);
  els.evidencePopover.style.left = `${Math.min(point.x + 12, window.innerWidth - 260)}px`;
  els.evidencePopover.style.top = `${Math.max(point.y - 24, 80)}px`;
  window.clearTimeout(showCellEvidence.timer);
  showCellEvidence.timer = window.setTimeout(() => {
    els.evidencePopover.hidden = true;
  }, 2800);
}

function fitBelfast() {
  state.map.fitBounds(state.modeA.bbox, { padding: 60, pitch: state.pitch3d ? 58 : 24, bearing: state.pitch3d ? -24 : -12, duration: 800 });
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
  els.playButton.textContent = state.playing ? "Ⅱ" : "▶";
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
  setYear: (year) => {
    state.year = Number(year);
    renderYear();
  },
  setMetric: (metric) => {
    state.metric = metric;
    state.layers[metric] = true;
    updateMapStyles();
    renderToggles();
    renderMetrics();
  }
};
