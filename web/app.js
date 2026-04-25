const state = {
  manifest: null,
  map: null,
  loadedLayers: new Map(),
  activeLayerIds: new Set()
};

const elements = {
  manifestStatus: document.querySelector("#manifestStatus"),
  yearSelect: document.querySelector("#yearSelect"),
  yearSummary: document.querySelector("#yearSummary"),
  layerToggles: document.querySelector("#layerToggles"),
  summaryStats: document.querySelector("#summaryStats"),
  provenanceList: document.querySelector("#provenanceList"),
  resetView: document.querySelector("#resetView"),
  mapNotice: document.querySelector("#mapNotice")
};

const statusLabels = {
  ready: "ready",
  "pending-etl": "pending",
  "source-available": "source",
  "source-available-heavy": "heavy"
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "n/a";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toLocaleString() : "n/a";
}

function layerColor(layer) {
  return layer.render?.color || "#4b5563";
}

function apiUrlForLayer(layer) {
  return layer.apiPath || `/${layer.path}`;
}

function initMap(manifest) {
  const [lat, lng] = manifest.viewport.center;
  state.map = L.map("map", {
    zoomControl: true,
    preferCanvas: true
  }).setView([lat, lng], manifest.viewport.zoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(state.map);

  fitFocusBounds();
}

function fitFocusBounds() {
  const bbox = state.manifest?.viewport?.focusBbox;
  if (!bbox || !state.map) return;
  state.map.fitBounds(
    [
      [bbox[1], bbox[0]],
      [bbox[3], bbox[2]]
    ],
    { padding: [24, 24] }
  );
}

function buildPopup(layer, feature) {
  const props = feature.properties || {};
  const title = props.name || props["@id"] || layer.label;
  const type = props.amenity || props.highway || props.building || props.landuse || props.natural || props.tourism || layer.category;
  const sourceId = props["@id"] ? `<div class="popup-line">${props["@id"]}</div>` : "";
  return `
    <div class="popup-title">${escapeHtml(title)}</div>
    <div class="popup-line">${escapeHtml(layer.label)} - ${escapeHtml(type || "feature")}</div>
    ${sourceId}
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function createGeoJsonLayer(layer, data) {
  const color = layerColor(layer);
  return L.geoJSON(data, {
    style: () => ({
      color,
      weight: layer.render?.weight ?? 2,
      opacity: layer.render?.opacity ?? 0.78,
      fillColor: color,
      fillOpacity: layer.render?.fillOpacity ?? 0.12
    }),
    pointToLayer: (_feature, latlng) =>
      L.circleMarker(latlng, {
        radius: 5,
        color,
        weight: 2,
        fillColor: "#fff",
        fillOpacity: 0.92
      }),
    onEachFeature: (feature, leafletLayer) => {
      leafletLayer.bindPopup(buildPopup(layer, feature));
    }
  });
}

async function toggleLayer(layer, enabled) {
  if (!state.map || layer.metadataOnly) return;

  if (!enabled) {
    const existing = state.loadedLayers.get(layer.id);
    if (existing) {
      state.map.removeLayer(existing.leafletLayer);
    }
    state.activeLayerIds.delete(layer.id);
    updateSummary();
    return;
  }

  state.activeLayerIds.add(layer.id);
  const cached = state.loadedLayers.get(layer.id);
  if (cached) {
    cached.leafletLayer.addTo(state.map);
    updateSummary();
    return;
  }

  setNotice(`Loading ${layer.label}...`);
  try {
    const response = await fetch(apiUrlForLayer(layer));
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const leafletLayer = createGeoJsonLayer(layer, data).addTo(state.map);
    state.loadedLayers.set(layer.id, {
      layer,
      leafletLayer,
      featureCount: Array.isArray(data.features) ? data.features.length : layer.featureCount || 0
    });
    setNotice(`Loaded ${layer.label}`);
  } catch (error) {
    state.activeLayerIds.delete(layer.id);
    setNotice(`Could not load ${layer.label}: ${error.message}`);
    const checkbox = document.querySelector(`[data-layer-id="${layer.id}"]`);
    if (checkbox) checkbox.checked = false;
  }
  updateSummary();
}

function setNotice(message) {
  elements.mapNotice.textContent = message;
  if (message) {
    window.clearTimeout(setNotice.timer);
    setNotice.timer = window.setTimeout(() => {
      elements.mapNotice.textContent = "";
    }, 3600);
  }
}

function timelineForYear(year) {
  return state.manifest.timeline.find((item) => item.year === year);
}

function layersForYear(year) {
  return state.manifest.layers.filter((layer) => layer.year === year);
}

function renderYearOptions() {
  elements.yearSelect.innerHTML = "";
  for (const year of state.manifest.years) {
    const option = document.createElement("option");
    option.value = year;
    option.textContent = year;
    if (year === 2026) option.selected = true;
    elements.yearSelect.append(option);
  }
}

function renderYear(year) {
  const timeline = timelineForYear(year);
  const layers = layersForYear(year);

  elements.yearSummary.textContent = timeline?.summary || "No timeline metadata is available for this year.";
  renderLayerToggles(layers);
  renderProvenance(year, layers);
  updateSummary();

  const visibleLayers = layers.filter((layer) => layer.defaultVisible && !layer.metadataOnly && layer.status === "ready");
  for (const layer of visibleLayers) {
    const checkbox = document.querySelector(`[data-layer-id="${layer.id}"]`);
    if (checkbox) checkbox.checked = true;
    toggleLayer(layer, true);
  }

  if (!visibleLayers.length) {
    setNotice(timeline?.status === "pending-etl" ? "No renderable layers for this year yet." : "");
  }
}

function renderLayerToggles(layers) {
  elements.layerToggles.innerHTML = "";
  if (!layers.length) {
    elements.layerToggles.innerHTML = '<div class="empty-state">No layers have been registered for this year.</div>';
    return;
  }

  for (const layer of layers) {
    const row = document.createElement("label");
    row.className = "layer-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.layerId = layer.id;
    checkbox.disabled = layer.metadataOnly || layer.status !== "ready";
    checkbox.addEventListener("change", () => toggleLayer(layer, checkbox.checked));

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = layer.metadataOnly ? "#f3f4f6" : layerColor(layer);

    const content = document.createElement("span");
    const status = statusLabels[layer.status] || layer.status;
    content.innerHTML = `
      <span class="layer-label">
        <span>${escapeHtml(layer.label)}</span>
        <span class="badge ${escapeHtml(layer.status)}">${escapeHtml(status)}</span>
      </span>
      <span class="layer-meta">${escapeHtml(layer.type)} - ${formatNumber(layer.featureCount)} features - ${formatBytes(layer.byteSize)}</span>
    `;

    row.append(checkbox, swatch, content);
    elements.layerToggles.append(row);
  }
}

function renderProvenance(year, layers) {
  const artifacts = state.manifest.sourceArtifacts.filter((artifact) => artifact.year === year);
  const items = [...layers, ...artifacts];
  elements.provenanceList.innerHTML = "";

  if (!items.length) {
    elements.provenanceList.innerHTML = '<div class="empty-state">No source artifacts are registered for this year.</div>';
    return;
  }

  for (const item of items) {
    const provenance = item.provenance || {};
    const node = document.createElement("div");
    node.className = "provenance-item";
    node.innerHTML = `
      <div class="provenance-name">${escapeHtml(item.label)}</div>
      <div class="provenance-meta">${escapeHtml(item.path || "no path")} - ${formatBytes(item.byteSize)}</div>
      <div class="provenance-meta">${escapeHtml(provenance.sourceName || item.status)} - ${escapeHtml(provenance.license || "license pending")}</div>
    `;
    elements.provenanceList.append(node);
  }
}

function updateSummary() {
  const year = Number(elements.yearSelect.value);
  const layers = layersForYear(year);
  const timeline = timelineForYear(year);
  const renderable = layers.filter((layer) => !layer.metadataOnly && layer.status === "ready");
  const declaredFeatures = renderable.reduce((sum, layer) => sum + (layer.featureCount || 0), 0);
  const activeFeatures = [...state.activeLayerIds].reduce((sum, id) => {
    const cached = state.loadedLayers.get(id);
    return sum + (cached?.featureCount || 0);
  }, 0);

  elements.summaryStats.innerHTML = `
    <dt>Status</dt><dd>${escapeHtml(timeline?.status || "unknown")}</dd>
    <dt>Registered layers</dt><dd>${formatNumber(layers.length)}</dd>
    <dt>Renderable layers</dt><dd>${formatNumber(renderable.length)}</dd>
    <dt>Declared features</dt><dd>${formatNumber(declaredFeatures)}</dd>
    <dt>Visible features</dt><dd>${formatNumber(activeFeatures)}</dd>
  `;
}

function clearMapLayers() {
  for (const { leafletLayer } of state.loadedLayers.values()) {
    state.map.removeLayer(leafletLayer);
  }
  state.activeLayerIds.clear();
}

async function loadManifest() {
  const candidates = ["/api/manifest", "/api/replay-manifest.json", "../api/replay-manifest.json"];
  let lastError;
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function start() {
  try {
    state.manifest = await loadManifest();
    elements.manifestStatus.textContent = `${state.manifest.layers.length} layers registered - schema ${state.manifest.schemaVersion}`;
    initMap(state.manifest);
    renderYearOptions();
    renderYear(Number(elements.yearSelect.value));
  } catch (error) {
    elements.manifestStatus.textContent = `Manifest load failed: ${error.message}`;
    elements.mapNotice.textContent = "Start the local server with node server.js and reload.";
  }
}

elements.yearSelect.addEventListener("change", () => {
  clearMapLayers();
  renderYear(Number(elements.yearSelect.value));
});

elements.resetView.addEventListener("click", fitFocusBounds);

start();
