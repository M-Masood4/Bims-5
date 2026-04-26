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

  const HISTORICAL_YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
  const SIM_YEARS = [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035, 2036];
  const ALL_YEARS = HISTORICAL_YEARS.concat(SIM_YEARS);
  const BASE_YEAR = 2025;
  const START_YEAR = 2026;
  const FINAL_YEAR = 2036;

  const STORAGE_KEY = 'belfast-dashboard-v1';

  const TOOL_LABELS = {
    building: 'Click any valid Belfast map point to place a building',
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
    mode: 'historical',
    view: '2D',
    activeBranchId: 'baseline',
    branches: clone(DEFAULT_BRANCHES),
    activeTool: null, // building | road | park | infrastructure | remove
    activeBuildingPreset: 'residential',
    pendingRoadStart: null, // for two-click road placement
    historicalMetrics: null, // { 2016: { traffic, jobs, electricity, buildings, services }, ... }
    summaryData: null,
    baselineForecast: null,
    manifest: null,
    map: null,
    mapLoaded: false,
    playing: false,
    playTimer: null,
    isRunningSim: false,
    nextItemId: 1,
    persistEnabled: true,
    bottomCollapsed: false,
    // Historical mode
    lens: 'traffic',                // traffic | jobs | electricity | buildings | services
    gridCache: {},                  // year -> grid GeoJSON
    contextLayersAdded: false,
    contextLayersData: {},          // layerId -> geojson
    activeEventId: null,            // commit/event id when one is selected
    eventsForYearCache: null,       // cached events for current year+lens
    // Predicted-impact ripple visualisation
    impactMetric: 'traffic',        // which forecast metric the map paints; kept in lock-step with state.lens
    impactLayersAdded: false,
    lastPlacedItemId: null,         // for similar-events overlay focus
    predictorReady: false,
    selectedPostcode: null,
    lastScenarioResult: null
  };

  // Lens definitions (the 5 historical signals)
  const LENSES = [
    { id: 'traffic',     label: 'Traffic',     color: '#fb923c', goodDirection: 'down', valueProp: 'traffic',     deltaProp: 'traffic_delta_previous',     contextLayer: 'source-ni-roads-osm' },
    { id: 'jobs',        label: 'Jobs',        color: '#a855f7', goodDirection: 'up',   valueProp: 'jobs',        deltaProp: 'jobs_delta_previous',        contextLayer: null },
    { id: 'buildings',   label: 'Buildings',   color: '#3b82f6', goodDirection: 'up',   valueProp: 'buildings',   deltaProp: 'buildings_delta_previous',   contextLayer: 'belfast-ni-buildings-3d' },
    { id: 'electricity', label: 'Electricity', color: '#06b6d4', goodDirection: 'down', valueProp: 'electricity', deltaProp: 'electricity_delta_previous', contextLayer: 'source-ni-power-grid-osm' },
    { id: 'services',    label: 'Services',    color: '#22c55e', goodDirection: 'up',   valueProp: 'services',    deltaProp: 'services_delta_previous',    contextLayer: null }
  ];

  function lensDef(id) { return LENSES.find(l => l.id === id) || LENSES[0]; }

  const SCENARIO_DIFF_LENSES = [
    { id: 'traffic', label: 'Traffic', source: 'traffic', color: '#fb923c', goodDirection: 'down' },
    { id: 'jobs', label: 'Jobs', source: 'jobs', color: '#a855f7', goodDirection: 'up' },
    { id: 'buildings', label: 'Buildings', source: 'population', color: '#3b82f6', goodDirection: 'up' },
    { id: 'electricity', label: 'Electricity', source: 'electricity', color: '#06b6d4', goodDirection: 'down' },
    { id: 'services', label: 'Services', source: 'services', color: '#22c55e', goodDirection: 'up' }
  ];

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
    if (Math.abs(diff) < 1e-6) return 'no change vs 2025';
    if (metric.id === 'population') {
      const sign = diff > 0 ? '+' : '';
      return sign + fmtNumber(diff) + ' vs 2025';
    }
    if (metric.id === 'economy') {
      const sign = diff > 0 ? '+' : '';
      return sign + '£' + Math.abs(diff).toFixed(2) + 'B vs 2025';
    }
    if (metric.id === 'air') {
      const sign = diff > 0 ? '+' : '';
      return sign + diff.toFixed(0) + ' AQI vs 2025';
    }
    return fmtPct((after - before) / Math.max(0.0001, before), true) + ' vs 2025';
  }

  function isSimYear(y) { return y >= START_YEAR; }

  function activeBranch() { return state.branches.find(b => b.id === state.activeBranchId) || state.branches[0]; }

  function activityColor(type) {
    if (type === 'simulation') return '#22c55e';
    if (type === 'diff') return '#3b82f6';
    if (type === 'road') return '#22d3ee';
    return '#64748b';
  }

  function activityIcon(type) {
    if (type === 'simulation') return 'S';
    if (type === 'diff') return 'D';
    if (type === 'road') return 'R';
    return 'A';
  }

  function recordBranchActivity(branch, type, title, detail, year, data) {
    if (!branch || branch.locked) return null;
    if (!Array.isArray(branch.activityLog)) branch.activityLog = [];
    const entry = {
      id: uid('act'),
      type: type || 'activity',
      title: title || 'Activity',
      detail: detail || '',
      year: clamp(Number(year) || state.year || START_YEAR, START_YEAR, FINAL_YEAR),
      createdAt: new Date().toISOString(),
      data: data || {}
    };
    branch.activityLog.push(entry);
    if (branch.activityLog.length > 80) branch.activityLog = branch.activityLog.slice(-80);
    renderLeftSidebar();
    renderBranches();
    saveState();
    return entry;
  }

  // ---------- IMPACT MODEL ----------

  function metricsForBranchYear(branch, targetYear) {
    const year = clamp(targetYear, BASE_YEAR, FINAL_YEAR);
    if (year <= BASE_YEAR) return baselineDisplayMetrics(BASE_YEAR);
    const forecastMetrics = metricsFromScenario(branch, year) || baselineForecastMetrics(year);
    return displayMetricsFromForecast(forecastMetrics, year);
  }

  function baselineForecastMetrics(year) {
    const summary = state.baselineForecast && state.baselineForecast.summaryByYear;
    if (summary && summary[String(year)]) return summary[String(year)];
    if (summary && summary[String(START_YEAR)]) return summary[String(START_YEAR)];
    return null;
  }

  function metricsFromScenario(branch, year) {
    if (!branch || branch.locked) return null;
    const result = branch.scenarioResult;
    if (!result || !result.timelineByYear) return null;
    const target = result.timelineByYear[String(year)];
    if (!target) return null;
    const objective = branch.forecastObjective || objectiveForBranch(branch);
    const branchRow = (target.branches || []).find(b => b.objective === objective) || (target.branches || [])[0];
    return branchRow ? branchRow.metrics : target.baseline;
  }

  function baselineDisplayMetrics(year) {
    const forecast = baselineForecastMetrics(Math.max(START_YEAR, year + 1));
    return displayMetricsFromForecast(forecast, year);
  }

  function displayMetricsFromForecast(forecast, year) {
    const baseline = (state.baselineForecast && state.baselineForecast.summaryByYear && state.baselineForecast.summaryByYear[String(START_YEAR)]) || {};
    const f = forecast || baseline;
    const popBase = METRICS.find(m => m.id === 'population').baseline;
    const economyBase = METRICS.find(m => m.id === 'economy').baseline;
    const populationDelta = ((f.population || 0) - (baseline.population || 0)) * 58_000;
    const economyDelta = ((f.economy || 0) - (baseline.economy || 0)) * 4.2;
    return {
      population: Math.max(0, popBase + populationDelta),
      traffic: clamp(Number(f.traffic || 0), 0, 1.5),
      air: clamp(92 - Number(f.environmentAir || 0) * 72, 0, 100),
      housing: clamp(Number(f.housingPressure || 0), 0, 1.5),
      economy: Math.max(0, economyBase + economyDelta)
    };
  }

  function objectiveForBranch(branch) {
    if (!branch) return 'user_proposal';
    if (branch.id === 'green') return 'green_mitigation';
    if (branch.id === 'transport') return 'traffic_mitigation';
    if (branch.id === 'density') return 'user_proposal';
    const name = String(branch.name || '').toLowerCase();
    if (name.includes('green')) return 'green_mitigation';
    if (name.includes('traffic') || name.includes('transport')) return 'traffic_mitigation';
    if (name.includes('fair')) return 'fairness_first';
    if (name.includes('job') || name.includes('econom')) return 'jobs_optimised';
    if (name.includes('balanced')) return 'balanced';
    return 'user_proposal';
  }

  function metricChangeClass(metric, before, after) {
    if (Math.abs(after - before) < 1e-6) return 'neutral';
    const goingUp = after > before;
    if (metric.goodDirection === 'up') return goingUp ? 'up' : 'down';
    return goingUp ? 'down' : 'up';
  }

  // Sparkline points, 11 entries from 2026 through 2036.
  function sparklinePoints(branch, metric) {
    const start = metric.baseline;
    const pts = [];
    for (let i = 0; i < SIM_YEARS.length; i++) {
      const yr = SIM_YEARS[i];
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
        branches: state.branches.map(b => {
          const copy = { ...b };
          delete copy.scenarioResult;
          delete copy._scenarioPending;
          return copy;
        }),
        activeTool: state.activeTool,
        activeBuildingPreset: state.activeBuildingPreset,
        nextItemId: state.nextItemId,
        bottomCollapsed: state.bottomCollapsed,
        lens: state.lens,
        selectedPostcode: state.selectedPostcode
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
      if (typeof data.bottomCollapsed === 'boolean') state.bottomCollapsed = data.bottomCollapsed;
      if (data.lens && LENSES.find(l => l.id === data.lens)) state.lens = data.lens;
      if (data.selectedPostcode && data.selectedPostcode.canPlace) state.selectedPostcode = data.selectedPostcode;
      // Don't restore active tool — fresh start each session

      // Migration: older sessions stored impactMetric ids like 'transit' or
      // 'opportunity' that no longer exist in IMPACT_METRICS. Always start
      // the impactMetric in lock-step with the lens.
      state.impactMetric = state.lens;
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
      'newBranchBtn', 'branchSelect', 'branchList',
      'tlBranchName', 'branchTimelineSvg',
      'runBtn', 'runBtnLabel', 'compareBtn', 'activeBranchName', 'activeYearLabel', 'exportBtn',
      'compareModal', 'compareYear', 'compareBody',
      'inspectModal', 'inspectTitle', 'inspectBody',
      'diffModal', 'diffTitle', 'diffBody', 'diffMeta', 'diffYearBefore', 'diffYearAfter',
      'lensTabs', 'collapseBtn',
      'mapSearch', 'postcodeForm', 'postcodeInput', 'mapSearchStatus', 'mapSearchSuggest', 'scenarioDiffBtn',
      'branchMenu', 'nodeMenu',
      'toast', 'topNav', 'viewToggle',
      'impactLens', 'impactLensTabs', 'impactLensYear', 'impactLensLegend',
      'similarEvents', 'similarEventsList', 'similarEventsConf',
      'workspaceSplit', 'splitCloseBtn', 'splitTitle', 'splitMeta',
      'splitYearBefore', 'splitYearAfter', 'splitStats', 'splitEvidence',
      'trafficSimSection', 'trafficSimToggle', 'trafficSimToggleLabel',
      'trafficSimDensity', 'trafficSimDensityVal', 'trafficSimSpeed', 'trafficSimSpeedVal',
      'trafficSimStats', 'trafficSimVehicles', 'trafficSimSpeedStat', 'trafficSimCongested',
      'roadCompareBtn', 'roadCompareModal', 'roadCompareName',
      'roadCompareProgress', 'roadCompareProgressFill', 'roadCompareProgressLabel',
      'roadCompareResult', 'roadCompareMapBefore', 'roadCompareMapAfter',
      'rcSpeedBefore', 'rcSpeedAfter', 'rcSpeedDelta', 'rcSpeedArrow',
      'rcCongBefore', 'rcCongAfter', 'rcCongDelta', 'rcCongArrow',
      'rcFlowBefore', 'rcFlowAfter', 'rcFlowDelta', 'rcFlowArrow',
      'rcUsage', 'roadCompareSummary',
      'planRoadHint', 'planRoadStep', 'planRoadCancel',
      // New light-theme layout
      'leftSidebarTitle', 'leftSidebarSubtitle', 'leftSidebarFilter', 'leftSidebarList',
      'timelineYears', 'timelineDots', 'timelineFilled'
    ];
    ids.forEach(id => { els[id] = document.getElementById(id); });
    els.mapCanvas = document.querySelector('.map-wrapper') || document.querySelector('.map-canvas');
    els.modifyButtons = els.modifyList ? els.modifyList.querySelectorAll('.tool-btn, .modify-btn') : [];
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

  async function loadForecastData() {
    try {
      const res = await fetch('/data/mode-a/baseline_2025_forecast.json');
      if (!res.ok) throw new Error('forecast fetch ' + res.status);
      state.baselineForecast = await res.json();
    } catch (e) {
      console.warn('forecast fetch failed', e);
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
    // Map perf: disable antialias and pitch in 2D mode for a much faster
    // first paint. The 3D extrusion layer is added on-demand when the user
    // toggles to 3D rather than at every load.
    state.map = new mapboxgl.Map({
      container: 'map',
      style: (m.mapbox && m.mapbox.style) || 'mapbox://styles/mapbox/dark-v11',
      center: view.center,
      zoom: view.zoom,
      pitch: state.view === '3D' ? (view.pitch || 60) : 0,
      bearing: state.view === '3D' ? (view.bearing || 0) : 0,
      antialias: false,
      attributionControl: false,
      fadeDuration: 100,
    });

    state.map.on('load', () => {
      state.mapLoaded = true;
      addItemSources();
      // Only build the heavy 3D extrusion layer if the user is actually in
      // 3D view; otherwise wait for them to flip the toggle. Cuts initial
      // load time on the dashboard.
      if (state.view === '3D') addAdded3DBuildings();
      ensureImpactLayers();
      attachMapInteractions();
      hideOverlay();
      renderItemsOnMap();
      if (isHistoricalMode()) renderHistoricalMapLayers();
      else { updateImpactRipples(); updateImpactLensUI(); }
      updateScenarioDiffButton();
      // Hand the map to the traffic-sim engine so it can draw vehicle layers.
      if (window.TrafficSim) {
        window.TrafficSim.init({
          map: state.map,
          onMetrics: updateTrafficSimStats,
        });
        // Preload the authoritative Belfast OSM road network so the road
        // planner snaps the candidate road onto real streets — instead of
        // a synthetic lattice fallback that drew lines through buildings.
        if (typeof window.TrafficSim.preloadOsm === 'function') {
          window.TrafficSim.preloadOsm('/api/layers/2026/source-ni-roads-osm');
        }
      }
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
      toast('Switch to a simulation year (2026-2036) to add changes', 'warn');
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

  // Roads can ONLY be placed by clicking two junction nodes that the road
  // planner has discovered around a postcode search. Free-click placement
  // is disabled — the simulation needs both endpoints to land on a real OSM
  // road junction so vehicles can actually route through them.
  function handleRoadClick(lng, lat) {
    if (!roadPlanner.armed) {
      toast('Search a postcode first — the planner will reveal junctions you can connect.', 'warn');
      if (els.postcodeInput) els.postcodeInput.focus();
      return;
    }
    // Snap-to-nearest-junction: if the click is within ~50m of an unpicked
    // junction, treat it like a junction click. Otherwise nudge the user.
    const nearest = nearestJunction([lng, lat], 0.06);
    if (!nearest) {
      toast('Click one of the glowing junction circles to place an end-point.', 'warn');
      return;
    }
    onJunctionClick({ features: [{ properties: { id: nearest.id } }] });
  }

  function nearestJunction(coord, maxKm) {
    if (!window.TrafficSim || !roadPlanner.junctions.length) return null;
    let best = null, bestKm = Infinity;
    for (const j of roadPlanner.junctions) {
      const dx = (j.coord[0] - coord[0]) * 111320 * Math.cos(coord[1] * Math.PI / 180);
      const dy = (j.coord[1] - coord[1]) * 111320;
      const km = Math.hypot(dx, dy) / 1000;
      if (km < bestKm) { bestKm = km; best = j; }
    }
    return (best && bestKm <= maxKm) ? best : null;
  }

  // ---------- ITEM CRUD ----------

  function buildingConfigForPreset(preset) {
    const map = {
      residential: { size: 'medium', buildingType: 'apartments', affordabilityMix: 'affordable', floors: 8, footprintSqm: 1500 },
      commercial: { size: 'medium', buildingType: 'office', affordabilityMix: 'market', floors: 8, footprintSqm: 1500 },
      industrial: { size: 'large', buildingType: 'office', affordabilityMix: 'market', floors: 4, footprintSqm: 3500 },
      mixed_use: { size: 'medium', buildingType: 'mixed_use', affordabilityMix: 'affordable', floors: 8, footprintSqm: 1500 }
    };
    const config = map[preset] || map.residential;
    return {
      ...config,
      energyStandard: 'net_zero_ready',
      parkingTransitAssumption: 'transit_first',
      mitigation: { green: preset === 'mixed_use', mobility: true, energy: true }
    };
  }

  function addBuildingAtSelectedPostcode(branch) {
    const resolved = state.selectedPostcode;
    if (!resolved || !resolved.canPlace || !resolved.location) {
      toast('Search a full Belfast postcode first. Broad BT outcodes can zoom, but cannot place.', 'warn');
      if (els.postcodeInput) els.postcodeInput.focus();
      return;
    }
    const preset = state.activeBuildingPreset;
    const presetDef = PRESETS.building.find(p => p.id === preset);
    const item = {
      id: 'item-' + (state.nextItemId++),
      type: 'building',
      year: START_YEAR,
      lng: resolved.location.lng,
      lat: resolved.location.lat,
      postcode: resolved.postcode || resolved.normalizedPostcode,
      resolvedPostcode: resolved,
      preset: preset,
      buildingConfig: buildingConfigForPreset(preset),
      color: presetDef ? presetDef.color : '#a855f7',
      label: capitalise(preset.replace('_', ' ')),
      height: preset === 'industrial' ? 22 : preset === 'commercial' ? 60 : preset === 'mixed_use' ? 45 : 32
    };
    branch.items.push(item);
    branch.forecastObjective = objectiveForBranch(branch);
    branch.scenarioResult = null;
    branch.scenarioStaged = true;
    if (state.lastScenarioResult && state.activeBranchId === branch.id) state.lastScenarioResult = null;
    state.lastPlacedItemId = item.id;
    if (state.year < START_YEAR) setYear(START_YEAR);
    afterChange();
    triggerEpicentrePulse(item);
    toast('Staged ' + item.label + ' at ' + item.postcode + '. Click Run Simulation to calculate the forecast.');
  }

  function ensureEditableBranch() {
    let branch = activeBranch();
    if (branch && !branch.locked) return branch;
    branch = state.branches.find(b => !b.locked);
    if (!branch) {
      createBranch('New Scenario', '#22c55e', 'baseline');
      branch = activeBranch();
    } else {
      state.activeBranchId = branch.id;
      renderBranches();
      renderActiveInfo();
      renderMapSubtitle();
    }
    return branch;
  }

  function locationLabel(lng, lat) {
    return Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5);
  }

  async function validateMapPlacement(lng, lat, config) {
    const res = await fetch('/api/building/validate-placement', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        location: { lng, lat },
        config,
        requireResolvedPostcode: false
      })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.status === 'invalid') {
      const warnings = json.warnings || json.validation?.warnings || [];
      throw new Error(warnings[0] || json.detail || json.error || 'Placement is invalid here');
    }
    return json;
  }

  async function addBuildingAtMapPoint(branch, lng, lat) {
    const preset = state.activeBuildingPreset;
    const presetDef = PRESETS.building.find(p => p.id === preset);
    const config = buildingConfigForPreset(preset);
    let validation;
    try {
      validation = await validateMapPlacement(lng, lat, config);
    } catch (error) {
      toast(error.message, 'warn');
      return;
    }
    const item = {
      id: 'item-' + (state.nextItemId++),
      type: 'building',
      year: START_YEAR,
      lng,
      lat,
      location: { lng, lat },
      validation,
      preset,
      buildingConfig: config,
      color: presetDef ? presetDef.color : '#a855f7',
      label: capitalise(preset.replace('_', ' ')),
      height: preset === 'industrial' ? 22 : preset === 'commercial' ? 60 : preset === 'mixed_use' ? 45 : 32
    };
    branch.items.push(item);
    branch.forecastObjective = objectiveForBranch(branch);
    branch.scenarioResult = null;
    branch.scenarioStaged = true;
    if (state.lastScenarioResult && state.activeBranchId === branch.id) state.lastScenarioResult = null;
    state.lastPlacedItemId = item.id;
    if (state.year < START_YEAR) setYear(START_YEAR);
    afterChange();
    triggerEpicentrePulse(item);
    toast('Staged ' + item.label + ' at ' + locationLabel(lng, lat) + '. Click Run Simulation to calculate the forecast.');
  }

  function addItemAt(type, lng, lat) {
    const branch = ensureEditableBranch();
    if (!branch || branch.locked) return;
    if (type === 'building') {
      if (state.selectedPostcode && state.selectedPostcode.canPlace) {
        addBuildingAtSelectedPostcode(branch);
      } else {
        addBuildingAtMapPoint(branch, lng, lat);
      }
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
    branch.scenarioResult = null;
    branch.scenarioStaged = true;
    if (state.lastScenarioResult && state.activeBranchId === branch.id) state.lastScenarioResult = null;
    state.lastPlacedItemId = item.id;
    afterChange();
    if (item.type === 'building') triggerEpicentrePulse(item);
    toast('Added ' + (item.label || type) + ' to ' + branch.name);
  }

  async function runScenarioForBranch(branch, item) {
    const building = item || (branch.items || []).find(it => it.type === 'building' && (it.postcode || (Number.isFinite(Number(it.lng)) && Number.isFinite(Number(it.lat)))));
    if (!building) return null;
    if (branch._scenarioPending) return branch._scenarioPending;
    branch._scenarioPending = fetch('/api/scenario-studio/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        postcode: building.postcode,
        building: {
          id: building.id,
          postcode: building.postcode,
          location: { lng: building.lng, lat: building.lat },
          config: building.buildingConfig || buildingConfigForPreset(building.preset),
          delivery: { startYear: START_YEAR, completionYear: FINAL_YEAR }
        },
        branch: {
          id: branch.id,
          name: branch.name,
          objective: objectiveForBranch(branch)
        },
        interventions: scenarioInterventionsForBranch(branch, building),
        startYear: START_YEAR,
        baselineYear: BASE_YEAR,
        horizonYear: FINAL_YEAR
      })
    })
      .then(async res => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.ok === false) throw new Error(json.detail || json.error || ('scenario ' + res.status));
        branch.scenarioResult = json;
        branch.forecastObjective = objectiveForBranch(branch);
        branch.scenarioStaged = false;
        state.lastScenarioResult = json;
        renderImpact();
        renderBranches();
        updateImpactRipples();
        updateImpactLensUI();
        updateScenarioDiffButton();
        return json;
      })
      .catch(err => {
        toast('Scenario run failed: ' + err.message, 'error');
        return null;
      })
      .finally(() => {
        branch._scenarioPending = null;
        saveState();
      });
    return branch._scenarioPending;
  }

  function selectedScenarioBuilding(branch) {
    return branch && (branch.items || []).find(it => it.type === 'building' && (it.postcode || (Number.isFinite(Number(it.lng)) && Number.isFinite(Number(it.lat)))));
  }

  function scenarioResultForBranch(branch) {
    return branch && branch.scenarioResult && branch.scenarioResult.timelineByYear ? branch.scenarioResult : null;
  }

  function scenarioDiffYear() {
    return clamp(isSimYear(state.year) ? state.year : FINAL_YEAR, START_YEAR, FINAL_YEAR);
  }

  function selectedForecastScenarioBranch(scenario, branch) {
    const branches = scenario && Array.isArray(scenario.scenarioBranches) ? scenario.scenarioBranches : [];
    if (!branches.length) return null;
    const objective = branch && (branch.forecastObjective || objectiveForBranch(branch));
    return branches.find(b => b.objective === objective) ||
      branches.find(b => b.name === scenario.recommendedBranch) ||
      branches[0];
  }

  function concreteImpactsForBranchYear(branch, year) {
    const scenario = scenarioResultForBranch(branch);
    if (!scenario) return null;
    const forecastBranch = selectedForecastScenarioBranch(scenario, branch);
    const row = forecastBranch && forecastBranch.timelineByYear
      ? forecastBranch.timelineByYear[String(year)]
      : null;
    return (row && row.concreteImpacts) || (forecastBranch && forecastBranch.concreteImpacts) || null;
  }

  function updateScenarioDiffButton() {
    if (!els.scenarioDiffBtn) return;
    const branch = activeBranch();
    const building = selectedScenarioBuilding(branch);
    const scenario = scenarioResultForBranch(branch);
    const ready = state.mode === 'simulation' &&
      state.view === '3D' &&
      !!building &&
      !!scenario &&
      !!scenario.baselineBranch &&
      !branch._scenarioPending &&
      !state.isRunningSim;
    els.scenarioDiffBtn.hidden = !ready;
    if (ready) {
      const year = scenarioDiffYear();
      els.scenarioDiffBtn.textContent = 'View Diff';
      els.scenarioDiffBtn.title = 'Open no-build vs with-building 3D diff for ' + (building.postcode || 'selected map point') + ' in ' + year;
    }
  }

  // Briefly amp up the epicentre dot's pulse value, then settle to its
  // year-driven steady state. Drives the bloom animation on placement.
  function triggerEpicentrePulse(item) {
    if (!state.map || !state.map.getSource('impact-epicentres')) return;
    const startTs = performance.now();
    const duration = 900;
    function tick(now) {
      const t = Math.min(1, (now - startTs) / duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const burst = 1 - eased;
      // Re-write source data with elevated pulse on the focused item
      const branch = activeBranch();
      const buildings = branch ? branch.items.filter(it => it.type === 'building' && it.year <= state.year) : [];
      const features = buildings.map(b => {
        const isFocus = b.id === item.id;
        const yearPulse = Math.min(1, (state.year - b.year + 1) / 8);
        const finalPulse = isFocus ? Math.max(yearPulse, burst) : yearPulse;
        return {
          type: 'Feature',
          properties: { id: b.id, color: '#22d3ee', pulse: finalPulse },
          geometry: { type: 'Point', coordinates: [b.lng, b.lat] }
        };
      });
      state.map.getSource('impact-epicentres').setData({ type: 'FeatureCollection', features: features });
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // Add a road item to the active branch. `path` is an optional polyline
  // [[lng,lat], ...] following real OSM streets — when present, start/end
  // are the path endpoints and the renderer + traffic sim treat the whole
  // polyline as the road.
  function addRoadItem(start, end, path) {
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
      label: 'New Road',
    };
    if (Array.isArray(path) && path.length >= 2) item.path = path;
    branch.items.push(item);
    branch.scenarioResult = null;
    branch.scenarioStaged = true;
    if (state.lastScenarioResult && state.activeBranchId === branch.id) state.lastScenarioResult = null;
    afterChange();
    toast('Added Road segment to ' + branch.name);
  }

  function locationFromCoords(coords) {
    if (!Array.isArray(coords) || !coords.length) return null;
    let lng = 0;
    let lat = 0;
    let count = 0;
    coords.forEach(coord => {
      if (!Array.isArray(coord) || coord.length < 2) return;
      const x = Number(coord[0]);
      const y = Number(coord[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      lng += x;
      lat += y;
      count++;
    });
    return count ? { lng: lng / count, lat: lat / count } : null;
  }

  function scenarioInterventionFromItem(item, primaryBuilding) {
    if (!item || item.id === primaryBuilding.id) return null;
    if (item.type === 'building' && item.postcode) {
      return {
        id: item.id,
        type: 'building',
        location: { lng: item.lng, lat: item.lat },
        postcode: item.postcode,
        config: item.buildingConfig || buildingConfigForPreset(item.preset),
        rationale: 'Additional staged building in the active branch.'
      };
    }
    if (item.type === 'road') {
      const path = Array.isArray(item.path) && item.path.length >= 2
        ? item.path
        : [item.start, item.end].filter(Array.isArray);
      if (path.length < 2) return null;
      return {
        id: item.id,
        type: 'road',
        label: item.label || 'New Road',
        path,
        start: path[0],
        end: path[path.length - 1],
        location: locationFromCoords(path),
        mode: 'road_capacity',
        radiusM: 850,
        year: item.year || START_YEAR,
        rationale: 'User-staged road included in the full forecast run.'
      };
    }
    if (item.type === 'infrastructure') {
      return {
        id: item.id,
        type: 'transformer',
        label: item.label || 'Transformer',
        location: { lng: item.lng, lat: item.lat },
        radiusM: 650,
        year: item.year || START_YEAR,
        rationale: 'User-staged transformer included in electricity and services planning.'
      };
    }
    if (item.type === 'park') {
      return {
        id: item.id,
        type: 'green_corridor',
        label: item.label || 'Park',
        location: { lng: item.lng, lat: item.lat },
        bufferRadiusM: 450,
        radiusM: 450,
        year: item.year || START_YEAR,
        rationale: 'User-staged green space included as environmental mitigation.'
      };
    }
    return null;
  }

  function scenarioInterventionsForBranch(branch, primaryBuilding) {
    return (branch.items || [])
      .map(item => scenarioInterventionFromItem(item, primaryBuilding))
      .filter(Boolean);
  }

  function removeItem(itemId) {
    const branch = activeBranch();
    if (branch.locked) { toast('Baseline is locked.', 'warn'); return; }
    const before = branch.items.length;
    branch.items = branch.items.filter(it => it.id !== itemId);
    if (branch.items.length !== before) {
      branch.scenarioResult = null;
      branch.scenarioStaged = true;
      if (state.lastScenarioResult && state.activeBranchId === branch.id) state.lastScenarioResult = null;
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
    // For historical years 2016-2025 we show no user items (those don't exist yet).
    const visible = state.year >= START_YEAR
      ? branch.items.filter(it => it.year <= state.year)
      : [];

    const points = { type: 'FeatureCollection', features: [] };
    const roads = { type: 'FeatureCollection', features: [] };
    const buildings3d = { type: 'FeatureCollection', features: [] };

    visible.forEach(it => {
      if (it.type === 'road') {
        // Roads with a `path` polyline follow real OSM streets — render the
        // whole polyline so the new road traces the road network instead of
        // cutting across blocks.
        const coords = (Array.isArray(it.path) && it.path.length >= 2) ? it.path : [it.start, it.end];
        roads.features.push({
          type: 'Feature',
          properties: { id: it.id, color: it.color, label: it.label },
          geometry: { type: 'LineString', coordinates: coords }
        });
        // Label sits at the polyline's middle vertex (or the midpoint of a
        // straight 2-point road).
        const midIdx = Math.floor(coords.length / 2);
        const mid = (coords.length >= 3) ? coords[midIdx]
                  : [(coords[0][0] + coords[1][0]) / 2, (coords[0][1] + coords[1][1]) / 2];
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
    els.tlYearNow.className = 'now-label' + (sim ? ' simulation' : '');

    const idx = ALL_YEARS.indexOf(state.year);
    const pct = idx === -1 ? 0 : (idx / (ALL_YEARS.length - 1)) * 100;
    if (els.tlProgress) {
      els.tlProgress.style.width = pct + '%';
      els.tlProgress.className = 'tl-progress' + (sim ? ' simulation' : '');
    }
    if (els.tlThumb) {
      els.tlThumb.style.left = pct + '%';
      els.tlThumb.className = 'tl-thumb' + (sim ? ' simulation' : '');
    }
    if (els.timelineFilled) els.timelineFilled.style.width = pct + '%';

    // New dot-based timeline (light-theme layout). Lazy-build labels + dots
    // once, then re-paint the active state on each year change.
    renderTimelineDots();

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
    if (els.tagYear) els.tagYear.style.color = sim ? 'var(--purple)' : 'var(--blue)';
    if (els.tagYear) els.tagYear.style.background = sim ? 'rgba(168,85,247,0.10)' : 'rgba(59,130,246,0.10)';
  }

  // Year-strip + dot timeline that lives in the new light-theme layout.
  // Lazy-builds the labels + dots on first call, then just retags which dot
  // is current.
  function renderTimelineDots() {
    if (!els.timelineDots || !els.timelineYears) return;
    const cur = ALL_YEARS.indexOf(state.year);
    if (!els.timelineDots.dataset.built) {
      els.timelineYears.innerHTML = ALL_YEARS.map(y => '<span>' + y + '</span>').join('');
      els.timelineDots.innerHTML = ALL_YEARS.map((y, i) =>
        '<button class="t-dot" data-tl-year="' + y + '" type="button" aria-label="' + y + '"></button>'
      ).join('');
      els.timelineDots.querySelectorAll('.t-dot').forEach((dot) => {
        dot.addEventListener('click', () => {
          const y = parseInt(dot.getAttribute('data-tl-year'), 10);
          if (Number.isFinite(y)) setYear(y);
        });
      });
      els.timelineDots.dataset.built = '1';
    }
    els.timelineDots.querySelectorAll('.t-dot').forEach((dot, i) => {
      dot.classList.remove('current', 'future');
      if (i === cur) dot.classList.add('current');
      else if (i > cur) dot.classList.add('future');
    });
  }

  // ---------- LEFT SIDEBAR (Events / Activity Log) ----------
  // Historical years (≤ 2025) → "Events" view: pulls from the in-app event
  // catalogue (eventsForCurrentYearAndLens) and lists historical milestones.
  // Simulation years (≥ 2026) → "Activity Log" view: a chronological log of
  // user actions on the active branch (placed buildings, planned roads, run
  // simulations).
  const LENS_ICONS = {
    traffic: '🛣️', jobs: '💼', electricity: '⚡', buildings: '🏢', services: '🌳',
    bus: '🚌', metro: '🚇', cycle: '🚲', park: '🌿', star: '⭐', water: '💧', people: '👥',
    home: '🏠', office: '🏢',
  };
  const LENS_TINTS = {
    traffic: '#fffbe6', jobs: '#f0eaff', electricity: '#fff5eb',
    buildings: '#eaf4ff', services: '#edfaf0',
  };

  function renderLeftSidebar() {
    if (!els.leftSidebarList || !els.leftSidebarTitle) return;
    const hist = isHistoricalMode();
    els.leftSidebarTitle.textContent = hist ? 'Events' : 'Activity Log';
    if (els.leftSidebarSubtitle) {
      els.leftSidebarSubtitle.innerHTML = hist
        ? 'What happens<br>as time goes on'
        : 'Your scenario actions<br>and simulation runs';
    }
    if (els.leftSidebarFilter) els.leftSidebarFilter.style.display = hist ? '' : 'none';
    if (hist) renderLeftSidebarEvents();
    else      renderLeftSidebarActivity();
  }

  function renderLeftSidebarEvents() {
    if (!els.leftSidebarList) return;
    const filterId = els.leftSidebarFilter ? els.leftSidebarFilter.value : 'all';
    // Pull events for the currently-selected year+lens. If a category filter
    // is active, also pull that lens's events so the user can browse outside
    // the active lens.
    let events = [];
    try { events = eventsForCurrentYearAndLens() || []; } catch (_) { events = []; }
    if (filterId !== 'all' && filterId !== state.lens) {
      // fire-and-forget — load + re-render once it resolves
      loadEventsForYearLens(state.year, filterId).then(() => renderLeftSidebar());
      const cached = state.eventsForYearCache;
      if (cached && cached.signal === filterId) events = cached.events || [];
    }
    if (!events.length) {
      els.leftSidebarList.innerHTML =
        '<div style="padding:20px 16px;font-size:11.5px;color:var(--text-mute);line-height:1.5">No events catalogued for this year and lens. Try another lens or scrub the timeline.</div>';
      return;
    }
    els.leftSidebarList.innerHTML = events.slice(0, 60).map(ev => {
      const lensId = ev.signal || state.lens;
      const tint = LENS_TINTS[lensId] || '#eaf4ff';
      const icon = LENS_ICONS[lensId] || '•';
      const title = escapeHtml(ev.title || ev.label || ('Event ' + (ev.id || '')));
      const sub = escapeHtml(ev.subtitle || ev.location || ev.placeName || '');
      const date = escapeHtml(ev.date || (ev.year ? String(ev.year) : ''));
      const active = (ev.id && ev.id === state.activeEventId) ? ' active' : '';
      return '<div class="event-item' + active + '" data-event-id="' + escapeHtml(ev.id || '') + '">' +
        '<div class="event-icon" style="background:' + tint + '">' + icon + '</div>' +
        '<div class="event-info">' +
          '<div class="event-title">' + title + '</div>' +
          (sub ? '<div class="event-sub">' + sub + '</div>' : '') +
          (date ? '<div class="event-date">' + date + '</div>' : '') +
        '</div></div>';
    }).join('');
    els.leftSidebarList.querySelectorAll('.event-item').forEach(node => {
      node.addEventListener('click', () => {
        const id = node.getAttribute('data-event-id');
        if (id && typeof selectEvent === 'function') selectEvent(id);
      });
    });
  }

  function renderLeftSidebarActivity() {
    if (!els.leftSidebarList) return;
    const branch = activeBranch();
    if (!branch) { els.leftSidebarList.innerHTML = ''; return; }
    const items = (branch.items || []).slice().sort((a, b) => (b.year || 0) - (a.year || 0));
    const logs = (branch.activityLog || []).slice().sort((a, b) => {
      const yearDiff = (b.year || 0) - (a.year || 0);
      if (yearDiff) return yearDiff;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    const entries = [];
    entries.push({
      icon: '🌳',
      tint: '#edfaf0',
      title: 'Branch: ' + (branch.name || 'Untitled'),
      sub: branch.locked ? 'Baseline (read-only)' : 'Active scenario',
      date: 'now',
    });
    logs.forEach(log => {
      entries.push({
        icon: activityIcon(log.type),
        tint: log.type === 'simulation' ? '#edfaf0' : log.type === 'diff' ? '#eaf4ff' : '#f8f9fc',
        title: log.title || 'Activity',
        sub: log.detail || '',
        date: 'Year ' + (log.year || state.year),
      });
    });
    items.forEach(it => {
      let icon = '➕', tint = '#fff5eb', title = 'Item';
      if (it.type === 'building') {
        icon = '🏢'; tint = '#eaf4ff';
        title = 'Added ' + (it.label || 'Building');
      } else if (it.type === 'road') {
        icon = '🛣️'; tint = '#fffbe6';
        const len = Array.isArray(it.path) ? it.path.length : 2;
        title = 'Planned road · ' + (len - 1) + ' segments';
      } else if (it.type === 'park') {
        icon = '🌿'; tint = '#edfaf0';
        title = 'Added Park';
      } else if (it.type === 'infrastructure') {
        icon = '⚡'; tint = '#fff5eb';
        title = 'Added Infrastructure';
      }
      entries.push({
        icon: icon, tint: tint,
        title: title,
        sub: it.preset ? capitalise(String(it.preset).replace(/_/g, ' ')) : (it.label || ''),
        date: 'Year ' + (it.year || state.year),
      });
    });
    if (entries.length === 1) {
      entries.push({
        icon: '✨', tint: '#f8f9fc',
        title: 'Nothing planned yet',
        sub: 'Add buildings or roads on the map to fill this log.',
        date: '',
      });
    }
    els.leftSidebarList.innerHTML = entries.map(e =>
      '<div class="event-item">' +
        '<div class="event-icon" style="background:' + e.tint + '">' + e.icon + '</div>' +
        '<div class="event-info">' +
          '<div class="event-title">' + escapeHtml(e.title) + '</div>' +
          (e.sub ? '<div class="event-sub">' + escapeHtml(e.sub) + '</div>' : '') +
          (e.date ? '<div class="event-date">' + escapeHtml(e.date) + '</div>' : '') +
        '</div></div>'
    ).join('');
  }

  function attachLeftSidebar() {
    if (els.leftSidebarFilter) {
      els.leftSidebarFilter.addEventListener('change', () => {
        // Map "all" to the active lens; everything else drives a new lens.
        const v = els.leftSidebarFilter.value;
        if (v && v !== 'all' && LENSES.find(l => l.id === v)) setLens(v);
        renderLeftSidebar();
      });
    }
    // First paint
    renderLeftSidebar();
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
    state.activeEventId = null;
    // Auto-mode: 2025 is the baseline. 2026 onward is the forecast simulation.
    const desiredMode = y <= BASE_YEAR ? 'historical' : 'simulation';
    if (desiredMode !== state.mode) {
      state.mode = desiredMode;
      if (desiredMode === 'historical') {
        state.activeTool = null;
        state.pendingRoadStart = null;
      } else {
        state.activeEventId = null;
      }
      syncTopNavForMode();
      renderLensTabs();
      renderModify();
      renderBranches();
      renderActiveInfo();
      if (state.mapLoaded) renderHistoricalMapLayers();
    }
    renderTimelineBar();
    renderYearLists();
    renderImpact();
    renderItemsOnMap();
    renderActiveInfo();
    renderMapSubtitle();
    renderLeftSidebar();
    if (isHistoricalMode()) {
      closeWorkspaceSplit();
      renderHistoricalBranchesPanel();
      renderCompareSection();
      renderHistoricalMapLayers();
    } else {
      // Always call renderCompareSection so the simulation panel HTML is
      // restored when transitioning from historical → simulation. Otherwise
      // the panel keeps the "Event Detail" content from the previous mode
      // and our footer action buttons disappear.
      renderCompareSection();
      updateImpactRipples();
      updateImpactLensUI();
    }
    updateScenarioDiffButton();
    saveState();
  }

  // Keep the top nav buttons (Historical / Simulation) visually in sync with
  // the auto-detected mode. Clicking them still works as a year shortcut.
  function syncTopNavForMode() {
    if (!els.topTabs) return;
    const m = state.mode === 'historical' ? 'historical' : 'simulation';
    els.topTabs.forEach(t => {
      const tab = t.getAttribute('data-mode-tab');
      // Only mark historical/simulation tabs as active — leave compare/library alone
      if (tab === 'historical' || tab === 'simulation') {
        t.classList.toggle('active', tab === m);
      }
    });
  }

  // ---------- RENDER: MODIFY PANEL ----------

  function renderModify() {
    if (isHistoricalMode()) { renderHistoricalModifyPanel(); return; }
    // Re-enable the toolbar tools when leaving historical mode (the
    // historical render dims them).
    if (els.modifyButtons) {
      els.modifyButtons.forEach(btn => {
        btn.removeAttribute('disabled');
        btn.style.opacity = '';
      });
    }
    if (els.modifySub) els.modifySub.style.color = '';
    if (els.presetSection) els.presetSection.style.display = state.activeTool === 'building' ? '' : 'none';
    if (!els.modifyButtons) return;
    els.modifyButtons.forEach(btn => {
      const t = btn.getAttribute('data-tool');
      // "Select" is the implicit default — show it as active when no tool
      // is active (since the user is free to click anything on the map).
      const isSelect = t === 'select';
      const active = isSelect ? !state.activeTool : (t === state.activeTool);
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    // Hide presets unless "building" tool active
    const showPresets = state.activeTool === 'building';
    if (els.presetSection) els.presetSection.style.display = showPresets ? '' : 'none';
    if (els.modifySub) {
      if (state.activeTool) {
        els.modifySub.textContent = state.activeTool === 'building'
          ? (state.selectedPostcode
            ? 'Building will be placed at ' + (state.selectedPostcode.postcode || state.selectedPostcode.normalizedPostcode)
            : 'Click any valid Belfast map point to place a building')
          : (TOOL_LABELS[state.activeTool] || 'Click on the map to place');
        els.modifySub.style.color = 'var(--blue-2)';
      } else {
        els.modifySub.textContent = state.selectedPostcode
          ? 'Ready at ' + (state.selectedPostcode.postcode || state.selectedPostcode.normalizedPostcode)
          : 'Choose Building, then click any valid Belfast map point';
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
    updateRunButtonLabel();
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
        // The "Select" tool is a no-op cursor — clear any active tool.
        if (t === 'select') {
          state.activeTool = null;
          state.pendingRoadStart = null;
          renderModify();
          return;
        }
        // Roads now flow through the postcode → junction picker. If the
        // planner isn't armed yet, push the user to the search box rather
        // than letting them free-click points that won't sit on real roads.
        if (t === 'road' && state.activeTool !== 'road' && !roadPlanner.armed) {
          toast('Search a postcode — junctions you can connect will appear on the map.', 'warn');
          showPlanRoadHint('Search a postcode, then click two junctions to plan a road');
          if (els.postcodeInput) els.postcodeInput.focus();
        }
        state.activeTool = state.activeTool === t ? null : t;
        state.pendingRoadStart = null;
        if (state.activeTool && state.year < START_YEAR) {
          // Auto-jump to first sim year so the action is meaningful.
          // setYear() auto-flips mode to simulation as a side effect.
          setYear(START_YEAR);
        }
        renderModify();
      });
    });
  }

  // ---------- RENDER: IMPACT PANEL ----------

  function renderImpact() {
    if (!els.impactStack || !els.impactTitle) return;
    if (isHistoricalMode()) {
      // Ensure grid is loaded for current year, then render
      loadGridYear(state.year).then(() => renderHistoricalImpact());
      return;
    }
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

    const concrete = concreteImpactsForBranchYear(branch, target);
    els.impactStack.innerHTML =
      METRICS.map(m => metricCardHTML(m, branch, target, metricsAtTarget)).join('') +
      concreteImpactPanelHTML(concrete);
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
    const deltaStr = year === BASE_YEAR ? '2025 baseline' : fmtDeltaLabel(metric, before, after);
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

  function fmtConcreteSigned(value, decimals) {
    const number = Number(value || 0);
    const fixed = Math.abs(number).toFixed(decimals || 0);
    return (number > 0 ? '+' : number < 0 ? '-' : '') + fixed.replace(/\.0+$/, '');
  }

  function concreteImpactPanelHTML(impact) {
    if (!impact || !impact.traffic || !impact.jobs || !impact.electricity || !impact.services) return '';
    const traffic = impact.traffic;
    const jobs = impact.jobs;
    const electricity = impact.electricity;
    const services = impact.services;
    return '' +
      '<div class="concrete-impact-card" data-testid="concrete-impact-data">' +
        '<div class="concrete-impact-head">' +
          '<span>Simulation Data</span>' +
          '<span>' + escapeHtml(String(impact.year || state.year)) + '</span>' +
        '</div>' +
        '<div class="concrete-impact-row">' +
          '<span>Traffic</span>' +
          '<strong>' + fmtConcreteSigned(traffic.netDailyTrips, 0) + ' daily trips</strong>' +
          '<small>' + fmtConcreteSigned(traffic.peakHourVehicleChange, 0) + ' peak hr, ' + fmtConcreteSigned(traffic.delayMinutesPerPeakHourChange, 1) + ' min delay</small>' +
        '</div>' +
        '<div class="concrete-impact-row">' +
          '<span>Jobs</span>' +
          '<strong>' + fmtConcreteSigned(jobs.netJobsEstimate, 0) + ' jobs</strong>' +
          '<small>' + fmtConcreteSigned(jobs.accessibilitySupportedJobs, 0) + ' access-supported</small>' +
        '</div>' +
        '<div class="concrete-impact-row">' +
          '<span>Electricity</span>' +
          '<strong>' + fmtConcreteSigned(electricity.peakKwChange, 0) + ' kW peak</strong>' +
          '<small>' + fmtConcreteSigned(electricity.annualMwhChange, 1) + ' MWh/yr, ' + fmtConcreteSigned(electricity.transformerReliefKw, 0) + ' kW relief</small>' +
        '</div>' +
        '<div class="concrete-impact-row">' +
          '<span>Services</span>' +
          '<strong>' + fmtConcreteSigned(services.netServiceDemand, 0) + ' people-eq</strong>' +
          '<small>' + fmtConcreteSigned(services.serviceCapacityEquivalent, 0) + ' capacity-eq</small>' +
        '</div>' +
        '<div class="concrete-impact-foot">Forecast artifact plus deterministic planners. Estimates, not engineering guarantees.</div>' +
      '</div>';
  }

  // ---------- RENDER: BRANCHES PANEL ----------

  function renderLegacyBranchCards() {
    if (!els.branchList) return;
    if (isHistoricalMode()) {
      // In the new layout the branches panel doesn't get hijacked into an
      // events list anymore — events live in the left sidebar. Hide branch
      // cards in historical mode for clarity.
      els.branchList.innerHTML = '';
      els.branchList.className = 'branch-cards';
      if (els.newBranchBtn) els.newBranchBtn.style.display = 'none';
      renderActiveInfo();
      renderBranchTimeline();
      renderTagDot();
      return;
    }
    if (els.newBranchBtn) els.newBranchBtn.style.display = '';
    els.branchList.className = 'branch-cards';
    if (!state.branches.length) {
      els.branchList.innerHTML = '<div class="branch-empty" style="font-size:11.5px;color:var(--text-mute);padding:8px 0;">No branches yet — click "New Branch" to start.</div>';
      return;
    }
    els.branchList.innerHTML = state.branches.map(branchCardHTML).join('');
    els.branchList.querySelectorAll('.branch-card').forEach(el => {
      const id = el.getAttribute('data-branch-id');
      el.addEventListener('click', (e) => { setActiveBranch(id); });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openBranchMenu(id, el);
      });
    });
    renderActiveInfo();
    renderBranchTimeline();
    renderTagDot();
  }

  function branchCardHTML(b) {
    const active = b.id === state.activeBranchId ? ' active' : '';
    const sub = b.locked ? 'Baseline (locked)' : ((b.items || []).length + ' item' + ((b.items || []).length === 1 ? '' : 's'));
    return '<div class="branch-card' + active + '" data-branch-id="' + b.id + '" tabindex="0">' +
      '<div class="branch-dot" style="background:' + (b.color || '#3b82f6') + '"></div>' +
      '<div class="branch-card-title">' + escapeHtml(b.name || 'Branch') + '</div>' +
      '<div class="branch-card-sub">' + escapeHtml(sub) + '</div>' +
    '</div>';
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

  function renderBranchSelect() {
    if (!els.branchSelect) return;
    els.branchSelect.innerHTML = state.branches.map(b => {
      const count = (b.items || []).length;
      const label = (b.name || 'Branch') + (b.locked ? ' (baseline)' : ' - ' + count + ' item' + (count === 1 ? '' : 's'));
      return '<option value="' + escapeHtml(b.id) + '">' + escapeHtml(label) + '</option>';
    }).join('');
    els.branchSelect.value = state.activeBranchId;
  }

  function renderBranches() {
    if (!els.branchList) return;
    renderBranchSelect();
    if (isHistoricalMode()) {
      els.branchList.className = 'branch-addition-list';
      els.branchList.innerHTML = branchLineHTML([{
        title: state.year + ' historical record',
        detail: 'Source-backed replay. Scenario additions begin in 2026.',
        color: '#3b82f6'
      }]);
      if (els.newBranchBtn) els.newBranchBtn.style.display = 'none';
      if (els.branchSelect) els.branchSelect.disabled = true;
      if (els.tlBranchName) {
        els.tlBranchName.textContent = 'Replay';
        els.tlBranchName.style.color = '';
      }
      renderActiveInfo();
      renderTagDot();
      return;
    }

    const branch = activeBranch();
    if (els.branchSelect) els.branchSelect.disabled = false;
    if (els.newBranchBtn) els.newBranchBtn.style.display = '';
    if (els.tlBranchName) {
      els.tlBranchName.textContent = 'Additions';
      els.tlBranchName.style.color = branch.color || '';
    }
    els.branchList.className = 'branch-addition-list';
    els.branchList.innerHTML = branchAdditionsHTML(branch);
    els.branchList.querySelectorAll('[data-item-id]').forEach(el => {
      const itemId = el.getAttribute('data-item-id');
      el.addEventListener('click', () => {
        const item = activeBranch().items.find(i => i.id === itemId);
        if (item) openInspectModal(item);
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        nodeMenuTarget = { branchId: branch.id, itemId: itemId };
        if (els.nodeMenu) {
          els.nodeMenu.style.left = e.clientX + 'px';
          els.nodeMenu.style.top = e.clientY + 'px';
          els.nodeMenu.hidden = false;
        }
      });
    });
    renderActiveInfo();
    renderTagDot();
  }

  function branchAdditionsHTML(branch) {
    const rows = [{
      title: BASE_YEAR + ' baseline',
      detail: branch.locked ? 'No planned changes' : 'Branched from ' + parentBranchName(branch),
      color: branch.color || '#3b82f6'
    }];
    (branch.items || [])
      .slice()
      .sort((a, b) => (a.year || START_YEAR) - (b.year || START_YEAR))
      .forEach(item => rows.push({
        title: branchItemTitle(item),
        detail: branchItemDetail(item),
        color: item.color || branch.color || '#3b82f6',
        item
      }));
    (branch.activityLog || [])
      .slice()
      .sort((a, b) => (a.year || START_YEAR) - (b.year || START_YEAR) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
      .forEach(log => rows.push({
        title: log.title || 'Activity',
        detail: (log.year ? ('Year ' + log.year + (log.detail ? ' - ' : '')) : '') + (log.detail || ''),
        color: activityColor(log.type)
      }));
    if (branch.scenarioResult && !(branch.activityLog || []).some(log => log.type === 'simulation')) {
      rows.push({
        title: 'Simulation run',
        detail: branch.scenarioResult.recommendedBranch || 'Forecast ready',
        color: '#22c55e'
      });
    }
    return branchLineHTML(rows);
  }

  function branchLineHTML(rows) {
    return '<div class="branch-line">' + rows.map(row => {
      const clickable = row.item ? ' is-clickable' : '';
      const itemAttr = row.item ? ' data-item-id="' + escapeHtml(row.item.id) + '" role="button" tabindex="0"' : '';
      return '<div class="branch-line-item' + clickable + '"' + itemAttr + '>' +
        '<span class="branch-line-dot" style="--branch-line-color:' + escapeHtml(row.color || '#3b82f6') + '"></span>' +
        '<div class="branch-line-card">' +
          '<div class="branch-line-title">' + escapeHtml(row.title) + '</div>' +
          '<div class="branch-line-detail">' + escapeHtml(row.detail || '') + '</div>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function parentBranchName(branch) {
    const parent = branch && state.branches.find(b => b.id === branch.parentId);
    return parent ? parent.name : 'baseline';
  }

  function branchItemTitle(item) {
    if (!item) return 'Addition';
    if (item.type === 'building') return 'Building - ' + (item.label || capitalise(item.preset || 'building'));
    if (item.type === 'road') return item.label || 'Road segment';
    if (item.type === 'park') return 'Park';
    if (item.type === 'infrastructure') return 'Electricity infrastructure';
    return capitalise(item.type || 'addition');
  }

  function branchItemDetail(item) {
    if (!item) return '';
    const year = 'Year ' + (item.year || START_YEAR);
    if (item.type === 'building') {
      const place = item.postcode || (Number.isFinite(Number(item.lng)) ? locationLabel(item.lng, item.lat) : 'map point');
      return year + ' - ' + place;
    }
    if (item.type === 'road') {
      const segments = Array.isArray(item.path) ? Math.max(1, item.path.length - 1) : 1;
      return year + ' - ' + segments + ' street segment' + (segments === 1 ? '' : 's');
    }
    if (Number.isFinite(Number(item.lng)) && Number.isFinite(Number(item.lat))) {
      return year + ' - ' + locationLabel(item.lng, item.lat);
    }
    return year;
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
    closeWorkspaceSplit();
    state.activeBranchId = id;
    renderBranches();
    renderImpact();
    renderItemsOnMap();
    renderMapSubtitle();
    renderLeftSidebar();
    updateScenarioDiffButton();
    saveState();
  }

  function attachBranchPickerEvents() {
    if (!els.branchSelect) return;
    els.branchSelect.addEventListener('change', () => {
      setActiveBranch(els.branchSelect.value);
    });
  }

  // ---------- BRANCH CRUD ----------

  function openModalCustom(title, renderBody) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    const close = () => modal.remove();
    modal.innerHTML =
      '<div class="modal-backdrop" data-close></div>' +
      '<div class="modal-card">' +
        '<div class="modal-head">' +
          '<h3>' + escapeHtml(title) + '</h3>' +
          '<button class="modal-close" data-close type="button">&times;</button>' +
        '</div>' +
        '<div class="modal-body"></div>' +
      '</div>';
    modal.querySelectorAll('[data-close]').forEach(node => node.addEventListener('click', close));
    document.body.appendChild(modal);
    const body = modal.querySelector('.modal-body');
    if (body && typeof renderBody === 'function') renderBody(body, close);
  }

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
    updateScenarioDiffButton();
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
    const target = state.year >= START_YEAR ? state.year : FINAL_YEAR;
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
    const scenario = activeBranch().scenarioResult;
    if (scenario && scenario.timelineByYear && scenario.timelineByYear[String(target)]) {
      renderScenarioCompareModal(scenario, target);
      els.compareModal.hidden = false;
      return;
    }
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

  function renderScenarioCompareModal(scenario, target) {
    const yearRow = scenario.timelineByYear[String(target)];
    const branches = [
      { name: scenario.baselineBranch.name, objective: 'baseline', metrics: yearRow.baseline, diffFromBaseline: {} }
    ].concat((yearRow.branches || []).map(b => ({ name: b.name, objective: b.objective, metrics: b.metrics, diffFromBaseline: b.diffFromBaseline || {} })));
    const metricDefs = [
      { id: 'traffic', label: 'Traffic', goodDirection: 'down' },
      { id: 'population', label: 'Population', goodDirection: 'up' },
      { id: 'jobs', label: 'Jobs', goodDirection: 'up' },
      { id: 'economy', label: 'Economy', goodDirection: 'up' },
      { id: 'housingPressure', label: 'Housing Pressure', goodDirection: 'down' },
      { id: 'services', label: 'Services', goodDirection: 'up' },
      { id: 'electricity', label: 'Electricity Load', goodDirection: 'down' },
      { id: 'environmentAir', label: 'Air / Exposure', goodDirection: 'down' },
      { id: 'greenScore', label: 'Green Score', goodDirection: 'up' },
      { id: 'fairness', label: 'Fairness', goodDirection: 'up' },
      { id: 'fiscalBalance', label: 'Fiscal Balance', goodDirection: 'up' },
      { id: 'planningViability', label: 'Planning Viability', goodDirection: 'up' }
    ];
    const winners = {};
    metricDefs.forEach(m => {
      let best = branches[0];
      branches.forEach(b => {
        const cur = Number(b.metrics[m.id] || 0);
        const old = Number(best.metrics[m.id] || 0);
        if (m.goodDirection === 'up' ? cur > old : cur < old) best = b;
      });
      winners[m.id] = best.name;
    });
    const cols = ['170px'].concat(branches.map(() => 'minmax(130px, 1fr)')).join(' ');
    let html = '<div class="compare-grid scenario-compare" style="grid-template-columns:' + cols + '">';
    html += '<div class="head">Metric</div>';
    branches.forEach(b => { html += '<div class="head">' + escapeHtml(truncate(b.name, 24)) + '</div>'; });
    metricDefs.forEach(m => {
      html += '<div class="row-label">' + m.label + '</div>';
      branches.forEach(b => {
        const value = Number(b.metrics[m.id] || 0);
        const cls = winners[m.id] === b.name ? 'winning' : 'neutral-cell';
        const delta = b.diffFromBaseline && Number.isFinite(Number(b.diffFromBaseline[m.id])) ? Number(b.diffFromBaseline[m.id]) : 0;
        html += '<div class="' + cls + '"><div>' + value.toFixed(3) + '</div>' +
          '<div style="font-size:10px;color:var(--text-mute);margin-top:2px">' + (b.objective === 'baseline' ? 'no-build' : ((delta >= 0 ? '+' : '') + delta.toFixed(3))) + '</div></div>';
      });
    });
    html += '</div>';
    const trace = scenario.agentTrace || [];
    if (trace.length) {
      html += '<div class="compare-summary"><strong>Agent swarm</strong><br>' +
        trace.slice(0, 6).map(t => escapeHtml(t.agent + ': ' + t.summary)).join('<br>') +
        '</div>';
    }
    html += '<div class="compare-summary"><strong>' + escapeHtml(scenario.recommendedBranch || 'Recommended branch') + '</strong> is recommended by deterministic score. Model: ' + escapeHtml(scenario.modelVersion || 'forecast') + '.</div>';
    els.compareBody.innerHTML = html;
  }

  function closeCompareModal() { if (els.compareModal) els.compareModal.hidden = true; }

  // ---------- RUN SIMULATION ----------

  function defaultRunButtonLabel() {
    return state.activeTool === 'road' ? 'Run Road Simulation' : 'Run Simulation';
  }

  function updateRunButtonLabel() {
    if (!state.isRunningSim && els.runBtnLabel) els.runBtnLabel.textContent = defaultRunButtonLabel();
  }

  function completeSimulationWorkspace(branch, scenario, building, metrics) {
    if (!branch || !scenario) return;
    state.lens = 'traffic';
    state.impactMetric = 'traffic';
    state.activeTool = null;
    setYear(FINAL_YEAR);
    setView('3D');
    renderLensTabs();
    renderModify();
    renderImpact();
    updateImpactRipples();
    updateImpactLensUI();
    if (window.TrafficSim) {
      if (window.TrafficSim.isRunning()) window.TrafficSim.refreshSegments();
      else startTrafficSim({ auto: true });
      state._trafficAutoStarted = false;
    }
    const populationMetric = METRICS.find(m => m.id === 'population');
    const popDelta = metrics.population - (populationMetric ? populationMetric.baseline : 0);
    branch.lastSimulationWorkspace = {
      completedAt: new Date().toISOString(),
      year: FINAL_YEAR,
      lens: 'traffic',
      buildingId: building && building.id,
      postcode: building && building.postcode,
      metrics: metrics,
      modelVersion: scenario.modelVersion || 'forecast'
    };
    recordBranchActivity(
      branch,
      'simulation',
      'Simulation complete',
      'Traffic map generated for ' + FINAL_YEAR + ' (' + (popDelta >= 0 ? '+' : '') + fmtNumber(popDelta) + ' population)',
      FINAL_YEAR,
      {
        postcode: building && building.postcode,
        modelVersion: scenario.modelVersion || 'forecast',
        metrics: metrics
      }
    );
  }

  async function runSimulation() {
    if (state.isRunningSim) return;
    const branch = activeBranch();
    if (state.activeTool === 'road') {
      runRoadComparison();
      return;
    }
    const building = selectedScenarioBuilding(branch);
    if (!building) {
      toast('Add a building on a valid Belfast map point before running the forecast.', 'warn');
      return;
    }
    state.isRunningSim = true;
    if (els.runBtn) els.runBtn.classList.add('running');
    if (els.runBtnLabel) els.runBtnLabel.textContent = 'Simulating...';
    const scenario = await runScenarioForBranch(branch, building);
    if (!scenario) {
      state.isRunningSim = false;
      if (els.runBtn) els.runBtn.classList.remove('running');
      updateRunButtonLabel();
      updateScenarioDiffButton();
      return;
    }
    setView('3D');
    updateScenarioDiffButton();
    // Kick off the in-page traffic flow visualisation alongside the year
    // animation. Auto-stops when the sim ends (toggle still works manually).
    const trafficWasRunning = window.TrafficSim && window.TrafficSim.isRunning();
    if (window.TrafficSim && !trafficWasRunning) {
      startTrafficSim({ auto: true });
    } else if (window.TrafficSim) {
      window.TrafficSim.refreshSegments();
    }
    // Animate playback through sim years
    let i = 0;
    setYear(START_YEAR);
    const tick = setInterval(() => {
      i++;
      if (i >= SIM_YEARS.length) {
        clearInterval(tick);
        state.isRunningSim = false;
        if (els.runBtn) els.runBtn.classList.remove('running');
        updateRunButtonLabel();
        // Stop on 2036, show outcome
        const m = metricsForBranchYear(branch, FINAL_YEAR);
        const popDelta = m.population - METRICS[0].baseline;
        updateScenarioDiffButton();
        completeSimulationWorkspace(branch, scenario, building, m);
        toast('Simulation complete — projected ' + (popDelta >= 0 ? '+' : '') + fmtNumber(popDelta) + ' population by 2036');
        // Traffic stays visible as the generated 2036 map after completion.
        if (window.TrafficSim && state._trafficAutoStarted) {
          state._trafficAutoStarted = false;
        }
        return;
      }
      setYear(SIM_YEARS[i]);
      // Refresh the traffic graph each year so user roads added in later years
      // light up as they appear.
      if (window.TrafficSim && window.TrafficSim.isRunning()) {
        window.TrafficSim.refreshSegments();
      }
    }, 220);
  }

  // ---------- TRAFFIC SIM GLUE ----------
  // Thin wrapper around the global TrafficSim engine (web/traffic-sim.js) that
  // keeps the toggle button, density/speed sliders and live stats in sync with
  // the engine's state. The heavy lifting — segment graph, vehicle physics,
  // mapbox layers — lives in TrafficSim itself; this function just owns the
  // panel UI.
  function attachTrafficSim() {
    if (!window.TrafficSim) return;
    if (els.trafficSimToggle) {
      els.trafficSimToggle.addEventListener('click', () => {
        if (window.TrafficSim.isRunning()) stopTrafficSim();
        else startTrafficSim({});
      });
    }
    if (els.trafficSimDensity) {
      els.trafficSimDensity.addEventListener('input', () => {
        const n = Number(els.trafficSimDensity.value);
        if (els.trafficSimDensityVal) els.trafficSimDensityVal.textContent = String(n);
        window.TrafficSim.setDensity(n);
      });
    }
    if (els.trafficSimSpeed) {
      els.trafficSimSpeed.addEventListener('input', () => {
        const n = Number(els.trafficSimSpeed.value);
        if (els.trafficSimSpeedVal) els.trafficSimSpeedVal.textContent = n.toFixed(1) + '×';
        window.TrafficSim.setSpeed(n);
      });
    }
  }

  function startTrafficSim(opts) {
    if (!window.TrafficSim) return;
    const density = Number(els.trafficSimDensity ? els.trafficSimDensity.value : 80);
    const speed = Number(els.trafficSimSpeed ? els.trafficSimSpeed.value : 1);
    window.TrafficSim.start({ density: density, speed: speed, congestionFeedback: true });
    if (opts && opts.auto) state._trafficAutoStarted = true;
    if (els.trafficSimToggle) {
      els.trafficSimToggle.setAttribute('aria-pressed', 'true');
      els.trafficSimToggle.classList.add('active');
    }
    if (els.trafficSimToggleLabel) els.trafficSimToggleLabel.textContent = 'Stop';
    if (els.trafficSimStats) els.trafficSimStats.hidden = false;
  }

  function stopTrafficSim() {
    if (!window.TrafficSim) return;
    window.TrafficSim.stop();
    if (els.trafficSimToggle) {
      els.trafficSimToggle.setAttribute('aria-pressed', 'false');
      els.trafficSimToggle.classList.remove('active');
    }
    if (els.trafficSimToggleLabel) els.trafficSimToggleLabel.textContent = 'Start';
    if (els.trafficSimStats) els.trafficSimStats.hidden = true;
    state._trafficAutoStarted = false;
  }

  function updateTrafficSimStats(m) {
    if (!els.trafficSimStats) return;
    if (els.trafficSimVehicles) els.trafficSimVehicles.textContent = String(m.vehicles || 0);
    if (els.trafficSimSpeedStat) els.trafficSimSpeedStat.textContent = (m.avgSpeed || 0).toFixed(1) + ' m/s';
    if (els.trafficSimCongested) els.trafficSimCongested.textContent = Math.round((m.congested || 0) * 100) + '%';
  }

  // ================================================================
  // ROAD PLANNER — postcode → junctions → plan road → impact comparison
  // ================================================================
  // Workflow:
  //   1. User searches a postcode. flyToResolvedPostcode() then arms the planner with
  //      the searched coordinate (via armRoadPlanner).
  //   2. We sample junction nodes from the OSM road network around that point
  //      and render them as glowing clickable circles.
  //   3. User clicks two junctions; we drop them as a candidate road into the
  //      active branch's items list (same shape as a normal road item).
  //   4. Run Simulation, while the Road tool is selected, runs runComparison()
  //      with the candidate vs. the same network without it, and shows the impact
  //      modal with before/after stats and a per-segment congestion diff.

  const roadPlanner = {
    armed: false,
    centre: null,
    junctions: [],
    pickedIds: [],         // up to 2 junction ids picked by the user
    candidateRoadItemId: null, // id of the most recently planned road in branch
  };

  function ensureRoadPlannerLayers() {
    if (!state.map || !state.mapLoaded) return false;
    if (!state.map.getSource('road-planner-junctions')) {
      state.map.addSource('road-planner-junctions', { type: 'geojson', data: emptyFC() });
    }
    if (!state.map.getLayer('road-planner-junctions-halo')) {
      state.map.addLayer({
        id: 'road-planner-junctions-halo',
        type: 'circle',
        source: 'road-planner-junctions',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 12, 16, 22],
          'circle-color': ['case', ['==', ['get', 'picked'], 1], '#22d3ee', '#60a5fa'],
          'circle-opacity': 0.18,
          'circle-blur': 0.3,
        },
      });
      state.map.addLayer({
        id: 'road-planner-junctions-dot',
        type: 'circle',
        source: 'road-planner-junctions',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'picked'], 1], 8, 5.5],
          'circle-color': ['case', ['==', ['get', 'picked'], 1], '#22d3ee', '#dbeafe'],
          'circle-stroke-width': 2,
          'circle-stroke-color': ['case', ['==', ['get', 'picked'], 1], '#0e7490', '#1d4ed8'],
        },
      });
      // Click handler — pick a junction
      state.map.on('click', 'road-planner-junctions-dot', onJunctionClick);
      state.map.on('mouseenter', 'road-planner-junctions-dot', () => {
        if (state.map) state.map.getCanvas().style.cursor = 'pointer';
      });
      state.map.on('mouseleave', 'road-planner-junctions-dot', () => {
        if (state.map) state.map.getCanvas().style.cursor = '';
      });
    }
    return true;
  }

  function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

  function junctionsAsFC() {
    return {
      type: 'FeatureCollection',
      features: roadPlanner.junctions.map(j => ({
        type: 'Feature',
        properties: {
          id: j.id,
          picked: roadPlanner.pickedIds.indexOf(j.id) >= 0 ? 1 : 0,
        },
        geometry: { type: 'Point', coordinates: j.coord },
      })),
    };
  }

  function paintJunctions() {
    if (!ensureRoadPlannerLayers()) return;
    const src = state.map.getSource('road-planner-junctions');
    if (src) src.setData(junctionsAsFC());
  }

  function clearRoadPlanner() {
    roadPlanner.armed = false;
    roadPlanner.centre = null;
    roadPlanner.junctions = [];
    roadPlanner.pickedIds = [];
    if (state.map && state.map.getSource('road-planner-junctions')) {
      state.map.getSource('road-planner-junctions').setData(emptyFC());
    }
    if (els.planRoadHint) els.planRoadHint.hidden = true;
  }

  function showPlanRoadHint(text) {
    if (!els.planRoadHint) return;
    els.planRoadHint.hidden = false;
    if (els.planRoadStep) els.planRoadStep.textContent = text;
  }

  // Called by the postcode search flow once we've zoomed to a location.
  function armRoadPlanner(centreCoord) {
    if (!Array.isArray(centreCoord) || centreCoord.length !== 2) return;
    if (!window.TrafficSim || !window.TrafficSim.findJunctionNodes) return;
    if (state.year < START_YEAR) {
      // Only meaningful in simulation years (when user-added roads count).
      return;
    }

    // The planner needs the authoritative Belfast OSM road network loaded
    // so the candidate road snaps to real streets rather than the synthetic
    // lattice. Wait for the preload before placing junctions.
    function tryArm() {
      const nodes = window.TrafficSim.findJunctionNodes(centreCoord, 14, 0.5);
      if (!nodes.length) {
        showPlanRoadHint('No nearby junctions found here — try a denser postcode');
        return;
      }
      roadPlanner.armed = true;
      roadPlanner.centre = centreCoord;
      roadPlanner.junctions = nodes;
      roadPlanner.pickedIds = [];
      paintJunctions();
      showPlanRoadHint('Click two glowing junctions to plan a road');
    }

    if (window.TrafficSim.isOsmLoaded && !window.TrafficSim.isOsmLoaded()) {
      showPlanRoadHint('Loading Belfast road network…');
      const promise = window.TrafficSim.preloadOsm
        ? window.TrafficSim.preloadOsm('/api/layers/2026/source-ni-roads-osm')
        : Promise.resolve();
      promise.then(() => setTimeout(tryArm, 200))
             .catch(() => showPlanRoadHint('Could not load road data — check your connection'));
      return;
    }

    // Wait a beat for the flyTo to settle, then arm.
    setTimeout(tryArm, 600);
  }

  function onJunctionClick(e) {
    if (!roadPlanner.armed) return;
    const f = e.features && e.features[0];
    if (!f) return;
    const id = f.properties && f.properties.id;
    if (!id) return;
    const idx = roadPlanner.pickedIds.indexOf(id);
    if (idx >= 0) {
      roadPlanner.pickedIds.splice(idx, 1);
    } else {
      roadPlanner.pickedIds.push(id);
      if (roadPlanner.pickedIds.length > 2) roadPlanner.pickedIds.shift();
    }
    paintJunctions();
    if (roadPlanner.pickedIds.length === 1) {
      showPlanRoadHint('Pick the second junction');
    } else if (roadPlanner.pickedIds.length === 2) {
      const ja = roadPlanner.junctions.find(n => n.id === roadPlanner.pickedIds[0]);
      const jb = roadPlanner.junctions.find(n => n.id === roadPlanner.pickedIds[1]);
      if (!ja || !jb) return;
      placeCandidateRoad(ja.coord, jb.coord);
    }
  }

  function placeCandidateRoad(a, b) {
    const branch = activeBranch();
    if (branch.locked) {
      // Auto-create a planning branch so the baseline stays untouched.
      createBranch('Road Plan', '#22d3ee', 'baseline');
    }
    // Snap the candidate to a path along real OSM streets so we never draw
    // through buildings. Falls back to a straight line only if the graph
    // can't produce a connected route between the two junctions.
    let path = null;
    if (window.TrafficSim && typeof window.TrafficSim.findOsmPath === 'function') {
      const segs = window.TrafficSim.findOsmPath(a, b);
      if (segs && segs.length) {
        path = window.TrafficSim.pathToPolyline(segs);
      }
    }
    if (!path) {
      toast('Could not snap to streets — try junctions a bit closer together.', 'warn');
      return;
    }
    addRoadItem(path[0], path[path.length - 1], path);
    // Track the freshly placed item so runRoadComparison knows which one is
    // the candidate.
    const fresh = activeBranch().items[activeBranch().items.length - 1];
    if (fresh) roadPlanner.candidateRoadItemId = fresh.id;
    showPlanRoadHint('Road planned. Click Run Road Simulation to calculate impact.');
    toast('Road planned. Run the simulation to calculate traffic impact.');
  }

  function setRoadCompareProgress(label, frac) {
    if (els.roadCompareProgressLabel) els.roadCompareProgressLabel.textContent = label;
    if (els.roadCompareProgressFill) els.roadCompareProgressFill.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
  }

  function openRoadCompareModal() {
    if (!els.roadCompareModal) return;
    if (els.roadCompareResult) els.roadCompareResult.hidden = true;
    if (els.roadCompareProgress) els.roadCompareProgress.hidden = false;
    setRoadCompareProgress('Preparing simulations…', 0.05);
    els.roadCompareModal.hidden = false;
  }

  // Called by Run Simulation when the Road tool is selected. If a candidate
  // road already exists, run the impact comparison; otherwise prompt search.
  function runRoadComparison() {
    if (!window.TrafficSim || !window.TrafficSim.runComparison) {
      toast('Traffic engine not ready yet', 'warn');
      return;
    }
    const branch = activeBranch();
    // Find the candidate road — most recently-placed road, prefer the one we
    // tracked.
    const roadItems = branch.items.filter(it => it.type === 'road');
    if (!roadItems.length) {
      // No road yet — arm the planner so the user can pick one.
      if (!roadPlanner.armed) {
        if (els.postcodeInput) els.postcodeInput.focus();
        showPlanRoadHint('Search a postcode, then click two junctions to plan a road');
        toast('Search a postcode and pick two junctions to plan a road', 'warn');
        return;
      }
      toast('Click two junctions to plan a road first', 'warn');
      return;
    }
    let cand = roadItems[roadItems.length - 1];
    if (roadPlanner.candidateRoadItemId) {
      const found = roadItems.find(it => it.id === roadPlanner.candidateRoadItemId);
      if (found) cand = found;
    }

    // Build the segment graph for the branch *without* the candidate, then
    // run with it appended as source:'candidate'. If the candidate has a
    // multi-point path along real streets, expand it into a chain of small
    // segments so the simulation routes vehicles step-by-step.
    const baseSegments = window.TrafficSim.segmentsForBranch({
      items: branch.items.filter(it => it.id !== cand.id),
    });
    const candPath = (Array.isArray(cand.path) && cand.path.length >= 2) ? cand.path : [cand.start, cand.end];
    const candidate = [];
    for (let i = 0; i + 1 < candPath.length; i++) {
      candidate.push({
        id: 'candidate-' + cand.id + '-' + i,
        a: candPath[i],
        b: candPath[i + 1],
        source: 'candidate',
      });
    }

    openRoadCompareModal();
    if (els.roadCompareName) els.roadCompareName.textContent = cand.label || 'New Road';

    // Kick off the live vehicle swarm on the main map so the user *sees*
    // the simulation run on real OSM roads while the headless comparison
    // computes in the background.
    const wasRunning = window.TrafficSim.isRunning();
    if (!wasRunning) {
      startTrafficSim({ auto: true });
    } else {
      window.TrafficSim.refreshSegments();
    }

    // Yield to the browser so the modal paints + vehicles start moving,
    // then run the headless comparison and paint the diff heatmap.
    setTimeout(() => {
      setRoadCompareProgress('Simulating without the new road…', 0.25);
      setTimeout(() => {
        setRoadCompareProgress('Simulating with the new road…', 0.55);
        setTimeout(() => {
          const result = window.TrafficSim.runComparison({
            baseSegments: baseSegments,
            candidate: candidate,
            density: Number(els.trafficSimDensity ? els.trafficSimDensity.value : 80),
            speed: Number(els.trafficSimSpeed ? els.trafficSimSpeed.value : 1),
            durationSeconds: 6,
            seed: 0xb1f55, // stable seed so before/after share spawn positions
          });
          setRoadCompareProgress('Painting congestion diff…', 0.9);
          setTimeout(() => {
            if (!result) {
              toast('Could not run comparison — load the OSM map first', 'warn');
              if (els.roadCompareModal) els.roadCompareModal.hidden = true;
              return;
            }
            // Persistent on-map heatmap — mirrors the historical Traffic
            // lens look. Stays visible after the modal closes.
            window.TrafficSim.showComparisonOverlay(result.segmentDeltas, candidate);
            renderRoadCompareResult(result, cand);
            showCongestionLegend();
          }, 250);
        }, 700);
      }, 700);
    }, 200);
  }

  // Floating legend + Clear button for the on-map congestion-delta heatmap.
  let congestionLegendEl = null;
  function showCongestionLegend() {
    if (congestionLegendEl) { congestionLegendEl.style.display = 'flex'; return; }
    const wrap = document.createElement('div');
    wrap.className = 'congestion-legend';
    wrap.innerHTML =
      '<div class="cl-head"><strong>Congestion change</strong>' +
        '<button class="cl-clear" type="button" title="Clear overlay">&times;</button></div>' +
      '<div class="cl-ramp">' +
        '<span class="cl-step" style="background:#16a34a"></span>' +
        '<span class="cl-step" style="background:#86efac"></span>' +
        '<span class="cl-step" style="background:#94a3b8"></span>' +
        '<span class="cl-step" style="background:#fb923c"></span>' +
        '<span class="cl-step" style="background:#dc2626"></span>' +
      '</div>' +
      '<div class="cl-ramp-labels"><span>Relieved</span><span>Worsened</span></div>' +
      '<div class="cl-row"><span class="cl-sw cl-sw-new"></span> New road</div>';
    const canvas = document.querySelector('.map-canvas') || document.body;
    canvas.appendChild(wrap);
    congestionLegendEl = wrap;
    wrap.querySelector('.cl-clear').addEventListener('click', clearCongestionOverlay);
  }
  function clearCongestionOverlay() {
    if (window.TrafficSim) window.TrafficSim.clearComparisonOverlay();
    if (congestionLegendEl) congestionLegendEl.style.display = 'none';
  }

  // ---------- Render the result ----------

  function renderRoadCompareResult(result, candItem) {
    if (els.roadCompareProgress) els.roadCompareProgress.hidden = true;
    if (els.roadCompareResult) els.roadCompareResult.hidden = false;

    // Stats
    setStatPair('Speed', els.rcSpeedBefore, els.rcSpeedAfter, els.rcSpeedDelta, els.rcSpeedArrow,
      result.before.avgSpeed, result.after.avgSpeed, 'm/s', { higherIsBetter: true, decimals: 1 });
    setStatPair('Cong',  els.rcCongBefore, els.rcCongAfter, els.rcCongDelta, els.rcCongArrow,
      result.before.congested * 100, result.after.congested * 100, '%', { higherIsBetter: false, decimals: 0 });
    setStatPair('Flow',  els.rcFlowBefore, els.rcFlowAfter, els.rcFlowDelta, els.rcFlowArrow,
      result.before.throughput / 1000, result.after.throughput / 1000, 'km', { higherIsBetter: true, decimals: 1 });
    if (els.rcUsage) els.rcUsage.textContent = String(result.after.candidateUsage || 0) + ' trips';

    // Mini-maps
    drawCompareMap(els.roadCompareMapBefore, result.segmentDeltas, 'before', candItem);
    drawCompareMap(els.roadCompareMapAfter,  result.segmentDeltas, 'after',  candItem);

    // Plain-language summary
    const dSpeed = result.after.avgSpeed - result.before.avgSpeed;
    const dCong  = result.after.congested - result.before.congested;
    const verdictBits = [];
    if (dSpeed > 0.3) verdictBits.push('average speeds rise by ' + dSpeed.toFixed(1) + ' m/s');
    else if (dSpeed < -0.3) verdictBits.push('average speeds drop by ' + Math.abs(dSpeed).toFixed(1) + ' m/s');
    if (dCong < -0.03) verdictBits.push('congested time falls by ' + Math.abs(dCong * 100).toFixed(0) + '%');
    else if (dCong > 0.03) verdictBits.push('congested time grows by ' + (dCong * 100).toFixed(0) + '%');
    if (!verdictBits.length) verdictBits.push('the network shifts but overall flow stays similar');
    const verdict = (dSpeed >= 0 && dCong <= 0) ? 'Net relief'
                  : (dSpeed <= 0 && dCong >= 0) ? 'Net congestion'
                  : 'Mixed effect';
    if (els.roadCompareSummary) {
      els.roadCompareSummary.innerHTML =
        '<span class="rc-verdict rc-verdict-' + verdict.toLowerCase().replace(/[^a-z]+/g, '-') + '">' + escapeHtml(verdict) + '</span>' +
        ' — ' + escapeHtml(verdictBits.join(' · ')) + '. ' +
        escapeHtml(result.after.candidateUsage + ' simulated vehicles routed via the new road.');
    }
    const branch = activeBranch();
    if (branch && !branch.locked) {
      branch.lastRoadSimulation = {
        completedAt: new Date().toISOString(),
        year: state.year,
        roadId: candItem && candItem.id,
        before: result.before,
        after: result.after,
        candidateUsage: result.after.candidateUsage || 0
      };
      recordBranchActivity(
        branch,
        'road',
        'Road simulation complete',
        verdict + ' - ' + verdictBits.join(', '),
        state.year,
        branch.lastRoadSimulation
      );
    }
  }

  function setStatPair(label, beforeEl, afterEl, deltaEl, arrowEl, beforeVal, afterVal, unit, opts) {
    opts = opts || {};
    const dec = (typeof opts.decimals === 'number') ? opts.decimals : 1;
    if (beforeEl) beforeEl.textContent = beforeVal.toFixed(dec) + ' ' + unit;
    if (afterEl)  afterEl.textContent  = afterVal.toFixed(dec) + ' ' + unit;
    const delta = afterVal - beforeVal;
    const better = opts.higherIsBetter ? delta > 0 : delta < 0;
    const sameish = Math.abs(delta) < (opts.epsilon != null ? opts.epsilon : (opts.higherIsBetter ? 0.05 : 0.5));
    if (arrowEl) {
      arrowEl.textContent = sameish ? '≈' : (delta > 0 ? '▲' : '▼');
      arrowEl.className = 'rc-stat-arrow ' + (sameish ? 'neutral' : (better ? 'good' : 'bad'));
    }
    if (deltaEl) {
      deltaEl.textContent = (delta > 0 ? '+' : '') + delta.toFixed(dec) + ' ' + unit;
      deltaEl.className = 'rc-stat-delta ' + (sameish ? 'neutral' : (better ? 'good' : 'bad'));
    }
  }

  // Draw a simple SVG schematic of the road network coloured by congestion
  // (or, in the "after" view, by the delta vs. before so users can see which
  // segments improved or got worse).
  function drawCompareMap(svgEl, segmentDeltas, mode, candItem) {
    if (!svgEl) return;
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
    if (!segmentDeltas.length) return;
    const W = 320, H = 220, pad = 12;
    let minLng =  Infinity, maxLng = -Infinity, minLat =  Infinity, maxLat = -Infinity;
    segmentDeltas.forEach(s => {
      [s.a, s.b].forEach(p => {
        if (p[0] < minLng) minLng = p[0]; if (p[0] > maxLng) maxLng = p[0];
        if (p[1] < minLat) minLat = p[1]; if (p[1] > maxLat) maxLat = p[1];
      });
    });
    if (candItem && candItem.start && candItem.end) {
      [candItem.start, candItem.end].forEach(p => {
        if (p[0] < minLng) minLng = p[0]; if (p[0] > maxLng) maxLng = p[0];
        if (p[1] < minLat) minLat = p[1]; if (p[1] > maxLat) maxLat = p[1];
      });
    }
    const dLng = Math.max(1e-6, maxLng - minLng);
    const dLat = Math.max(1e-6, maxLat - minLat);
    function project(p) {
      const x = pad + ((p[0] - minLng) / dLng) * (W - 2 * pad);
      const y = pad + (1 - (p[1] - minLat) / dLat) * (H - 2 * pad);
      return [x, y];
    }
    function colourFor(s) {
      if (mode === 'before') {
        // amber→red ramp by congestion ratio
        const r = Math.min(1, s.baseRatio);
        return ratioToColour(r);
      } else {
        // diff: green = improvement, red = worse
        const d = s.delta;
        if (d < -0.05) return '#22c55e';
        if (d >  0.05) return '#ef4444';
        return '#94a3b8';
      }
    }
    function ratioToColour(r) {
      if (r < 0.15) return '#1e3a8a';
      if (r < 0.4)  return '#fde68a';
      if (r < 0.7)  return '#fb923c';
      return '#dc2626';
    }
    // Draw segments
    segmentDeltas.forEach(s => {
      const [x1, y1] = project(s.a);
      const [x2, y2] = project(s.b);
      const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('x1', x1.toFixed(1));
      ln.setAttribute('y1', y1.toFixed(1));
      ln.setAttribute('x2', x2.toFixed(1));
      ln.setAttribute('y2', y2.toFixed(1));
      ln.setAttribute('stroke', colourFor(s));
      ln.setAttribute('stroke-width', s.source === 'candidate' ? 0 : 1.6);
      ln.setAttribute('stroke-linecap', 'round');
      ln.setAttribute('opacity', mode === 'after' ? '0.85' : '0.7');
      svgEl.appendChild(ln);
    });
    // Draw candidate road (only on after) as a bright cyan dashed line
    if (mode === 'after' && candItem && candItem.start && candItem.end) {
      const [x1, y1] = project(candItem.start);
      const [x2, y2] = project(candItem.end);
      const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('x1', x1.toFixed(1));
      ln.setAttribute('y1', y1.toFixed(1));
      ln.setAttribute('x2', x2.toFixed(1));
      ln.setAttribute('y2', y2.toFixed(1));
      ln.setAttribute('stroke', '#22d3ee');
      ln.setAttribute('stroke-width', 3.2);
      ln.setAttribute('stroke-linecap', 'round');
      ln.setAttribute('stroke-dasharray', '6 3');
      svgEl.appendChild(ln);
      [candItem.start, candItem.end].forEach(p => {
        const [cx, cy] = project(p);
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', cx.toFixed(1));
        c.setAttribute('cy', cy.toFixed(1));
        c.setAttribute('r', 3.2);
        c.setAttribute('fill', '#22d3ee');
        c.setAttribute('stroke', '#0e7490');
        c.setAttribute('stroke-width', 1);
        svgEl.appendChild(c);
      });
    }
  }

  function attachRoadCompare() {
    if (els.roadCompareBtn) {
      els.roadCompareBtn.addEventListener('click', runRoadComparison);
    }
    if (els.planRoadCancel) {
      els.planRoadCancel.addEventListener('click', clearRoadPlanner);
    }
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
      baselineYear: BASE_YEAR,
      forecastYears: SIM_YEARS,
      baseline: METRICS.reduce((acc, m) => { acc[m.id] = m.baseline; return acc; }, {}),
      scenarioResult: branch.scenarioResult || null
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
      // Lazy-add the 3D extrusion layer the first time the user actually
      // needs it. Saves a chunky GPU upload on initial map load.
      if (v === '3D' && state.mapLoaded && !state.map.getLayer('items-buildings-3d')) {
        try { addAdded3DBuildings(); renderItemsOnMap(); } catch (_) {}
      }
      if (state.map.getLayer('items-buildings-3d')) {
        state.map.setLayoutProperty('items-buildings-3d', 'visibility', v === '3D' ? 'visible' : 'none');
      }
      if (isHistoricalMode()) renderHistoricalMapLayers();
    }
    updateScenarioDiffButton();
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
        if (m === 'historical') {
          // Jump to a representative historical year — the timeline year drives mode.
          if (state.year >= BASE_YEAR) setYear(BASE_YEAR);
          syncTopNavForMode();
        } else if (m === 'simulation') {
          if (state.year < START_YEAR) setYear(START_YEAR);
          syncTopNavForMode();
        } else if (m === 'compare') {
          openCompareModal();
        } else if (m === 'library') {
          toast('Data Library - connected to local /api/manifest', 'warn');
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
      : 'Showing ' + state.year + (state.year === BASE_YEAR ? ' forecast baseline' : ' historical replay');
    els.mapSubtitle.innerHTML = text + ' <span class="info-i" title="Add a building at a valid Belfast map point, then run a forecast year between 2026 and 2036.">i</span>';
  }

  // ---------- AFTER CHANGE PIPELINE ----------

  function afterChange() {
    renderBranches();
    renderImpact();
    renderItemsOnMap();
    if (state.mode === 'simulation') {
      updateImpactRipples();
      updateImpactLensUI();
    }
    renderLeftSidebar();
    updateScenarioDiffButton();
    saveState();
  }

  // ---------- POSTCODE SEARCH (local postcode resolver) ----------

  let searchMarker = null;
  let searchDebounce = null;

  async function resolvePostcode(query) {
    const q = query.trim();
    if (!q) return null;
    try {
      const res = await fetch('/api/postcode/resolve?postcode=' + encodeURIComponent(q));
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  function showSearchStatus(msg, kind) {
    if (!els.mapSearchStatus) return;
    if (!msg) { els.mapSearchStatus.hidden = true; return; }
    els.mapSearchStatus.textContent = msg;
    els.mapSearchStatus.className = 'map-search-status' + (kind === 'error' ? ' error' : '');
    els.mapSearchStatus.hidden = false;
  }

  function showSearchSuggestions(results) {
    if (!els.mapSearchSuggest) return;
    const features = Array.isArray(results) ? results : (results ? [results] : []);
    if (!features.length) { els.mapSearchSuggest.hidden = true; els.mapSearchSuggest.innerHTML = ''; return; }
    els.mapSearchSuggest.innerHTML = features.map((f, i) => {
      const status = f.canPlace ? 'Ready to place' : (f.precision === 'outcode' ? 'Zoom only - enter full postcode' : 'Not placeable');
      return '<li data-i="' + i + '"><strong>' + escapeHtml(f.postcode || f.normalizedPostcode || f.input || '') + '</strong>' +
        '<small>' + escapeHtml((f.label || 'Belfast') + ' · ' + status) + '</small></li>';
    }).join('');
    els.mapSearchSuggest.hidden = false;
    els.mapSearchSuggest.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => {
        const idx = parseInt(li.getAttribute('data-i'), 10);
        flyToResolvedPostcode(features[idx]);
        els.mapSearchSuggest.hidden = true;
      });
    });
  }

  function flyToResolvedPostcode(feat) {
    if (!feat || !state.map || !feat.location) return;
    const c = [feat.location.lng, feat.location.lat];
    state.map.flyTo({ center: c, zoom: feat.precision === 'outcode' ? 13.7 : 16.2, pitch: 62, bearing: -24, duration: 900 });
    if (searchMarker) { try { searchMarker.remove(); } catch (_) {} }
    if (els.mapSearchSuggest) {
      els.mapSearchSuggest.hidden = true;
      els.mapSearchSuggest.innerHTML = '';
    }
    const el = document.createElement('div');
    el.style.cssText = 'width:22px;height:22px;border-radius:50%;background:' + (feat.canPlace ? '#22c55e' : '#f59e0b') + ';box-shadow:0 0 0 7px rgba(96,165,250,0.25),0 0 22px rgba(96,165,250,0.7);border:2px solid #0a1426;';
    searchMarker = new mapboxgl.Marker({ element: el })
      .setLngLat(c)
      .setPopup(new mapboxgl.Popup({ offset: 14 }).setHTML('<strong>' + escapeHtml(feat.postcode || feat.normalizedPostcode || '') + '</strong><br><small>' + escapeHtml(feat.canPlace ? 'Buildability gate passed' : ((feat.warnings || [])[0] || 'Full postcode required')) + '</small>'))
      .addTo(state.map);
    searchMarker.togglePopup();
    if (feat.canPlace) {
      state.selectedPostcode = feat;
      showSearchStatus((feat.postcode || feat.normalizedPostcode) + ' selected · Add Building enabled');
      if (state.year < START_YEAR) setYear(START_YEAR);
      setView('3D');
    } else {
      state.selectedPostcode = null;
      showSearchStatus(((feat.warnings || [])[0] || 'Full Belfast postcode required'), 'error');
    }
    renderModify();
    saveState();
    // Arm the road planner with junction nodes around the searched location.
    armRoadPlanner(c);
  }

  function attachPostcodeSearch() {
    if (!els.postcodeForm || !els.postcodeInput) return;
    els.postcodeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = els.postcodeInput.value;
      if (!q.trim()) return;
      showSearchStatus('Resolving postcode...');
      const resolved = await resolvePostcode(q);
      if (!resolved) { showSearchStatus('Search failed', 'error'); return; }
      flyToResolvedPostcode(resolved);
    });
    els.postcodeInput.addEventListener('input', () => {
      const q = els.postcodeInput.value.trim();
      if (searchDebounce) clearTimeout(searchDebounce);
      if (q.length < 2) { showSearchSuggestions([]); return; }
      searchDebounce = setTimeout(async () => {
        const resolved = await resolvePostcode(q);
        if (resolved && resolved.precision !== 'invalid') showSearchSuggestions([resolved]);
        else showSearchSuggestions([]);
      }, 250);
    });
    els.postcodeInput.addEventListener('blur', () => {
      // Delay hide so click on suggestion fires first
      setTimeout(() => { if (els.mapSearchSuggest) els.mapSearchSuggest.hidden = true; }, 180);
    });
    els.postcodeInput.addEventListener('focus', () => {
      if (els.mapSearchSuggest && els.mapSearchSuggest.children.length) els.mapSearchSuggest.hidden = false;
    });
  }

  function applyBottomCollapse() {
    const app = document.querySelector('.app');
    if (!app) return;
    app.classList.toggle('bottom-collapsed', !!state.bottomCollapsed);
    if (els.collapseBtn) els.collapseBtn.title = state.bottomCollapsed ? 'Expand bottom panels' : 'Collapse panels for more map space';
    // Resize map after a beat so Mapbox repaints to new container size
    setTimeout(() => { if (state.map) try { state.map.resize(); } catch (_) {} }, 220);
  }
  function toggleBottomCollapse() {
    state.bottomCollapsed = !state.bottomCollapsed;
    applyBottomCollapse();
    saveState();
  }

  // ================================================================
  // HISTORICAL MODE
  // ================================================================

  function isHistoricalMode() { return state.mode === 'historical'; }

  function setMode(mode) {
    state.mode = mode;
    if (mode === 'historical') {
      if (state.year > BASE_YEAR) state.year = BASE_YEAR;
      state.activeTool = null;
      state.pendingRoadStart = null;
    } else {
      state.activeEventId = null;
    }
    renderYearLists();
    renderTimelineBar();
    renderMapSubtitle();
    renderLensTabs();
    renderModify();
    renderBranches();
    renderImpact();
    renderActiveInfo();
    renderCompareSection();
    renderLeftSidebar();
    if (state.mapLoaded) {
      renderHistoricalMapLayers();
      renderItemsOnMap();
      if (mode === 'simulation') { updateImpactRipples(); updateImpactLensUI(); }
      else {
        if (els.impactLens) els.impactLens.hidden = true;
        if (els.similarEvents) els.similarEvents.hidden = true;
        // Clear ripple sources
        if (state.map.getSource('impact-ripples')) state.map.getSource('impact-ripples').setData({ type: 'FeatureCollection', features: [] });
        if (state.map.getSource('impact-epicentres')) state.map.getSource('impact-epicentres').setData({ type: 'FeatureCollection', features: [] });
      }
    }
    updateScenarioDiffButton();
    syncTopNavForMode();
  }

  function setLens(lensId) {
    if (!LENSES.find(l => l.id === lensId)) return;
    state.lens = lensId;
    state.activeEventId = null;
    // Sim/future view also keys off the lens — flipping to "Jobs" should
    // recolour the forecast ripples to the jobs prediction, not just paint
    // the historical lens. Both halves of the studio now share the same
    // active metric.
    state.impactMetric = lensId;
    renderLensTabs();
    renderModify();
    renderBranches();
    renderImpact();
    renderCompareSection();
    if (state.mapLoaded) {
      if (isHistoricalMode()) renderHistoricalMapLayers();
      else { updateImpactRipples(); updateImpactLensUI(); }
    }
    saveState();
  }

  function renderLensTabs() {
    if (!els.lensTabs) return;
    // Lens tabs live in BOTH historical and simulation modes — the model
    // forecasts change in all five lenses (traffic, jobs, electricity,
    // buildings, services), so users should be able to flip between them
    // on the future map just like they can on the historical map.
    els.lensTabs.hidden = false;
    els.lensTabs.innerHTML = LENSES.map(l => {
      const active = l.id === state.lens ? ' active' : '';
      return '<button class="lens-tab' + active + '" data-lens="' + l.id + '" type="button" style="--lens-color:' + l.color + '">' +
        '<span class="lens-dot"></span>' + l.label +
        '</button>';
    }).join('');
    els.lensTabs.querySelectorAll('.lens-tab').forEach(b => {
      b.addEventListener('click', () => setLens(b.getAttribute('data-lens')));
    });
  }

  async function loadGridYear(year) {
    if (year < 2016 || year > 2026) return null; // grids only exist for historical years
    if (state.gridCache[year]) return state.gridCache[year];
    try {
      const res = await fetch('/data/mode-a/grid_' + year + '.geojson');
      if (!res.ok) return null;
      const json = await res.json();
      state.gridCache[year] = json;
      return json;
    } catch (e) {
      return null;
    }
  }

  async function loadContextLayer(layerId) {
    if (state.contextLayersData[layerId]) return state.contextLayersData[layerId];
    try {
      const res = await fetch('/api/layers/2026/' + layerId);
      if (!res.ok) throw new Error('layer ' + layerId + ' ' + res.status);
      const json = await res.json();
      state.contextLayersData[layerId] = json;
      return json;
    } catch (e) {
      console.warn('context layer failed', layerId, e);
      return null;
    }
  }

  function ensureHistoricalSourcesAndLayers() {
    if (state.contextLayersAdded) return;
    state.contextLayersAdded = true;
    const empty = { type: 'FeatureCollection', features: [] };

    if (!state.map.getSource('hist-cells')) state.map.addSource('hist-cells', { type: 'geojson', data: empty });
    if (!state.map.getSource('hist-events')) state.map.addSource('hist-events', { type: 'geojson', data: empty });
    if (!state.map.getSource('hist-highlight')) state.map.addSource('hist-highlight', { type: 'geojson', data: empty });
    if (!state.map.getSource('grid-substations')) state.map.addSource('grid-substations', { type: 'geojson', data: empty });
    if (!state.map.getSource('cells-points')) state.map.addSource('cells-points', { type: 'geojson', data: empty });
    ['ctx-buildings', 'ctx-roads', 'ctx-power', 'ctx-water', 'ctx-services', 'ctx-transport'].forEach(id => {
      if (!state.map.getSource(id)) state.map.addSource(id, { type: 'geojson', data: empty });
    });

    const refLayerId = findFirstSymbolLayer();

    state.map.addLayer({
      id: 'ctx-water-fill', type: 'fill', source: 'ctx-water',
      paint: { 'fill-color': '#0e2238', 'fill-opacity': 0.6 },
      layout: { visibility: 'none' }
    }, refLayerId);

    state.map.addLayer({
      id: 'ctx-roads-line', type: 'line', source: 'ctx-roads',
      paint: {
        'line-color': '#fb923c',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 13, 1.4, 16, 3],
        'line-opacity': 0.7
      },
      layout: { visibility: 'none' }
    }, refLayerId);
    state.map.addLayer({
      id: 'ctx-roads-glow', type: 'line', source: 'ctx-roads',
      paint: {
        'line-color': '#fb923c',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 13, 4, 16, 9],
        'line-opacity': 0.18,
        'line-blur': 1.5
      },
      layout: { visibility: 'none' }
    }, 'ctx-roads-line');

    state.map.addLayer({
      id: 'ctx-power-line', type: 'line', source: 'ctx-power',
      paint: { 'line-color': '#06b6d4', 'line-width': 1.4, 'line-opacity': 0.7 },
      layout: { visibility: 'none' }
    }, refLayerId);

    // Buildings — per-year filter using replay_first_visible_year. Newly-appeared
    // buildings of the active year render in a brighter highlight color so the user
    // can see year-over-year growth.
    const buildingFilter = ['<=', ['coalesce', ['to-number', ['get', 'replay_first_visible_year']], 2016], state.year];
    const buildingColor = [
      'case',
      ['==', ['coalesce', ['to-number', ['get', 'replay_first_visible_year']], 2016], state.year],
      '#facc15',  // yellow - newly visible this year
      '#3b82f6'   // blue - older
    ];
    state.map.addLayer({
      id: 'ctx-buildings-fill', type: 'fill', source: 'ctx-buildings',
      paint: {
        'fill-color': buildingColor,
        'fill-opacity': 0.65,
        'fill-outline-color': '#60a5fa'
      },
      filter: buildingFilter,
      layout: { visibility: 'none' }
    }, refLayerId);
    state.map.addLayer({
      id: 'ctx-buildings-3d', type: 'fill-extrusion', source: 'ctx-buildings',
      paint: {
        'fill-extrusion-color': buildingColor,
        'fill-extrusion-height': ['coalesce', ['to-number', ['get', 'replay_height_m']], ['to-number', ['get', 'height']], ['*', ['coalesce', ['to-number', ['get', 'building:levels']], 4], 3], 12],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.78
      },
      filter: buildingFilter,
      layout: { visibility: 'none' }
    });

    // Services + transport context layers (jobs/services lenses)
    state.map.addLayer({
      id: 'ctx-services-circle', type: 'circle', source: 'ctx-services',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 13, 5, 16, 9],
        'circle-color': '#22c55e',
        'circle-opacity': 0.85,
        'circle-stroke-color': '#0a1426',
        'circle-stroke-width': 1
      },
      layout: { visibility: 'none' }
    });
    state.map.addLayer({
      id: 'ctx-transport-circle', type: 'circle', source: 'ctx-transport',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 13, 4.5, 16, 8],
        'circle-color': '#a855f7',
        'circle-opacity': 0.85,
        'circle-stroke-color': '#0a1426',
        'circle-stroke-width': 1
      },
      layout: { visibility: 'none' }
    });

    state.map.addLayer({
      id: 'hist-cells-fill', type: 'fill', source: 'hist-cells',
      paint: {
        'fill-color': ['coalesce', ['get', '__color'], '#1a2942'],
        'fill-opacity': ['coalesce', ['get', '__opacity'], 0.0]
      },
      layout: { visibility: 'none' }
    }, refLayerId);

    state.map.addLayer({
      id: 'hist-cells-line', type: 'line', source: 'hist-cells',
      paint: { 'line-color': 'rgba(96,165,250,0.18)', 'line-width': 0.4 },
      layout: { visibility: 'none' }
    }, refLayerId);

    // Continuous Mapbox heatmap fed by REAL geocoded points (events + POIs).
    // Tight radius keeps natural clustering visible — each event burns its own
    // small hotspot so dense corridors light up red while sparse areas stay green.
    state.map.addLayer({
      id: 'lens-heatmap', type: 'heatmap', source: 'cells-points',
      paint: {
        'heatmap-weight': ['get', 'w'],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 12, 1.0, 14, 1.4, 16, 2.2],
        'heatmap-radius':    ['interpolate', ['linear'], ['zoom'], 9, 16, 12, 32, 14, 60, 16, 110],
        'heatmap-opacity': 0.82,
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0,    'rgba(0,0,0,0)',
          0.05, 'rgba(34,197,94,0.55)',
          0.25, 'rgba(132,204,22,0.78)',
          0.5,  'rgba(245,158,11,0.86)',
          0.75, 'rgba(251,146,60,0.92)',
          1,    'rgba(239,68,68,0.96)'
        ]
      },
      layout: { visibility: 'none' }
    }, refLayerId);

    state.map.addLayer({
      id: 'hist-highlight-fill', type: 'fill', source: 'hist-highlight',
      paint: {
        'fill-color': ['coalesce', ['get', '__color'], '#60a5fa'],
        'fill-opacity': 0.45
      },
      layout: { visibility: 'none' }
    }, refLayerId);
    state.map.addLayer({
      id: 'hist-highlight-line', type: 'line', source: 'hist-highlight',
      paint: { 'line-color': '#60a5fa', 'line-width': 1.8, 'line-opacity': 0.95 },
      layout: { visibility: 'none' }
    }, refLayerId);

    // GRID-style electricity heatmap (overlapping translucent ellipses, GRID-main inspired).
    // Three layered circles per substation create a continuous heat bleed across the city.
    // Color uses an interpolation green→amber→red based on grid_load_pct.
    const loadColor = [
      'interpolate', ['linear'],
      ['coalesce', ['to-number', ['get', 'grid_load_pct']], 50],
      0, '#22c55e',
      50, '#22c55e',
      65, '#eab308',
      80, '#fb923c',
      90, '#ef4444',
      100, '#b91c1c'
    ];
    state.map.addLayer({
      id: 'grid-substations-bleed', type: 'circle', source: 'grid-substations',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 30, 13, 70, 16, 140],
        'circle-color': loadColor,
        'circle-opacity': 0.10,
        'circle-blur': 1.0
      },
      layout: { visibility: 'none' }
    });
    state.map.addLayer({
      id: 'grid-substations-mid', type: 'circle', source: 'grid-substations',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 14, 13, 32, 16, 70],
        'circle-color': loadColor,
        'circle-opacity': 0.20,
        'circle-blur': 0.6
      },
      layout: { visibility: 'none' }
    });
    state.map.addLayer({
      id: 'grid-substations-core', type: 'circle', source: 'grid-substations',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 13, 8, 16, 16],
        'circle-color': loadColor,
        'circle-opacity': 0.95,
        'circle-stroke-color': '#0a1426',
        'circle-stroke-width': 1
      },
      layout: { visibility: 'none' }
    });
    state.map.on('mouseenter', 'grid-substations-core', (e) => {
      state.map.getCanvas().style.cursor = 'pointer';
    });
    state.map.on('mouseleave', 'grid-substations-core', () => { state.map.getCanvas().style.cursor = ''; });
    state.map.on('click', 'grid-substations-core', (e) => {
      if (!e.features || !e.features.length) return;
      const p = e.features[0].properties || {};
      new mapboxgl.Popup({ offset: 8 })
        .setLngLat(e.lngLat)
        .setHTML('<strong>' + escapeHtml(p.power || 'asset') + '</strong>' +
          '<br>Load: <strong>' + (p.grid_load_pct || '?') + '%</strong>' +
          '<br>Headroom: ' + (p.headroom_pct || '?') + '%' +
          '<br>Status: ' + escapeHtml(p.status || ''))
        .addTo(state.map);
    });

    state.map.addLayer({
      id: 'hist-events-glow', type: 'circle', source: 'hist-events',
      paint: { 'circle-radius': 18, 'circle-color': ['get', 'color'], 'circle-opacity': 0.18, 'circle-blur': 1.1 },
      layout: { visibility: 'none' }
    });
    state.map.addLayer({
      id: 'hist-events-circle', type: 'circle', source: 'hist-events',
      paint: { 'circle-radius': 8, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#0a1426', 'circle-stroke-width': 2, 'circle-opacity': 0.95 },
      layout: { visibility: 'none' }
    });

    state.map.on('click', 'hist-events-circle', (e) => {
      if (!e.features || !e.features.length) return;
      const id = e.features[0].properties && e.features[0].properties.id;
      if (id) selectEvent(id);
    });
    state.map.on('mouseenter', 'hist-events-circle', () => { state.map.getCanvas().style.cursor = 'pointer'; });
    state.map.on('mouseleave', 'hist-events-circle', () => { state.map.getCanvas().style.cursor = ''; });
  }

  function findFirstSymbolLayer() {
    const layers = state.map.getStyle().layers || [];
    for (const l of layers) if (l.type === 'symbol') return l.id;
    return undefined;
  }

  function setHistoricalLayerVisibility(visible) {
    const v = visible ? 'visible' : 'none';
    // Highlight + water always toggle with mode. Event markers stay HIDDEN on the map
    // (events live in the side panel; clicking one zooms + highlights its area).
    // Discrete cell layer is also kept hidden — replaced by continuous heatmap or context layer per lens.
    [
      'hist-highlight-fill', 'hist-highlight-line',
      'ctx-water-fill'
    ].forEach(id => {
      if (state.map.getLayer(id)) state.map.setLayoutProperty(id, 'visibility', v);
    });
    // Per-lens layers default to none; showContextForLens flips them on selectively.
    [
      'hist-cells-fill', 'hist-cells-line',
      'hist-events-glow', 'hist-events-circle',
      'lens-heatmap',
      'ctx-roads-line', 'ctx-roads-glow', 'ctx-power-line',
      'ctx-buildings-3d', 'ctx-buildings-fill',
      'ctx-services-circle', 'ctx-transport-circle',
      'grid-substations-bleed', 'grid-substations-mid', 'grid-substations-core'
    ].forEach(id => {
      if (state.map.getLayer(id)) state.map.setLayoutProperty(id, 'visibility', 'none');
    });
  }

  // Cache for per-year electricity asset data
  const electricityCache = {};
  async function loadElectricityYear(year) {
    if (year < 2016 || year > 2026) return null;
    if (electricityCache[year]) return electricityCache[year];
    try {
      const res = await fetch('/data/mode-a/electricity_' + year + '.geojson');
      if (!res.ok) return null;
      const json = await res.json();
      // Filter to only point features (substations, towers, poles) with load data — drop lines for the ellipse heatmap.
      const features = (json.features || []).filter(f => f.geometry && f.geometry.type === 'Point' && f.properties && Number.isFinite(Number(f.properties.grid_load_pct)));
      const trimmed = { type: 'FeatureCollection', features: features };
      electricityCache[year] = trimmed;
      return trimmed;
    } catch (e) {
      return null;
    }
  }

  async function renderHistoricalMapLayers() {
    if (!state.mapLoaded) return;
    if (!isHistoricalMode()) {
      if (state.contextLayersAdded) setHistoricalLayerVisibility(false);
      return;
    }
    ensureHistoricalSourcesAndLayers();
    setHistoricalLayerVisibility(true);
    const lens = lensDef(state.lens);
    showContextForLens(lens);
    await refreshHistoricalCells();
    refreshHistoricalEvents();
    refreshHighlightedCells();
  }

  function showContextForLens(lens) {
    const map = state.map;
    const id = lens.id;
    const isBuildings = id === 'buildings';
    const isTraffic = id === 'traffic';
    const isElec = id === 'electricity';
    const isJobs = id === 'jobs';
    const isServices = id === 'services';
    // The three "metric heatmap" lenses use the smooth Mapbox heatmap.
    const useHeatmap = isTraffic || isJobs || isServices;

    // Water always on as soft base.
    map.setLayoutProperty('ctx-water-fill', 'visibility', 'visible');

    // Buildings: filtered by year, 2D fill or 3D extrusion. Highlight new this year in yellow.
    if (map.getLayer('ctx-buildings-fill')) {
      map.setFilter('ctx-buildings-fill', ['<=', ['coalesce', ['to-number', ['get', 'replay_first_visible_year']], 2016], state.year]);
      map.setPaintProperty('ctx-buildings-fill', 'fill-color', [
        'case',
        ['==', ['coalesce', ['to-number', ['get', 'replay_first_visible_year']], 2016], state.year],
        '#facc15', '#3b82f6'
      ]);
    }
    if (map.getLayer('ctx-buildings-3d')) {
      map.setFilter('ctx-buildings-3d', ['<=', ['coalesce', ['to-number', ['get', 'replay_first_visible_year']], 2016], state.year]);
      map.setPaintProperty('ctx-buildings-3d', 'fill-extrusion-color', [
        'case',
        ['==', ['coalesce', ['to-number', ['get', 'replay_first_visible_year']], 2016], state.year],
        '#facc15', '#3b82f6'
      ]);
    }
    map.setLayoutProperty('ctx-buildings-fill', 'visibility', isBuildings && state.view === '2D' ? 'visible' : 'none');
    map.setLayoutProperty('ctx-buildings-3d',   'visibility', isBuildings && state.view === '3D' ? 'visible' : 'none');

    // Traffic: real road network underneath the heatmap
    map.setLayoutProperty('ctx-roads-line', 'visibility', isTraffic ? 'visible' : 'none');
    map.setLayoutProperty('ctx-roads-glow', 'visibility', isTraffic ? 'visible' : 'none');

    // Electricity: GRID-style substation hotspot heatmap + power lines
    map.setLayoutProperty('ctx-power-line', 'visibility', isElec ? 'visible' : 'none');
    ['grid-substations-bleed', 'grid-substations-mid', 'grid-substations-core'].forEach(L => {
      if (map.getLayer(L)) map.setLayoutProperty(L, 'visibility', isElec ? 'visible' : 'none');
    });

    // Jobs/Services: services anchors as point context underneath the heatmap
    map.setLayoutProperty('ctx-services-circle', 'visibility', (isJobs || isServices) ? 'visible' : 'none');
    map.setLayoutProperty('ctx-transport-circle', 'visibility', isJobs ? 'visible' : 'none');

    // Smooth heatmap for traffic/jobs/services; off otherwise.
    map.setLayoutProperty('lens-heatmap', 'visibility', useHeatmap ? 'visible' : 'none');
    if (useHeatmap) {
      // Color ramp per lens. The first stop has alpha so areas outside the
      // cell coverage (water, off-extent) stay transparent; everywhere inside
      // the city renders a graded green→red (traffic) or low→high (jobs/services).
      const ramps = {
        traffic:  ['interpolate', ['linear'], ['heatmap-density'],
          0,   'rgba(0,0,0,0)',
          0.04,'rgba(34,197,94,0.60)',
          0.25,'rgba(132,204,22,0.78)',
          0.5, 'rgba(245,158,11,0.88)',
          0.75,'rgba(251,146,60,0.92)',
          1,   'rgba(239,68,68,0.96)'],
        jobs:     ['interpolate', ['linear'], ['heatmap-density'],
          0,   'rgba(0,0,0,0)',
          0.04,'rgba(67,56,202,0.55)',
          0.25,'rgba(124,58,237,0.75)',
          0.5, 'rgba(168,85,247,0.88)',
          0.75,'rgba(217,70,239,0.93)',
          1,   'rgba(250,204,21,0.97)'],
        services: ['interpolate', ['linear'], ['heatmap-density'],
          0,   'rgba(0,0,0,0)',
          0.04,'rgba(15,118,110,0.55)',
          0.25,'rgba(34,197,94,0.78)',
          0.5, 'rgba(132,204,22,0.88)',
          0.75,'rgba(190,242,100,0.92)',
          1,   'rgba(250,204,21,0.97)']
      };
      map.setPaintProperty('lens-heatmap', 'heatmap-color', ramps[id]);
      refreshCellsHeatmapPoints(lens);
    }

    if (isElec) {
      loadElectricityYear(state.year).then(data => {
        if (data && map.getSource('grid-substations')) map.getSource('grid-substations').setData(data);
      });
    }

    // Lazy-fetch the relevant 2026 context layer geojsons.
    const wantsByLayer = {
      'belfast-ni-buildings-3d':       isBuildings,
      'source-ni-roads-osm':           isTraffic,
      'source-ni-power-grid-osm':      isElec,
      'source-ni-water-osm':           true,
      'source-ni-services-osm':        isJobs || isServices,
      'source-ni-transport-stops-osm': isJobs
    };
    Object.keys(wantsByLayer).forEach(layerId => {
      if (!wantsByLayer[layerId]) return;
      loadContextLayer(layerId).then(data => {
        if (!data) return;
        let srcId = null;
        if (layerId === 'belfast-ni-buildings-3d') srcId = 'ctx-buildings';
        else if (layerId === 'source-ni-roads-osm') srcId = 'ctx-roads';
        else if (layerId === 'source-ni-power-grid-osm') srcId = 'ctx-power';
        else if (layerId === 'source-ni-water-osm') srcId = 'ctx-water';
        else if (layerId === 'source-ni-services-osm') srcId = 'ctx-services';
        else if (layerId === 'source-ni-transport-stops-osm') srcId = 'ctx-transport';
        if (srcId && state.map.getSource(srcId)) state.map.getSource(srcId).setData(data);
      });
    });
  }

  // Build a point cloud for the smooth heatmap — driven by REAL data, not cell
  // centroids, so the result has organic spatial variation (multiple discrete
  // hotspots) instead of a single huge gradient blob.
  //
  //   traffic  → all geocoded traffic events for the year
  //   jobs     → job events + transport stops + services POIs (proxy for job access)
  //   services → service events + service POIs
  async function refreshCellsHeatmapPoints(lens) {
    if (!state.map || !state.map.getSource('cells-points')) return;
    const features = [];
    const id = lens.id;

    // 1) Real events (have coordinates per event)
    const evData = await loadEventsForYearLens(state.year, id);
    const events = evData && evData.events ? evData.events : [];
    events.forEach(ev => {
      if (Array.isArray(ev.coordinates) && ev.coordinates.length === 2) {
        features.push({ type: 'Feature', properties: { w: 1 }, geometry: { type: 'Point', coordinates: ev.coordinates } });
      }
    });

    // 2) For services + jobs lenses, also fold in real POIs as low-weight context points
    if (id === 'services' || id === 'jobs') {
      const services = await loadContextLayer('source-ni-services-osm');
      if (services && services.features) {
        services.features.forEach(f => {
          const c = pointOrCentroid(f.geometry);
          if (c) features.push({ type: 'Feature', properties: { w: 0.55 }, geometry: { type: 'Point', coordinates: c } });
        });
      }
    }
    if (id === 'jobs') {
      const transport = await loadContextLayer('source-ni-transport-stops-osm');
      if (transport && transport.features) {
        transport.features.forEach(f => {
          const c = pointOrCentroid(f.geometry);
          if (c) features.push({ type: 'Feature', properties: { w: 0.7 }, geometry: { type: 'Point', coordinates: c } });
        });
      }
    }

    state.map.getSource('cells-points').setData({ type: 'FeatureCollection', features: features });
  }

  function pointOrCentroid(geom) {
    if (!geom) return null;
    if (geom.type === 'Point') return geom.coordinates;
    if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') return polygonCentroid(geom);
    return null;
  }

  function polygonRing(geom) {
    if (!geom) return null;
    if (geom.type === 'Polygon') return geom.coordinates[0];
    if (geom.type === 'MultiPolygon') return geom.coordinates[0][0];
    return null;
  }

  async function refreshHistoricalCells() {
    const grid = await loadGridYear(state.year);
    if (!grid || !state.map.getSource('hist-cells')) return;
    const lens = lensDef(state.lens);
    const features = grid.features.map(f => {
      const props = f.properties || {};
      const value = Number(props[lens.valueProp]) || 0;
      // For value-based goodness: high is "good" if goodDirection==='up', else "bad"
      // We render red→amber→green so the user instantly sees stress vs healthy.
      const goodness = lens.goodDirection === 'up' ? value : (1 - value);
      const color = ramp_RedGreen(goodness);
      const opacity = clamp(0.18 + value * 0.55, 0.18, 0.78);
      return Object.assign({}, f, {
        properties: Object.assign({}, props, { __color: color, __opacity: opacity, __value: value })
      });
    });
    state.map.getSource('hist-cells').setData({ type: 'FeatureCollection', features: features });
  }

  // Red→amber→green heatmap (RAG): goodness ∈ [0,1]; 0 = bad (red), 0.5 = mid (amber), 1 = good (green).
  function ramp_RedGreen(goodness) {
    const t = clamp(goodness, 0, 1);
    // Three stops: red #ef4444, amber #f59e0b, green #22c55e
    const stops = [[239,68,68], [245,158,11], [34,197,94]];
    if (t <= 0.5) {
      const u = t / 0.5;
      const a = stops[0], b = stops[1];
      return 'rgb(' + Math.round(lerp(a[0],b[0],u)) + ',' + Math.round(lerp(a[1],b[1],u)) + ',' + Math.round(lerp(a[2],b[2],u)) + ')';
    }
    const u = (t - 0.5) / 0.5;
    const a = stops[1], b = stops[2];
    return 'rgb(' + Math.round(lerp(a[0],b[0],u)) + ',' + Math.round(lerp(a[1],b[1],u)) + ',' + Math.round(lerp(a[2],b[2],u)) + ')';
  }

  function colorRamp(baseHex, value) {
    const dark = [10, 20, 38];
    const target = hexToRgb(baseHex);
    const t = clamp(value, 0, 1);
    const r = Math.round(lerp(dark[0], target[0], t));
    const g = Math.round(lerp(dark[1], target[1], t));
    const b = Math.round(lerp(dark[2], target[2], t));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
  }

  // Real-events fetch + cache. The catalog has 29K events; we lazy-load by (year, signal).
  const eventCache = {}; // key = year+'|'+signal -> { total, events }
  function eventsCacheKey(year, signal) { return year + '|' + signal; }

  async function loadEventsForYearLens(year, signal) {
    const k = eventsCacheKey(year, signal);
    if (eventCache[k]) return eventCache[k];
    try {
      const res = await fetch('/api/events?year=' + year + '&signal=' + signal + '&limit=5000');
      if (!res.ok) throw new Error('events ' + res.status);
      const json = await res.json();
      const data = { total: json.total || 0, events: Array.isArray(json.events) ? json.events : [] };
      eventCache[k] = data;
      return data;
    } catch (e) {
      console.warn('events fetch failed', year, signal, e);
      return { total: 0, events: [] };
    }
  }

  async function refreshHistoricalEvents() {
    const data = await loadEventsForYearLens(state.year, state.lens);
    state.eventsForYearCache = data.events;
    state.eventsTotalForYear = data.total;
    // Re-render the events list with the now-loaded count + items
    if (isHistoricalMode()) renderHistoricalBranchesPanel();
    if (!state.map || !state.map.getSource('hist-events')) return;
    const lens = lensDef(state.lens);
    const features = data.events.map(ev => {
      const c = realEventCoords(ev);
      if (!c) return null;
      return {
        type: 'Feature',
        properties: { id: ev.id, color: lens.color, signal: ev.signal },
        geometry: { type: 'Point', coordinates: c }
      };
    }).filter(Boolean);
    state.map.getSource('hist-events').setData({ type: 'FeatureCollection', features: features });
  }

  function eventsForCurrentYearAndLens() {
    return state.eventsForYearCache || [];
  }

  // Real events have direct coordinates; older summary commits used cellIds. Support both.
  function realEventCoords(ev) {
    if (ev && Array.isArray(ev.coordinates) && ev.coordinates.length === 2) return ev.coordinates;
    return eventCentroid(ev);
  }

  // Find the cells closest to an event (cellIds if present, otherwise N nearest by coords).
  function nearestCellsForEvent(ev, features) {
    if (!ev || !features || !features.length) return [];
    if (Array.isArray(ev.cellIds) && ev.cellIds.length) {
      const idSet = new Set(ev.cellIds);
      return features.filter(f => idSet.has(f.properties.cell_id));
    }
    if (Array.isArray(ev.coordinates) && ev.coordinates.length === 2) {
      const c = ev.coordinates;
      const ranked = features.map(f => {
        const fc = polygonCentroid(f.geometry);
        if (!fc) return null;
        const dx = (fc[0] - c[0]) * Math.cos(c[1] * Math.PI / 180);
        const dy = (fc[1] - c[1]);
        return { feature: f, dist: dx * dx + dy * dy };
      }).filter(Boolean).sort((a, b) => a.dist - b.dist).slice(0, 6);
      return ranked.map(r => r.feature);
    }
    return [];
  }

  function eventCentroid(ev) {
    const grid = state.gridCache[state.year];
    if (!grid || !ev.cellIds || !ev.cellIds.length) return null;
    const byId = {};
    grid.features.forEach(f => { byId[f.properties.cell_id] = f; });
    let sx = 0, sy = 0, n = 0;
    ev.cellIds.forEach(id => {
      const f = byId[id];
      if (!f || !f.geometry) return;
      const c = polygonCentroid(f.geometry);
      if (!c) return;
      sx += c[0]; sy += c[1]; n++;
    });
    if (!n) return null;
    return [sx / n, sy / n];
  }

  function polygonCentroid(geom) {
    if (!geom) return null;
    let coords = null;
    if (geom.type === 'Polygon') coords = geom.coordinates[0];
    else if (geom.type === 'MultiPolygon') coords = geom.coordinates[0][0];
    if (!coords || !coords.length) return null;
    let sx = 0, sy = 0;
    coords.forEach(p => { sx += p[0]; sy += p[1]; });
    return [sx / coords.length, sy / coords.length];
  }

  function refreshHighlightedCells() {
    if (!state.map.getSource('hist-highlight')) return;
    const grid = state.gridCache[state.year];
    if (!state.activeEventId || !grid) {
      state.map.getSource('hist-highlight').setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const ev = (state.eventsForYearCache || []).find(e => e.id === state.activeEventId);
    if (!ev) {
      state.map.getSource('hist-highlight').setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const lens = lensDef(state.lens);
    let features = [];
    if (Array.isArray(ev.cellIds) && ev.cellIds.length) {
      const idSet = new Set(ev.cellIds);
      features = grid.features.filter(f => idSet.has(f.properties.cell_id));
    } else if (Array.isArray(ev.coordinates) && ev.coordinates.length === 2) {
      // Find the closest few grid cells to the event location
      const c = ev.coordinates;
      const ranked = grid.features.map(f => {
        const fc = polygonCentroid(f.geometry);
        if (!fc) return null;
        const dx = (fc[0] - c[0]) * Math.cos(c[1] * Math.PI / 180);
        const dy = (fc[1] - c[1]);
        return { feature: f, dist: dx * dx + dy * dy };
      }).filter(Boolean).sort((a, b) => a.dist - b.dist).slice(0, 6);
      features = ranked.map(r => r.feature);
    }
    features = features.map(f => Object.assign({}, f, {
      properties: Object.assign({}, f.properties, { __color: lens.color })
    }));
    state.map.getSource('hist-highlight').setData({ type: 'FeatureCollection', features: features });
  }

  function renderHistoricalModifyPanel() {
    if (!els.modifyList) return;
    // The new layout keeps the same toolbar tools visible in both modes —
    // historical mode used to hijack this strip with lens buttons, but
    // those now live in the right sidebar's tabs. We just dim/disable the
    // editing tools in historical mode so the user knows they can't place.
    if (els.presetSection) els.presetSection.style.display = 'none';
    if (els.modifySub) {
      els.modifySub.innerHTML = 'Historical mode — pick a lens on the right and a year to inspect.';
      els.modifySub.style.color = '';
    }
    if (els.modifyButtons) {
      els.modifyButtons.forEach(btn => {
        const t = btn.getAttribute('data-tool');
        const isSelect = t === 'select';
        btn.classList.toggle('active', isSelect);
        if (!isSelect) {
          btn.setAttribute('disabled', 'disabled');
          btn.style.opacity = '0.5';
        }
      });
    }
    if (els.mapCanvas) els.mapCanvas.classList.remove('placing', 'removing');
    if (els.cursorHint) els.cursorHint.hidden = true;
  }

  function renderHistoricalBranchesPanel() {
    renderBranches();
    return;
    if (!els.branchList) return;
    if (els.newBranchBtn) els.newBranchBtn.style.display = 'none';
    const events = eventsForCurrentYearAndLens();
    const total = state.eventsTotalForYear || events.length;
    const lensLabel = lensDef(state.lens).label.toLowerCase();
    const headerText = total + ' ' + lensLabel + ' events in ' + state.year + (total > events.length ? ' (showing top ' + events.length + ')' : '');
    const branchesPanel = els.branchList.closest('.branches-panel');
    if (branchesPanel) {
      const sub = branchesPanel.querySelector('.panel-sub');
      if (sub) sub.textContent = headerText;
      const h3 = branchesPanel.querySelector('h3');
      if (h3) h3.innerHTML = '3. Events';
    }
    if (!events.length) {
      els.branchList.className = 'events-list';
      els.branchList.innerHTML = '<div class="branch-empty">Loading ' + lensLabel + ' events for ' + state.year + '...</div>';
      return;
    }
    // Show only first ~80 in the list for perf, but mention the full count
    const shown = events.slice(0, 80);
    els.branchList.className = 'events-list';
    els.branchList.innerHTML = shown.map(eventItemHTML).join('');
    els.branchList.querySelectorAll('.event-item').forEach(el => {
      el.addEventListener('click', () => selectEvent(el.getAttribute('data-event-id')));
    });
  }

  function eventItemHTML(ev) {
    const lens = lensDef(state.lens);
    const active = state.activeEventId === ev.id ? ' active' : '';
    const sym = escapeHtml(ev.symbol || (ev.signal === 'buildings' ? 'B' : ev.signal === 'electricity' ? 'E' : ev.signal === 'jobs' ? 'J' : ev.signal === 'services' ? 'S' : 'T'));
    const title = escapeHtml(ev.title || ev.id);
    const meta = '<span class="pill">' + escapeHtml(ev.area || 'Belfast') + '</span>' +
                 (ev.month ? '<span class="pill">' + escapeHtml(ev.month) + '</span>' : '') +
                 (ev.confidence ? '<span class="pill">' + escapeHtml(ev.confidence) + '</span>' : '');
    return '<div class="event-item' + active + '" data-event-id="' + ev.id + '" style="--ev-color:' + lens.color + '">' +
      '<span class="event-symbol" style="background:' + lens.color + '">' + sym + '</span>' +
      '<div class="event-text"><div class="event-title">' + title + '</div>' +
        '<div class="event-meta">' + meta + '</div>' +
      '</div>' +
      '<span class="event-arrow">&rsaquo;</span>' +
      '</div>';
  }

  function renderHistoricalImpact() {
    if (!els.impactStack || !els.impactTitle) return;
    els.impactTitle.textContent = 'Year-over-year change (' + state.year + ')';
    const grid = state.gridCache[state.year];
    if (!grid) {
      els.impactStack.innerHTML = '<div class="branch-empty">Loading ' + state.year + '...</div>';
      return;
    }
    const html = LENSES.map(lens => histImpactCardHTML(lens, grid)).join('');
    els.impactStack.innerHTML = html;
    els.impactStack.querySelectorAll('.hist-impact-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-lens');
        if (id) setLens(id);
      });
    });
  }

  function histImpactCardHTML(lens, grid) {
    const meanCurrent = mean(grid.features.map(f => Number(f.properties[lens.valueProp]) || 0));
    const meanDelta = mean(grid.features.map(f => Number(f.properties[lens.deltaProp]) || 0));
    const isLensActive = lens.id === state.lens;
    const sign = meanDelta > 0 ? '+' : (meanDelta < 0 ? '' : '');
    const flat = Math.abs(meanDelta) < 0.001;
    const dirGoodWhenUp = lens.goodDirection === 'up';
    const isGood = flat ? false : ((meanDelta > 0) === dirGoodWhenUp);
    const cls = flat ? 'flat' : (isGood ? 'up' : 'down');
    const valStr = (meanCurrent * 100).toFixed(0);
    const deltaStr = sign + (meanDelta * 100).toFixed(1) + ' pts';
    return '<div class="hist-impact-card' + (isLensActive ? ' lens' : '') + '" style="--lens-color:' + lens.color + '" data-lens="' + lens.id + '">' +
      '<div class="hist-impact-row"><span class="lbl">' + lens.label + '</span><span class="ico">' + lensIcon(lens.id) + '</span></div>' +
      '<div class="hist-impact-val" style="color:' + (isLensActive ? lens.color : 'var(--text)') + '">' +
        valStr + '<span class="delta ' + cls + '">' + (flat ? 'flat' : deltaStr) + '</span>' +
      '</div>' +
      '<div class="hist-impact-sub">' + lens.label + ' index, mean across cells</div>' +
      '</div>';
  }

  function lensIcon(id) {
    if (id === 'traffic') return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg>';
    if (id === 'jobs') return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>';
    if (id === 'electricity') return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
    if (id === 'buildings') return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22V12h6v10"/></svg>';
    if (id === 'services') return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11H5a2 2 0 0 0-2 2v7h6"/><path d="M15 11h4a2 2 0 0 1 2 2v7h-6"/><circle cx="12" cy="7" r="3"/></svg>';
    return '';
  }

  function mean(arr) {
    if (!arr.length) return 0;
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  function renderCompareSection() {
    const comparePanel = document.querySelector('.compare-panel');
    if (!comparePanel) return;
    if (!isHistoricalMode()) {
      if (comparePanel.dataset.histMode === '1') {
        comparePanel.innerHTML = comparePanel.dataset.simHtml || '';
        delete comparePanel.dataset.histMode;
        cacheEls();
        if (els.runBtn) els.runBtn.addEventListener('click', runSimulation);
        if (els.compareBtn) els.compareBtn.addEventListener('click', openCompareModal);
        if (els.exportBtn) els.exportBtn.addEventListener('click', exportResults);
        // Re-attach the traffic-sim and road-compare listeners since the
        // restored HTML has fresh DOM nodes that lost their handlers.
        attachTrafficSim();
        attachRoadCompare();
      }
      return;
    }
    if (!comparePanel.dataset.simHtml) comparePanel.dataset.simHtml = comparePanel.innerHTML;
    comparePanel.dataset.histMode = '1';

    const ev = state.activeEventId
      ? (state.eventsForYearCache || []).find(e => e.id === state.activeEventId)
      : null;
    let html = '<h3>4. Event Detail</h3>';
    if (!ev) {
      html += '<div class="panel-sub">Pick an event from the list to see what changed.</div>' +
        '<button class="diff-btn" disabled>Open before/after diff</button>' +
        '<div class="active-info"><div class="active-row"><span>Year</span><span>Lens</span></div>' +
          '<div class="active-vals"><span>' + state.year + '</span><span style="color:' + lensDef(state.lens).color + '">' + lensDef(state.lens).label + '</span></div></div>' +
        '<button class="export-btn" id="exportYearBtn" type="button">' +
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
          'Export ' + state.year + ' grid</button>';
    } else {
      const lens = lensDef(state.lens);
      html += '<div class="event-detail-card">' +
        '<div class="head"><span class="event-symbol" style="background:' + lens.color + '">' + escapeHtml(ev.symbol || '+') + '</span>' + escapeHtml(ev.title || '') + '</div>' +
        '<div class="meta">' + escapeHtml(ev.subtitle || '') + '</div>' +
        '<div class="meta">' +
          '<span class="pill" style="background:rgba(255,255,255,0.05);padding:1px 6px;border-radius:8px;color:var(--text-dim);font-size:9.5px">' + escapeHtml(ev.area || 'Belfast') + '</span> ' +
          '<span class="pill" style="background:rgba(255,255,255,0.05);padding:1px 6px;border-radius:8px;color:var(--text-dim);font-size:9.5px">' + escapeHtml(ev.month || state.year) + '</span> ' +
          '<span class="pill" style="background:rgba(255,255,255,0.05);padding:1px 6px;border-radius:8px;color:var(--text-dim);font-size:9.5px">' + escapeHtml(ev.severity || 'Watch') + '</span>' +
        '</div>' +
        '<div class="why">' + escapeHtml(ev.explanation || ev.subtitle || '') + '</div>' +
        '</div>' +
        '<button class="diff-btn" id="openDiffBtn" type="button">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="18"/><rect x="14" y="3" width="7" height="18"/></svg>' +
          'Open before/after diff</button>' +
        '<button class="export-btn" id="exportEventBtn" type="button">' +
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
          'Export event JSON</button>';
    }
    comparePanel.innerHTML = html;
    const diffBtn = comparePanel.querySelector('#openDiffBtn');
    if (diffBtn) diffBtn.addEventListener('click', () => openDiffModal(state.activeEventId));
    const expEvBtn = comparePanel.querySelector('#exportEventBtn');
    if (expEvBtn) expEvBtn.addEventListener('click', exportEvent);
    const expYBtn = comparePanel.querySelector('#exportYearBtn');
    if (expYBtn) expYBtn.addEventListener('click', exportYearSnapshot);
  }

  function selectEvent(eventId) {
    state.activeEventId = eventId;
    renderHistoricalBranchesPanel();
    renderCompareSection();
    refreshHighlightedCells();
    const ev = (state.eventsForYearCache || []).find(e => e.id === eventId);
    if (ev && state.map) {
      const c = realEventCoords(ev);
      if (c) state.map.flyTo({ center: c, zoom: 15, duration: 700 });
    }
  }

  function exportEvent() {
    const ev = (state.eventsForYearCache || []).find(e => e.id === state.activeEventId);
    if (!ev) return;
    const blob = new Blob([JSON.stringify(ev, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'belfast-event-' + ev.id + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    toast('Exported event JSON');
  }

  async function exportYearSnapshot() {
    const grid = await loadGridYear(state.year);
    if (!grid) return;
    const events = eventsForCurrentYearAndLens();
    const data = { year: state.year, lens: state.lens, eventCount: events.length, events: events, cells: grid.features.length };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'belfast-' + state.year + '-' + state.lens + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    toast('Exported ' + state.year + ' ' + state.lens + ' snapshot');
  }

  // ---------- DIFF MODAL ----------

  let diffMaps = { before: null, after: null };
  let workspaceSplitMaps = { before: null, after: null };

  function setDiffSideLabels(beforeLabel, afterLabel) {
    const beforeHead = document.querySelector('#diffMapBefore')?.closest('.diff-side')?.querySelector('.diff-side-head span:last-child');
    const afterHead = document.querySelector('#diffMapAfter')?.closest('.diff-side')?.querySelector('.diff-side-head span:last-child');
    if (beforeHead) beforeHead.textContent = beforeLabel;
    if (afterHead) afterHead.textContent = afterLabel;
  }

  function closeWorkspaceSplitMaps() {
    if (workspaceSplitMaps.before) { try { workspaceSplitMaps.before.remove(); } catch (_) {} workspaceSplitMaps.before = null; }
    if (workspaceSplitMaps.after) { try { workspaceSplitMaps.after.remove(); } catch (_) {} workspaceSplitMaps.after = null; }
  }

  function closeWorkspaceSplit() {
    if (els.workspaceSplit) els.workspaceSplit.hidden = true;
    closeWorkspaceSplitMaps();
  }

  async function openScenarioDiffModal() {
    if (!els.workspaceSplit) return;
    const branch = activeBranch();
    const scenario = scenarioResultForBranch(branch);
    const building = selectedScenarioBuilding(branch);
    if (!scenario || !building) {
      toast('Run the simulation before opening a diff.', 'warn');
      updateScenarioDiffButton();
      return;
    }

    const year = scenarioDiffYear();
    const scenarioBranch = selectedForecastScenarioBranch(scenario, branch);
    const beforeFc = scenario.baselineBranch && scenario.baselineBranch.affectedCellsByYear
      ? scenario.baselineBranch.affectedCellsByYear[String(year)]
      : null;
    const afterFc = scenarioBranch && scenarioBranch.affectedCellsByYear
      ? scenarioBranch.affectedCellsByYear[String(year)]
      : (scenario.affectedCellsByYear && scenario.affectedCellsByYear[String(year)]);
    if (!beforeFc || !afterFc) {
      toast('No forecast cell data for ' + year + '.', 'warn');
      return;
    }

    closeWorkspaceSplitMaps();
    setView('3D');
    if (els.diffModal) els.diffModal.hidden = true;
    if (els.splitYearBefore) els.splitYearBefore.textContent = 'No-build ' + year;
    if (els.splitYearAfter) els.splitYearAfter.textContent = 'With build ' + year;
    if (els.splitTitle) els.splitTitle.textContent = 'Scenario diff: ' + (building.postcode || 'selected postcode');

    const branchName = scenarioBranch ? (scenarioBranch.name || scenarioBranch.branchName || 'Selected branch') : branch.name;
    const confidence = scenarioBranch ? scenarioBranch.confidence : (scenario.confidence || 'medium');
    if (els.splitMeta) {
      els.splitMeta.innerHTML = '<strong>' + escapeHtml(building.postcode || 'Selected postcode') + '</strong>' +
        '<span class="pill">' + escapeHtml(branch.name) + '</span>' +
        '<span class="pill">' + escapeHtml(branchName) + '</span>' +
        '<span class="pill">Confidence: ' + escapeHtml(confidence) + '</span>' +
        '<span class="pill">Model: ' + escapeHtml(scenario.modelVersion || 'forecast') + '</span>';
    }

    els.workspaceSplit.hidden = false;
    if (els.splitStats) els.splitStats.innerHTML = scenarioDiffStatsHTML(beforeFc, afterFc, scenarioBranch, year);
    if (els.splitEvidence) els.splitEvidence.innerHTML = scenarioDiffEvidenceHTML(scenario, scenarioBranch, branch, year);
    branch.lastScenarioDiff = {
      openedAt: new Date().toISOString(),
      year: year,
      postcode: building.postcode,
      branchName: branchName,
      confidence: confidence,
      modelVersion: scenario.modelVersion || 'forecast'
    };
    recordBranchActivity(
      branch,
      'diff',
      'Split diff added',
      'Before/after workspace for ' + (building.postcode || 'selected postcode'),
      year,
      branch.lastScenarioDiff
    );

    const maps = await Promise.all([
      buildScenarioDiffMapInContainer(document.getElementById('splitMapBefore'), 'before', beforeFc, building, year, false, workspaceSplitMaps),
      buildScenarioDiffMapInContainer(document.getElementById('splitMapAfter'), 'after', afterFc, building, year, true, workspaceSplitMaps)
    ]);
    if (maps[0] && maps[1]) syncScenarioDiffCameras(maps[0], maps[1]);
  }

  function closeDiffMaps() {
    if (diffMaps.before) { try { diffMaps.before.remove(); } catch (_) {} diffMaps.before = null; }
    if (diffMaps.after) { try { diffMaps.after.remove(); } catch (_) {} diffMaps.after = null; }
  }

  function scenarioDiffMetricValue(feature, lens) {
    const props = feature && feature.properties ? feature.properties : {};
    const raw = props[lens.source];
    return Number.isFinite(Number(raw)) ? Number(raw) : 0;
  }

  function scenarioDeltaValue(feature, lens) {
    const props = feature && feature.properties ? feature.properties : {};
    const deltas = props.deltas || {};
    const raw = deltas[lens.source];
    return Number.isFinite(Number(raw)) ? Number(raw) : 0;
  }

  function scenarioDeltaColour(diff, lens) {
    if (Math.abs(diff) < 0.001) return '#64748b';
    const isGood = lens.goodDirection === 'up' ? diff > 0 : diff < 0;
    return isGood ? '#22c55e' : '#ef4444';
  }

  function scenarioDiffStatsHTML(beforeFc, afterFc, scenarioBranch, year) {
    const beforeFeatures = beforeFc && beforeFc.features ? beforeFc.features : [];
    const afterFeatures = afterFc && afterFc.features ? afterFc.features : [];
    if (!beforeFeatures.length || !afterFeatures.length) {
      return '<div class="branch-empty">No cell data for the selected scenario.</div>';
    }
    const concrete = scenarioBranch && scenarioBranch.timelineByYear
      ? scenarioBranch.timelineByYear[String(year)]?.concreteImpacts
      : null;
    return SCENARIO_DIFF_LENSES.map(lens => {
      const before = mean(beforeFeatures.map(f => scenarioDiffMetricValue(f, lens)));
      const directAfter = mean(afterFeatures.map(f => scenarioDiffMetricValue(f, lens)));
      let diff = mean(afterFeatures.map(f => scenarioDeltaValue(f, lens)));
      if (!Number.isFinite(diff) || Math.abs(diff) < 0.000001) diff = directAfter - before;
      const after = before + diff;
      const flat = Math.abs(diff) < 0.00005;
      const isGood = flat ? false : (lens.goodDirection === 'up' ? diff > 0 : diff < 0);
      const cls = flat ? 'flat' : (isGood ? 'up' : 'down');
      const sign = diff > 0 ? '+' : '';
      const deltaPts = diff * 100;
      return '<div class="diff-stat lens" style="--lens-color:' + lens.color + '">' +
        '<div class="name">' + lens.label + '</div>' +
        '<div class="vals">' +
          '<span class="before">' + fmtScenarioIndex(before, deltaPts) + '</span>' +
          '<span class="arrow">&rarr;</span>' +
          '<span class="after">' + fmtScenarioIndex(after, deltaPts) + '</span>' +
        '</div>' +
        '<div class="delta-line ' + cls + '">' + (flat ? 'no change' : sign + deltaPts.toFixed(Math.abs(deltaPts) < 1 ? 2 : 1) + ' pts') + '</div>' +
        '</div>';
    }).join('') + scenarioDiffConcreteHTML(concrete);
  }

  function renderScenarioDiffStats(beforeFc, afterFc, scenarioBranch, year) {
    const stats = document.getElementById('diffStats');
    if (!stats) return;
    const beforeFeatures = beforeFc && beforeFc.features ? beforeFc.features : [];
    const afterFeatures = afterFc && afterFc.features ? afterFc.features : [];
    if (!beforeFeatures.length || !afterFeatures.length) {
      stats.innerHTML = '<div class="branch-empty">No cell data for the selected scenario.</div>';
      return;
    }
    const concrete = scenarioBranch && scenarioBranch.timelineByYear
      ? scenarioBranch.timelineByYear[String(year)]?.concreteImpacts
      : null;
    stats.innerHTML = SCENARIO_DIFF_LENSES.map(lens => {
      const before = mean(beforeFeatures.map(f => scenarioDiffMetricValue(f, lens)));
      const directAfter = mean(afterFeatures.map(f => scenarioDiffMetricValue(f, lens)));
      let diff = mean(afterFeatures.map(f => scenarioDeltaValue(f, lens)));
      if (!Number.isFinite(diff) || Math.abs(diff) < 0.000001) diff = directAfter - before;
      const after = before + diff;
      const flat = Math.abs(diff) < 0.00005;
      const isGood = flat ? false : (lens.goodDirection === 'up' ? diff > 0 : diff < 0);
      const cls = flat ? 'flat' : (isGood ? 'up' : 'down');
      const sign = diff > 0 ? '+' : '';
      const deltaPts = diff * 100;
      return '<div class="diff-stat lens" style="--lens-color:' + lens.color + '">' +
        '<div class="name">' + lens.label + '</div>' +
        '<div class="vals">' +
          '<span class="before">' + fmtScenarioIndex(before, deltaPts) + '</span>' +
          '<span class="arrow">&rarr;</span>' +
          '<span class="after">' + fmtScenarioIndex(after, deltaPts) + '</span>' +
        '</div>' +
        '<div class="delta-line ' + cls + '">' + (flat ? 'no change' : sign + deltaPts.toFixed(Math.abs(deltaPts) < 1 ? 2 : 1) + ' pts') + '</div>' +
        '</div>';
    }).join('') + scenarioDiffConcreteHTML(concrete);
  }

  function scenarioDiffConcreteHTML(impact) {
    if (!impact || !impact.traffic || !impact.jobs || !impact.electricity || !impact.services) return '';
    return '<div class="diff-concrete-data">' +
      '<strong>Concrete simulation data</strong>' +
      '<span>Traffic ' + fmtConcreteSigned(impact.traffic.netDailyTrips, 0) + ' daily trips</span>' +
      '<span>Jobs ' + fmtConcreteSigned(impact.jobs.netJobsEstimate, 0) + '</span>' +
      '<span>Electricity ' + fmtConcreteSigned(impact.electricity.peakKwChange, 0) + ' kW peak</span>' +
      '<span>Services ' + fmtConcreteSigned(impact.services.netServiceDemand, 0) + ' people-eq</span>' +
      '</div>';
  }

  function fmtScenarioIndex(value, deltaPts) {
    const pct = clamp(value, 0, 1.5) * 100;
    const decimals = Math.abs(deltaPts) > 0 && Math.abs(deltaPts) < 1 ? 2 : 0;
    return pct.toFixed(decimals).replace(/\.0+$/, '');
  }

  function scenarioDiffEvidenceHTML(scenario, scenarioBranch, branch, year) {
    const evidence = []
      .concat(scenarioBranch && Array.isArray(scenarioBranch.evidence) ? scenarioBranch.evidence : [])
      .concat(Array.isArray(scenario.evidence) ? scenario.evidence : []);
    const warnings = Array.isArray(scenario.warnings) ? scenario.warnings : [];
    let html = '<strong>Scenario evidence</strong>';
    html += '<div>Forecast artifacts and deterministic planners are driving the numeric impacts.</div>';
    html += '<div style="margin-top:6px">Year: ' + year + ' &middot; Branch: ' + escapeHtml(branch.name) + '</div>';
    if (evidence.length) {
      html += '<ul>' + evidence.slice(0, 3).map(line => '<li>' + escapeHtml(line) + '</li>').join('') + '</ul>';
    }
    if (warnings.length) {
      html += '<div style="margin-top:6px;color:var(--amber)">Warning: ' + escapeHtml(warnings[0]) + '</div>';
    }
    return html;
  }

  function renderScenarioDiffEvidence(scenario, scenarioBranch, branch, year) {
    const evNode = document.getElementById('diffEvidence');
    if (!evNode) return;
    const evidence = []
      .concat(scenarioBranch && Array.isArray(scenarioBranch.evidence) ? scenarioBranch.evidence : [])
      .concat(Array.isArray(scenario.evidence) ? scenario.evidence : []);
    const warnings = Array.isArray(scenario.warnings) ? scenario.warnings : [];
    const trace = Array.isArray(scenario.agentTrace) ? scenario.agentTrace : [];
    let html = '<strong>Scenario evidence</strong>';
    html += '<div>Numeric impacts come from the trained forecast artifact and deterministic planners. Gemini-style agents explain branches and risks only.</div>';
    html += '<div style="margin-top:6px">Year: ' + year + ' &middot; Branch: ' + escapeHtml(branch.name) + '</div>';
    if (evidence.length) {
      html += '<ul>' + evidence.slice(0, 6).map(line => '<li>' + escapeHtml(line) + '</li>').join('') + '</ul>';
    }
    if (warnings.length) {
      html += '<div style="margin-top:6px;color:var(--amber)">Warnings: ' + warnings.slice(0, 3).map(escapeHtml).join(' &middot; ') + '</div>';
    }
    if (trace.length) {
      html += '<div style="margin-top:6px">Agents: ' + trace.slice(0, 5).map(t => escapeHtml(t.agent + ' - ' + t.summary)).join('<br>') + '</div>';
    }
    evNode.innerHTML = html;
  }

  async function buildScenarioDiffMapInContainer(container, side, grid, building, year, showBuilding, mapStore) {
    if (!container) return null;
    container.innerHTML = '';
    const mp = state.manifest && state.manifest.mapbox;
    if (!mp || !mp.token || !window.mapboxgl) return null;

    mapboxgl.accessToken = mp.token;
    const center = [Number(building.lng), Number(building.lat)];
    const map = new mapboxgl.Map({
      container: container,
      style: mp.style || 'mapbox://styles/mapbox/dark-v11',
      center: center,
      zoom: 15.9,
      pitch: 64,
      bearing: -24,
      antialias: true,
      attributionControl: false,
      interactive: true
    });
    if (mapStore) mapStore[side] = map;

    return new Promise(resolve => {
      map.on('load', () => {
        const trafficLens = SCENARIO_DIFF_LENSES[0];
        const features = (grid && grid.features) ? grid.features.map(f => {
          const props = f.properties || {};
          const value = Number(props.traffic) || 0;
          const diff = scenarioDeltaValue(f, trafficLens);
          const neutralAffected = Math.abs(diff) < 0.00005;
          const color = side === 'before'
            ? ramp_RedGreen(1 - clamp(value, 0, 1))
            : (neutralAffected ? '#22d3ee' : scenarioDeltaColour(diff, trafficLens));
          const opacity = side === 'before'
            ? clamp(0.12 + value * 0.7, 0.14, 0.82)
            : clamp(0.18 + Math.max(Math.abs(diff), Number(props.intensity) || 0.03) * 3.5, 0.22, 0.86);
          return Object.assign({}, f, {
            properties: Object.assign({}, props, {
              __color: color,
              __opacity: opacity
            })
          });
        }) : [];
        const refLayerId = (() => {
          const ls = map.getStyle().layers || [];
          for (const l of ls) if (l.type === 'symbol') return l.id;
          return undefined;
        })();
        map.addSource('cells', { type: 'geojson', data: { type: 'FeatureCollection', features: features } });
        map.addLayer({
          id: 'cells-fill',
          type: 'fill',
          source: 'cells',
          paint: { 'fill-color': ['get', '__color'], 'fill-opacity': ['get', '__opacity'] }
        }, refLayerId);
        map.addLayer({
          id: 'cells-line',
          type: 'line',
          source: 'cells',
          paint: { 'line-color': 'rgba(226,232,240,0.16)', 'line-width': 0.45 }
        }, refLayerId);

        const markerFeature = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: center } };
        map.addSource('site', { type: 'geojson', data: { type: 'FeatureCollection', features: [markerFeature] } });
        map.addLayer({
          id: 'site-glow',
          type: 'circle',
          source: 'site',
          paint: { 'circle-radius': showBuilding ? 30 : 24, 'circle-color': showBuilding ? '#22d3ee' : '#60a5fa', 'circle-opacity': 0.2, 'circle-blur': 1.2 }
        });
        map.addLayer({
          id: 'site-circle',
          type: 'circle',
          source: 'site',
          paint: { 'circle-radius': 8, 'circle-color': showBuilding ? '#22d3ee' : '#60a5fa', 'circle-stroke-color': '#0a1426', 'circle-stroke-width': 2 }
        });

        if (showBuilding) {
          const ring = squareRing(center[0], center[1], Math.max(28, Math.sqrt((building.buildingConfig && building.buildingConfig.footprintSqm) || 900)));
          map.addSource('scenario-building', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: [{
                type: 'Feature',
                properties: {
                  color: building.color || '#a855f7',
                  height: building.height || ((building.buildingConfig && building.buildingConfig.floors || 8) * 3.8)
                },
                geometry: { type: 'Polygon', coordinates: [ring] }
              }]
            }
          });
          map.addLayer({
            id: 'scenario-building-extrusion',
            type: 'fill-extrusion',
            source: 'scenario-building',
            paint: {
              'fill-extrusion-color': ['get', 'color'],
              'fill-extrusion-height': ['get', 'height'],
              'fill-extrusion-base': 0,
              'fill-extrusion-opacity': 0.9
            }
          }, refLayerId);
        }
        requestAnimationFrame(() => {
          try { map.resize(); } catch (_) {}
          resolve(map);
        });
      });
      map.on('error', () => resolve(map));
    });
  }

  async function buildScenarioDiffMap(side, grid, building, year, showBuilding) {
    const containerId = side === 'before' ? 'diffMapBefore' : 'diffMapAfter';
    const container = document.getElementById(containerId);
    if (!container) return null;
    container.innerHTML = '';
    const mp = state.manifest && state.manifest.mapbox;
    if (!mp || !mp.token || !window.mapboxgl) return null;

    mapboxgl.accessToken = mp.token;
    const center = [Number(building.lng), Number(building.lat)];
    const map = new mapboxgl.Map({
      container: container,
      style: mp.style || 'mapbox://styles/mapbox/dark-v11',
      center: center,
      zoom: 15.9,
      pitch: 64,
      bearing: -24,
      antialias: true,
      attributionControl: false,
      interactive: true
    });
    diffMaps[side] = map;

    return new Promise(resolve => {
      map.on('load', () => {
        const trafficLens = SCENARIO_DIFF_LENSES[0];
        const features = (grid && grid.features) ? grid.features.map(f => {
          const props = f.properties || {};
          const value = Number(props.traffic) || 0;
          const diff = scenarioDeltaValue(f, trafficLens);
          const neutralAffected = Math.abs(diff) < 0.00005;
          const color = side === 'before'
            ? ramp_RedGreen(1 - clamp(value, 0, 1))
            : (neutralAffected ? '#22d3ee' : scenarioDeltaColour(diff, trafficLens));
          const opacity = side === 'before'
            ? clamp(0.12 + value * 0.7, 0.14, 0.82)
            : clamp(0.18 + Math.max(Math.abs(diff), Number(props.intensity) || 0.03) * 3.5, 0.22, 0.86);
          return Object.assign({}, f, {
            properties: Object.assign({}, props, {
              __color: color,
              __opacity: opacity
            })
          });
        }) : [];
        const refLayerId = (() => {
          const ls = map.getStyle().layers || [];
          for (const l of ls) if (l.type === 'symbol') return l.id;
          return undefined;
        })();
        map.addSource('cells', { type: 'geojson', data: { type: 'FeatureCollection', features: features } });
        map.addLayer({
          id: 'cells-fill',
          type: 'fill',
          source: 'cells',
          paint: { 'fill-color': ['get', '__color'], 'fill-opacity': ['get', '__opacity'] }
        }, refLayerId);
        map.addLayer({
          id: 'cells-line',
          type: 'line',
          source: 'cells',
          paint: { 'line-color': 'rgba(226,232,240,0.16)', 'line-width': 0.45 }
        }, refLayerId);

        const markerFeature = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: center } };
        map.addSource('site', { type: 'geojson', data: { type: 'FeatureCollection', features: [markerFeature] } });
        map.addLayer({
          id: 'site-glow',
          type: 'circle',
          source: 'site',
          paint: { 'circle-radius': showBuilding ? 30 : 24, 'circle-color': showBuilding ? '#22d3ee' : '#60a5fa', 'circle-opacity': 0.2, 'circle-blur': 1.2 }
        });
        map.addLayer({
          id: 'site-circle',
          type: 'circle',
          source: 'site',
          paint: { 'circle-radius': 8, 'circle-color': showBuilding ? '#22d3ee' : '#60a5fa', 'circle-stroke-color': '#0a1426', 'circle-stroke-width': 2 }
        });

        if (showBuilding) {
          const ring = squareRing(center[0], center[1], Math.max(28, Math.sqrt((building.buildingConfig && building.buildingConfig.footprintSqm) || 900)));
          map.addSource('scenario-building', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: [{
                type: 'Feature',
                properties: {
                  color: building.color || '#a855f7',
                  height: building.height || ((building.buildingConfig && building.buildingConfig.floors || 8) * 3.8)
                },
                geometry: { type: 'Polygon', coordinates: [ring] }
              }]
            }
          });
          map.addLayer({
            id: 'scenario-building-extrusion',
            type: 'fill-extrusion',
            source: 'scenario-building',
            paint: {
              'fill-extrusion-color': ['get', 'color'],
              'fill-extrusion-height': ['get', 'height'],
              'fill-extrusion-base': 0,
              'fill-extrusion-opacity': 0.9
            }
          }, refLayerId);
        }
        resolve(map);
      });
      map.on('error', () => resolve(map));
    });
  }

  function syncScenarioDiffCameras(beforeMap, afterMap) {
    let syncing = false;
    function mirror(src, dst) {
      if (syncing || !src || !dst) return;
      syncing = true;
      const c = src.getCenter();
      dst.jumpTo({ center: [c.lng, c.lat], zoom: src.getZoom(), bearing: src.getBearing(), pitch: src.getPitch() });
      requestAnimationFrame(() => { syncing = false; });
    }
    beforeMap.on('move', () => mirror(beforeMap, afterMap));
    afterMap.on('move', () => mirror(afterMap, beforeMap));
  }

  async function openDiffModal(eventId) {
    if (!els.diffModal) return;
    const ev = (state.eventsForYearCache || []).find(e => e.id === eventId);
    if (!ev) return;

    const yearAfter = state.year;
    const yearBefore = Math.max(2016, yearAfter - 1);
    const lens = lensDef(state.lens);

    closeDiffMaps();
    document.getElementById('diffYearBefore').textContent = yearBefore;
    document.getElementById('diffYearAfter').textContent = yearAfter;
    setDiffSideLabels('before', 'after');
    document.getElementById('diffTitle').textContent = ev.title || 'Event';

    const meta = document.getElementById('diffMeta');
    meta.innerHTML = '<strong>' + escapeHtml(ev.title || '') + '</strong>' +
      '<small>' + escapeHtml(ev.subtitle || '') + '</small>' +
      '<div style="margin-top:6px">' +
        '<span class="pill" style="background:' + lens.color + '20;color:' + lens.color + '">' + lens.label + '</span>' +
        '<span class="pill">' + escapeHtml(ev.area || 'Belfast') + '</span>' +
        '<span class="pill">' + escapeHtml(ev.month || yearAfter) + '</span>' +
        '<span class="pill">' + escapeHtml(ev.severity || 'Watch') + '</span>' +
      '</div>';

    els.diffModal.hidden = false;

    const [gridBefore, gridAfter] = await Promise.all([
      loadGridYear(yearBefore),
      loadGridYear(yearAfter)
    ]);

    renderDiffStats(ev, gridBefore, gridAfter);
    renderDiffEvidence(ev);

    await Promise.all([
      buildDiffMap('before', gridBefore, ev, yearBefore),
      buildDiffMap('after', gridAfter, ev, yearAfter)
    ]);
  }

  function closeDiffModal() {
    if (els.diffModal) els.diffModal.hidden = true;
    closeDiffMaps();
  }

  async function buildDiffMap(side, grid, ev, year) {
    const containerId = side === 'before' ? 'diffMapBefore' : 'diffMapAfter';
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    const mp = state.manifest && state.manifest.mapbox;
    if (!mp || !mp.token || !window.mapboxgl) return;

    mapboxgl.accessToken = mp.token;
    const center = realEventCoords(ev) || (state.manifest.viewport && state.manifest.viewport.center) || [-5.93, 54.6];
    const map = new mapboxgl.Map({
      container: container,
      style: mp.style || 'mapbox://styles/mapbox/dark-v11',
      center: center,
      zoom: 13.5,
      pitch: 35,
      bearing: -18,
      antialias: true,
      attributionControl: false,
      interactive: true
    });
    diffMaps[side] = map;

    const lens = lensDef(state.lens);

    map.on('load', () => {
      const features = (grid && grid.features) ? grid.features.map(f => {
        const v = Number(f.properties[lens.valueProp]) || 0;
        const opacity = clamp(0.06 + v * 0.6, 0.06, 0.85);
        const goodness = lens.goodDirection === 'up' ? v : (1 - v);
        return Object.assign({}, f, { properties: Object.assign({}, f.properties, { __color: ramp_RedGreen(goodness), __opacity: opacity }) });
      }) : [];
      map.addSource('cells', { type: 'geojson', data: { type: 'FeatureCollection', features: features } });
      const refLayerId = (() => { const ls = map.getStyle().layers || []; for (const l of ls) if (l.type === 'symbol') return l.id; })();
      map.addLayer({
        id: 'cells-fill', type: 'fill', source: 'cells',
        paint: { 'fill-color': ['get', '__color'], 'fill-opacity': ['get', '__opacity'] }
      }, refLayerId);
      map.addLayer({
        id: 'cells-line', type: 'line', source: 'cells',
        paint: { 'line-color': 'rgba(96,165,250,0.16)', 'line-width': 0.4 }
      }, refLayerId);

      const highlights = nearestCellsForEvent(ev, features);
      map.addSource('hl', { type: 'geojson', data: { type: 'FeatureCollection', features: highlights } });
      map.addLayer({
        id: 'hl-fill', type: 'fill', source: 'hl',
        paint: { 'fill-color': lens.color, 'fill-opacity': 0.35 }
      }, refLayerId);
      map.addLayer({
        id: 'hl-line', type: 'line', source: 'hl',
        paint: { 'line-color': lens.color, 'line-width': 1.6, 'line-opacity': 0.95 }
      }, refLayerId);

      map.addSource('mk', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: center } }] }
      });
      map.addLayer({ id: 'mk-glow', type: 'circle', source: 'mk',
        paint: { 'circle-radius': 22, 'circle-color': lens.color, 'circle-opacity': 0.18, 'circle-blur': 1.2 } });
      map.addLayer({ id: 'mk-circle', type: 'circle', source: 'mk',
        paint: { 'circle-radius': 9, 'circle-color': lens.color, 'circle-stroke-color': '#0a1426', 'circle-stroke-width': 2 } });
    });

    map.on('error', () => {});
  }

  function renderDiffStats(ev, gridBefore, gridAfter) {
    const stats = document.getElementById('diffStats');
    if (!stats) return;
    if (!gridBefore || !gridAfter) {
      stats.innerHTML = '<div class="branch-empty">Loading metrics...</div>';
      return;
    }
    const bf = nearestCellsForEvent(ev, gridBefore.features);
    const af = nearestCellsForEvent(ev, gridAfter.features);
    if (!bf.length || !af.length) {
      stats.innerHTML = '<div class="branch-empty">No cell data for affected area.</div>';
      return;
    }
    stats.innerHTML = LENSES.map(lens => {
      const before = mean(bf.map(f => Number(f.properties[lens.valueProp]) || 0));
      const after = mean(af.map(f => Number(f.properties[lens.valueProp]) || 0));
      const diff = after - before;
      const flat = Math.abs(diff) < 0.001;
      const dirGoodWhenUp = lens.goodDirection === 'up';
      const isGood = flat ? false : ((diff > 0) === dirGoodWhenUp);
      const cls = flat ? 'flat' : (isGood ? 'up' : 'down');
      const sign = diff > 0 ? '+' : '';
      const isLens = lens.id === state.lens;
      return '<div class="diff-stat' + (isLens ? ' lens' : '') + '" style="--lens-color:' + lens.color + '">' +
        '<div class="name">' + lens.label + '</div>' +
        '<div class="vals">' +
          '<span class="before">' + (before * 100).toFixed(0) + '</span>' +
          '<span class="arrow">&rarr;</span>' +
          '<span class="after">' + (after * 100).toFixed(0) + '</span>' +
        '</div>' +
        '<div class="delta-line ' + cls + '">' + (flat ? 'no change' : sign + (diff * 100).toFixed(1) + ' pts') + '</div>' +
        '</div>';
    }).join('');
  }

  function renderDiffEvidence(ev) {
    const evNode = document.getElementById('diffEvidence');
    if (!evNode) return;
    const items = [];
    const srcName = ev.eventSourceName || ev.sourceName;
    const srcBasis = ev.eventSourceBasis || ev.sourceBasis;
    if (srcName) items.push('Source: ' + escapeHtml(srcName));
    if (srcBasis) items.push(escapeHtml(srcBasis));
    if (ev.confidence) items.push('Confidence: ' + escapeHtml(ev.confidence));
    if (Array.isArray(ev.cellIds) && ev.cellIds.length) items.push(ev.cellIds.length + ' cells affected');
    else if (Array.isArray(ev.coordinates)) items.push('Geocoded to ' + ev.coordinates[1].toFixed(4) + ', ' + ev.coordinates[0].toFixed(4));
    if (ev.osmTimestamp) items.push('OSM mapped: ' + escapeHtml(String(ev.osmTimestamp).slice(0, 10)));
    if (ev.osmUser) items.push('Mapper: ' + escapeHtml(ev.osmUser));
    let evidenceLis = '';
    if (Array.isArray(ev.evidence)) {
      ev.evidence.slice(0, 6).forEach(line => {
        evidenceLis += '<li>' + escapeHtml(line) + '</li>';
      });
    }
    let html = '<strong>Evidence trail</strong>';
    if (ev.explanation) html += '<div style="margin-bottom:6px">' + escapeHtml(ev.explanation) + '</div>';
    if (items.length) html += '<div>' + items.join(' &middot; ') + '</div>';
    if (evidenceLis) html += '<ul>' + evidenceLis + '</ul>';
    const srcUrl = ev.eventSourceUrl || ev.sourceUrl;
    const csUrl = ev.eventOsmChangesetUrl || ev.osmChangesetUrl;
    if (srcUrl) html += '<div style="margin-top:6px"><a href="' + srcUrl + '" target="_blank" rel="noopener">Open source &rarr;</a></div>';
    if (csUrl) html += '<div><a href="' + csUrl + '" target="_blank" rel="noopener">OSM changeset &rarr;</a></div>';
    evNode.innerHTML = html;
  }

  // ================================================================
  // PREDICTED-IMPACT RIPPLE VISUALISATION
  //   - Heatmap of distance + recency-weighted predicted impact, drawn
  //     around every placed building.
  //   - Animates year-by-year as the timeline advances (S-curve ramp).
  //   - Driven by /web/impact-predictor.js (window.BelfastPredictor).
  // ================================================================

  // Forecast/simulation impact metrics are kept in lock-step with the
  // historical LENSES (traffic, jobs, electricity, buildings, services) —
  // the model simulates change in all five, so the user can flip between
  // any of them on the future map just like they can on the historical map.
  const IMPACT_METRICS = [
    { id: 'traffic',     label: 'Traffic',     source: 'traffic',     color: '#fb923c', goodDir: 'down' },
    { id: 'jobs',        label: 'Jobs',        source: 'jobs',        color: '#a855f7', goodDir: 'up' },
    { id: 'buildings',   label: 'Buildings',   source: 'population',  color: '#3b82f6', goodDir: 'up' },
    { id: 'electricity', label: 'Electricity', source: 'electricity', color: '#06b6d4', goodDir: 'down' },
    { id: 'services',    label: 'Services',    source: 'services',    color: '#22c55e', goodDir: 'up' }
  ];

  function impactMetricDef(id) { return IMPACT_METRICS.find(m => m.id === id) || IMPACT_METRICS[0]; }
  function impactMetricSource(id) { return impactMetricDef(id).source || id; }

  function ensureImpactLayers() {
    if (state.impactLayersAdded || !state.map || !state.mapLoaded) return;
    state.impactLayersAdded = true;
    const empty = { type: 'FeatureCollection', features: [] };

    if (!state.map.getSource('impact-ripples')) {
      state.map.addSource('impact-ripples', { type: 'geojson', data: empty });
    }

    // Heatmap layer — Mapbox heatmap renders points with radius/intensity
    // expressions, giving us a beautiful soft ripple that grows as more
    // points get higher intensity values.
    if (!state.map.getLayer('impact-heatmap')) {
      state.map.addLayer({
        id: 'impact-heatmap',
        type: 'heatmap',
        source: 'impact-ripples',
        maxzoom: 20,
        paint: {
          'heatmap-weight': ['get', 'intensity'],
          'heatmap-intensity': [
            'interpolate', ['linear'], ['zoom'],
            10, 0.6,
            14, 1.2,
            17, 1.8
          ],
          'heatmap-radius': [
            'interpolate', ['linear'], ['zoom'],
            10, 24,
            14, 60,
            17, 110
          ],
          'heatmap-opacity': 0.78,
          // Color ramp set per-metric in updateImpactRipples()
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,    'rgba(0,0,0,0)',
            0.15, 'rgba(168, 85, 247, 0.35)',
            0.4,  'rgba(168, 85, 247, 0.55)',
            0.7,  'rgba(168, 85, 247, 0.85)',
            1,    'rgba(255, 255, 255, 0.95)'
          ]
        }
      });
    }

    // Per-building epicentre pulses — small bright dots that pulse on placement
    if (!state.map.getSource('impact-epicentres')) {
      state.map.addSource('impact-epicentres', { type: 'geojson', data: empty });
    }
    if (!state.map.getLayer('impact-epicentres-glow')) {
      state.map.addLayer({
        id: 'impact-epicentres-glow',
        type: 'circle',
        source: 'impact-epicentres',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'pulse'], 0, 14, 1, 32],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['interpolate', ['linear'], ['get', 'pulse'], 0, 0.45, 1, 0.05],
          'circle-blur': 0.8
        }
      });
    }
  }

  function metricColor(metric) {
    const def = impactMetricDef(metric);
    return def.color;
  }

  function metricRamp(color, polarityFavorable) {
    // When the impact is favourable (good for the city) → green-cyan ramp
    // When the impact is unfavourable → orange-red ramp
    if (polarityFavorable) {
      return [
        'interpolate', ['linear'], ['heatmap-density'],
        0,    'rgba(0,0,0,0)',
        0.15, 'rgba(34, 211, 238, 0.30)',
        0.35, 'rgba(34, 197, 94, 0.55)',
        0.6,  'rgba(34, 197, 94, 0.80)',
        0.85, 'rgba(190, 242, 100, 0.92)',
        1,    'rgba(255, 255, 255, 0.95)'
      ];
    }
    return [
      'interpolate', ['linear'], ['heatmap-density'],
      0,    'rgba(0,0,0,0)',
      0.15, 'rgba(251, 146, 60, 0.32)',
      0.35, 'rgba(249, 115, 22, 0.60)',
      0.6,  'rgba(239, 68, 68, 0.80)',
      0.85, 'rgba(254, 202, 87, 0.92)',
      1,    'rgba(255, 255, 255, 0.96)'
    ];
  }

  function scenarioCellsForImpact(branch, year) {
    const scenario = scenarioResultForBranch(branch);
    if (!scenario) return null;
    const forecastBranch = selectedForecastScenarioBranch(scenario, branch);
    return forecastBranch && forecastBranch.affectedCellsByYear
      ? forecastBranch.affectedCellsByYear[String(year)]
      : (scenario.affectedCellsByYear && scenario.affectedCellsByYear[String(year)]);
  }

  function scenarioImpactDelta(feature, metricId) {
    const props = feature && feature.properties ? feature.properties : {};
    const source = impactMetricSource(metricId);
    const deltas = props.deltas || {};
    const raw = deltas[source];
    if (Number.isFinite(Number(raw))) return Number(raw);
    const baseline = Number(props.baseline && props.baseline[source]);
    const value = Number(props[source]);
    return Number.isFinite(value) && Number.isFinite(baseline) ? value - baseline : 0;
  }

  function scenarioImpactHeatmap(branch, year, metricId) {
    const fc = scenarioCellsForImpact(branch, year);
    const features = fc && Array.isArray(fc.features) ? fc.features : [];
    if (!features.length) return null;
    const def = impactMetricDef(metricId);
    const points = [];
    let polaritySum = 0;
    let polarityN = 0;
    features.forEach(feature => {
      const centre = polygonCentroid(feature.geometry);
      if (!centre) return;
      const diff = scenarioImpactDelta(feature, metricId);
      const props = feature.properties || {};
      const baseIntensity = Math.abs(diff);
      const modelIntensity = Number(props.intensity) || 0;
      const intensity = clamp(baseIntensity * 22 + modelIntensity * 0.25, 0.04, 1);
      const favourable = Math.abs(diff) < 0.00005
        ? true
        : (def.goodDir === 'up' ? diff > 0 : diff < 0);
      polaritySum += favourable ? 1 : -1;
      polarityN += 1;
      points.push({
        type: 'Feature',
        properties: {
          intensity,
          delta: diff,
          metric: metricId,
          polarity: favourable ? 1 : -1
        },
        geometry: { type: 'Point', coordinates: centre }
      });
    });
    return {
      points,
      polarityFavourable: polarityN > 0 ? polaritySum / polarityN >= 0 : true,
      confidence: (features[0] && features[0].properties && features[0].properties.confidence) || 'medium'
    };
  }

  function impactEpicentreFeatures(branch, metricId) {
    if (!branch) return [];
    const def = impactMetricDef(metricId);
    return (branch.items || []).map(item => {
      let coord = null;
      if (item.type === 'road') {
        const path = Array.isArray(item.path) && item.path.length >= 2 ? item.path : [item.start, item.end].filter(Array.isArray);
        const location = locationFromCoords(path);
        if (location) coord = [location.lng, location.lat];
      } else if (Number.isFinite(Number(item.lng)) && Number.isFinite(Number(item.lat))) {
        coord = [Number(item.lng), Number(item.lat)];
      }
      if (!coord) return null;
      return {
        type: 'Feature',
        properties: {
          id: item.id,
          color: def.color,
          pulse: item.type === 'road' ? 0.55 : 0.85
        },
        geometry: { type: 'Point', coordinates: coord }
      };
    }).filter(Boolean);
  }

  function updateImpactRipples() {
    if (!state.mapLoaded) return;
    ensureImpactLayers();
    const branch = activeBranch();
    if (!branch) return;
    if (state.mode !== 'simulation') {
      if (state.map.getSource('impact-ripples')) state.map.getSource('impact-ripples').setData({ type: 'FeatureCollection', features: [] });
      if (state.map.getSource('impact-epicentres')) state.map.getSource('impact-epicentres').setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const metric = state.impactMetric;
    const scenarioHeatmap = scenarioImpactHeatmap(branch, state.year, metric);
    if (scenarioHeatmap) {
      if (state.map.getLayer('impact-heatmap')) {
        state.map.setPaintProperty('impact-heatmap', 'heatmap-color', metricRamp(metricColor(metric), scenarioHeatmap.polarityFavourable));
      }
      state.map.getSource('impact-ripples').setData({ type: 'FeatureCollection', features: scenarioHeatmap.points });
      state.map.getSource('impact-epicentres').setData({ type: 'FeatureCollection', features: impactEpicentreFeatures(branch, metric) });
      return;
    }

    if (!window.BelfastPredictor) {
      state.map.getSource('impact-ripples').setData({ type: 'FeatureCollection', features: [] });
      state.map.getSource('impact-epicentres').setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const buildings = branch.items.filter(it => it.type === 'building' && it.year <= state.year);
    if (!buildings.length) {
      state.map.getSource('impact-ripples').setData({ type: 'FeatureCollection', features: [] });
      state.map.getSource('impact-epicentres').setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    let allPts = [];
    let polaritySum = 0; let polarityN = 0;
    const epicentres = [];
    buildings.forEach(b => {
      const pts = window.BelfastPredictor.generateHeatmapPoints(b, state.year, metric);
      pts.forEach(p => {
        allPts.push(p);
        polaritySum += p.properties.polarity || 0;
        polarityN += 1;
      });
      const pred = window.BelfastPredictor.predictForBuilding(b, state.year);
      const pulseLevel = Math.min(1, (state.year - b.year + 1) / 8);
      epicentres.push({
        type: 'Feature',
        properties: {
          id: b.id,
          color: pred && pred.deltas[metric] !== undefined && ((window.BelfastPredictor.metricGoodDirection(metric) === 'up' && pred.deltas[metric] >= 0) || (window.BelfastPredictor.metricGoodDirection(metric) === 'down' && pred.deltas[metric] < 0))
            ? '#22c55e' : '#fb923c',
          pulse: pulseLevel
        },
        geometry: { type: 'Point', coordinates: [b.lng, b.lat] }
      });
    });

    const polarityFavourable = polarityN > 0 ? (polaritySum / polarityN) > 0 : true;
    if (state.map.getLayer('impact-heatmap')) {
      state.map.setPaintProperty('impact-heatmap', 'heatmap-color', metricRamp(metricColor(metric), polarityFavourable));
    }
    state.map.getSource('impact-ripples').setData({ type: 'FeatureCollection', features: allPts });
    state.map.getSource('impact-epicentres').setData({ type: 'FeatureCollection', features: epicentres });
  }

  function updateImpactLensUI() {
    if (!els.impactLens) return;
    const branch = activeBranch();
    const showLens = state.mode === 'simulation';
    els.impactLens.hidden = !showLens;
    if (!showLens) {
      if (els.similarEvents) els.similarEvents.hidden = true;
      return;
    }

    // Tabs
    if (els.impactLensTabs) {
      els.impactLensTabs.innerHTML = IMPACT_METRICS.map(m => {
        const active = m.id === state.impactMetric ? ' active' : '';
        return '<button class="impact-lens-tab' + active + '" data-metric="' + m.id + '" type="button">' + m.label + '</button>';
      }).join('');
      els.impactLensTabs.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-metric');
          state.impactMetric = id;
          // Keep the top-of-map lens tabs in sync with the in-map impact
          // tabs — they're two views into the same active metric.
          if (LENSES.find(l => l.id === id)) state.lens = id;
          renderLensTabs();
          updateImpactRipples();
          updateImpactLensUI();
        });
      });
    }
    // Year-since-baseline label
    if (els.impactLensYear) {
      const since = Math.max(0, state.year - BASE_YEAR);
      els.impactLensYear.textContent = since === 0 ? 'baseline' : ('+' + since + ' yr' + (since === 1 ? '' : 's'));
    }
    // Legend / confidence
    if (els.impactLensLegend) {
      const def = impactMetricDef(state.impactMetric);
      const scenario = scenarioResultForBranch(branch);
      const scenarioBranch = scenario ? selectedForecastScenarioBranch(scenario, branch) : null;
      const yearRow = scenarioBranch && scenarioBranch.timelineByYear ? scenarioBranch.timelineByYear[String(state.year)] : null;
      const branchPred = !yearRow && window.BelfastPredictor ? window.BelfastPredictor.predictForBranch(branch, state.year) : null;
      const conf = yearRow ? (yearRow.confidence || scenarioBranch.confidence || 'medium') : (branchPred ? branchPred.confidence : 'pending');
      els.impactLensLegend.innerHTML =
        '<span style="color:' + def.color + '">' + def.label + ' impact</span>' +
        '<span class="impact-lens-bar" style="color:' + def.color + '"></span>' +
        '<span class="impact-lens-confidence-dot ' + conf + '" title="Prediction confidence: ' + conf + '"></span>';
    }
    // Similar events overlay (driven by latest placed building, fallback to first)
    updateSimilarEventsOverlay();
  }

  function updateSimilarEventsOverlay() {
    if (!els.similarEvents || !els.similarEventsList) return;
    if (state.mode !== 'simulation' || !window.BelfastPredictor || !window.BelfastPredictor.isReady()) {
      els.similarEvents.hidden = true;
      return;
    }
    const branch = activeBranch();
    if (!branch) { els.similarEvents.hidden = true; return; }
    const buildings = branch.items.filter(it => it.type === 'building');
    if (!buildings.length) { els.similarEvents.hidden = true; return; }
    const focus = buildings.find(b => b.id === state.lastPlacedItemId) || buildings[buildings.length - 1];
    const similar = window.BelfastPredictor.similarEvents(focus, 4);
    if (!similar.length) { els.similarEvents.hidden = true; return; }
    els.similarEvents.hidden = false;
    const pred = window.BelfastPredictor.predictForBuilding(focus, state.year);
    if (els.similarEventsConf && pred) {
      els.similarEventsConf.textContent = pred.totalNearby + ' nearby events · ' + pred.confidence;
    }
    els.similarEventsList.innerHTML = similar.map((s, i) => {
      const distLabel = s.distM < 1000 ? (s.distM + 'm') : ((s.distM / 1000).toFixed(1) + 'km');
      const title = (s.title || 'Past event').replace(/</g, '&lt;');
      const area = (s.area || '').replace(/</g, '&lt;');
      return '<div class="similar-event" data-idx="' + i + '" data-lng="' + (s.coordinates ? s.coordinates[0] : '') + '" data-lat="' + (s.coordinates ? s.coordinates[1] : '') + '">' +
               '<div class="similar-event-title">' + title + (area ? ' · ' + area : '') + '</div>' +
               '<div class="similar-event-meta">' +
                 '<span class="se-year">' + (s.year || '—') + '</span>' +
                 '<span>' + (s.signal || '') + '</span>' +
                 '<span class="se-dist">' + distLabel + '</span>' +
               '</div>' +
             '</div>';
    }).join('');
    els.similarEventsList.querySelectorAll('.similar-event').forEach(el => {
      el.addEventListener('click', () => {
        const lng = parseFloat(el.getAttribute('data-lng'));
        const lat = parseFloat(el.getAttribute('data-lat'));
        if (Number.isFinite(lng) && Number.isFinite(lat) && state.map) {
          state.map.flyTo({ center: [lng, lat], zoom: 15.5, duration: 700 });
        }
      });
    });
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
    attachBranchPickerEvents();
    attachBranchMenuEvents();
    attachNodeMenuEvents();
    attachTopNav();
    attachBottomNav();

    if (els.newBranchBtn) els.newBranchBtn.addEventListener('click', openNewBranchModal);
    if (els.runBtn) els.runBtn.addEventListener('click', runSimulation);
    if (els.compareBtn) els.compareBtn.addEventListener('click', openCompareModal);
    if (els.exportBtn) els.exportBtn.addEventListener('click', exportResults);
    if (els.scenarioDiffBtn) els.scenarioDiffBtn.addEventListener('click', openScenarioDiffModal);
    if (els.splitCloseBtn) els.splitCloseBtn.addEventListener('click', closeWorkspaceSplit);
    if (els.showAllBtn) els.showAllBtn.addEventListener('click', () => {
      openCompareModal();
    });
    if (els.collapseBtn) els.collapseBtn.addEventListener('click', toggleBottomCollapse);
    attachPostcodeSearch();
    attachTrafficSim();
    attachRoadCompare();
    attachLeftSidebar();

    // Apply persisted collapse state. Mode is now derived from the year — see
    // setYear()'s auto-mode logic. We just need to make sure the persisted
    // mode matches the persisted year so historical UI shows up correctly on
    // first paint.
    applyBottomCollapse();
    state.mode = state.year <= BASE_YEAR ? 'historical' : 'simulation';
    if (state.mode === 'historical') {
      setMode('historical');
    }
    syncTopNavForMode();

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
        if (modal) {
          if (modal.id === 'diffModal') closeDiffModal();
          else modal.hidden = true;
        }
      });
    });
    // Esc to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal').forEach(m => {
          if (m.id === 'diffModal' && !m.hidden) closeDiffModal();
          else m.hidden = true;
        });
        closeMenus();
        if (state.activeTool) {
          state.activeTool = null;
          state.pendingRoadStart = null;
          renderModify();
        }
      }
    });

    // Initial top-nav sync (driven by year, not by user clicks any more)
    syncTopNavForMode();

    // Kick off the impact predictor's data load in parallel — it fetches the
    // past-events catalog once (5 signals × ~5K events each) and powers all
    // building impact predictions.
    if (window.BelfastPredictor) {
      window.BelfastPredictor.loadAllSignals().then(() => {
        state.predictorReady = true;
        if (state.mode === 'simulation') {
          updateImpactRipples();
          updateImpactLensUI();
        }
      });
    }

    // Map last so the rest of the UI is alive even if Mapbox fails. Run
    // historical + forecast fetches in parallel with the manifest fetch —
    // manifest blocks map init (we need the Mapbox token), but the data
    // fetches can keep going while Mapbox boots its WebGL context.
    const histPromise = loadHistorical();
    const forecastPromise = loadForecastData();
    await loadManifest();
    initMap();
    await Promise.all([histPromise, forecastPromise]);

    // Expose for debugging / smoke tests
    window.BelfastDashboard = {
      state: state,
      setYear: setYear,
      setView: setView,
      setMode: setMode,
      setLens: setLens,
      addItemAt: addItemAt,
      addRoadItem: addRoadItem,
      removeItem: removeItem,
      runSimulation: runSimulation,
      openCompareModal: openCompareModal,
      openDiffModal: openDiffModal,
      openScenarioDiffModal: openScenarioDiffModal,
      selectEvent: selectEvent,
      createBranch: createBranch,
      deleteBranch: deleteBranch,
      activeBranch: activeBranch,
      metricsForBranchYear: metricsForBranchYear,
      eventsForCurrentYearAndLens: eventsForCurrentYearAndLens,
      loadEventsForYearLens: loadEventsForYearLens,
      toggleBottomCollapse: toggleBottomCollapse,
      startTrafficSim: startTrafficSim,
      stopTrafficSim: stopTrafficSim
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
