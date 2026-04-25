/* ================================================================
   BELFAST 2016-2036 - SIMULATION STUDIO
   Single-file dashboard engine.
   - Loads the historical metrics from /data/mode-a/summary.json
   - Loads the Mapbox manifest from /api/manifest (token + viewport)
   - Manages branches (in localStorage), placement tools, simulation,
     impact diff, branch timeline SVG and compare modal.
   ================================================================ */

(function () {
  'use strict';

  // ---------- CONSTANTS ----------

  const HISTORICAL_YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
  const SIM_YEARS = [2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035, 2036];
  const ALL_YEARS = HISTORICAL_YEARS.concat(SIM_YEARS);
  const BASE_YEAR = 2026;
  const FINAL_YEAR = 2036;

  const STORAGE_KEY = 'belfast-dashboard-v1';

  const TOOL_LABELS = {
    building: 'Click on the map to place a building',
    road: 'Click two points on the map to place a road',
    park: 'Click on the map to place a park',
    infrastructure: 'Click on the map to place infrastructure',
    remove: 'Click any item you placed to remove it'
  };

  // Metric definitions (the five surfaced in the impact panel)
  const METRICS = [
    {
      id: 'population',
      label: 'Population',
      goodDirection: 'up',
      baseline: 343000,
      unit: 'count',
      color: '#22c55e',
      icon:
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>' +
        '<path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
    },
    {
      id: 'traffic',
      label: 'Traffic Congestion',
      goodDirection: 'down',
      baseline: 0.28,
      unit: 'index',
      color: '#fb923c',
      icon:
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/>' +
        '<circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg>'
    },
    {
      id: 'air',
      label: 'Air Quality Index',
      goodDirection: 'up',
      baseline: 64,
      unit: 'aqi',
      color: '#22d3ee',
      icon:
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96c1.4 9.3-3.6 15.8-8.2 17.04z"/>' +
        '<path d="M2 21c0-3 1.85-5.36 5.08-6"/></svg>'
    },
    {
      id: 'housing',
      label: 'Housing Demand',
      goodDirection: 'down',
      baseline: 0.62,
      unit: 'index',
      color: '#fbbf24',
      icon:
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'
    },
    {
      id: 'economy',
      label: 'Economic Output',
      goodDirection: 'up',
      baseline: 7.3,  // billions GBP
      unit: 'gbp',
      color: '#a855f7',
      icon:
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M3 3v18h18"/><path d="M7 16l4-4 4 4 5-7"/></svg>'
    }
  ];

  // Per-item year-over-year impact (per item, per year that has elapsed since placement).
  // Numbers are intentionally tuned to feel meaningful but not absurd.
  const IMPACT_RULES = {
    building: {
      residential: { population: 110, traffic: 0.0035, air: -0.18, housing: -0.012, economy: 0.018 },
      commercial: { population: 18, traffic: 0.006, air: -0.12, housing: -0.002, economy: 0.075 },
      industrial: { population: 6, traffic: 0.0085, air: -0.55, housing: 0, economy: 0.1 },
      mixed_use: { population: 70, traffic: 0.0045, air: -0.22, housing: -0.008, economy: 0.05 }
    },
    road: { population: 0, traffic: -0.014, air: 0.04, housing: -0.001, economy: 0.022 },
    park: { population: 0, traffic: -0.002, air: 0.85, housing: 0.001, economy: 0.004 },
    infrastructure: { population: 0, traffic: -0.022, air: 0.18, housing: -0.002, economy: 0.04 }
  };

  const PRESETS = {
    building: [
      { id: 'residential', label: 'Residential', color: '#a855f7' },
      { id: 'commercial', label: 'Commercial', color: '#06b6d4' },
      { id: 'industrial', label: 'Industrial', color: '#fb923c' },
      { id: 'mixed_use', label: 'Mixed Use', color: '#22c55e' }
    ]
  };

  // Default scenario branches the user starts with
  const DEFAULT_BRANCHES = [
    { id: 'baseline', name: 'Baseline (No Changes)', color: '#3b82f6', items: [], parentId: null, locked: true },
    { id: 'green', name: 'Green Belfast Vision', color: '#22c55e', items: [], parentId: 'baseline' },
    { id: 'transport', name: 'Transport First', color: '#f59e0b', items: [], parentId: 'baseline' },
    { id: 'density', name: 'High Density Growth', color: '#a855f7', items: [], parentId: 'baseline' }
  ];

  const SWATCH_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#fb923c', '#22d3ee', '#10b981', '#ef4444'];

  // ---------- STATE ----------

  const state = {
    year: BASE_YEAR,
    mode: 'simulation', // historical | simulation | compare | library
    view: '2D',
    activeBranchId: 'baseline',
    branches: clone(DEFAULT_BRANCHES),
    activeTool: null, // building | road | park | infrastructure | remove
    activeBuildingPreset: 'residential',
    pendingRoadStart: null, // for two-click road placement
    historicalMetrics: null, // { 2016: { traffic, jobs, electricity, buildings, services }, ... }
    summaryData: null,
    manifest: null,
    map: null,
    mapLoaded: false,
    playing: false,
    playTimer: null,
    isRunningSim: false,
    nextItemId: 1,
    persistEnabled: true,
    // Historical mode
    lens: 'traffic',                // traffic | jobs | electricity | buildings | services
    gridCache: {},                  // year -> grid GeoJSON
    contextLayersAdded: false,
    contextLayersData: {},          // layerId -> geojson
    activeEventId: null,            // commit/event id when one is selected
    eventsForYearCache: null        // cached events for current year+lens
  };

  // Lens definitions (the 5 historical signals)
  const LENSES = [
    { id: 'traffic',     label: 'Traffic',     color: '#fb923c', goodDirection: 'down', valueProp: 'traffic',     deltaProp: 'traffic_delta_previous',     contextLayer: 'source-ni-roads-osm' },
    { id: 'jobs',        label: 'Jobs',        color: '#a855f7', goodDirection: 'up',   valueProp: 'jobs',        deltaProp: 'jobs_delta_previous',        contextLayer: null },
    { id: 'electricity', label: 'Electricity', color: '#06b6d4', goodDirection: 'down', valueProp: 'electricity', deltaProp: 'electricity_delta_previous', contextLayer: 'source-ni-power-grid-osm' },
    { id: 'buildings',   label: 'Buildings',   color: '#3b82f6', goodDirection: 'up',   valueProp: 'buildings',   deltaProp: 'buildings_delta_previous',   contextLayer: 'belfast-ni-buildings-3d' },
    { id: 'services',    label: 'Services',    color: '#22c55e', goodDirection: 'up',   valueProp: 'services',    deltaProp: 'services_delta_previous',    contextLayer: null }
  ];

  function lensDef(id) { return LENSES.find(l => l.id === id) || LENSES[0]; }

  const els = {};

  // ---------- HELPERS ----------

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function uid(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round(v, d) { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function fmtNumber(n) {
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return Math.round(n).toString();
  }

  function fmtPct(decimal, signed) {
    const v = decimal * 100;
    const s = (Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)) + '%';
    return signed && v > 0 ? '+' + s : s;
  }

  function fmtMetricValue(metric, value) {
    if (metric.id === 'population') return fmtNumber(value);
    if (metric.id === 'economy') return '£' + value.toFixed(2) + 'B';
    if (metric.id === 'air') return Math.round(value).toString() + ' AQI';
    return value.toFixed(2);
  }

  function fmtDeltaLabel(metric, before, after) {
    const diff = after - before;
    if (Math.abs(diff) < 1e-6) return 'no change vs 2026';
    if (metric.id === 'population') {
      const sign = diff > 0 ? '+' : '';
      return sign + fmtNumber(diff) + ' vs 2026';
    }
    if (metric.id === 'economy') {
      const sign = diff > 0 ? '+' : '';
      return sign + '£' + Math.abs(diff).toFixed(2) + 'B vs 2026';
    }
    if (metric.id === 'air') {
      const sign = diff > 0 ? '+' : '';
      return sign + diff.toFixed(0) + ' AQI vs 2026';
    }
    return fmtPct((after - before) / Math.max(0.0001, before), true) + ' vs 2026';
  }

  function isSimYear(y) { return y >= 2027; }

  function activeBranch() { return state.branches.find(b => b.id === state.activeBranchId) || state.branches[0]; }

  // ---------- IMPACT MODEL ----------

  // For each metric we accumulate the contribution of every item placed in the active branch,
  // from its `year` up to the requested target year. Each year of "operation" contributes its
  // per-year delta. Then we add this to the 2026 baseline to get the simulated value.
  function metricsForBranchYear(branch, targetYear) {
    const out = {};
    METRICS.forEach(m => { out[m.id] = m.baseline; });

    if (!branch || !branch.items.length || targetYear <= BASE_YEAR) return out;

    const cap = Math.min(targetYear, FINAL_YEAR);
    branch.items.forEach(item => {
      const startYear = Math.max(BASE_YEAR + 1, item.year);
      const elapsed = Math.max(0, cap - startYear + 1);
      if (elapsed <= 0) return;
      const rule = ruleFor(item);
      Object.keys(rule).forEach(metricId => {
        out[metricId] += rule[metricId] * elapsed;
      });
    });

    // Soft caps to keep numbers sane
    out.air = clamp(out.air, 0, 100);
    out.housing = clamp(out.housing, 0, 1.5);
    out.traffic = clamp(out.traffic, 0, 1.5);
    out.economy = Math.max(0, out.economy);
    out.population = Math.max(0, out.population);

    return out;
  }

  function ruleFor(item) {
    if (item.type === 'building') {
      return IMPACT_RULES.building[item.preset] || IMPACT_RULES.building.residential;
    }
    return IMPACT_RULES[item.type] || {};
  }

  function metricChangeClass(metric, before, after) {
    if (Math.abs(after - before) < 1e-6) return 'neutral';
    const goingUp = after > before;
    if (metric.goodDirection === 'up') return goingUp ? 'up' : 'down';
    return goingUp ? 'down' : 'up';
  }

  // Sparkline points, 11 entries from 2026 (always baseline) projected to 2036.
  function sparklinePoints(branch, metric) {
    const start = metric.baseline;
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const yr = BASE_YEAR + i;
      const m = metricsForBranchYear(branch, yr);
      pts.push(m[metric.id]);
    }
    // For historical years also weave in past data if available
    return pts;
  }

  function sparklineSvg(values, color) {
    if (!values.length) return '';
    const w = 200, h = 30;
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const range = max - min || 1;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return '<polyline fill="none" stroke="' + color + '" stroke-width="1.5" points="' + pts + '"/>';
  }

  // ---------- PERSISTENCE ----------

  function saveState() {
    if (!state.persistEnabled) return;
    try {
      const data = {
        v: 1,
        year: state.year,
        view: state.view,
        activeBranchId: state.activeBranchId,
        branches: state.branches,
        activeTool: state.activeTool,
        activeBuildingPreset: state.activeBuildingPreset,
        nextItemId: state.nextItemId
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (_) {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || data.v !== 1) return;
      if (Number.isFinite(data.year)) state.year = clamp(data.year, 2016, FINAL_YEAR);
      if (data.view === '2D' || data.view === '3D') state.view = data.view;
      if (Array.isArray(data.branches) && data.branches.length) state.branches = data.branches;
      if (data.activeBranchId && state.branches.find(b => b.id === data.activeBranchId)) {
        state.activeBranchId = data.activeBranchId;
      }
      if (data.activeBuildingPreset) state.activeBuildingPreset = data.activeBuildingPreset;
      if (Number.isFinite(data.nextItemId)) state.nextItemId = data.nextItemId;
      // Don't restore active tool — fresh start each session
    } catch (_) {}
  }

  // ---------- DOM CACHE ----------

  function cacheEls() {
    const ids = [
      'historicalYears', 'simulationYears',
      'modifyList', 'presetGrid', 'presetSection', 'presetLabel', 'modifySub',
      'mapSubtitle', 'mapOverlay', 'cursorHint', 'cursorHintText',
      'activeBranchTag', 'tagDot', 'tagName', 'tagYear',
      'tlPrev', 'tlPlay', 'tlPlayIcon', 'tlNext', 'tlYearNow', 'tlTrack', 'tlProgress', 'tlThumb', 'tlMarks',
      'impactTitle', 'impactStack', 'showAllBtn',
      'newBranchBtn', 'branchList',
      'tlBranchName', 'branchTimelineSvg',
      'runBtn', 'runBtnLabel', 'compareBtn', 'activeBranchName', 'activeYearLabel', 'exportBtn',
      'compareModal', 'compareYear', 'compareBody',
      'inspectModal', 'inspectTitle', 'inspectBody',
      'branchMenu', 'nodeMenu',
      'toast', 'topNav', 'viewToggle', 'aboutBtn', 'helpBtn', 'settingsBtn'
    ];
    ids.forEach(id => { els[id] = document.getElementById(id); });
    els.mapCanvas = document.querySelector('.map-canvas');
    els.modifyButtons = els.modifyList ? els.modifyList.querySelectorAll('.modify-btn') : [];
    els.viewToggleButtons = els.viewToggle ? els.viewToggle.querySelectorAll('button') : [];
    els.bottomTabs = document.querySelectorAll('.bn-btn');
    els.topTabs = els.topNav ? els.topNav.querySelectorAll('.nav-btn') : [];
  }

  // ---------- DATA LOAD ----------

  async function loadHistorical() {
    try {
      const res = await fetch('/data/mode-a/summary.json');
      if (!res.ok) throw new Error('summary fetch ' + res.status);
      const json = await res.json();
      state.summaryData = json;
      state.historicalMetrics = json.metricsByYear || {};
    } catch (e) {
      console.warn('historical fetch failed', e);
    }
  }

  async function loadManifest() {
    try {
      const res = await fetch('/api/manifest');
      if (!res.ok) throw new Error('manifest fetch ' + res.status);
      state.manifest = await res.json();
    } catch (e) {
      console.warn('manifest fetch failed, falling back', e);
      state.manifest = {
        mapbox: {
          token: 'pk.eyJ1IjoiYXl1c2hndXB0YTA1IiwiYSI6ImNtb2VjdW5oYTBmb3oycXNnMzY0NW82bW4ifQ.vLx2CXXlKLhzMLvGa_g2Bw',
          style: 'mapbox://styles/mapbox/dark-v11'
        },
        viewport: { center: [-5.9301, 54.5973], zoom: 12.1, pitch: 64, bearing: -24 }
      };
    }
  }

  // ---------- MAP ----------

  function initMap() {
    if (!window.mapboxgl) {
      console.error('mapbox-gl missing');
      hideOverlay();
      return;
    }
    const m = state.manifest || {};
    mapboxgl.accessToken = (m.mapbox && m.mapbox.token) || '';
    if (!mapboxgl.accessToken) {
      els.mapOverlay.innerHTML = '<div class="overlay-loader"><span>Mapbox token missing</span></div>';
      return;
    }

    const view = m.viewport || { center: [-5.9301, 54.5973], zoom: 12.1, pitch: 0, bearing: 0 };
    state.map = new mapboxgl.Map({
      container: 'map',
      style: (m.mapbox && m.mapbox.style) || 'mapbox://styles/mapbox/dark-v11',
      center: view.center,
      zoom: view.zoom,
      pitch: state.view === '3D' ? (view.pitch || 60) : 0,
      bearing: view.bearing || 0,
      antialias: true,
      attributionControl: false
    });

    state.map.on('load', () => {
      state.mapLoaded = true;
      addItemSources();
      addAdded3DBuildings();
      attachMapInteractions();
      hideOverlay();
      renderItemsOnMap();
    });

    state.map.on('error', (e) => {
      console.warn('map error', e && e.error && e.error.message);
    });
  }

  function hideOverlay() {
    if (els.mapOverlay) {
      els.mapOverlay.classList.add('hidden');
      setTimeout(() => { if (els.mapOverlay) els.mapOverlay.style.display = 'none'; }, 350);
    }
  }

  function addItemSources() {
    const empty = { type: 'FeatureCollection', features: [] };
    state.map.addSource('items-points', { type: 'geojson', data: empty });
    state.map.addSource('items-roads', { type: 'geojson', data: empty });
    state.map.addSource('items-buildings', { type: 'geojson', data: empty });

    // Roads
    state.map.addLayer({
      id: 'items-roads-line',
      type: 'line',
      source: 'items-roads',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 5,
        'line-opacity': 0.85
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' }
    });
    state.map.addLayer({
      id: 'items-roads-line-glow',
      type: 'line',
      source: 'items-roads',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 12,
        'line-opacity': 0.18,
        'line-blur': 4
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' }
    }, 'items-roads-line');

    // Parks (circles, larger)
    state.map.addLayer({
      id: 'items-parks-circle',
      type: 'circle',
      source: 'items-points',
      filter: ['==', ['get', 'type'], 'park'],
      paint: {
        'circle-radius': 18,
        'circle-color': '#22c55e',
        'circle-opacity': 0.55,
        'circle-stroke-color': '#22c55e',
        'circle-stroke-width': 2,
        'circle-stroke-opacity': 1,
        'circle-blur': 0.4
      }
    });
    state.map.addLayer({
      id: 'items-parks-glow',
      type: 'circle',
      source: 'items-points',
      filter: ['==', ['get', 'type'], 'park'],
      paint: {
        'circle-radius': 32,
        'circle-color': '#22c55e',
        'circle-opacity': 0.18,
        'circle-blur': 1
      }
    }, 'items-parks-circle');

    // Infrastructure (square-ish marker)
    state.map.addLayer({
      id: 'items-infra-circle',
      type: 'circle',
      source: 'items-points',
      filter: ['==', ['get', 'type'], 'infrastructure'],
      paint: {
        'circle-radius': 9,
        'circle-color': '#fde68a',
        'circle-stroke-color': '#f59e0b',
        'circle-stroke-width': 2,
        'circle-opacity': 0.95
      }
    });

    // Building markers (overlaid for 2D mode and labelling)
    state.map.addLayer({
      id: 'items-buildings-circle',
      type: 'circle',
      source: 'items-points',
      filter: ['==', ['get', 'type'], 'building'],
      paint: {
        'circle-radius': 7,
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.95,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1.5
      }
    });

    // Label
    state.map.addLayer({
      id: 'items-labels',
      type: 'symbol',
      source: 'items-points',
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-offset': [0, -1.4],
        'text-anchor': 'bottom',
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold']
      },
      paint: {
        'text-color': '#fff',
        'text-halo-color': 'rgba(10,20,38,0.85)',
        'text-halo-width': 1.4
      }
    });
  }

  function addAdded3DBuildings() {
    state.map.addLayer({
      id: 'items-buildings-3d',
      type: 'fill-extrusion',
      source: 'items-buildings',
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.85
      },
      layout: { visibility: state.view === '3D' ? 'visible' : 'none' }
    });
  }

  function attachMapInteractions() {
    state.map.on('click', onMapClick);
    state.map.on('mousemove', (e) => {
      if (!state.activeTool) return;
      // Could update a ghost marker — keeping minimal for now
    });

    // Click handlers on item layers (for inspect/remove)
    ['items-buildings-circle', 'items-parks-circle', 'items-infra-circle', 'items-roads-line', 'items-buildings-3d']
      .forEach(layerId => {
        state.map.on('click', layerId, (e) => {
          if (!e.features || !e.features.length) return;
          const feat = e.features[0];
          const itemId = feat.properties && feat.properties.id;
          if (!itemId) return;
          if (state.activeTool === 'remove') {
            removeItem(itemId);
          } else {
            inspectItem(itemId);
          }
          e.preventDefault && e.preventDefault();
        });
        state.map.on('mouseenter', layerId, () => {
          state.map.getCanvas().style.cursor = state.activeTool === 'remove' ? 'not-allowed' : 'pointer';
        });
        state.map.on('mouseleave', layerId, () => {
          state.map.getCanvas().style.cursor = state.activeTool ? '' : '';
        });
      });
  }

  function onMapClick(e) {
    if (!state.activeTool) return;
    if (state.activeTool === 'remove') return; // handled by per-layer click
    if (isSimYear(state.year) === false && state.activeTool) {
      toast('Switch to a simulation year (2027-2036) to add changes', 'warn');
      return;
    }
    const lng = e.lngLat.lng;
    const lat = e.lngLat.lat;
    if (state.activeTool === 'road') {
      handleRoadClick(lng, lat);
      return;
    }
    addItemAt(state.activeTool, lng, lat);
  }

  function handleRoadClick(lng, lat) {
    if (!state.pendingRoadStart) {
      state.pendingRoadStart = [lng, lat];
      els.cursorHintText.textContent = 'Click the road end-point';
      els.cursorHint.hidden = false;
      return;
    }
    const start = state.pendingRoadStart;
    const end = [lng, lat];
    state.pendingRoadStart = null;
    addRoadItem(start, end);
    if (state.activeTool === 'road') {
      els.cursorHintText.textContent = TOOL_LABELS.road;
    }
  }

  // ---------- ITEM CRUD ----------

  function addItemAt(type, lng, lat) {
    const branch = activeBranch();
    if (branch.locked) {
      toast('Baseline is locked. Switch to or create another branch.', 'warn');
      return;
    }
    const item = {
      id: 'item-' + (state.nextItemId++),
      type: type,
      year: state.year,
      lng: lng,
      lat: lat
    };
    if (type === 'building') {
      item.preset = state.activeBuildingPreset;
      const presetDef = PRESETS.building.find(p => p.id === item.preset);
      item.color = presetDef ? presetDef.color : '#a855f7';
      item.label = capitalise(item.preset.replace('_', ' '));
      item.height = item.preset === 'industrial' ? 22 : item.preset === 'commercial' ? 60 : item.preset === 'mixed_use' ? 45 : 32;
    } else if (type === 'park') {
      item.color = '#22c55e';
      item.label = 'Park';
    } else if (type === 'infrastructure') {
      item.color = '#f59e0b';
      item.label = 'Infrastructure';
    }
    branch.items.push(item);
    afterChange();
    toast('Added ' + (item.label || type) + ' to ' + branch.name);
  }

  function addRoadItem(start, end) {
    const branch = activeBranch();
    if (branch.locked) {
      toast('Baseline is locked.', 'warn');
      return;
    }
    const item = {
      id: 'item-' + (state.nextItemId++),
      type: 'road',
      year: state.year,
      start: start,
      end: end,
      color: '#f59e0b',
      label: 'New Road'
    };
    branch.items.push(item);
    afterChange();
    toast('Added Road segment to ' + branch.name);
  }

  function removeItem(itemId) {
    const branch = activeBranch();
    if (branch.locked) { toast('Baseline is locked.', 'warn'); return; }
    const before = branch.items.length;
    branch.items = branch.items.filter(it => it.id !== itemId);
    if (branch.items.length !== before) {
      afterChange();
      toast('Item removed', 'warn');
    }
  }

  function inspectItem(itemId) {
    const branch = activeBranch();
    const item = branch.items.find(it => it.id === itemId);
    if (!item) return;
    openInspectModal(item);
  }

  function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---------- RENDER MAP ITEMS ----------

  function renderItemsOnMap() {
    if (!state.mapLoaded) return;
    const branch = activeBranch();
    const items = branch.items.filter(it => it.year <= state.year || !isSimYear(state.year));

    // Show all items up through the chosen year (for simulation years)
    // For historical years 2016-2026 we show no user items (those don't exist yet).
    const visible = state.year >= 2027
      ? branch.items.filter(it => it.year <= state.year)
      : [];

    const points = { type: 'FeatureCollection', features: [] };
    const roads = { type: 'FeatureCollection', features: [] };
    const buildings3d = { type: 'FeatureCollection', features: [] };

    visible.forEach(it => {
      if (it.type === 'road') {
        roads.features.push({
          type: 'Feature',
          properties: { id: it.id, color: it.color, label: it.label },
          geometry: { type: 'LineString', coordinates: [it.start, it.end] }
        });
        // Add label point at midpoint
        const mid = [(it.start[0] + it.end[0]) / 2, (it.start[1] + it.end[1]) / 2];
        points.features.push({
          type: 'Feature',
          properties: { id: it.id, type: 'road-label', color: it.color, label: it.label },
          geometry: { type: 'Point', coordinates: mid }
        });
      } else {
        points.features.push({
          type: 'Feature',
          properties: {
            id: it.id,
            type: it.type,
            color: it.color || '#3b82f6',
            label: it.label || it.type
          },
          geometry: { type: 'Point', coordinates: [it.lng, it.lat] }
        });

        if (it.type === 'building') {
          // Build a small square footprint for 3D extrusion
          const sizeM = 30; // ~30m square footprint
          const ring = squareRing(it.lng, it.lat, sizeM);
          buildings3d.features.push({
            type: 'Feature',
            properties: { id: it.id, color: it.color, height: it.height || 30 },
            geometry: { type: 'Polygon', coordinates: [ring] }
          });
        }
      }
    });

    if (state.map.getSource('items-points')) state.map.getSource('items-points').setData(points);
    if (state.map.getSource('items-roads')) state.map.getSource('items-roads').setData(roads);
    if (state.map.getSource('items-buildings')) state.map.getSource('items-buildings').setData(buildings3d);

    // Toggle 3D extrusion visibility based on view
    if (state.map.getLayer('items-buildings-3d')) {
      state.map.setLayoutProperty('items-buildings-3d', 'visibility', state.view === '3D' ? 'visible' : 'none');
    }
  }

  function squareRing(lng, lat, sizeMeters) {
    // Approximate degrees-per-meter for Belfast latitude
    const dLat = sizeMeters / 111111;
    const dLng = sizeMeters / (111111 * Math.cos(lat * Math.PI / 180));
    return [
      [lng - dLng / 2, lat - dLat / 2],
      [lng + dLng / 2, lat - dLat / 2],
      [lng + dLng / 2, lat + dLat / 2],
      [lng - dLng / 2, lat + dLat / 2],
      [lng - dLng / 2, lat - dLat / 2]
    ];
  }

  // ---------- RENDER: TIMEFRAME ----------

  function renderYearLists() {
    if (!els.historicalYears || !els.simulationYears) return;
    els.historicalYears.innerHTML = HISTORICAL_YEARS.map(y => yearLi(y, false)).join('');
    els.simulationYears.innerHTML = SIM_YEARS.map(y => yearLi(y, true)).join('');
    [els.historicalYears, els.simulationYears].forEach(ul => {
      ul.querySelectorAll('li').forEach(li => {
        li.addEventListener('click', () => {
          const y = parseInt(li.getAttribute('data-year'), 10);
          if (Number.isFinite(y)) setYear(y);
        });
      });
    });
  }

  function yearLi(y, simulation) {
    const active = (y === state.year);
    const cls = active ? (simulation ? ' class="active-purple"' : ' class="active-blue"') : '';
    return '<li' + cls + ' data-year="' + y + '">' + y + '</li>';
  }

  // ---------- RENDER: TIMELINE BAR ----------

  function renderTimelineBar() {
    if (!els.tlYearNow) return;
    const sim = isSimYear(state.year);
    els.tlYearNow.textContent = state.year;
    els.tlYearNow.className = 'tl-year-now' + (sim ? ' simulation' : '');

    const idx = ALL_YEARS.indexOf(state.year);
    const pct = idx === -1 ? 0 : (idx / (ALL_YEARS.length - 1)) * 100;
    els.tlProgress.style.width = pct + '%';
    els.tlProgress.className = 'tl-progress' + (sim ? ' simulation' : '');
    els.tlThumb.style.left = pct + '%';
    els.tlThumb.className = 'tl-thumb' + (sim ? ' simulation' : '');

    // Render marks (only every other year to fit)
    if (els.tlMarks && !els.tlMarks.dataset.built) {
      els.tlMarks.innerHTML = ALL_YEARS.map(y => '<span data-year="' + y + '">' + y + '</span>').join('');
      els.tlMarks.dataset.built = '1';
      els.tlMarks.querySelectorAll('span').forEach(s => {
        s.addEventListener('click', () => {
          const y = parseInt(s.getAttribute('data-year'), 10);
          if (Number.isFinite(y)) setYear(y);
        });
      });
    }
    if (els.tlMarks) {
      els.tlMarks.querySelectorAll('span').forEach(s => {
        const y = parseInt(s.getAttribute('data-year'), 10);
        s.classList.toggle('now', y === state.year);
        s.classList.toggle('simulation', y === state.year && isSimYear(y));
      });
    }

    // Active branch tag
    if (els.tagYear) els.tagYear.textContent = state.year;
    if (els.tagYear) els.tagYear.style.color = sim ? 'var(--purple-2)' : 'var(--blue-2)';
    if (els.tagYear) els.tagYear.style.background = sim ? 'rgba(168,85,247,0.18)' : 'rgba(59,130,246,0.18)';
  }

  function attachTimelineEvents() {
    if (els.tlPrev) els.tlPrev.addEventListener('click', () => {
      const idx = ALL_YEARS.indexOf(state.year);
      if (idx > 0) setYear(ALL_YEARS[idx - 1]);
    });
    if (els.tlNext) els.tlNext.addEventListener('click', () => {
      const idx = ALL_YEARS.indexOf(state.year);
      if (idx < ALL_YEARS.length - 1) setYear(ALL_YEARS[idx + 1]);
    });
    if (els.tlPlay) els.tlPlay.addEventListener('click', togglePlay);

    if (els.tlTrack) {
      els.tlTrack.addEventListener('click', (e) => {
        const rect = els.tlTrack.getBoundingClientRect();
        const t = clamp((e.clientX - rect.left) / rect.width, 0, 1);
        const idx = Math.round(t * (ALL_YEARS.length - 1));
        setYear(ALL_YEARS[idx]);
      });
    }
  }

  function togglePlay() {
    if (state.playing) {
      state.playing = false;
      if (state.playTimer) clearInterval(state.playTimer);
      state.playTimer = null;
      els.tlPlay.classList.remove('playing');
      els.tlPlayIcon.outerHTML = '<svg id="tlPlayIcon" width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
      els.tlPlayIcon = document.getElementById('tlPlayIcon');
    } else {
      state.playing = true;
      els.tlPlay.classList.add('playing');
      els.tlPlayIcon.outerHTML = '<svg id="tlPlayIcon" width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
      els.tlPlayIcon = document.getElementById('tlPlayIcon');
      state.playTimer = setInterval(() => {
        const idx = ALL_YEARS.indexOf(state.year);
        if (idx >= ALL_YEARS.length - 1) {
          togglePlay();
          return;
        }
        setYear(ALL_YEARS[idx + 1]);
      }, 700);
    }
  }

  function setYear(y) {
    state.year = y;
    renderTimelineBar();
    renderYearLists();
    renderImpact();
    renderItemsOnMap();
    renderActiveInfo();
    renderMapSubtitle();
    saveState();
  }

  // ---------- RENDER: MODIFY PANEL ----------

  function renderModify() {
    if (!els.modifyButtons) return;
    els.modifyButtons.forEach(btn => {
      const t = btn.getAttribute('data-tool');
      btn.classList.toggle('active', t === state.activeTool);
    });
    // Hide presets unless "building" tool active
    const showPresets = state.activeTool === 'building';
    if (els.presetSection) els.presetSection.style.display = showPresets ? '' : 'none';
    if (els.modifySub) {
      if (state.activeTool) {
        els.modifySub.textContent = TOOL_LABELS[state.activeTool] || 'Click on the map to place';
        els.modifySub.style.color = 'var(--blue-2)';
      } else {
        els.modifySub.textContent = 'Pick an element, then click on the map to place it';
        els.modifySub.style.color = '';
      }
    }
    // Show cursor hint
    if (els.cursorHint) {
      const wantsHint = !!state.activeTool && isSimYear(state.year);
      els.cursorHint.hidden = !wantsHint;
      if (wantsHint && els.cursorHintText) {
        els.cursorHintText.textContent =
          state.activeTool === 'road' && state.pendingRoadStart
            ? 'Click the road end-point'
            : (TOOL_LABELS[state.activeTool] || 'Click the map');
      }
    }
    // Update map cursor
    if (els.mapCanvas) {
      els.mapCanvas.classList.toggle('placing', !!state.activeTool && state.activeTool !== 'remove');
      els.mapCanvas.classList.toggle('removing', state.activeTool === 'remove');
    }
    renderPresets();
  }

  function renderPresets() {
    if (!els.presetGrid) return;
    els.presetGrid.innerHTML = PRESETS.building.map(p => {
      const active = p.id === state.activeBuildingPreset ? ' active' : '';
      return '<button class="preset-btn' + active + '" data-preset="' + p.id + '" type="button">' +
        '<span class="preset-dot" style="background:' + p.color + '"></span>' + p.label +
        '</button>';
    }).join('');
    els.presetGrid.querySelectorAll('.preset-btn').forEach(b => {
      b.addEventListener('click', () => {
        state.activeBuildingPreset = b.getAttribute('data-preset');
        renderPresets();
      });
    });
  }

  function attachModifyEvents() {
    if (!els.modifyButtons) return;
    els.modifyButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.getAttribute('data-tool');
        // Toggle off if already active
        state.activeTool = state.activeTool === t ? null : t;
        state.pendingRoadStart = null;
        if (state.activeTool && state.year < 2027) {
          // Auto-jump to first sim year so the action is meaningful
          setYear(2027);
          toast('Jumped to 2027 — start of simulation window', 'warn');
        }
        renderModify();
      });
    });
  }

  // ---------- RENDER: IMPACT PANEL ----------

  function renderImpact() {
    if (!els.impactStack || !els.impactTitle) return;
    const branch = activeBranch();
    const target = state.year;
    const isHistorical = !isSimYear(target);
    els.impactTitle.textContent = 'Impact Overview (' + target + ')';

    let metricsAtTarget;
    if (isHistorical && state.historicalMetrics && state.historicalMetrics[String(target)]) {
      // Build from real historical numbers, mapped onto our 5 metrics for display
      metricsAtTarget = historicalToDisplay(target);
    } else {
      metricsAtTarget = metricsForBranchYear(branch, target);
    }

    els.impactStack.innerHTML = METRICS.map(m => metricCardHTML(m, branch, target, metricsAtTarget)).join('');
  }

  function historicalToDisplay(year) {
    // Map historical 5 metrics (traffic, jobs, electricity, buildings, services) onto our display
    const arr = state.historicalMetrics[String(year)] || [];
    const byId = {};
    arr.forEach(r => { byId[r.metric] = r.value; });
    // Approximate transforms from the historical indices
    // Use linear interpolation from the index value to a meaningful display number
    return {
      // population grew from ~330K (2016) to ~343K (2026); use buildings index as proxy growth
      population: lerp(330000, 343000, clamp((byId.buildings || 0.247) - 0.247, 0, 1) / 0.5 + (year - 2016) / 10),
      traffic: byId.traffic != null ? byId.traffic : 0.28,
      // air quality — start ~75 (2016), drift to 64 (2026) as buildings grow
      air: clamp(75 - ((byId.buildings || 0.4) - 0.247) * 22, 35, 95),
      housing: clamp(0.45 + ((byId.buildings || 0.4) - 0.247) * 0.5, 0, 1.2),
      // economy from jobs: scale to GBP B
      economy: 5.5 + (byId.jobs || 0.12) * 14
    };
  }

  function metricCardHTML(metric, branch, year, metricsAtTarget) {
    const before = metric.baseline;
    const after = metricsAtTarget[metric.id];
    const cls = metricChangeClass(metric, before, after);
    const changed = Math.abs(after - before) > (metric.id === 'population' ? 100 : 0.001);
    const valueStr = fmtMetricValue(metric, after);
    const deltaStr = year === BASE_YEAR ? 'Today' : fmtDeltaLabel(metric, before, after);
    const sparkVals = sparklinePoints(branch, metric);
    const spark = sparklineSvg(sparkVals, metric.color);

    return '' +
      '<div class="metric-card' + (changed ? ' changed' : '') + '" data-metric="' + metric.id + '">' +
        '<div class="metric-row">' +
          '<span class="metric-name">' + metric.label + '</span>' +
          '<span class="metric-icon">' + metric.icon + '</span>' +
        '</div>' +
        '<div class="metric-value ' + cls + '">' + valueStr + '</div>' +
        '<div class="metric-sub">' + deltaStr + '</div>' +
        '<svg class="spark" viewBox="0 0 200 30" preserveAspectRatio="none">' + spark + '</svg>' +
      '</div>';
  }

  // ---------- RENDER: BRANCHES PANEL ----------

  function renderBranches() {
    if (!els.branchList) return;
    if (!state.branches.length) {
      els.branchList.innerHTML = '<div class="branch-empty">No branches yet. Click "New Branch" to start.</div>';
      return;
    }
    els.branchList.innerHTML = state.branches.map(branchItemHTML).join('');
    els.branchList.querySelectorAll('.branch-item').forEach(el => {
      const id = el.getAttribute('data-branch-id');
      el.addEventListener('click', (e) => {
        if (e.target.closest('.branch-more')) return;
        setActiveBranch(id);
      });
      const more = el.querySelector('.branch-more');
      if (more) {
        more.addEventListener('click', (e) => {
          e.stopPropagation();
          openBranchMenu(id, more);
        });
      }
    });
    renderActiveInfo();
    renderBranchTimeline();
    renderTagDot();
  }

  function branchItemHTML(b) {
    const active = b.id === state.activeBranchId ? ' active' : '';
    return '' +
      '<div class="branch-item' + active + '" data-branch-id="' + b.id + '">' +
        '<span class="branch-dot" style="background:' + b.color + ';color:' + b.color + '"></span>' +
        '<span class="branch-name">' + escapeHtml(b.name) + '</span>' +
        '<span class="branch-count">' + b.items.length + '</span>' +
        '<span class="branch-more">&#x22EF;</span>' +
      '</div>';
  }

  function renderTagDot() {
    const b = activeBranch();
    if (els.tagDot) {
      els.tagDot.style.background = b.color;
      els.tagDot.style.color = b.color;
    }
    if (els.tagName) els.tagName.textContent = b.name;
  }

  function renderActiveInfo() {
    const b = activeBranch();
    if (els.activeBranchName) els.activeBranchName.textContent = b.name;
    if (els.activeYearLabel) els.activeYearLabel.textContent = state.year;
  }

  function setActiveBranch(id) {
    if (!state.branches.find(x => x.id === id)) return;
    state.activeBranchId = id;
    renderBranches();
    renderImpact();
    renderItemsOnMap();
    saveState();
  }

  // ---------- BRANCH CRUD ----------

  function openNewBranchModal() {
    const usedColors = new Set(state.branches.map(b => b.color));
    let firstFree = SWATCH_COLORS.find(c => !usedColors.has(c)) || SWATCH_COLORS[0];
    let chosenColor = firstFree;
    let chosenName = '';
    let chosenParent = state.activeBranchId;

    openModalCustom('New Scenario Branch', function (body, close) {
      const swatches = SWATCH_COLORS.map(c =>
        '<div class="color-swatch' + (c === chosenColor ? ' active' : '') + '" data-color="' + c + '" style="background:' + c + ';color:' + c + '"></div>'
      ).join('');
      const parentOpts = state.branches.map(b =>
        '<option value="' + b.id + '"' + (b.id === chosenParent ? ' selected' : '') + '>' + escapeHtml(b.name) + '</option>'
      ).join('');
      body.innerHTML = '' +
        '<div class="new-branch-form">' +
          '<div><label class="field-label">Branch name</label>' +
            '<input class="text-input" id="newBranchName" placeholder="e.g. Eco-Suburbs" maxlength="60"></div>' +
          '<div><label class="field-label">Color</label>' +
            '<div class="color-grid" id="colorGrid">' + swatches + '</div></div>' +
          '<div><label class="field-label">Branch from</label>' +
            '<select class="parent-select" id="parentSelect">' + parentOpts + '</select>' +
            '<div style="font-size:10px;color:var(--text-mute);margin-top:4px">Items from the parent branch are copied as the starting point.</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;margin-top:6px">' +
            '<button class="modal-btn secondary" id="newBranchCancel" type="button">Cancel</button>' +
            '<button class="modal-btn" id="newBranchCreate" type="button">Create Branch</button>' +
          '</div>' +
        '</div>';

      const nameInput = body.querySelector('#newBranchName');
      const parentSel = body.querySelector('#parentSelect');
      body.querySelectorAll('.color-swatch').forEach(s => {
        s.addEventListener('click', () => {
          chosenColor = s.getAttribute('data-color');
          body.querySelectorAll('.color-swatch').forEach(x => x.classList.toggle('active', x === s));
        });
      });
      body.querySelector('#newBranchCancel').addEventListener('click', close);
      body.querySelector('#newBranchCreate').addEventListener('click', () => {
        chosenName = (nameInput.value || '').trim();
        chosenParent = parentSel.value;
        if (!chosenName) { nameInput.focus(); return; }
        createBranch(chosenName, chosenColor, chosenParent);
        close();
      });
      nameInput.focus();
    });
  }

  function createBranch(name, color, parentId) {
    const parent = state.branches.find(b => b.id === parentId);
    const newBranch = {
      id: uid('br'),
      name: name,
      color: color,
      parentId: parentId || null,
      items: parent ? clone(parent.items) : []
    };
    // Generate fresh ids for copied items so removal/inspection doesn't collide
    newBranch.items.forEach(it => { it.id = 'item-' + (state.nextItemId++); });
    state.branches.push(newBranch);
    state.activeBranchId = newBranch.id;
    renderBranches();
    renderImpact();
    renderItemsOnMap();
    toast('Created branch "' + name + '"');
    saveState();
  }

  function deleteBranch(id) {
    const b = state.branches.find(x => x.id === id);
    if (!b) return;
    if (b.locked) { toast('Baseline cannot be deleted', 'warn'); return; }
    if (!confirm('Delete branch "' + b.name + '"? Items will be lost.')) return;
    state.branches = state.branches.filter(x => x.id !== id);
    if (state.activeBranchId === id) {
      state.activeBranchId = state.branches[0].id;
    }
    renderBranches();
    renderImpact();
    renderItemsOnMap();
    toast('Deleted branch', 'warn');
    saveState();
  }

  function renameBranch(id) {
    const b = state.branches.find(x => x.id === id);
    if (!b) return;
    if (b.locked) { toast('Baseline cannot be renamed', 'warn'); return; }
    const next = prompt('Rename branch:', b.name);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    b.name = trimmed;
    renderBranches();
    saveState();
  }

  function duplicateBranch(id) {
    const b = state.branches.find(x => x.id === id);
    if (!b) return;
    createBranch(b.name + ' (copy)', b.color, id);
  }

  function recolorBranch(id) {
    const b = state.branches.find(x => x.id === id);
    if (!b) return;
    const ix = SWATCH_COLORS.indexOf(b.color);
    b.color = SWATCH_COLORS[(ix + 1) % SWATCH_COLORS.length];
    renderBranches();
    renderItemsOnMap();
    saveState();
  }

  // ---------- BRANCH CTX MENU ----------

  let menuTarget = null;
  function openBranchMenu(branchId, anchor) {
    if (!els.branchMenu) return;
    menuTarget = branchId;
    const r = anchor.getBoundingClientRect();
    els.branchMenu.style.left = (r.right - 140) + 'px';
    els.branchMenu.style.top = (r.bottom + 4) + 'px';
    els.branchMenu.hidden = false;
  }
  function closeMenus() {
    if (els.branchMenu) els.branchMenu.hidden = true;
    if (els.nodeMenu) els.nodeMenu.hidden = true;
  }
  function attachBranchMenuEvents() {
    if (!els.branchMenu) return;
    els.branchMenu.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        const act = b.getAttribute('data-act');
        if (!menuTarget) return closeMenus();
        if (act === 'rename') renameBranch(menuTarget);
        if (act === 'duplicate') duplicateBranch(menuTarget);
        if (act === 'recolor') recolorBranch(menuTarget);
        if (act === 'delete') deleteBranch(menuTarget);
        closeMenus();
      });
    });
    document.addEventListener('click', (e) => {
      if (!els.branchMenu.hidden && !els.branchMenu.contains(e.target)) closeMenus();
      if (els.nodeMenu && !els.nodeMenu.hidden && !els.nodeMenu.contains(e.target)) closeMenus();
    });
  }

  // ---------- BRANCH TIMELINE SVG ----------

  let nodeMenuTarget = null;

  function renderBranchTimeline() {
    if (!els.branchTimelineSvg) return;
    const svg = els.branchTimelineSvg;
    const branches = state.branches;
    const branchCount = branches.length;
    const W = 940;
    const headerH = 36;
    const rowH = Math.max(34, Math.min(50, (200 - headerH - 18) / Math.max(1, branchCount)));
    const usableH = headerH + branchCount * rowH + 12;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + usableH);

    const yearMarks = [BASE_YEAR].concat(SIM_YEARS);
    const xLeft = 60;
    const xRight = W - 30;
    const xFor = (year) => {
      const idx = yearMarks.indexOf(year);
      const t = idx / (yearMarks.length - 1);
      return xLeft + t * (xRight - xLeft);
    };

    // Header year labels
    let header = '<g font-family="Outfit" font-size="11" fill="#8aa0c4">';
    yearMarks.forEach(y => {
      const x = xFor(y);
      header += '<text x="' + x + '" y="16" text-anchor="middle">' + y + '</text>';
      if (y === BASE_YEAR) header += '<text x="' + x + '" y="29" text-anchor="middle" font-size="9" fill="#5d7396">(Base Year)</text>';
    });
    header += '</g>';

    // Vertical guides
    let guides = '<g stroke="rgba(80,120,180,0.10)" stroke-dasharray="2 4">';
    yearMarks.forEach(y => {
      const x = xFor(y);
      guides += '<line x1="' + x + '" y1="' + (headerH + 4) + '" x2="' + x + '" y2="' + (usableH - 6) + '"/>';
    });
    guides += '</g>';

    // Origin marker (left side)
    const originY = headerH + (branchCount * rowH) / 2;
    let origin = '<g transform="translate(20,' + originY + ')">' +
      '<circle r="13" fill="#1a2942" stroke="#3b82f6" stroke-width="1.5"/>' +
      '<line x1="-6" y1="0" x2="6" y2="0" stroke="#3b82f6" stroke-width="1.8"/>' +
      '<line x1="0" y1="-6" x2="0" y2="6" stroke="#3b82f6" stroke-width="1.8"/>' +
      '</g>';

    // Branches
    let branchesSvg = '';
    branches.forEach((b, i) => {
      const y = headerH + (i + 0.5) * rowH;
      const isActive = b.id === state.activeBranchId;
      const lineOpacity = isActive ? 1 : 0.55;

      // Curved line from origin (left, originY) to (xLeft, y)
      const curveOriginX = 30;
      const path = 'M ' + curveOriginX + ' ' + originY +
        ' C ' + (curveOriginX + 14) + ' ' + originY + ', ' + (xLeft - 18) + ' ' + y + ', ' + xLeft + ' ' + y +
        ' L ' + xRight + ' ' + y;
      branchesSvg += '<path d="' + path + '" stroke="' + b.color + '" stroke-width="2" fill="none" opacity="' + lineOpacity + '"/>';

      // Branch label (left of base year)
      branchesSvg += '<text x="' + (xLeft - 6) + '" y="' + (y + 3) + '" font-family="Outfit" font-size="10" fill="' + b.color + '" text-anchor="end" font-weight="600">' + escapeHtml(truncate(b.name, 18)) + '</text>';

      // Year-base node at xLeft for each branch
      branchesSvg += '<g transform="translate(' + xLeft + ',' + y + ')"><circle r="4" fill="' + b.color + '"/></g>';

      // Item nodes
      // Group items by year
      const byYear = {};
      b.items.forEach(it => {
        const yr = it.year;
        byYear[yr] = byYear[yr] || [];
        byYear[yr].push(it);
      });
      Object.keys(byYear).forEach(yr => {
        const ya = parseInt(yr, 10);
        if (!yearMarks.includes(ya)) return;
        const items = byYear[yr];
        const x = xFor(ya);
        items.forEach((it, j) => {
          const offsetY = (j - (items.length - 1) / 2) * 12;
          const ny = y + offsetY;
          const sym = nodeSymbol(it, b.color);
          const isActiveNode = false;
          branchesSvg += '<g class="timeline-node' + (isActiveNode ? ' active' : '') + '" transform="translate(' + x + ',' + ny + ')" data-item-id="' + it.id + '" data-branch-id="' + b.id + '">' + sym + '</g>';
        });
      });

      // Marker for selected year
      if (yearMarks.includes(state.year)) {
        const xs = xFor(state.year);
        branchesSvg += '<circle cx="' + xs + '" cy="' + y + '" r="9" fill="none" stroke="rgba(96,165,250,0.6)" stroke-width="1" stroke-dasharray="3 3" opacity="' + (isActive ? 0.85 : 0.3) + '"/>';
      }
    });

    svg.innerHTML = header + guides + origin + branchesSvg;

    // Wire click handlers on nodes
    svg.querySelectorAll('.timeline-node').forEach(g => {
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        const itemId = g.getAttribute('data-item-id');
        const branchId = g.getAttribute('data-branch-id');
        if (branchId !== state.activeBranchId) setActiveBranch(branchId);
        const item = activeBranch().items.find(i => i.id === itemId);
        if (item) openInspectModal(item);
      });
      g.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const itemId = g.getAttribute('data-item-id');
        const branchId = g.getAttribute('data-branch-id');
        nodeMenuTarget = { branchId: branchId, itemId: itemId };
        if (els.nodeMenu) {
          els.nodeMenu.style.left = (e.clientX) + 'px';
          els.nodeMenu.style.top = (e.clientY) + 'px';
          els.nodeMenu.hidden = false;
        }
      });
    });

    // Update branch timeline label
    if (els.tlBranchName) {
      const b = activeBranch();
      els.tlBranchName.textContent = '— ' + b.name;
      els.tlBranchName.style.color = b.color;
    }
  }

  function nodeSymbol(item, branchColor) {
    if (item.type === 'building') {
      return '<rect x="-7" y="-7" width="14" height="14" rx="2.5" fill="' + (item.color || branchColor) + '"/>' +
        '<rect x="-3.5" y="-3" width="2" height="6" fill="#fff" opacity="0.85"/>' +
        '<rect x="-0.5" y="-3" width="2" height="6" fill="#fff" opacity="0.85"/>' +
        '<rect x="2.5" y="-3" width="2" height="6" fill="#fff" opacity="0.85"/>';
    }
    if (item.type === 'road') {
      return '<rect x="-7" y="-7" width="14" height="14" rx="2.5" fill="' + (item.color || '#f59e0b') + '"/>' +
        '<path d="M -4 -2 L 4 -2 M -4 2 L 4 2" stroke="#fff" stroke-width="1.6"/>';
    }
    if (item.type === 'park') {
      return '<rect x="-7" y="-7" width="14" height="14" rx="2.5" fill="#22c55e"/>' +
        '<path d="M 0 -3 Q 3 -1 3 2 Q 3 4 0 4 Q -3 4 -3 2 Q -3 -1 0 -3 Z" fill="#fff" opacity="0.9"/>';
    }
    if (item.type === 'infrastructure') {
      return '<rect x="-7" y="-7" width="14" height="14" rx="2.5" fill="#f59e0b"/>' +
        '<circle r="4.5" fill="none" stroke="#fff" stroke-width="1.5"/>' +
        '<line x1="0" y1="-3.5" x2="0" y2="3.5" stroke="#fff" stroke-width="1.5"/>';
    }
    return '<circle r="4.5" fill="' + branchColor + '"/>';
  }

  function attachNodeMenuEvents() {
    if (!els.nodeMenu) return;
    els.nodeMenu.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        const act = b.getAttribute('data-act');
        if (!nodeMenuTarget) { closeMenus(); return; }
        const branch = state.branches.find(x => x.id === nodeMenuTarget.branchId);
        const item = branch ? branch.items.find(i => i.id === nodeMenuTarget.itemId) : null;
        if (!item) { closeMenus(); return; }
        if (act === 'inspect') openInspectModal(item);
        if (act === 'goto') setYear(item.year);
        if (act === 'delete') {
          if (branch.locked) { toast('Baseline is locked', 'warn'); }
          else {
            branch.items = branch.items.filter(i => i.id !== item.id);
            afterChange();
          }
        }
        closeMenus();
      });
    });
  }

  function truncate(s, n) { return s && s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- INSPECT MODAL ----------

  function openInspectModal(item) {
    if (!els.inspectModal || !els.inspectBody) return;
    const branch = state.branches.find(b => b.items.find(i => i.id === item.id));
    const presetLabel = item.type === 'building' ? capitalise((item.preset || 'residential').replace('_', ' ')) : capitalise(item.type);
    els.inspectTitle.textContent = (item.label || presetLabel);

    // Compute marginal impact: branch metrics with item vs without
    const without = state.branches.map(b => b.id === branch.id ? Object.assign({}, b, { items: branch.items.filter(i => i.id !== item.id) }) : b);
    const baseBranch = without.find(b => b.id === branch.id);
    const target = state.year >= 2027 ? state.year : FINAL_YEAR;
    const withMetrics = metricsForBranchYear(branch, target);
    const withoutMetrics = metricsForBranchYear(baseBranch, target);

    let html = '' +
      '<div class="inspect-row"><span class="k">Branch</span><span class="v" style="color:' + branch.color + '">' + escapeHtml(branch.name) + '</span></div>' +
      '<div class="inspect-row"><span class="k">Type</span><span class="v">' + presetLabel + '</span></div>' +
      '<div class="inspect-row"><span class="k">Placed in year</span><span class="v">' + item.year + '</span></div>';
    if (item.lng != null) html += '<div class="inspect-row"><span class="k">Location</span><span class="v">' + item.lng.toFixed(4) + ', ' + item.lat.toFixed(4) + '</span></div>';
    if (item.start) html += '<div class="inspect-row"><span class="k">Length</span><span class="v">' + roadLengthMeters(item).toFixed(0) + ' m</span></div>';
    html += '<div style="margin:14px 0 6px;font-size:10px;color:var(--text-dim);letter-spacing:0.6px;text-transform:uppercase">Marginal impact at ' + target + '</div>';
    METRICS.forEach(m => {
      const diff = withMetrics[m.id] - withoutMetrics[m.id];
      const cls = (m.goodDirection === 'up' ? (diff >= 0 ? 'delta-up' : 'delta-down') : (diff > 0 ? 'delta-down' : 'delta-up'));
      const sign = diff > 0 ? '+' : '';
      let dStr;
      if (m.id === 'population') dStr = sign + fmtNumber(diff);
      else if (m.id === 'economy') dStr = sign + '£' + Math.abs(diff).toFixed(2) + 'B';
      else if (m.id === 'air') dStr = sign + diff.toFixed(1) + ' AQI';
      else dStr = sign + diff.toFixed(3);
      html += '<div class="inspect-row"><span class="k">' + m.label + '</span><span class="v ' + cls + '">' + dStr + '</span></div>';
    });

    const actionsLocked = branch && branch.locked;
    html += '<div class="inspect-actions">' +
      '<button data-act="goto" type="button">Go to ' + item.year + '</button>' +
      '<button data-act="zoom" type="button">Zoom on map</button>' +
      (actionsLocked ? '' : '<button data-act="remove" class="danger" type="button">Remove</button>') +
      '</div>';

    els.inspectBody.innerHTML = html;
    els.inspectBody.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        const act = b.getAttribute('data-act');
        if (act === 'goto') { setYear(item.year); closeInspectModal(); }
        if (act === 'zoom' && state.map && (item.lng || item.start)) {
          const c = item.start ? [(item.start[0] + item.end[0]) / 2, (item.start[1] + item.end[1]) / 2] : [item.lng, item.lat];
          state.map.flyTo({ center: c, zoom: 15, duration: 800 });
          closeInspectModal();
        }
        if (act === 'remove') {
          removeItem(item.id);
          closeInspectModal();
        }
      });
    });
    els.inspectModal.hidden = false;
  }

  function closeInspectModal() { if (els.inspectModal) els.inspectModal.hidden = true; }

  function roadLengthMeters(item) {
    if (!item.start || !item.end) return 0;
    const lat1 = item.start[1] * Math.PI / 180;
    const lat2 = item.end[1] * Math.PI / 180;
    const dLat = (item.end[1] - item.start[1]) * Math.PI / 180;
    const dLng = (item.end[0] - item.start[0]) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ---------- COMPARE MODAL ----------

  function openCompareModal() {
    if (!els.compareModal || !els.compareBody) return;
    const target = isSimYear(state.year) ? state.year : FINAL_YEAR;
    els.compareYear.textContent = target;
    const branches = state.branches;
    if (branches.length < 2) {
      els.compareBody.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-mute)">Create a second branch to compare.</div>';
      els.compareModal.hidden = false;
      return;
    }

    // Per branch metrics at target year
    const perBranch = branches.map(b => ({ branch: b, metrics: metricsForBranchYear(b, target) }));

    // Identify winners per metric (taking goodDirection into account)
    const winnersByMetric = {};
    METRICS.forEach(m => {
      let best = perBranch[0];
      perBranch.forEach(p => {
        const cur = p.metrics[m.id];
        const bestVal = best.metrics[m.id];
        if (m.goodDirection === 'up' ? cur > bestVal : cur < bestVal) best = p;
      });
      winnersByMetric[m.id] = best.branch.id;
    });

    // Build grid
    const cols = ['180px'].concat(branches.map(() => 'minmax(140px, 1fr)')).join(' ');
    let html = '<div class="compare-grid" style="grid-template-columns:' + cols + '">';
    html += '<div class="head">Metric</div>';
    branches.forEach((b, i) => {
      const last = i === branches.length - 1 ? ' last-col' : '';
      html += '<div class="head' + last + '"><span class="branch-dot" style="background:' + b.color + ';color:' + b.color + ';width:7px;height:7px"></span>' + escapeHtml(truncate(b.name, 22)) + '</div>';
    });
    METRICS.forEach(m => {
      html += '<div class="row-label">' + m.label + '</div>';
      branches.forEach((b, i) => {
        const last = i === branches.length - 1 ? ' last-col' : '';
        const val = perBranch[i].metrics[m.id];
        const before = m.baseline;
        const isWin = winnersByMetric[m.id] === b.id;
        const cls = isWin ? ' winning' : '';
        const valStr = fmtMetricValue(m, val);
        const deltaStr = fmtDeltaLabel(m, before, val);
        html += '<div class="' + (isWin ? 'winning' : 'neutral-cell') + last + '"><div>' + valStr + '</div>' +
          '<div style="font-size:10px;color:var(--text-mute);margin-top:2px">' + deltaStr + '</div></div>';
      });
    });
    html += '</div>';

    // Headline summary
    const winnerCounts = {};
    Object.values(winnersByMetric).forEach(bid => { winnerCounts[bid] = (winnerCounts[bid] || 0) + 1; });
    let topBranch = null, topCount = -1;
    Object.keys(winnerCounts).forEach(bid => {
      if (winnerCounts[bid] > topCount) { topCount = winnerCounts[bid]; topBranch = state.branches.find(b => b.id === bid); }
    });
    if (topBranch) {
      html += '<div class="compare-summary"><strong>' + escapeHtml(topBranch.name) + '</strong> wins on ' + topCount + ' of ' + METRICS.length + ' indicators by ' + target + '. Items in this branch: ' + topBranch.items.length + '.</div>';
    }

    els.compareBody.innerHTML = html;
    els.compareModal.hidden = false;
  }

  function closeCompareModal() { if (els.compareModal) els.compareModal.hidden = true; }

  // ---------- RUN SIMULATION ----------

  function runSimulation() {
    if (state.isRunningSim) return;
    state.isRunningSim = true;
    if (els.runBtn) els.runBtn.classList.add('running');
    if (els.runBtnLabel) els.runBtnLabel.textContent = 'Simulating...';
    // Animate playback through sim years
    const branch = activeBranch();
    let i = 0;
    setYear(2027);
    const tick = setInterval(() => {
      i++;
      if (i >= SIM_YEARS.length) {
        clearInterval(tick);
        state.isRunningSim = false;
        if (els.runBtn) els.runBtn.classList.remove('running');
        if (els.runBtnLabel) els.runBtnLabel.textContent = 'Run Simulation';
        // Stop on 2036, show outcome
        const m = metricsForBranchYear(branch, FINAL_YEAR);
        const popDelta = m.population - METRICS[0].baseline;
        toast('Simulation complete — projected ' + (popDelta >= 0 ? '+' : '') + fmtNumber(popDelta) + ' population by 2036');
        return;
      }
      setYear(SIM_YEARS[i]);
    }, 220);
  }

  // ---------- EXPORT ----------

  function exportResults() {
    const branch = activeBranch();
    const target = isSimYear(state.year) ? state.year : FINAL_YEAR;
    const data = {
      generatedAt: new Date().toISOString(),
      branch: { id: branch.id, name: branch.name, color: branch.color },
      year: target,
      items: branch.items,
      metrics: metricsForBranchYear(branch, target),
      baseline: METRICS.reduce((acc, m) => { acc[m.id] = m.baseline; return acc; }, {})
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = branch.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    a.href = url;
    a.download = 'belfast-' + slug + '-' + target + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    toast('Exported scenario JSON');
  }

  // ---------- VIEW TOGGLE ----------

  function setView(v) {
    if (v !== '2D' && v !== '3D') return;
    state.view = v;
    if (els.viewToggleButtons) {
      els.viewToggleButtons.forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-view') === v);
      });
    }
    if (state.map) {
      const targetPitch = v === '3D' ? ((state.manifest && state.manifest.viewport && state.manifest.viewport.pitch) || 60) : 0;
      state.map.easeTo({ pitch: targetPitch, bearing: v === '3D' ? -24 : 0, duration: 700 });
      if (state.map.getLayer('items-buildings-3d')) {
        state.map.setLayoutProperty('items-buildings-3d', 'visibility', v === '3D' ? 'visible' : 'none');
      }
    }
    saveState();
  }

  // ---------- TOAST ----------

  let toastTimer = null;
  function toast(msg, kind) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.className = 'toast' + (kind ? ' ' + kind : '');
    els.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2400);
  }

  // ---------- TOP NAV / BOTTOM NAV ----------

  function attachTopNav() {
    if (!els.topTabs) return;
    els.topTabs.forEach(t => {
      t.addEventListener('click', () => {
        const m = t.getAttribute('data-mode-tab');
        els.topTabs.forEach(x => x.classList.toggle('active', x === t));
        if (m === 'historical') {
          if (state.year > 2026) setYear(2026);
          state.activeTool = null;
          renderModify();
        } else if (m === 'simulation') {
          if (state.year < 2027) setYear(2027);
        } else if (m === 'compare') {
          openCompareModal();
        } else if (m === 'library') {
          toast('Data Library — connected to local /api/manifest', 'warn');
        }
      });
    });
  }

  function attachBottomNav() {
    if (!els.bottomTabs) return;
    els.bottomTabs.forEach(t => {
      t.addEventListener('click', () => {
        els.bottomTabs.forEach(x => x.classList.toggle('active', x === t));
        const m = t.getAttribute('data-bottom-tab');
        if (m === 'analytics') openCompareModal();
        if (m === 'reports') exportResults();
        if (m === 'community' || m === 'map') {
          // No-op visually, just for UI completeness
          toast(capitalise(m) + ' view coming soon');
          // Keep the dashboard tab active for now
          els.bottomTabs.forEach(x => x.classList.toggle('active', x.getAttribute('data-bottom-tab') === 'dashboard'));
        }
      });
    });
  }

  // ---------- MAP SUBTITLE ----------

  function renderMapSubtitle() {
    if (!els.mapSubtitle) return;
    const sim = isSimYear(state.year);
    const branch = activeBranch();
    const text = sim
      ? 'Simulating ' + branch.name + ' to ' + state.year
      : 'Showing ' + state.year + ' historical baseline';
    els.mapSubtitle.innerHTML = text + ' <span class="info-i" title="Pick a tool, then click on the map. Switch to a year between 2027 and 2036 to add changes.">i</span>';
  }

  // ---------- AFTER CHANGE PIPELINE ----------

  function afterChange() {
    renderBranches();
    renderImpact();
    renderItemsOnMap();
    saveState();
  }

  // ---------- BOOTSTRAP ----------

  async function init() {
    cacheEls();
    loadState();

    renderYearLists();
    renderTimelineBar();
    attachTimelineEvents();
    renderModify();
    attachModifyEvents();
    renderBranches();
    renderImpact();
    renderActiveInfo();
    renderMapSubtitle();
    attachBranchMenuEvents();
    attachNodeMenuEvents();
    attachTopNav();
    attachBottomNav();

    if (els.newBranchBtn) els.newBranchBtn.addEventListener('click', openNewBranchModal);
    if (els.runBtn) els.runBtn.addEventListener('click', runSimulation);
    if (els.compareBtn) els.compareBtn.addEventListener('click', openCompareModal);
    if (els.exportBtn) els.exportBtn.addEventListener('click', exportResults);
    if (els.aboutBtn) els.aboutBtn.addEventListener('click', () => {
      toast('Belfast 2016-2036 Simulation Studio — built with Mapbox + open source data', 'warn');
    });
    if (els.helpBtn) els.helpBtn.addEventListener('click', () => {
      toast('Pick a year, pick a tool, click on the map. Branches let you compare alternate futures.', 'warn');
    });
    if (els.settingsBtn) els.settingsBtn.addEventListener('click', () => {
      if (confirm('Reset the dashboard? This will clear all branches you created.')) {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
      }
    });
    if (els.showAllBtn) els.showAllBtn.addEventListener('click', () => {
      openCompareModal();
    });

    // View toggle
    if (els.viewToggleButtons) {
      els.viewToggleButtons.forEach(b => b.addEventListener('click', () => setView(b.getAttribute('data-view'))));
    }
    // Initialize toggle visual state
    setView(state.view);

    // Modal close handlers
    document.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => {
        const modal = el.closest('.modal');
        if (modal) modal.hidden = true;
      });
    });
    // Esc to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal').forEach(m => m.hidden = true);
        closeMenus();
        if (state.activeTool) {
          state.activeTool = null;
          state.pendingRoadStart = null;
          renderModify();
        }
      }
    });

    // Map last so the rest of the UI is alive even if Mapbox fails
    await loadHistorical();
    await loadManifest();
    initMap();

    // Expose for debugging / smoke tests
    window.BelfastDashboard = {
      state: state,
      setYear: setYear,
      setView: setView,
      addItemAt: addItemAt,
      addRoadItem: addRoadItem,
      removeItem: removeItem,
      runSimulation: runSimulation,
      openCompareModal: openCompareModal,
      createBranch: createBranch,
      deleteBranch: deleteBranch,
      activeBranch: activeBranch,
      metricsForBranchYear: metricsForBranchYear
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
