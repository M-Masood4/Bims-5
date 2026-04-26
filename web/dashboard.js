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
  const TRANSFORMER_ICON_SVG =
    '<svg class="transformer-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 6h16"/><path d="M7 6v4"/><path d="M17 6v4"/>' +
    '<rect x="7" y="10" width="10" height="7" rx="1.8"/>' +
    '<path d="M10 13h4"/><path d="M12 3v3"/><path d="M12 17v4"/>' +
    '<path d="M8 21h8"/><path d="M15 11l-4 5h4l-3 4"/>' +
    '</svg>';

  const TOOL_LABELS = {
    building: 'Click on the map to place a building',
    road: 'Click two points on the map to place a road',
    park: 'Click on the map to place a park',
    infrastructure: 'Click on the map to place a transformer',
    remove: 'Click a staged item or existing city building to remove it'
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
    historicalMetrics: null, // { 2016: { traffic, jobs, electricity, buildings, services/public transit }, ... }
    summaryData: null,
    baselineForecast: null,
    trendBaselineData: null,
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
    lens: 'buildings',              // traffic | jobs | electricity | buildings | services (public transit)
    gridCache: {},                  // year -> grid GeoJSON
    contextLayersAdded: false,
    contextLayersData: {},          // layerId -> geojson
    activeEventId: null,            // commit/event id when one is selected
    eventsForYearCache: null,       // cached events for current year+lens
    // Predicted-impact ripple visualisation
    impactMetric: 'buildings',      // which forecast metric the map paints; kept in lock-step with state.lens
    impactLayersAdded: false,
    lastPlacedItemId: null,         // for similar-events overlay focus
    predictorReady: false,
    selectedPostcode: null,
    lastScenarioResult: null,
    buildabilityLoaded: false,
    buildabilityLoading: false,
    buildabilityPostcodeKey: null,
    buildabilityFocus: null,
    cityBuildingSelectionAttached: false
  };

  // Lens definitions (the 5 historical signals)
  const LENSES = [
    { id: 'traffic',     label: 'Traffic',     color: '#fb923c', goodDirection: 'down', valueProp: 'traffic',     deltaProp: 'traffic_delta_previous',     contextLayer: 'source-ni-roads-osm' },
    { id: 'jobs',        label: 'Jobs',        color: '#a855f7', goodDirection: 'up',   valueProp: 'jobs',        deltaProp: 'jobs_delta_previous',        contextLayer: null },
    { id: 'buildings',   label: 'Buildings',   color: '#3b82f6', goodDirection: 'up',   valueProp: 'buildings',   deltaProp: 'buildings_delta_previous',   contextLayer: 'belfast-ni-buildings-3d' },
    { id: 'electricity', label: 'Electricity', color: '#06b6d4', goodDirection: 'down', valueProp: 'electricity', deltaProp: 'electricity_delta_previous', contextLayer: 'source-ni-power-grid-osm' },
    { id: 'services',    label: 'Public Transit', color: '#22c55e', goodDirection: 'up', valueProp: 'services',    deltaProp: 'services_delta_previous',    contextLayer: 'pt-stop-core' }
  ];

  function lensDef(id) { return LENSES.find(l => l.id === id) || LENSES.find(l => l.id === DEFAULT_LENS) || LENSES[0]; }

  const SCENARIO_DIFF_LENSES = [
    { id: 'traffic', label: 'Traffic', source: 'traffic', color: '#fb923c', goodDirection: 'down' },
    { id: 'jobs', label: 'Jobs', source: 'jobs', color: '#a855f7', goodDirection: 'up' },
    { id: 'buildings', label: 'Buildings', source: 'population', color: '#3b82f6', goodDirection: 'up' },
    { id: 'electricity', label: 'Electricity', source: 'electricity', color: '#06b6d4', goodDirection: 'down' },
    { id: 'services', label: 'Public Transit', source: 'services', color: '#22c55e', goodDirection: 'up' }
  ];
  const DEFAULT_LENS = 'buildings';
  // T1.6: include "buildings" so the default lens is a visible chip,
  // not an invisible state.
  const LENS_FILTER_IDS = ['buildings', 'traffic', 'jobs', 'electricity', 'services'];
  const BELFAST_CENTER = [-5.9301, 54.5973];
  const PLANNING_ENGINES = [
    { id: 'traffic', label: 'Traffic', color: '#fb923c', objective: 'traffic_mitigation' },
    { id: 'jobs', label: 'Jobs', color: '#a855f7', objective: 'jobs_optimised' },
    { id: 'electricity', label: 'Transformer', color: '#06b6d4', objective: 'balanced' },
    { id: 'services', label: 'Public Transit', color: '#22c55e', objective: 'traffic_mitigation' }
  ];

  const els = {};

  // ---------- HELPERS ----------

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function uid(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round(v, d) { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  const DASH_M_PER_DEG_LAT = 111320;
  const DASH_M_PER_DEG_LNG = 111320 * Math.cos(54.6 * Math.PI / 180);
  function coordDistKm(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
    const dx = (Number(a[0]) - Number(b[0])) * DASH_M_PER_DEG_LNG;
    const dy = (Number(a[1]) - Number(b[1])) * DASH_M_PER_DEG_LAT;
    return Math.hypot(dx, dy) / 1000;
  }

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

  function isSimYear(y) { return y >= START_YEAR && y <= FINAL_YEAR; }

  function activeBranch() { return state.branches.find(b => b.id === state.activeBranchId) || state.branches[0]; }

  function activityColor(type) {
    if (type === 'simulation') return '#22c55e';
    if (type === 'diff') return '#3b82f6';
    if (type === 'road') return '#22d3ee';
    if (type === 'planner') return '#a855f7';
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
    if (!branchRow) return target.baseline;
    const cityBaseline = baselineForecastMetrics(year);
    const diff = branchRow.diffFromBaseline || {};
    const totalCells = state.baselineForecast && Array.isArray(state.baselineForecast.cells)
      ? state.baselineForecast.cells.length
      : 0;
    const affectedCells = Array.isArray(result.contextCellIds) ? result.contextCellIds.length : 0;
    if (!cityBaseline || !totalCells || !affectedCells) return branchRow.metrics;
    const weight = clamp(affectedCells / totalCells, 0, 1);
    const citywide = Object.assign({}, cityBaseline);
    Object.keys(diff).forEach(metric => {
      const base = Number(citywide[metric]);
      const delta = Number(diff[metric]);
      if (Number.isFinite(base) && Number.isFinite(delta)) citywide[metric] = clamp(base + delta * weight, 0, 1.5);
    });
    return citywide;
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
    const plannerEngine = PLANNING_ENGINES.find(engine => engine.id === branch.plannerEngine);
    if (plannerEngine && plannerEngine.objective) return plannerEngine.objective;
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
      if (data.selectedPostcode && data.selectedPostcode.canPlace) state.selectedPostcode = data.selectedPostcode;
      // Don't restore active tool — fresh start each session

      // Filters are session-local: every load starts from the Buildings view,
      // and active filter buttons can temporarily override it.
      state.lens = DEFAULT_LENS;
      state.impactMetric = DEFAULT_LENS;
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
      'impactTitle', 'impactStack', 'scenarioIntegrityHost',
      'newBranchBtn', 'branchSelect', 'branchList',
      'tlBranchName', 'branchTimelineSvg',
      'runBtn', 'runBtnLabel', 'compareBtn', 'activeBranchName', 'activeYearLabel', 'exportBtn',
      'exportModal', 'exportForm', 'exportBranchA', 'exportBranchB', 'exportBranchBWrap', 'exportStatus', 'exportGenerateBtn',
      'compareModal', 'compareYear', 'compareBody',
      'inspectModal', 'inspectTitle', 'inspectBody',
      'diffModal', 'diffTitle', 'diffBody', 'diffMeta', 'diffYearBefore', 'diffYearAfter',
      'lensTabs', 'collapseBtn',
      'mapSearch', 'postcodeForm', 'postcodeInput', 'mapSearchStatus', 'mapSearchSuggest', 'scenarioDiffBtn',
      'branchMenu', 'nodeMenu',
      'toast', 'topNav', 'viewToggle',
      'impactLens', 'impactLensTabs', 'impactLensYear', 'impactLensLegend',
      'similarEvents', 'similarEventsList', 'similarEventsConf',
      'workspaceSplit', 'splitCloseBtn', 'splitTitle',
      'splitYearBefore', 'splitYearAfter', 'splitSummary',
      'trafficSimSection', 'trafficSimToggle', 'trafficSimToggleLabel',
      'trafficSimDensity', 'trafficSimDensityVal', 'trafficSimSpeed', 'trafficSimSpeedVal',
      'trafficSimStats', 'trafficSimVehicles', 'trafficSimSpeedStat', 'trafficSimCongested',
      'roadCompareModal', 'roadCompareName',
      'roadCompareProgress', 'roadCompareProgressFill', 'roadCompareProgressLabel',
      'roadCompareResult', 'roadCompareMapBefore', 'roadCompareMapAfter',
      'rcSpeedBefore', 'rcSpeedAfter', 'rcSpeedDelta', 'rcSpeedArrow',
      'rcCongBefore', 'rcCongAfter', 'rcCongDelta', 'rcCongArrow',
      'rcFlowBefore', 'rcFlowAfter', 'rcFlowDelta', 'rcFlowArrow',
      'rcUsage', 'roadCompareSummary',
      'planRoadHint', 'planRoadStep', 'planRoadCancel',
      // T2.1 mode banner
      'modeBanner', 'modeBannerJump',
      // T3.4 / T3.1 toolbar undo + help buttons
      'undoBtn', 'helpBtn',
      // T3.2 planner-variations CTA
      'plannerVariationsBtn',
      // T4.1 sim progress overlay
      'simProgress', 'simProgressLabel', 'simProgressFill', 'simProgressCancel',
      // T4.3 buildability legend
      'buildabilityLegend', 'buildabilityLegendSwatch', 'buildabilityLegendLabel',
      // New light-theme layout
      'leftSidebarTitle', 'leftSidebarSubtitle', 'leftSidebarFilter', 'leftSidebarList', 'selectedEventSummary',
      'timelineYears', 'timelineDots', 'timelineFilled'
    ];
    ids.forEach(id => { els[id] = document.getElementById(id); });
    els.mapCanvas = document.querySelector('.map-wrapper') || document.querySelector('.map-canvas');
    els.modifyButtons = els.modifyList ? els.modifyList.querySelectorAll('.tool-btn, .modify-btn') : [];
    els.viewToggleButtons = document.querySelectorAll('.map-ctrl-btn[data-view], .toolbar-view-btn[data-view]');
    els.bottomTabs = document.querySelectorAll('.bn-btn');
    els.topTabs = els.topNav ? els.topNav.querySelectorAll('.nav-btn') : [];
    ensureToolbarLensHost();
  }

  function ensureToolbarLensHost() {
    if (els.lensTabs && document.body.contains(els.lensTabs)) return els.lensTabs;
    // Reuse the static lensTabs node if the HTML already provides one
    // (otherwise we'd duplicate the chip strip). T1.7.
    const existing = document.getElementById('lensTabs');
    if (existing) {
      els.lensTabs = existing;
      return existing;
    }
    const toolbarRight = document.querySelector('.toolbar-right');
    if (!toolbarRight) return null;
    const host = document.createElement('div');
    host.id = 'lensTabs';
    host.className = 'right-tabs';
    host.setAttribute('role', 'tablist');
    host.setAttribute('aria-label', 'Forecast filters');
    toolbarRight.insertBefore(host, toolbarRight.firstChild);
    els.lensTabs = host;
    return host;
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
      syncTransitForecastData();
    } catch (e) {
      console.warn('forecast fetch failed', e);
    }
    try {
      const res = await fetch('/data/mode-a/trend_baseline_branch.json');
      if (!res.ok) throw new Error('trend baseline fetch ' + res.status);
      applyTrendBaselineBranch(await res.json());
    } catch (e) {
      console.warn('trend baseline fetch failed', e);
    }
  }

  function applyTrendBaselineBranch(payload) {
    if (!payload || payload.kind !== 'belfast.trendBaselineBranch' || !payload.branch) return false;
    const branch = clone(payload.branch);
    branch.id = 'baseline';
    branch.locked = true;
    branch.parentId = null;
    branch.trendBaseline = true;
    branch.items = Array.isArray(branch.items) ? branch.items : [];
    branch.activityLog = Array.isArray(branch.activityLog) ? branch.activityLog : [];
    branch.scenarioResult = null;
    branch._scenarioPending = null;
    state.trendBaselineData = payload;
    const existingIndex = state.branches.findIndex(b => b.id === 'baseline');
    if (existingIndex >= 0) {
      state.branches[existingIndex] = Object.assign({}, state.branches[existingIndex], branch);
    } else {
      state.branches.unshift(branch);
    }
    if (!state.branches.find(b => b.id === state.activeBranchId)) {
      state.activeBranchId = 'baseline';
    }
    return true;
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
      syncCityBuildingHeightContext();
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
      // Google-Maps-style placement UX (drag-and-drop, hover preview,
      // ripple animation, keyboard shortcuts, drag-to-relocate placed items).
      if (window.MapUX && typeof window.MapUX.init === 'function') {
        window.MapUX.init({ map: state.map });
      }
      // Public transport engine: paints Belfast OSM stops and forecast deltas.
      if (window.TransitEngine && typeof window.TransitEngine.init === 'function') {
        window.TransitEngine.init({ map: state.map });
        syncTransitForecastData();
        if (typeof window.TransitEngine.preload === 'function') {
          window.TransitEngine.preload('/api/layers/2026/source-ni-transport-stops-osm')
            .then(() => { refreshTransitLayer(); });
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

  function roundedCanvasRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function ensureTransformerMarkerImage() {
    if (!state.map || (state.map.hasImage && state.map.hasImage('transformer-marker'))) return;
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, 48, 48);
    ctx.save();
    ctx.shadowColor = 'rgba(15, 23, 42, 0.45)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;

    ctx.strokeStyle = '#7c2d12';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(24, 5);
    ctx.lineTo(24, 43);
    ctx.moveTo(8, 9);
    ctx.lineTo(40, 9);
    ctx.moveTo(16, 9);
    ctx.lineTo(16, 14);
    ctx.moveTo(32, 9);
    ctx.lineTo(32, 14);
    ctx.stroke();

    ctx.fillStyle = '#fed7aa';
    [11, 37].forEach(x => {
      ctx.beginPath();
      ctx.arc(x, 9, 3.2, 0, Math.PI * 2);
      ctx.fill();
    });

    roundedCanvasRect(ctx, 12, 15, 24, 19, 5);
    ctx.fillStyle = '#f59e0b';
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = '#fff7ed';
    ctx.stroke();

    ctx.strokeStyle = '#fff7ed';
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.moveTo(19, 19);
    ctx.lineTo(14, 27);
    ctx.lineTo(21, 27);
    ctx.lineTo(17, 35);
    ctx.stroke();

    ctx.strokeStyle = '#7c2d12';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(17, 34);
    ctx.lineTo(12, 42);
    ctx.moveTo(31, 34);
    ctx.lineTo(36, 42);
    ctx.stroke();
    ctx.restore();

    try {
      state.map.addImage('transformer-marker', ctx.getImageData(0, 0, 48, 48), { pixelRatio: 2 });
    } catch (error) {
      if (!/already exists/i.test(String(error && error.message))) console.warn('transformer marker image', error);
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

    ensureTransformerMarkerImage();
    state.map.addLayer({
      id: 'items-infra-halo',
      type: 'circle',
      source: 'items-points',
      filter: ['==', ['get', 'type'], 'infrastructure'],
      paint: {
        'circle-radius': 15,
        'circle-color': '#0f172a',
        'circle-opacity': 0.34,
        'circle-stroke-color': '#fbbf24',
        'circle-stroke-width': 1.5,
        'circle-stroke-opacity': 0.85
      }
    });

    // Transformer marker: pole, body and coil lines so it does not read as a building.
    state.map.addLayer({
      id: 'items-infra-circle',
      type: 'circle',
      source: 'items-points',
      filter: ['==', ['get', 'type'], 'infrastructure'],
      paint: {
        'circle-radius': 13,
        'circle-color': '#f59e0b',
        'circle-stroke-color': '#f59e0b',
        'circle-stroke-width': 2,
        'circle-opacity': 0.28
      }
    });
    state.map.addLayer({
      id: 'items-infra-symbol',
      type: 'symbol',
      source: 'items-points',
      filter: ['==', ['get', 'type'], 'infrastructure'],
      layout: {
        'icon-image': 'transformer-marker',
        'icon-size': 1,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true
      },
      paint: { 'icon-opacity': 0.98 }
    });

    // Building markers (overlaid for 2D mode and labelling)
    state.map.addLayer({
      id: 'items-buildings-circle',
      type: 'circle',
      source: 'items-points',
      filter: ['match', ['get', 'type'], ['building', 'building_removal'], true, false],
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
    ['items-buildings-circle', 'items-parks-circle', 'items-infra-circle', 'items-infra-symbol', 'items-roads-line', 'items-buildings-3d']
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

  function buildingConfigForExisting(itemOrProps) {
    const props = itemOrProps && itemOrProps.properties ? itemOrProps.properties : (itemOrProps || {});
    const footprint = Number(props.footprint_area_m2 || props.footprintSqm || props.footprint_sqm) || 900;
    const height = Number(props.replay_height_m || props.height || 0);
    const floors = Math.max(1, Math.round(height ? height / 3.8 : Number(props.floors || props['building:levels'] || 6)));
    const buildingTag = String(props.building || '').toLowerCase();
    const buildingType = /office|commercial|retail|hotel/.test(buildingTag)
      ? 'office'
      : /industrial|manufacture|warehouse/.test(buildingTag)
        ? 'office'
        : 'apartments';
    return {
      size: 'custom',
      buildingType,
      affordabilityMix: 'market',
      floors,
      footprintSqm: Math.max(120, Math.round(footprint)),
      energyStandard: 'standard',
      parkingTransitAssumption: 'balanced',
      mitigation: { green: false, mobility: false, energy: false }
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
      year: clamp(state.year || START_YEAR, START_YEAR, FINAL_YEAR),
      createdAt: new Date().toISOString(),
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
    closeWorkspaceSplit();
    if (state.year < START_YEAR) setYear(START_YEAR);
    afterChange();
    triggerEpicentrePulse(item);
    pushUndo({
      type: 'add',
      label: 'Add ' + item.label + ' at ' + item.postcode,
      do: () => {
        const b = state.branches.find(x => x.id === branch.id);
        if (!b) return;
        b.items = b.items.filter(it => it.id !== item.id);
        b.scenarioResult = null;
        b.scenarioStaged = true;
        afterChange();
      }
    });
    toast('Staged ' + item.label + ' at ' + item.postcode + '. Click Run Simulation to calculate the forecast.');
  }

  function ensureEditableBranch() {
    const current = activeBranch();
    if (current && !current.locked) return current;
    // T2.3: stop silently switching the active branch out from under the
    // user. Surface a one-shot prompt that lets them pick which branch the
    // edit should land on (or create a new one). Returning null aborts the
    // current edit; the prompt promises to retry it on the user's choice.
    showEditableBranchPicker();
    return null;
  }

  // Re-entrancy guard so a click storm only opens one picker.
  let __editableBranchPickerOpen = false;
  // The most recent edit attempt that was blocked because the active branch
  // was locked. Replayed when the user picks a target branch.
  let __pendingLockedEdit = null;
  function rememberLockedEdit(fn, label) {
    __pendingLockedEdit = { fn: fn, label: label || 'edit', queuedAt: Date.now() };
  }
  function replayLockedEdit() {
    const pending = __pendingLockedEdit;
    __pendingLockedEdit = null;
    if (!pending) return;
    if (Date.now() - pending.queuedAt > 30000) return; // stale
    try { pending.fn(); } catch (e) { console.warn('replayLockedEdit failed', e); }
  }

  function showEditableBranchPicker() {
    if (__editableBranchPickerOpen) return;
    const unlocked = state.branches.filter(b => !b.locked);
    // No unlocked branch exists at all — creating one is the only choice.
    if (!unlocked.length) {
      __editableBranchPickerOpen = true;
      const created = createBranch('New Scenario', '#22c55e', activeBranch() ? activeBranch().id : 'baseline');
      __editableBranchPickerOpen = false;
      toast('Created scenario branch "' + created.name + '" — Baseline is read-only.', 'info');
      replayLockedEdit();
      return;
    }
    __editableBranchPickerOpen = true;
    const lockedName = (activeBranch() && activeBranch().name) || 'Baseline';
    const optionsHtml = unlocked.map(b =>
      '<button type="button" class="lbp-option" data-branch-id="' + escapeHtml(b.id) + '">' +
        '<span class="lbp-dot" style="background:' + (b.color || '#3b82f6') + '"></span>' +
        '<span class="lbp-name">' + escapeHtml(b.name || 'Branch') + '</span>' +
        '<span class="lbp-count">' + ((b.items || []).length) + ' item' + ((b.items || []).length === 1 ? '' : 's') + '</span>' +
      '</button>'
    ).join('');
    const overlay = document.createElement('div');
    overlay.className = 'locked-branch-picker-overlay';
    overlay.innerHTML =
      '<div class="locked-branch-picker" role="dialog" aria-modal="true" aria-label="Choose a branch to edit">' +
        '<div class="lbp-head">' +
          '<strong>' + escapeHtml(lockedName) + ' is read-only</strong>' +
          '<span>Pick a branch to receive this change, or create a new one.</span>' +
        '</div>' +
        '<div class="lbp-options">' + optionsHtml + '</div>' +
        '<div class="lbp-foot">' +
          '<button type="button" class="lbp-new" id="lbpNewBtn">+ New branch from ' + escapeHtml(lockedName) + '</button>' +
          '<button type="button" class="lbp-cancel" id="lbpCancelBtn">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    const cleanup = () => {
      overlay.remove();
      __editableBranchPickerOpen = false;
      __pendingLockedEdit = null;
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
    document.addEventListener('keydown', function escClose(e) {
      if (e.key === 'Escape') { cleanup(); document.removeEventListener('keydown', escClose); }
    });
    overlay.querySelectorAll('.lbp-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-branch-id');
        const target = state.branches.find(b => b.id === id);
        if (!target) { cleanup(); return; }
        state.activeBranchId = target.id;
        renderBranches();
        renderActiveInfo();
        renderMapSubtitle();
        toast('Switched to ' + target.name + '.', 'info');
        overlay.remove();
        __editableBranchPickerOpen = false;
        replayLockedEdit();
      });
    });
    overlay.querySelector('#lbpNewBtn').addEventListener('click', () => {
      const parentId = activeBranch() ? activeBranch().id : 'baseline';
      const created = createBranch('New Scenario', '#22c55e', parentId);
      overlay.remove();
      __editableBranchPickerOpen = false;
      toast('Created branch "' + created.name + '". Edit is now safe to retry.', 'info');
      replayLockedEdit();
    });
    overlay.querySelector('#lbpCancelBtn').addEventListener('click', cleanup);
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
    // Validation runs in the background but never blocks placement — the
    // building always lands exactly where the cursor was.
    let validation = null;
    try {
      validation = await validateMapPlacement(lng, lat, config);
    } catch (error) {
      validation = { status: 'invalid', warnings: [error && error.message].filter(Boolean) };
    }
    const item = {
      id: 'item-' + (state.nextItemId++),
      type: 'building',
      year: clamp(state.year || START_YEAR, START_YEAR, FINAL_YEAR),
      createdAt: new Date().toISOString(),
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
    closeWorkspaceSplit();
    if (state.year < START_YEAR) setYear(START_YEAR);
    afterChange();
    triggerEpicentrePulse(item);
    pushUndo({
      type: 'add',
      label: 'Add ' + item.label,
      do: () => {
        const b = state.branches.find(x => x.id === branch.id);
        if (!b) return;
        b.items = b.items.filter(it => it.id !== item.id);
        b.scenarioResult = null;
        b.scenarioStaged = true;
        afterChange();
      }
    });
    toast('Staged ' + item.label + ' at ' + branchItemDetail(item) + '. Click Run Simulation to calculate the forecast.');
  }

  function addItemAt(type, lng, lat) {
    const branch = ensureEditableBranch();
    if (!branch || branch.locked) {
      // T2.3: queue this same edit so the user's pick in the picker can
      // replay it without forcing them to re-click the map.
      rememberLockedEdit(() => addItemAt(type, lng, lat), 'add ' + type);
      return;
    }
    if (type === 'building') {
      // Always place at the cursor's lng/lat — no postcode override. The
      // selected postcode (if any) is used for context only.
      return addBuildingAtMapPoint(branch, lng, lat);
    }
    const item = {
      id: 'item-' + (state.nextItemId++),
      type: type,
      year: state.year,
      createdAt: new Date().toISOString(),
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
      item.label = 'Transformer';
      item.assetClass = 'secondary';
      item.capacityKva = 500;
      item.voltageKv = 11;
      item.serviceRadiusM = 650;
    }
    branch.items.push(item);
    branch.scenarioResult = null;
    branch.scenarioStaged = true;
    if (state.lastScenarioResult && state.activeBranchId === branch.id) state.lastScenarioResult = null;
    state.lastPlacedItemId = item.id;
    closeWorkspaceSplit();
    afterChange();
    if (item.type === 'building') triggerEpicentrePulse(item);
    // T3.4: register an undo entry for this addition.
    pushUndo({
      type: 'add',
      label: 'Add ' + (item.label || type),
      do: () => {
        const b = state.branches.find(x => x.id === branch.id);
        if (!b) return;
        b.items = b.items.filter(it => it.id !== item.id);
        b.scenarioResult = null;
        b.scenarioStaged = true;
        afterChange();
      }
    });
    toast('Added ' + (item.label || type) + ' to ' + branch.name);
  }

  async function runScenarioForBranch(branch, item, opts) {
    const building = item || selectedScenarioBuilding(branch);
    if (!building) return null;
    if (branch._scenarioPending) return branch._scenarioPending;
    const removalScenario = building.type === 'building_removal';
    const signal = opts && opts.signal ? opts.signal : undefined;
    branch._scenarioPending = fetch('/api/scenario-studio/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: signal,
      body: JSON.stringify({
        postcode: building.postcode,
        building: {
          id: building.id,
          type: removalScenario ? 'building_removal' : 'building',
          interventionType: removalScenario ? 'building_removal' : 'building',
          removal: removalScenario,
          postcode: building.postcode,
          location: { lng: building.lng, lat: building.lat },
          geometry: building.geometry,
          existingBuildingId: building.existingBuildingId,
          existingBuildingName: building.existingBuildingName,
          config: building.buildingConfig || buildingConfigForPreset(building.preset),
          year: building.year || START_YEAR,
          startYear: building.year || START_YEAR,
          delivery: { startYear: building.year || START_YEAR, completionYear: FINAL_YEAR }
        },
        branch: {
          id: branch.id,
          name: branch.name,
          objective: objectiveForBranch(branch)
        },
        branches: removalScenario ? removalScenarioBranches(building) : undefined,
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
        branch.solana = null;
        state.lastScenarioResult = json;
        renderImpact();
        renderBranches();
        updateImpactRipples();
        updateImpactLensUI();
        updateScenarioDiffButton();
        return json;
      })
      .catch(err => {
        // T4.1: AbortError is a deliberate user cancel — don't surface it as
        // a scary "Scenario run failed" toast.
        if (err && (err.name === 'AbortError' || err.code === 20)) {
          return null;
        }
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
    if (!branch) return null;
    const buildings = (branch.items || []).filter(it =>
      it.type === 'building' &&
      (it.postcode || (Number.isFinite(Number(it.lng)) && Number.isFinite(Number(it.lat))))
    );
    const removals = (branch.items || []).filter(it =>
      it.type === 'building_removal' &&
      Number.isFinite(Number(it.lng)) &&
      Number.isFinite(Number(it.lat))
    );
    if (!buildings.length && !removals.length) return null;
    const latest = buildings.find(it => it.id === state.lastPlacedItemId);
    const latestRemoval = removals.find(it => it.id === state.lastPlacedItemId);
    return latest || latestRemoval || buildings[buildings.length - 1] || removals[removals.length - 1];
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
      const actionLabel = isBuildingRemovalItem(building) ? 'after-removal' : 'with-building';
      els.scenarioDiffBtn.textContent = 'View Diff';
      els.scenarioDiffBtn.title = 'Open no-build vs ' + actionLabel + ' 3D diff for ' + (building.postcode || 'selected map point') + ' in ' + year;
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
      createdAt: new Date().toISOString(),
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
    state.lastPlacedItemId = item.id;
    closeWorkspaceSplit();
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
    if (item.type === 'building_removal' && Number.isFinite(Number(item.lng)) && Number.isFinite(Number(item.lat))) {
      return {
        id: item.id,
        type: 'building_removal',
        location: { lng: item.lng, lat: item.lat },
        geometry: item.geometry,
        existingBuildingId: item.existingBuildingId,
        existingBuildingName: item.existingBuildingName,
        config: item.buildingConfig || buildingConfigForExisting(item),
        year: item.year || START_YEAR,
        startYear: item.year || START_YEAR,
        delivery: { startYear: item.year || START_YEAR, completionYear: FINAL_YEAR },
        rationale: 'Existing city building selected for removal in the active branch.'
      };
    }
    if (item.type === 'building' && Number.isFinite(Number(item.lng)) && Number.isFinite(Number(item.lat))) {
      return {
        id: item.id,
        type: 'building',
        location: { lng: item.lng, lat: item.lat },
        postcode: item.postcode,
        config: item.buildingConfig || buildingConfigForPreset(item.preset),
        year: item.year || START_YEAR,
        startYear: item.year || START_YEAR,
        delivery: { startYear: item.year || START_YEAR, completionYear: FINAL_YEAR },
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
        mode: item.plannerMode || 'road_capacity',
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
        assetClass: item.assetClass || 'secondary',
        capacityKva: item.capacityKva || 500,
        voltageKv: item.voltageKv || 11,
        serviceRadiusM: item.serviceRadiusM || item.radiusM || 650,
        radiusM: item.serviceRadiusM || item.radiusM || 650,
        year: item.year || START_YEAR,
        rationale: 'User-staged transformer included in electricity headroom and jobs screening.'
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

  function removalScenarioBranches(building) {
    const intervention = {
      id: building.id,
      type: 'building_removal',
      location: { lng: building.lng, lat: building.lat },
      geometry: building.geometry,
      existingBuildingId: building.existingBuildingId,
      existingBuildingName: building.existingBuildingName,
      config: building.buildingConfig || buildingConfigForExisting(building),
      year: building.year || START_YEAR,
      startYear: building.year || START_YEAR,
      delivery: { startYear: building.year || START_YEAR, completionYear: FINAL_YEAR },
      rationale: 'Runs exactly the existing-building removal selected on the map.'
    };
    const location = intervention.location;
    return {
      scenario_variants: [
        {
          branchName: 'Selected Building Removed',
          objective: 'user_proposal',
          description: 'Removes the selected existing city building and compares the 2036 branch against the no-build forecast.',
          interventions: [intervention],
          assumptions: ['Removal is modelled as reduced activity, trips and electricity demand around the selected footprint.']
        },
        {
          branchName: 'Green Reuse After Removal',
          objective: 'green_mitigation',
          description: 'Tests whether the cleared site becomes local green mitigation.',
          interventions: [intervention, { type: 'green_corridor', location, radiusM: 520, bufferRadiusM: 520, rationale: 'Reuses the cleared footprint for environmental benefit.' }],
          assumptions: ['Green reuse reduces exposure and improves green score around the site.']
        },
        {
          branchName: 'Access Rebalanced After Removal',
          objective: 'traffic_mitigation',
          description: 'Pairs the removal with a local mobility-access rebalance.',
          interventions: [intervention, { type: 'mobility_corridor', mode: 'transit_first', location, radiusM: 650, rationale: 'Tests lower trip pressure plus better access around the cleared site.' }],
          assumptions: ['Mobility effects are deterministic proxies over nearby forecast cells.']
        }
      ]
    };
  }

  function removeItem(itemId) {
    const branch = activeBranch();
    if (branch.locked) { toast('Baseline is locked.', 'warn'); return; }
    const before = branch.items.length;
    const idx = branch.items.findIndex(it => it.id === itemId);
    if (idx < 0) return;
    const removed = branch.items[idx];
    branch.items = branch.items.filter(it => it.id !== itemId);
    if (branch.items.length !== before) {
      branch.scenarioResult = null;
      branch.scenarioStaged = true;
      if (state.lastScenarioResult && state.activeBranchId === branch.id) state.lastScenarioResult = null;
      afterChange();
      // T3.4 + T3.5: instead of a silent "Item removed" toast, give the
      // user an inline Undo for ~5s. Captures the branch + insert position
      // so the item lands back exactly where it was.
      pushUndo({
        type: 'remove',
        label: branchItemTitle(removed),
        do: () => {
          const b = state.branches.find(x => x.id === branch.id);
          if (!b) return;
          if (b.items.some(x => x.id === removed.id)) return;
          b.items.splice(Math.min(idx, b.items.length), 0, removed);
          b.scenarioResult = null;
          b.scenarioStaged = true;
          afterChange();
        }
      });
      toastWithAction('Removed ' + branchItemTitle(removed) + '.', 'Undo', () => undoLast(), { kind: 'warn' });
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

        if (it.type === 'building' || it.type === 'building_removal') {
          const ring = Array.isArray(it.footprint) && it.footprint.length
            ? it.footprint
            : squareRing(it.lng, it.lat, it.type === 'building_removal' ? 34 : 30);
          buildings3d.features.push({
            type: 'Feature',
            properties: { id: it.id, color: it.color, height: it.type === 'building_removal' ? 4 : (it.height || 30) },
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
    traffic: '🛣️', jobs: '💼', electricity: '⚡', buildings: '🏢',
    transit: '🚌', services: '🚌',
    bus: '🚌', metro: '🚇', cycle: '🚲', park: '🌿', star: '⭐', water: '💧', people: '👥',
    home: '🏠', office: '🏢',
  };
  LENS_ICONS.electricity = TRANSFORMER_ICON_SVG;
  const LENS_TINTS = {
    traffic: '#fffbe6', jobs: '#f0eaff', electricity: '#fff5eb',
    buildings: '#eaf4ff', transit: '#edfaf0', services: '#edfaf0',
  };

  function simpleEventKind(ev) {
    const signal = ev && (ev.signal || ev.category || state.lens);
    const title = String((ev && ev.title) || '').toLowerCase();
    const tags = ev && ev.tags ? ev.tags : {};
    const basis = String((ev && (ev.sourceBasis || ev.eventSourceBasis)) || '').toLowerCase();
    if (title.includes('planning approval')) return 'Planning approval';
    if (title.includes('station opened') || basis.includes('station opening')) return 'Station opening';
    if (signal === 'traffic' || tags.highway) return 'Road network change';
    if (signal === 'jobs' || tags.office || tags.shop) return 'Jobs access change';
    if (signal === 'electricity' || tags.power) return 'Grid network change';
    if (signal === 'services' || signal === 'transit' || tags.public_transport || tags.railway) return 'Public transit change';
    if (signal === 'buildings' || tags.building) return 'Building footprint change';
    return 'City change';
  }

  function compactPlaceName(value) {
    let text = String(value || '').replace(/\s+/g, ' ').trim();
    text = text.replace(/\s+BT\d[\dA-Z]?\s*\d[A-Z]{2}\.?$/i, '').trim();
    text = text.replace(/\s+Belfast\.?$/i, '').trim();
    text = text.replace(/\s+Northern Ireland\.?$/i, '').trim();
    if (text.includes(';')) text = text.split(';')[0].trim();
    if (text.length > 42) text = text.slice(0, 39).trim() + '...';
    return text;
  }

  function simpleSourceName(ev) {
    let source = String((ev && (ev.sourceName || ev.eventSourceName)) || (ev && ev.osmChangeset ? 'OpenStreetMap' : '') || '');
    source = source
      .replace('OpenStreetMap / Overpass API', 'OSM')
      .replace(/^OpenStreetMap$/i, 'OSM')
      .replace(/Northern Ireland planning statistics.*$/i, 'NI planning stats')
      .replace(/planning-statistics-\d{4}-\d{2}-dataset\.csv/i, 'NI planning stats');
    return source || 'Belfast event catalogue';
  }

  function planningProposalText(title) {
    return String(title || '')
      .replace(/^.+?\s+planning approval:\s*/i, '')
      .replace(/^proposed\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function planningSiteName(area) {
    const clean = String(area || '')
      .replace(/\s+BT\d[\dA-Z]?\s*\d[A-Z]{2}\.?$/i, '')
      .replace(/\s+Belfast\.?$/i, '')
      .trim();
    if (!clean) return '';
    const segments = clean.split(/\s{2,}|[,;]/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const namedPattern = /(Social Club|Grammar School|Primary School|School|City Hospital|Hospital|House|Centre|Church|College|Station|Library|Clinic|Surgery|Hall)/i;
    const namedSegment = segments.find(s => namedPattern.test(s));
    if (namedSegment) {
      const venue = namedSegment.match(/^(.+?(?:Social Club|Grammar School|Primary School|School|City Hospital|Hospital|House|Centre|Church|College|Station|Library|Clinic|Surgery|Hall))/i);
      return compactPlaceName((venue && venue[1]) || namedSegment);
    }
    return compactPlaceName(segments[0] || clean.replace(/\s+/g, ' '));
  }

  function planningProposalSummary(text) {
    const t = String(text || '').toLowerCase();
    if (/medical|hospital|clinic|health/.test(t)) return 'medical facility';
    if (/classroom|school|primary|grammar/.test(t)) return /extension/.test(t) ? 'school extension' : 'classroom unit';
    if (/telecom|antenna|base station|tower|mast/.test(t)) return 'telecoms upgrade';
    if (/car park|parking/.test(t) && /lift|platform/.test(t)) return 'car park lift';
    if (/church|chapel/.test(t) && /kitchen/.test(t)) return 'church kitchen extension';
    if (/external lift|platform lift|lift to service/.test(t)) return 'access lift';
    if (/mobile|toilet accommodation/.test(t)) return 'modular accommodation';
    if (/social club|main hall|lounge/.test(t)) return 'social club extension';
    if (/first floor/.test(t)) return 'first-floor extension';
    if (/boundary wall/.test(t)) return 'boundary works';
    if (/extension/.test(t)) return 'building extension';
    if (/alteration|alterations/.test(t)) return 'alterations';
    if (/replacement|replace/.test(t)) return 'replacement works';
    if (/development/.test(t)) return 'new development';
    return String(text || 'approval').replace(/[.]+$/, '').slice(0, 34).trim() || 'approval';
  }

  function planningEventTitle(ev, category) {
    const site = planningSiteName(ev && (ev.area || ev.location || ev.placeName));
    const summary = planningProposalSummary(planningProposalText(ev && ev.title));
    const prefix = site || category || 'Planning';
    let title = prefix + ' - ' + summary;
    if (title.length > 58 && site) title = site.slice(0, 34).trim() + ' - ' + summary;
    if (title.length > 58) title = title.slice(0, 55).trim() + '...';
    return title;
  }

  function simpleEventTitle(ev) {
    if (!ev) return 'Event';
    const area = String(ev.area || ev.location || ev.placeName || '').trim();
    let title = String(ev.title || ev.label || area || 'Event').trim();
    const planningMatch = title.match(/^(.+?)\s+planning approval:/i);
    if (planningMatch) {
      return planningEventTitle(ev, capitalise(planningMatch[1].replace(/_/g, ' ').trim()));
    }
    if (/road mapped in OSM/i.test(title) && area) {
      return compactPlaceName(area) + ' update';
    }
    title = title
      .replace(/^Belfast\s+/i, '')
      .replace(/\s+mapped in OSM$/i, '')
      .replace(/\s+road mapped$/i, ' road update')
      .replace(/\s+road$/i, ' road update')
      .replace(/\s+rail station opened$/i, ' station opened');
    if (/^(residential|service|trunk|primary|secondary|tertiary|unclassified) road/i.test(title) && area) {
      title = area + ' road update';
    }
    if (title.length > 58) title = title.slice(0, 55).trim() + '...';
    return title;
  }

  function simpleEventSubtitle(ev) {
    if (!ev) return '';
    const bits = [simpleEventKind(ev)];
    const place = compactPlaceName(ev.area || ev.location || ev.placeName || '');
    if (place) bits.push(place);
    if (ev.month || ev.year) bits.push(ev.month || String(ev.year));
    return bits.join(' - ');
  }

  function simpleEventSourceLine(ev) {
    if (!ev) return '';
    const source = simpleSourceName(ev);
    const confidence = ev.confidence ? ev.confidence + ' confidence' : '';
    return [source, confidence].filter(Boolean).join(' - ');
  }

  function simpleEventNote(ev) {
    if (!ev) return '';
    const note = String(ev.impactNote || ev.explanation || ev.subtitle || '').trim();
    const kind = simpleEventKind(ev);
    if (/use the .*lens/i.test(note)) {
      if (kind === 'Station opening') return 'Shows nearby access, jobs, traffic, and transit pressure around the station area.';
      if (kind === 'Road network change') return 'Shows nearby traffic pressure and related cell changes around this road record.';
      if (kind === 'Grid network change') return 'Shows local electricity pressure and nearby service impacts.';
      if (kind === 'Public transit change') return 'Shows access changes around nearby stops and route corridors.';
      return 'Shows how the nearby model cells changed around this event.';
    }
    return note.length > 135 ? note.slice(0, 132).trim() + '...' : note;
  }

  function renderLeftSidebar() {
    if (!els.leftSidebarList || !els.leftSidebarTitle) return;
    const hist = isHistoricalMode();
    els.leftSidebarTitle.textContent = hist ? 'Events' : 'Activity Log';
    if (els.leftSidebarSubtitle) {
      els.leftSidebarSubtitle.innerHTML = hist
        ? 'Permits, openings,<br>and changes by year'
        : 'Your scenario actions<br>and simulation runs';
    }
    if (els.leftSidebarFilter) els.leftSidebarFilter.style.display = hist ? '' : 'none';
    if (hist) renderLeftSidebarEvents();
    else      renderLeftSidebarActivity();
    renderSelectedEventSummary();
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
      const title = escapeHtml(simpleEventTitle(ev));
      const sub = escapeHtml(simpleEventSubtitle(ev));
      const date = escapeHtml(simpleEventSourceLine(ev));
      const active = (ev.id && ev.id === state.activeEventId) ? ' active' : '';
      return '<div class="event-item' + active + '" data-event-id="' + escapeHtml(ev.id || '') + '" role="button" tabindex="0">' +
        '<div class="event-icon" style="background:' + tint + '">' + icon + '</div>' +
        '<div class="event-info">' +
          '<div class="event-title">' + title + '</div>' +
          (sub ? '<div class="event-sub">' + sub + '</div>' : '') +
          (date ? '<div class="event-date">' + date + '</div>' : '') +
        '</div></div>';
    }).join('');
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
      sub: branch.trendBaseline ? 'Locked Belfast trend projection' : (branch.locked ? 'Baseline (read-only)' : 'Active scenario'),
      date: 'now',
    });
    // Year-by-year jobs evolution from committed buildings/roads/transformers.
    if (state.mode === 'simulation' && (branch.items || []).length) {
      const jobsThisYear = branchCommitYearlyJobs(branch, state.year);
      const jobsFinal = branchCommitYearlyJobs(branch, FINAL_YEAR);
      entries.push({
        icon: '💼',
        tint: '#f3e8ff',
        title: (jobsThisYear >= 0 ? '+' : '') + jobsThisYear.toLocaleString() + ' jobs from commits',
        sub: 'Ramps to ' + (jobsFinal >= 0 ? '+' : '') + jobsFinal.toLocaleString() + ' jobs by ' + FINAL_YEAR,
        date: 'Year ' + state.year
      });
    }
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
        title = 'Added Transformer';
      }
      if (it.trendBaseline && it.label) title = 'Projected ' + it.label;
      if (it.type === 'infrastructure') icon = TRANSFORMER_ICON_SVG;
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
    if (els.leftSidebarList && els.leftSidebarList.dataset.delegatedClick !== '1') {
      els.leftSidebarList.dataset.delegatedClick = '1';
      els.leftSidebarList.addEventListener('click', (event) => {
        const node = event.target && event.target.closest ? event.target.closest('.event-item[data-event-id]') : null;
        if (!node || !els.leftSidebarList.contains(node)) return;
        const id = node.getAttribute('data-event-id');
        if (id) selectEvent(id);
      });
      els.leftSidebarList.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const node = event.target && event.target.closest ? event.target.closest('.event-item[data-event-id]') : null;
        if (!node || !els.leftSidebarList.contains(node)) return;
        event.preventDefault();
        const id = node.getAttribute('data-event-id');
        if (id) selectEvent(id);
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

  // T2.1: throttle the mode-transition toast so a quick scrub or play-through
  // doesn't spam the user. Only fires once per ~3s and never fires on the
  // first mode set during init (when state.mode goes from null → mode).
  let __lastModeToastAt = 0;
  function maybeFireModeToast(prevMode, nextMode) {
    if (!prevMode) return; // initial assignment
    const now = Date.now();
    if (now - __lastModeToastAt < 3000) return;
    __lastModeToastAt = now;
    if (nextMode === 'simulation') {
      toast('Switched to Simulation. Edits in 2026–2036 only affect this branch.', 'info');
    } else {
      toast('Back in Historical Replay (2016–2025). Editing tools are paused.', 'info');
    }
  }

  function renderModeBanner() {
    if (!els.modeBanner) return;
    const sim = isSimYear(state.year);
    els.modeBanner.classList.toggle('mode-simulation', sim);
    els.modeBanner.classList.toggle('mode-historical', !sim);
    const label = els.modeBanner.querySelector('.mode-banner-label');
    if (label) label.textContent = sim ? 'Simulation · 2026–2036' : 'Historical Replay · 2016–2025';
    if (els.modeBannerJump) {
      els.modeBannerJump.textContent = sim ? '← Back to Historical' : 'Jump to Simulation →';
    }
    els.modeBanner.title = sim
      ? 'Click to jump back to the 2025 baseline year'
      : 'Click to jump to 2026 and start designing your scenario';
  }

  function setYear(y) {
    state.year = y;
    state.activeEventId = null;
    // Auto-mode: 2025 is the baseline. 2026 onward is the forecast simulation.
    const desiredMode = y <= BASE_YEAR ? 'historical' : 'simulation';
    if (desiredMode !== state.mode) {
      const prevMode = state.mode;
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
      renderModeBanner();
      maybeFireModeToast(prevMode, desiredMode);
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
    syncCityBuildingHeightContext();
    updateScenarioDiffButton();
    updateRunButtonLabel();
    refreshTransitLayer();
    refreshWorkspaceSplit();
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
        btn.removeAttribute('aria-disabled');
        btn.style.opacity = '';
        btn.style.cursor = '';
      });
    }
    if (els.modifySub) els.modifySub.style.color = '';
    if (!els.modifyButtons) return;
    els.modifyButtons.forEach(btn => {
      const t = btn.getAttribute('data-tool');
      // "Select" is the implicit default — show it as active when no tool
      // is active (since the user is free to click anything on the map).
      const isSelect = t === 'select';
      const active = isSelect ? !state.activeTool : (t === state.activeTool);
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      // Restore tool-disabled tooltip cleared by historical mode (T1.3).
      if (btn.dataset.disabledTitle) {
        btn.title = btn.dataset.disabledTitle;
        delete btn.dataset.disabledTitle;
      }
    });
    // Hide presets unless "building" tool active. Use the .hidden property
    // (not style.display) — the element has a `hidden` HTML attribute that
    // setting display='' alone won't override.
    const showPresets = state.activeTool === 'building';
    if (els.presetSection) els.presetSection.hidden = !showPresets;
    if (els.modifySub) {
      if (state.activeTool) {
        els.modifySub.textContent = TOOL_LABELS[state.activeTool] || 'Click on the map to place';
        els.modifySub.style.color = 'var(--blue-2)';
      } else {
        els.modifySub.textContent = '';
        els.modifySub.style.color = '';
      }
    }
    // Show cursor hint — suppressed for the Buildings tool since the green
    // city-wide overlay already communicates "click anywhere to place".
    if (els.cursorHint) {
      const wantsHint = !!state.activeTool && state.activeTool !== 'building' && isSimYear(state.year);
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
    updateBuildabilityOverlay();
    syncRoadPlannerVisibility();
    syncCityBuildingHeightContext();
    updateRunButtonLabel();
    renderPresets();
    // Re-arm the toolbar buttons for HTML5 drag-and-drop onto the map.
    if (window.MapUX && typeof window.MapUX.attachToolbarDrag === 'function') {
      window.MapUX.attachToolbarDrag();
    }
    if (window.MapUX && typeof window.MapUX.refreshCursor === 'function') {
      window.MapUX.refreshCursor();
    }
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
        state.buildabilityLoaded = false;
        renderPresets();
        updateBuildabilityOverlay();
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
        closeWorkspaceSplit();
        const activatingRoad = t === 'road' && state.activeTool !== 'road';
        // Roads now flow through the postcode → junction picker. If the
        // planner isn't armed yet, push the user to the search box rather
        // than letting them free-click points that won't sit on real roads.
        if (t === 'road' && state.activeTool !== 'road' && !roadPlanner.armed && !roadPlanner.searchCentre) {
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
        if (activatingRoad && state.activeTool === 'road' && !roadPlanner.armed && roadPlanner.searchCentre) {
          armRoadPlanner(roadPlanner.searchCentre);
        }
        renderModify();
      });
    });
  }

  // ---------- RENDER: IMPACT PANEL ----------

  function renderImpact() {
    if (!els.impactStack || !els.impactTitle) return;
    if (isHistoricalMode()) {
      // T5.1: set the title synchronously so the year never lags behind the
      // scrubber while loadGridYear() is in flight. renderHistoricalImpact()
      // overwrites it with the same string after the grid resolves.
      els.impactTitle.textContent = 'Year-over-year change (' + state.year + ')';
      loadGridYear(state.year).then(() => renderHistoricalImpact());
      return;
    }
    const branch = activeBranch();
    const target = state.year;
    const isHistorical = !isSimYear(target);
    // T4.2: distinguish proxy heuristic estimates from real AI forecasts.
    const hasForecast = !!(branch && branch.scenarioResult && branch.scenarioResult.timelineByYear && branch.scenarioResult.timelineByYear[String(target)]);
    const badgeClass = hasForecast ? 'impact-badge impact-badge--forecast' : 'impact-badge impact-badge--estimate';
    const badgeLabel = hasForecast ? 'Forecast' : 'Estimate';
    const badgeTitle = hasForecast
      ? 'Real AI forecast values from the most recent simulation run.'
      : 'Quick proxy estimate from the impact heuristic. Run Simulation for a real forecast.';
    els.impactTitle.innerHTML = 'Impact Overview (' + target + ')' +
      ' <span class="' + badgeClass + '" title="' + escapeHtml(badgeTitle) + '">' + badgeLabel + '</span>';

    let metricsAtTarget;
    if (isHistorical && state.historicalMetrics && state.historicalMetrics[String(target)]) {
      // Build from real historical numbers, mapped onto our 5 metrics for display
      metricsAtTarget = historicalToDisplay(target);
    } else {
      metricsAtTarget = metricsForBranchYear(branch, target);
    }

    const concrete = concreteImpactsForBranchYear(branch, target);
    const integrityHTML = scenarioIntegrityCardHTML(branch, target, metricsAtTarget);
    els.impactStack.innerHTML =
      METRICS.map(m => metricCardHTML(m, branch, target, metricsAtTarget)).join('') +
      concreteImpactPanelHTML(concrete) +
      integrityHTML;
    if (els.scenarioIntegrityHost) {
      const hasScenario = !!scenarioResultForBranch(branch);
      const hasSolanaProof = !!(branch && branch.solana && branch.solana.signature && branch.solana.scenarioHash);
      const show = hasScenario || hasSolanaProof;
      els.scenarioIntegrityHost.hidden = !show;
      els.scenarioIntegrityHost.innerHTML = show ? integrityHTML : '';
    }
    attachScenarioIntegrityEvents();
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
    const confidence = electricity.confidence || jobs.confidence || impact.confidence || 'medium';
    const reliefKw = Number(electricity.transformerReliefKw) || 0;
    const headroomKw = Number(electricity.localCapacityHeadroomKwChange) || 0;
    const overloadRisk = Number(electricity.overloadRiskDelta) || 0;
    const loadIndex = Number(electricity.loadIndexDelta ?? electricity.localLoadIndexDelta) || 0;
    const peakBand = electricity.p10 && electricity.p90
      ? 'p10 ' + fmtConcreteSigned(electricity.p10.peakKwChange, 0) + ' / p90 ' + fmtConcreteSigned(electricity.p90.peakKwChange, 0) + ' kW'
      : '';
    const reliefBand = electricity.p10 && electricity.p90
      ? 'p10 ' + fmtConcreteSigned(electricity.p10.transformerReliefKw, 0) + ' / p90 ' + fmtConcreteSigned(electricity.p90.transformerReliefKw, 0) + ' kW'
      : '';
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
          '<small>' + fmtConcreteSigned(jobs.temporaryConstructionJobs, 1) + ' construction, ' + fmtConcreteSigned(jobs.operationsJobs, 1) + ' operations, ' + fmtConcreteSigned(jobs.capacityEnabledJobs, 0) + ' capacity-enabled</small>' +
        '</div>' +
        '<div class="concrete-impact-row">' +
          '<span>Demand</span>' +
          '<strong>' + fmtConcreteSigned(electricity.peakKwChange, 0) + ' kW peak</strong>' +
          '<small>' + fmtConcreteSigned(electricity.annualMwhChange, 1) + ' MWh/yr' + (peakBand ? ', ' + peakBand : '') + '</small>' +
        '</div>' +
        '<div class="concrete-impact-row">' +
          '<span>Transformer</span>' +
          '<strong>' + fmtConcreteSigned(reliefKw, 0) + ' kW relief</strong>' +
          '<small>' + fmtConcreteSigned(headroomKw, 0) + ' kW headroom, risk ' + fmtConcreteSigned(overloadRisk, 3) + ', load ' + fmtConcreteSigned(loadIndex, 3) + (reliefBand ? ', ' + reliefBand : '') + '</small>' +
        '</div>' +
        '<div class="concrete-impact-row">' +
          '<span>Public Transit</span>' +
          '<strong>' + fmtConcreteSigned(services.netServiceDemand, 0) + ' people-eq</strong>' +
          '<small>' + fmtConcreteSigned(services.serviceCapacityEquivalent, 0) + ' capacity-eq</small>' +
        '</div>' +
        '<div class="concrete-impact-foot">Confidence ' + escapeHtml(confidence) + '. Planning-grade screening only, not NIE engineering approval.</div>' +
      '</div>';
  }

  function solanaCommitVersions() {
    const sol = window.ReplaySolana || {};
    return {
      dataVersion: sol.DATA_VERSION || 'belfast_2016_2026_v1',
      dataVersionLabel: 'Belfast 2016-2026 v1',
      engineVersion: sol.ENGINE_VERSION || 'sim_v0.3',
      agentVersion: sol.AGENT_VERSION || 'agents_v0.2'
    };
  }

  function scenarioConfidenceLabel(branch) {
    const scenario = scenarioResultForBranch(branch);
    const critic = scenario && scenario.critic ? scenario.critic : {};
    const siteAgent = scenario && scenario.siteAgent ? scenario.siteAgent : {};
    const concrete = concreteImpactsForBranchYear(branch, FINAL_YEAR);
    return critic.confidenceLabel || critic.confidence_label || siteAgent.confidence || (concrete && concrete.confidence) || 'medium';
  }

  function shortHash(value) {
    const raw = String(value || '').replace(/^sha256:/, '');
    if (!raw) return '';
    return raw.slice(0, 8) + '...' + raw.slice(-6);
  }

  function shortSignature(value) {
    const raw = String(value || '');
    if (!raw) return '';
    return raw.slice(0, 4) + '...' + raw.slice(-4);
  }

  function scenarioIntegrityCardHTML(branch, target, metricsAtTarget) {
    const versions = solanaCommitVersions();
    const scenario = scenarioResultForBranch(branch);
    const solana = branch && branch.solana ? branch.solana : null;
    const verified = Boolean(solana && solana.signature && solana.scenarioHash);
    const confidence = scenario ? scenarioConfidenceLabel(branch) : (verified ? 'Verified scenario' : 'Run simulation first');
    const statusClass = verified ? 'verified' : 'draft';
    const statusLabel = verified ? 'Verified on Solana' : 'Draft';
    const disabled = scenario ? '' : ' disabled';
    const detail = scenario
      ? 'Publish a compact Devnet memo; full scenario data stays off-chain.'
      : 'Run the 2036 simulation before publishing a scenario commit.';
    let body = '' +
      '<div class="sic-row"><span>Data version</span><strong>' + escapeHtml(versions.dataVersionLabel) + '</strong></div>' +
      '<div class="sic-row"><span>Simulation engine</span><strong>' + escapeHtml(versions.engineVersion) + '</strong></div>' +
      '<div class="sic-row"><span>Agent review</span><strong>' + escapeHtml(confidence) + '</strong></div>';
    if (verified) {
      body += '' +
        '<div class="sic-proof">' +
          '<div class="sic-proof-row"><span>Scenario hash</span><code title="' + escapeHtml(solana.scenarioHash) + '">' + escapeHtml(shortHash(solana.scenarioHash)) + '</code></div>' +
          '<div class="sic-proof-row"><span>Transaction</span><a href="' + escapeHtml(solana.explorerUrl || solanaExplorerUrl(solana)) + '" target="_blank" rel="noreferrer">View on Explorer</a></div>' +
        '</div>' +
        '<div class="sic-actions">' +
          '<button type="button" class="sic-secondary" data-solana-copy="' + escapeHtml(solana.scenarioHash) + '">Copy hash</button>' +
          '<span class="sic-tx" title="' + escapeHtml(solana.signature) + '">' + escapeHtml(shortSignature(solana.signature)) + '</span>' +
        '</div>';
    } else {
      body += '' +
        '<p class="sic-note">' + escapeHtml(detail) + '</p>' +
        '<button type="button" class="sic-publish" data-solana-publish' + disabled + '>Publish Scenario Commit</button>';
    }
    return '' +
      '<div class="scenario-integrity-card" data-scenario-integrity>' +
        '<div class="sic-head">' +
          '<span>Scenario Integrity</span>' +
          '<strong class="sic-status ' + statusClass + '">' + escapeHtml(statusLabel) + '</strong>' +
        '</div>' +
        body +
        '<div class="sic-error" data-solana-error hidden></div>' +
      '</div>';
  }

  function solanaExplorerUrl(solana) {
    const cluster = solana && solana.cluster ? solana.cluster : 'devnet';
    return 'https://explorer.solana.com/tx/' + encodeURIComponent(solana.signature || '') + '?cluster=' + encodeURIComponent(cluster);
  }

  function attachScenarioIntegrityEvents() {
    const hosts = [els.impactStack, els.scenarioIntegrityHost].filter(Boolean);
    hosts.forEach(host => {
      host.querySelectorAll('[data-solana-publish]').forEach(btn => {
        btn.addEventListener('click', () => publishScenarioCommit(btn));
      });
      host.querySelectorAll('[data-solana-copy]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const text = btn.getAttribute('data-solana-copy') || '';
          try {
            await navigator.clipboard.writeText(text);
            toast('Scenario hash copied');
          } catch (_) {
            toast('Could not copy hash from this browser', 'warn');
          }
        });
      });
    });
  }

  function roundedCoord(value) {
    const n = Number(value);
    return Number.isFinite(n) ? round(n, 6) : undefined;
  }

  function compactScenarioCommitItem(item) {
    const config = item.buildingConfig || item.config || {};
    const compact = {
      id: item.id,
      type: item.type,
      label: item.label || branchItemTitle(item),
      year: item.year,
      preset: item.preset,
      plannerEngine: item.plannerEngine
    };
    if (Number.isFinite(Number(item.lng)) && Number.isFinite(Number(item.lat))) {
      compact.location = { lng: roundedCoord(item.lng), lat: roundedCoord(item.lat) };
    }
    if (item.type === 'road') {
      const path = Array.isArray(item.path) ? item.path.slice(0, 24) : [item.start, item.end].filter(Array.isArray);
      compact.path = path.map(coord => [roundedCoord(coord[0]), roundedCoord(coord[1])]);
      compact.lengthM = round(roadLengthMeters(item), 1);
    }
    if (item.type === 'building') {
      compact.building = {
        buildingType: config.buildingType,
        floors: config.floors,
        footprintSqm: config.footprintSqm,
        units: config.units,
        jobs: config.jobs,
        affordabilityMix: config.affordabilityMix
      };
    }
    if (item.type === 'infrastructure') {
      compact.infrastructure = {
        assetClass: item.assetClass,
        capacityKva: item.capacityKva,
        voltageKv: item.voltageKv,
        serviceRadiusM: item.serviceRadiusM || item.radiusM
      };
    }
    return compact;
  }

  function scenarioProofOutputs(branch, target, metricsAtTarget) {
    const concrete = concreteImpactsForBranchYear(branch, target) || {};
    const raw = scenarioRawMetricsForBranchYear(branch, target) || {};
    return {
      mobilityTraffic: {
        trafficIndex: metricsAtTarget.traffic,
        rawTraffic: raw.traffic,
        concrete: concrete.traffic
      },
      populationDensity: {
        population: metricsAtTarget.population,
        housingDemand: metricsAtTarget.housing,
        rawPopulation: raw.population
      },
      jobsOpportunity: {
        economicOutput: metricsAtTarget.economy,
        rawJobs: raw.jobs,
        concrete: concrete.jobs
      },
      environmentalExposure: {
        airQualityIndex: metricsAtTarget.air,
        electricity: concrete.electricity,
        publicTransit: concrete.services
      }
    };
  }

  function agentSummaryForScenario(scenario) {
    const report = scenario && scenario.report ? scenario.report : {};
    if (report.summary) return String(report.summary).slice(0, 1400);
    const critic = scenario && scenario.critic ? scenario.critic : {};
    if (Array.isArray(critic.recommendations)) return critic.recommendations.join(' ').slice(0, 1400);
    return '';
  }

  function createScenarioProof(branch, target, metricsAtTarget) {
    const scenario = scenarioResultForBranch(branch);
    if (!branch || !scenario) throw new Error('Run a scenario simulation before publishing.');
    const versions = solanaCommitVersions();
    const createdAt = new Date().toISOString();
    const proofId = branch.id + '-' + Date.parse(createdAt).toString(36);
    return {
      type: 'replay_belfast_scenario_commit',
      version: '1',
      scenarioId: proofId,
      scenarioName: branch.name || 'Belfast scenario',
      city: 'Belfast',
      baseYear: 2026,
      targetYear: 2036,
      dataVersion: versions.dataVersion,
      engineVersion: versions.engineVersion,
      agentVersion: versions.agentVersion,
      createdAt: createdAt,
      interventions: (branch.items || []).map(compactScenarioCommitItem),
      outputs: scenarioProofOutputs(branch, target, metricsAtTarget),
      confidence: scenarioConfidenceLabel(branch),
      agentSummary: agentSummaryForScenario(scenario)
    };
  }

  function setScenarioIntegrityBusy(card, isBusy, message) {
    const btn = card && card.querySelector('[data-solana-publish]');
    if (btn) {
      btn.disabled = Boolean(isBusy);
      btn.textContent = isBusy ? (message || 'Publishing...') : 'Publish Scenario Commit';
    }
    const error = card && card.querySelector('[data-solana-error]');
    if (error && isBusy) error.hidden = true;
  }

  function setScenarioIntegrityError(card, message) {
    const error = card && card.querySelector('[data-solana-error]');
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
  }

  async function publishScenarioCommit(button) {
    const sol = window.ReplaySolana;
    const card = button && button.closest('[data-scenario-integrity]');
    if (!sol || typeof sol.publishScenarioProof !== 'function') {
      setScenarioIntegrityError(card, 'Solana runtime is not loaded. Refresh and try again.');
      return;
    }
    const branch = activeBranch();
    const target = FINAL_YEAR;
    const metricsAtTarget = metricsForBranchYear(branch, target);
    try {
      setScenarioIntegrityBusy(card, true, 'Preparing proof...');
      const proof = createScenarioProof(branch, target, metricsAtTarget);
      setScenarioIntegrityBusy(card, true, 'Open wallet...');
      const result = await sol.publishScenarioProof(proof);
      branch.solana = {
        status: 'verified',
        cluster: result.cluster,
        signature: result.signature,
        scenarioHash: result.scenarioHash,
        metadataUri: result.metadataUri,
        explorerUrl: result.explorerUrl,
        wallet: result.publicKey,
        scenarioId: proof.scenarioId,
        publishedAt: result.publishedAt
      };
      saveState();
      renderImpact();
      toast('Verified on Solana');
    } catch (error) {
      const message = sol.friendlySolanaError ? sol.friendlySolanaError(error) : (error.message || 'Could not publish scenario commit.');
      setScenarioIntegrityBusy(card, false);
      setScenarioIntegrityError(card, message);
      toast(message, 'error');
    }
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
    // T1.5: drop the redundant "(baseline)" suffix — the baseline branch's
    // own name already says "Baseline". Use a 🔒 prefix to signal read-only.
    els.branchSelect.innerHTML = state.branches.map(b => {
      const count = (b.items || []).length;
      let label;
      if (b.locked) {
        const lockedDetail = b.trendBaseline ? count + ' Belfast projected' : 'read-only';
        label = '🔒 ' + (b.name || 'Branch') + ' · ' + lockedDetail;
      } else {
        label = (b.name || 'Branch') + ' · ' + count + ' item' + (count === 1 ? '' : 's');
      }
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
      // T5.8: clicking a row now zooms AND opens the inspect modal so the
      // tabindex/role="button" affordance actually does something. Cmd/Ctrl
      // or Shift modifier zooms only (skip the modal), preserving the old
      // shortcut for power users who want to navigate the map without a
      // modal in the way.
      el.addEventListener('click', (e) => {
        const item = activeBranch().items.find(i => i.id === itemId);
        if (!item) return;
        zoomToBranchItem(item);
        if (!(e.metaKey || e.ctrlKey || e.shiftKey)) openInspectModal(item);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        const item = activeBranch().items.find(i => i.id === itemId);
        if (!item) return;
        zoomToBranchItem(item);
        openInspectModal(item);
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openNodeContextMenu({ branchId: branch.id, itemId: itemId }, e);
      });
    });
    els.branchList.querySelectorAll('[data-diff-item-id]').forEach(el => {
      const itemId = el.getAttribute('data-diff-item-id');
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        // T1.2: pre-sim diff is meaningless. Direct the user to Run Simulation.
        if (el.getAttribute('aria-disabled') === 'true' || el.dataset.needsSim === 'true') {
          toast('Run Simulation first to see the diff for this addition.', 'warn');
          if (els.runBtn) els.runBtn.classList.add('attention-pulse');
          setTimeout(() => els.runBtn && els.runBtn.classList.remove('attention-pulse'), 1600);
          return;
        }
        handleBranchItemDiff(itemId);
      });
    });
    renderActiveInfo();
    renderTagDot();
  }

  function branchAdditionsHTML(branch) {
    const items = (branch && branch.items) || [];
    const introRows = branch && branch.trendBaseline ? [{
      sortYear: FINAL_YEAR + 1,
      sortTime: Number.MAX_SAFE_INTEGER,
      sortRank: -1,
      row: {
        title: BASE_YEAR + ' Belfast trend baseline',
        detail: 'Current trend continuation constrained to the Belfast NI boundary',
        color: branch.color || '#3b82f6'
      }
    }] : [];
    if (!items.length) {
      if (introRows.length) return branchLineHTML(introRows.map(entry => entry.row));
      return '<div class="branch-empty" style="font-size:11.5px;color:var(--text-mute);padding:8px 0;">No additions yet. Add something on the map to start this branch.</div>';
    }
    const rows = introRows.concat(items.map((item, index) => ({
      sortYear: item.year || START_YEAR,
      sortTime: Date.parse(item.createdAt || '') || 0,
      sortRank: index,
      row: {
        title: branchItemTitle(item),
        detail: branchItemDetail(item),
        color: item.color || branch.color || '#3b82f6',
        item
      }
    })))
      .sort((a, b) => (b.sortTime - a.sortTime) || ((b.sortYear || 0) - (a.sortYear || 0)) || (b.sortRank - a.sortRank))
      .map(entry => entry.row || entry);
    return branchLineHTML(rows);
  }

  function branchLineHTML(rows) {
    return '<div class="branch-line">' + rows.map(row => {
      const clickable = (row.item || row.log) ? ' is-clickable' : '';
      const tooltip = row.item ? branchItemTooltip(row.item) : (row.tooltip || '');
      const titleAttr = tooltip ? ' title="' + escapeHtml(tooltip) + '"' : '';
      const itemAttr = row.item
        ? ' data-item-id="' + escapeHtml(row.item.id) + '" role="button" tabindex="0"'
        : (row.log ? ' data-log-id="' + escapeHtml(row.log.id) + '" role="button" tabindex="0"' : '');
      return '<div class="branch-line-item' + clickable + '"' + itemAttr + titleAttr + '>' +
        '<span class="branch-line-dot" style="--branch-line-color:' + escapeHtml(row.color || '#3b82f6') + '"></span>' +
        '<div class="branch-line-card">' +
          '<div class="branch-line-main">' +
            '<div class="branch-line-title">' + escapeHtml(row.title) + '</div>' +
            '<div class="branch-line-detail">' + escapeHtml(row.detail || '') + '</div>' +
          '</div>' +
          (row.item ? branchItemDiffButtonHTML(row.item) : '') +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function branchItemDiffButtonHTML(item) {
    const label = 'View Diff';
    // The diff modal needs a scenarioResult on the active branch — show the
    // button as disabled until the user has actually run a simulation,
    // rather than letting the click toast an error (T1.2).
    const branch = activeBranch();
    const ready = !!scenarioResultForBranch(branch);
    const tooltip = ready
      ? label + ' for ' + branchItemTitle(item)
      : 'Run Simulation first to compare ' + branchItemTitle(item) + ' against the no-build forecast.';
    const disabledAttrs = ready ? '' : ' aria-disabled="true" data-needs-sim="true"';
    return '<button class="branch-line-diff' + (ready ? '' : ' is-disabled') + '" type="button" data-diff-item-id="' + escapeHtml(item.id) + '" title="' + escapeHtml(tooltip) + '"' + disabledAttrs + '>' +
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="3" width="5" height="10" rx="1"/><rect x="9" y="3" width="5" height="10" rx="1"/><path d="M7 6h2M7 10h2" stroke-linecap="round"/></svg>' +
      '<span>' + escapeHtml(label) + '</span>' +
    '</button>';
  }

  function parentBranchName(branch) {
    const parent = branch && state.branches.find(b => b.id === branch.parentId);
    return parent ? parent.name : 'baseline';
  }

  function branchItemTitle(item) {
    if (!item) return 'Addition';
    if (item.trendBaseline && item.label) return item.label;
    if (item.type === 'building') return 'Building - ' + (item.label || capitalise(item.preset || 'building'));
    if (item.type === 'building_removal') return 'Delete - ' + (item.existingBuildingName || item.label || 'Existing building');
    if (item.type === 'road') return item.label || 'Road segment';
    if (item.type === 'park') return 'Park';
    if (item.type === 'infrastructure') return 'Transformer';
    return capitalise(item.type || 'addition');
  }

  function branchItemDetail(item) {
    if (!item) return '';
    const year = 'Year ' + (item.year || START_YEAR);
    if (item.trendBaseline && item.trendBaseline.reason) {
      return year + ' - ' + item.trendBaseline.reason;
    }
    // T1.4: prefer a postcode; otherwise just say "custom location" and
    // keep the precise coordinates in the row tooltip (see branchItemTooltip).
    if (item.type === 'building') {
      const place = item.postcode || 'custom location';
      return year + ' - ' + place;
    }
    if (item.type === 'building_removal') {
      const place = item.postcode || 'mapped footprint';
      return year + ' - remove existing footprint at ' + place;
    }
    if (item.type === 'road') {
      const segments = Array.isArray(item.path) ? Math.max(1, item.path.length - 1) : 1;
      return year + ' - ' + segments + ' street segment' + (segments === 1 ? '' : 's');
    }
    if (item.postcode) return year + ' - ' + item.postcode;
    if (Number.isFinite(Number(item.lng)) && Number.isFinite(Number(item.lat))) {
      return year + ' - custom location';
    }
    return year;
  }

  // Verbose hover-tooltip with precise coords for power users (T1.4).
  function branchItemTooltip(item) {
    if (!item) return '';
    const parts = [branchItemTitle(item)];
    if (item.year) parts.push('Year ' + item.year);
    if (item.postcode) parts.push(item.postcode);
    if (Number.isFinite(Number(item.lng)) && Number.isFinite(Number(item.lat))) {
      parts.push(locationLabel(item.lng, item.lat));
    }
    return parts.join(' · ');
  }

  function collectCoordinatePairs(value, out) {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
      out.push([Number(value[0]), Number(value[1])]);
      return;
    }
    value.forEach(part => collectCoordinatePairs(part, out));
  }

  function branchItemCoordinates(item) {
    const coords = [];
    if (!item) return coords;
    if (item.type === 'road') {
      collectCoordinatePairs(Array.isArray(item.path) && item.path.length >= 2 ? item.path : [item.start, item.end], coords);
    }
    if (Array.isArray(item.footprint)) collectCoordinatePairs(item.footprint, coords);
    if (item.geometry) collectCoordinatePairs(item.geometry.coordinates, coords);
    if (Number.isFinite(Number(item.lng)) && Number.isFinite(Number(item.lat))) coords.push([Number(item.lng), Number(item.lat)]);
    return coords;
  }

  function branchItemCenter(item) {
    const coords = branchItemCoordinates(item);
    const loc = locationFromCoords(coords);
    return loc ? [loc.lng, loc.lat] : null;
  }

  function branchItemBounds(item) {
    const coords = branchItemCoordinates(item);
    if (!coords.length) return null;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    coords.forEach(coord => {
      minLng = Math.min(minLng, coord[0]);
      maxLng = Math.max(maxLng, coord[0]);
      minLat = Math.min(minLat, coord[1]);
      maxLat = Math.max(maxLat, coord[1]);
    });
    if (!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) return null;
    return [minLng, minLat, maxLng, maxLat];
  }

  function zoomToBranchItem(item) {
    if (!item || !state.map) return;
    state.lastPlacedItemId = item.id;
    const targetYear = clamp(Number(item.year) || START_YEAR, START_YEAR, FINAL_YEAR);
    if (state.year < START_YEAR || (isSimYear(state.year) && state.year < targetYear)) setYear(targetYear);
    const bounds = branchItemBounds(item);
    if (bounds) {
      const samePoint = Math.abs(bounds[0] - bounds[2]) < 0.00001 && Math.abs(bounds[1] - bounds[3]) < 0.00001;
      if (!samePoint) {
        state.map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], {
          padding: { top: 96, bottom: 190, left: 140, right: 140 },
          maxZoom: item.type === 'road' ? 16 : 16.4,
          duration: 800,
          pitch: state.view === '3D' ? 60 : 0,
          bearing: state.view === '3D' ? -24 : 0
        });
        return;
      }
    }
    const center = branchItemCenter(item);
    if (center) {
      state.map.flyTo({
        center,
        zoom: item.type === 'road' ? 15.6 : 16.2,
        pitch: state.view === '3D' ? 60 : 0,
        bearing: state.view === '3D' ? -24 : 0,
        duration: 760
      });
    }
  }

  function handleBranchItemDiff(itemId) {
    const branch = activeBranch();
    const item = branch && (branch.items || []).find(i => i.id === itemId);
    if (!item) return;
    state.lastPlacedItemId = item.id;
    if (item.type === 'road') {
      roadPlanner.candidateRoadItemId = item.id;
      runRoadComparison(item.id);
      return;
    }
    openScenarioDiffModal(item.id);
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
    return newBranch;
  }

  function defaultForkBranchName(branch, commit) {
    const source = String((branch && branch.name) || 'Branch').replace(/\s*\(No Changes\)\s*/i, '').trim() || 'Branch';
    const suffix = commit && commit.year ? ' ' + commit.year : '';
    const name = source + ' fork' + suffix;
    return name.length > 60 ? name.slice(0, 57) + '...' : name;
  }

  function openBranchPointModal(sourceBranch, target) {
    if (!sourceBranch) return;
    const commit = commitContextForTarget(sourceBranch, target);
    const snapshot = snapshotItemsForCommit(sourceBranch, target);
    const usedColors = new Set(state.branches.map(b => b.color));
    let chosenColor = SWATCH_COLORS.find(c => !usedColors.has(c)) || sourceBranch.color || SWATCH_COLORS[0];
    let chosenName = defaultForkBranchName(sourceBranch, commit);

    openModalCustom('Start Branch Here', function (body, close) {
      const swatches = SWATCH_COLORS.map(c =>
        '<div class="color-swatch' + (c === chosenColor ? ' active' : '') + '" data-color="' + c + '" style="background:' + c + ';color:' + c + '"></div>'
      ).join('');
      body.innerHTML = '' +
        '<div class="new-branch-form">' +
          '<div><label class="field-label">Branch name</label>' +
            '<input class="text-input" id="newBranchName" value="' + escapeHtml(chosenName) + '" maxlength="60"></div>' +
          '<div><label class="field-label">Color</label>' +
            '<div class="color-grid" id="colorGrid">' + swatches + '</div></div>' +
          '<div class="inspect-row"><span class="k">Source</span><span class="v" style="color:' + escapeHtml(sourceBranch.color || '#3b82f6') + '">' + escapeHtml(sourceBranch.name || 'Branch') + '</span></div>' +
          '<div class="inspect-row"><span class="k">Point</span><span class="v">' + escapeHtml(commit.title || 'Branch point') + '</span></div>' +
          '<div class="inspect-row"><span class="k">Copied</span><span class="v">' + snapshot.length + ' addition' + (snapshot.length === 1 ? '' : 's') + ' through ' + commit.year + '</span></div>' +
          '<div style="display:flex;gap:8px;margin-top:6px">' +
            '<button class="modal-btn secondary" id="newBranchCancel" type="button">Cancel</button>' +
            '<button class="modal-btn" id="newBranchCreate" type="button">Create Branch</button>' +
          '</div>' +
        '</div>';

      const nameInput = body.querySelector('#newBranchName');
      body.querySelectorAll('.color-swatch').forEach(s => {
        s.addEventListener('click', () => {
          chosenColor = s.getAttribute('data-color');
          body.querySelectorAll('.color-swatch').forEach(x => x.classList.toggle('active', x === s));
        });
      });
      body.querySelector('#newBranchCancel').addEventListener('click', close);
      body.querySelector('#newBranchCreate').addEventListener('click', () => {
        chosenName = (nameInput.value || '').trim();
        if (!chosenName) { nameInput.focus(); return; }
        createBranchFromPoint(chosenName, chosenColor, sourceBranch, target);
        close();
      });
      nameInput.focus();
      nameInput.select();
    });
  }

  function createBranchFromPoint(name, color, sourceBranch, target) {
    const branch = sourceBranch || activeBranch();
    if (!branch) return null;
    const commit = commitContextForTarget(branch, target);
    const items = cloneItemsWithFreshIds(snapshotItemsForCommit(branch, target));
    const newBranch = {
      id: uid('br'),
      name: name,
      color: color,
      parentId: branch.id,
      items,
      scenarioResult: null,
      scenarioStaged: items.length > 0,
      branchPoint: {
        sourceBranchId: branch.id,
        sourceItemId: commit.itemId || null,
        sourceLogId: commit.logId || null,
        title: commit.title,
        year: commit.year,
        createdAt: new Date().toISOString()
      },
      activityLog: [{
        id: uid('act'),
        type: 'activity',
        title: 'Branch started here',
        detail: 'Forked from ' + (branch.name || 'branch') + ' at ' + (commit.title || 'selected point') + '.',
        year: commit.year,
        createdAt: new Date().toISOString(),
        data: {
          sourceBranchId: branch.id,
          sourceItemId: commit.itemId || null,
          sourceLogId: commit.logId || null
        }
      }]
    };
    if (branch.plannerEngine) newBranch.plannerEngine = branch.plannerEngine;
    if (branch.forecastObjective) newBranch.forecastObjective = branch.forecastObjective;
    state.branches.push(newBranch);
    state.activeBranchId = newBranch.id;
    renderBranchSelect();
    renderBranches();
    renderImpact();
    renderItemsOnMap();
    renderLeftSidebar();
    updateScenarioDiffButton();
    toast('Started branch "' + name + '" from ' + (commit.title || 'branch history'));
    saveState();
    return newBranch;
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

  // ---------- PLANNER VARIATION ENGINES ----------

  function planningEngineDef(id) {
    return PLANNING_ENGINES.find(engine => engine.id === id) || PLANNING_ENGINES[0];
  }

  function offsetCoord(coord, eastM, northM) {
    const base = Array.isArray(coord) ? coord : BELFAST_CENTER;
    const lat = Number(base[1]) || BELFAST_CENTER[1];
    const lng = Number(base[0]) || BELFAST_CENTER[0];
    const metersPerDegLng = Math.max(1, 111320 * Math.cos(lat * Math.PI / 180));
    return [
      lng + Number(eastM || 0) / metersPerDegLng,
      lat + Number(northM || 0) / 111320
    ];
  }

  function itemCentroid(item) {
    if (!item) return null;
    if (item.type === 'road') {
      const path = Array.isArray(item.path) && item.path.length >= 2 ? item.path : [item.start, item.end].filter(Array.isArray);
      const loc = locationFromCoords(path);
      return loc ? [loc.lng, loc.lat] : null;
    }
    if (Number.isFinite(Number(item.lng)) && Number.isFinite(Number(item.lat))) {
      return [Number(item.lng), Number(item.lat)];
    }
    return null;
  }

  function chronologicalBranchItems(branch) {
    return (branch && branch.items || []).map((item, index) => ({ item, index }))
      .sort((a, b) => ((a.item.year || START_YEAR) - (b.item.year || START_YEAR)) || (a.index - b.index));
  }

  function commitContextForTarget(branch, target) {
    const safeTarget = target || {};
    const items = chronologicalBranchItems(branch);
    const itemRow = safeTarget.itemId ? items.find(row => row.item.id === safeTarget.itemId) : null;
    const log = safeTarget.logId && branch ? (branch.activityLog || []).find(entry => entry.id === safeTarget.logId) : null;
    const fallbackItem = items.length ? items[items.length - 1].item : null;
    const sourceItem = itemRow ? itemRow.item : fallbackItem;
    const coord = itemCentroid(sourceItem) || BELFAST_CENTER;
    const year = clamp(Number((itemRow && itemRow.item.year) || (log && log.year) || state.year || START_YEAR), START_YEAR, FINAL_YEAR);
    return {
      year,
      coord,
      title: itemRow ? branchItemTitle(itemRow.item) : (log ? (log.title || 'Activity') : 'Current branch'),
      itemId: itemRow && itemRow.item.id,
      logId: log && log.id
    };
  }

  function snapshotItemsForCommit(branch, target) {
    const items = chronologicalBranchItems(branch);
    if (!items.length) return [];
    const safeTarget = target || {};
    if (safeTarget.itemId) {
      const idx = items.findIndex(row => row.item.id === safeTarget.itemId);
      return (idx >= 0 ? items.slice(0, idx + 1) : items).map(row => row.item);
    }
    if (safeTarget.logId) {
      const log = branch && (branch.activityLog || []).find(entry => entry.id === safeTarget.logId);
      const cutoffYear = log ? (log.year || START_YEAR) : FINAL_YEAR;
      return items.filter(row => (row.item.year || START_YEAR) <= cutoffYear).map(row => row.item);
    }
    return items.map(row => row.item);
  }

  function cloneItemsWithFreshIds(items) {
    return clone(items || []).map(item => {
      item.id = 'item-' + (state.nextItemId++);
      return item;
    });
  }

  function plannerItemForEngine(engine, commit) {
    const c = commit && commit.coord ? commit.coord : BELFAST_CENTER;
    const year = commit && commit.year ? commit.year : START_YEAR;
    if (engine.id === 'traffic') {
      const path = [
        offsetCoord(c, -440, -160),
        offsetCoord(c, -120, -40),
        offsetCoord(c, 170, 55),
        offsetCoord(c, 460, 155)
      ];
      return {
        type: 'road',
        year,
        start: path[0],
        end: path[path.length - 1],
        path,
        color: engine.color,
        label: 'Traffic relief corridor',
        plannerEngine: engine.id,
        plannerMode: 'road_capacity'
      };
    }
    if (engine.id === 'jobs') {
      const p = offsetCoord(c, 165, 95);
      return {
        type: 'building',
        year,
        lng: p[0],
        lat: p[1],
        location: { lng: p[0], lat: p[1] },
        preset: 'commercial',
        buildingConfig: Object.assign({}, buildingConfigForPreset('commercial'), {
          buildingType: 'office',
          floors: 10,
          footprintSqm: 2200,
          employmentFocus: 'city_centre_jobs_hub'
        }),
        color: engine.color,
        label: 'Jobs hub',
        height: 68,
        plannerEngine: engine.id
      };
    }
    if (engine.id === 'electricity') {
      const p = offsetCoord(c, -180, 130);
      return {
        type: 'infrastructure',
        year,
        lng: p[0],
        lat: p[1],
        color: engine.color,
        label: 'Transformer node',
        plannerEngine: engine.id,
        assetClass: 'secondary',
        capacityKva: 500,
        voltageKv: 11,
        serviceRadiusM: 800,
        radiusM: 800
      };
    }
    const path = [
      offsetCoord(c, -210, -390),
      offsetCoord(c, -80, -120),
      offsetCoord(c, 95, 140),
      offsetCoord(c, 230, 420)
    ];
    return {
      type: 'road',
      year,
      start: path[0],
      end: path[path.length - 1],
      path,
      color: engine.color,
      label: 'Public transit priority corridor',
      plannerEngine: engine.id,
      plannerMode: 'transit_priority'
    };
  }

  function createPlannerVariationBranch(sourceBranch, target, engineId) {
    const branch = sourceBranch || activeBranch();
    if (!branch) return null;
    const engine = planningEngineDef(engineId);
    const commit = commitContextForTarget(branch, target);
    const items = cloneItemsWithFreshIds(snapshotItemsForCommit(branch, target));
    const planned = plannerItemForEngine(engine, commit);
    planned.id = 'item-' + (state.nextItemId++);
    items.push(planned);
    const newBranch = {
      id: uid('br'),
      name: engine.label + ' variation',
      color: engine.color,
      parentId: branch.id,
      plannerEngine: engine.id,
      forecastObjective: engine.objective,
      items,
      scenarioResult: null,
      scenarioStaged: true,
      activityLog: []
    };
    state.branches.push(newBranch);
    state.activeBranchId = newBranch.id;
    recordBranchActivity(
      newBranch,
      'planner',
      engine.label + ' planner branch',
      'Branched from ' + commit.title + '. Powered by Gemini planning context; deterministic engine added ' + (planned.label || planned.type) + '.',
      commit.year,
      {
        engine: engine.id,
        sourceBranchId: branch.id,
        sourceItemId: commit.itemId || null,
        sourceLogId: commit.logId || null,
        addedItemId: planned.id,
        color: engine.color,
        poweredBy: 'gemini'
      }
    );
    return newBranch;
  }

  function createPlannerVariationsFromNode(target, engineId) {
    const branch = state.branches.find(x => x.id === (target && target.branchId)) || activeBranch();
    if (!branch) return;
    const engines = engineId ? [planningEngineDef(engineId)] : PLANNING_ENGINES;
    const created = [];
    engines.forEach(engine => {
      const b = createPlannerVariationBranch(branch, target, engine.id);
      if (b) created.push(b);
    });
    renderBranchSelect();
    renderBranches();
    renderImpact();
    renderItemsOnMap();
    renderLeftSidebar();
    updateScenarioDiffButton();
    saveState();
    if (created.length) {
      const label = created.length === 1 ? created[0].name : (created.length + ' planner variations');
      toast('Created ' + label + ' from branch history');
    }
  }

  // ---------- BRANCH CTX MENU ----------

  let menuTarget = null;
  function openBranchMenu(branchId, anchor) {
    if (!els.branchMenu) return;
    menuTarget = branchId;
    const r = anchor.getBoundingClientRect();
    positionContextMenu(els.branchMenu, r.right - 140, r.bottom + 4);
  }
  function closeMenus() {
    if (els.branchMenu) els.branchMenu.hidden = true;
    if (els.nodeMenu) els.nodeMenu.hidden = true;
  }
  function positionContextMenu(menu, left, top) {
    if (!menu) return;
    const pad = 8;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(pad, window.innerWidth - rect.width - pad);
    const maxTop = Math.max(pad, window.innerHeight - rect.height - pad);
    menu.style.left = clamp(left, pad, maxLeft) + 'px';
    menu.style.top = clamp(top, pad, maxTop) + 'px';
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

  function openNodeContextMenu(target, event) {
    if (!els.nodeMenu || !target) return;
    nodeMenuTarget = target;
    const isItem = Boolean(target.itemId);
    const inspectBtn = els.nodeMenu.querySelector('[data-act="inspect"]');
    const deleteBtn = els.nodeMenu.querySelector('[data-act="delete"]');
    const forkBtn = els.nodeMenu.querySelector('[data-act="fork-here"]');
    if (inspectBtn) inspectBtn.hidden = !isItem;
    if (deleteBtn) deleteBtn.hidden = !isItem;
    if (forkBtn) forkBtn.hidden = !(isItem || target.logId);
    positionContextMenu(els.nodeMenu, event.clientX, event.clientY);
  }

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
        openNodeContextMenu({ branchId: branchId, itemId: itemId }, e);
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
      return '<circle r="8" fill="#f59e0b"/>' +
        '<path d="M -5 -5 H 5 M -3 -2 H 3 M -3 1 H 3 M 0 -5 V 6 M -5 6 H 5" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>' +
        '<rect x="-4" y="-2.5" width="8" height="6" rx="1.2" fill="none" stroke="#fff" stroke-width="1.3"/>';
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
        const log = branch ? (branch.activityLog || []).find(entry => entry.id === nodeMenuTarget.logId) : null;
        if (act === 'fork-here') {
          closeMenus();
          if (branch) openBranchPointModal(branch, nodeMenuTarget);
          return;
        }
        if (act === 'branch-variations') {
          createPlannerVariationsFromNode(nodeMenuTarget);
          closeMenus();
          return;
        }
        if (act && act.indexOf('branch-') === 0) {
          createPlannerVariationsFromNode(nodeMenuTarget, act.replace('branch-', ''));
          closeMenus();
          return;
        }
        if (act === 'inspect' && item) openInspectModal(item);
        if (act === 'goto') setYear((item && item.year) || (log && log.year) || START_YEAR);
        if (act === 'delete') {
          if (!item) { closeMenus(); return; }
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
    const presetLabel = item.type === 'building'
      ? capitalise((item.preset || 'residential').replace('_', ' '))
      : item.type === 'building_removal'
        ? 'Building removal'
        : capitalise(item.type);
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

  // T3.1: First-run guided tour. Three slides explaining the timeline,
  // branches, and Run Simulation. Persists "seen" in localStorage. The "?"
  // button in the map controls re-launches it via { force: true }.
  const ONBOARDING_STEPS = [
    {
      title: 'Welcome to Belfast 2016–2036',
      body: 'Scrub the timeline at the bottom to see real planning history (2016–2025) or jump to 2026+ to design your own scenario.',
    },
    {
      title: 'Branches let you compare futures',
      body: 'Three seed branches (Green Belfast Vision, Transport First, High Density Growth) start empty. Use “+ New” in the right sidebar to create your own. The Baseline is read-only.',
    },
    {
      title: 'Place changes, then run a forecast',
      body: 'In simulation years, use the toolbar to add buildings, roads, parks, or transformers. Click “Run Simulation” for the AI forecast — or “AI: 4 Variations” to generate planner alternatives.',
    },
  ];
  function showOnboardingTour(opts) {
    opts = opts || {};
    // Don't double-show.
    if (document.querySelector('.onboarding-overlay')) return;
    let step = 0;
    const overlay = document.createElement('div');
    overlay.className = 'onboarding-overlay';
    overlay.innerHTML =
      '<div class="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="obTitle">' +
        '<div class="ob-progress"><span class="ob-dot"></span><span class="ob-dot"></span><span class="ob-dot"></span></div>' +
        '<h3 id="obTitle"></h3>' +
        '<p id="obBody"></p>' +
        '<div class="ob-actions">' +
          '<button type="button" class="ob-skip" id="obSkipBtn">Skip</button>' +
          '<div class="ob-nav">' +
            '<button type="button" class="ob-back" id="obBackBtn">Back</button>' +
            '<button type="button" class="ob-next" id="obNextBtn">Next</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    const titleEl = overlay.querySelector('#obTitle');
    const bodyEl = overlay.querySelector('#obBody');
    const dotEls = overlay.querySelectorAll('.ob-dot');
    const backBtn = overlay.querySelector('#obBackBtn');
    const nextBtn = overlay.querySelector('#obNextBtn');
    const skipBtn = overlay.querySelector('#obSkipBtn');
    function render() {
      const s = ONBOARDING_STEPS[step];
      titleEl.textContent = s.title;
      bodyEl.textContent = s.body;
      dotEls.forEach((d, i) => d.classList.toggle('active', i === step));
      backBtn.disabled = step === 0;
      nextBtn.textContent = step === ONBOARDING_STEPS.length - 1 ? 'Got it' : 'Next';
    }
    function dismiss(markSeen) {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      if (markSeen) {
        try { localStorage.setItem('belfastOnboardingV1Done', '1'); } catch (e) {}
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') dismiss(true);
      else if (e.key === 'ArrowRight' || e.key === 'Enter') nextBtn.click();
      else if (e.key === 'ArrowLeft') backBtn.click();
    }
    backBtn.addEventListener('click', () => { if (step > 0) { step--; render(); } });
    nextBtn.addEventListener('click', () => {
      if (step < ONBOARDING_STEPS.length - 1) { step++; render(); }
      else dismiss(true);
    });
    skipBtn.addEventListener('click', () => dismiss(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(true); });
    document.addEventListener('keydown', onKey);
    render();
  }

  // T3.4: a single undo store shared across removeItem (toast Undo button),
  // map-ux's Cmd/Ctrl+Z, and the toolbar Undo button. Each entry has a
  // `label` (used in the toast) and a `do` thunk that reverses the action.
  // Capped at 20 actions so we don't bloat memory.
  const __undoStack = [];
  function pushUndo(entry) {
    if (!entry || typeof entry.do !== 'function') return;
    __undoStack.push(entry);
    if (__undoStack.length > 20) __undoStack.shift();
    refreshUndoButton();
  }
  function undoLast() {
    const entry = __undoStack.pop();
    if (!entry) {
      toast('Nothing to undo.', 'warn');
      refreshUndoButton();
      return;
    }
    try { entry.do(); } catch (e) { console.warn('undo failed', e); }
    refreshUndoButton();
    toast('Undone: ' + (entry.label || 'last action'));
  }
  function refreshUndoButton() {
    if (!els.undoBtn) return;
    els.undoBtn.disabled = __undoStack.length === 0;
    els.undoBtn.title = __undoStack.length
      ? 'Undo: ' + (__undoStack[__undoStack.length - 1].label || 'last action') + ' (Ctrl/Cmd+Z)'
      : 'Nothing to undo';
    els.undoBtn.setAttribute('aria-label', els.undoBtn.title);
  }

  // T2.2: target year for the compare modal — drives the year-pill selector.
  // Persisted in module scope so the user's pick survives between opens.
  let __compareTargetYear = null;

  function openCompareModal() {
    if (!els.compareModal || !els.compareBody) return;
    if (!__compareTargetYear || !isSimYear(__compareTargetYear)) {
      __compareTargetYear = isSimYear(state.year) ? state.year : FINAL_YEAR;
    }
    els.compareModal.hidden = false;
    renderCompareModalBody();
  }

  function renderCompareModalBody() {
    if (!els.compareModal || !els.compareBody) return;
    const target = __compareTargetYear;
    if (els.compareYear) els.compareYear.textContent = target;
    const activeScenario = activeBranch().scenarioResult;
    if (activeScenario && activeScenario.timelineByYear && activeScenario.timelineByYear[String(target)]) {
      renderScenarioCompareModal(activeScenario, target);
      return;
    }
    const branches = state.branches;
    if (branches.length < 2) {
      els.compareBody.innerHTML = compareYearPillsHTML(target) +
        '<div style="text-align:center;padding:24px;color:var(--text-mute)">Create a second branch to compare.</div>';
      attachCompareYearPills();
      return;
    }

    // T2.2: count how many branches actually have a forecast — the rest will
    // show proxy estimates (a heuristic, not the AI scenario).
    const branchesWithSim = branches.filter(b => !!b.scenarioResult).length;
    const allEstimates = branchesWithSim === 0;

    // Per branch metrics at target year
    const perBranch = branches.map(b => ({ branch: b, metrics: metricsForBranchYear(b, target) }));

    // Identify winners per metric, but treat ties (within an epsilon) as "no winner".
    const winnersByMetric = {};
    METRICS.forEach(m => {
      const values = perBranch.map(p => p.metrics[m.id]);
      const max = Math.max.apply(null, values);
      const min = Math.min.apply(null, values);
      // Use 0.1% of the range as the tie tolerance, with a small absolute floor.
      const tol = Math.max(Math.abs(max - min) * 0.001, 1e-6);
      if (Math.abs(max - min) <= tol) {
        winnersByMetric[m.id] = '__tie__';
        return;
      }
      let best = perBranch[0];
      perBranch.forEach(p => {
        const cur = p.metrics[m.id];
        const bestVal = best.metrics[m.id];
        if (m.goodDirection === 'up' ? cur > bestVal : cur < bestVal) best = p;
      });
      winnersByMetric[m.id] = best.branch.id;
    });

    // Build grid
    let html = compareYearPillsHTML(target);
    if (allEstimates) {
      html += '<div class="compare-banner compare-banner--estimate">' +
        '<strong>Showing proxy estimates.</strong> ' +
        'Run a simulation in any branch to see real differences across columns.' +
        '<button type="button" class="compare-banner-cta" id="compareRunSimCta">Run Simulation</button>' +
      '</div>';
    } else if (branchesWithSim < branches.length) {
      html += '<div class="compare-banner">' +
        '<strong>' + branchesWithSim + ' of ' + branches.length + ' branches have a forecast.</strong> ' +
        'Branches without one show proxy estimates.' +
      '</div>';
    }

    const cols = ['180px'].concat(branches.map(() => 'minmax(140px, 1fr)')).join(' ');
    html += '<div class="compare-grid" style="grid-template-columns:' + cols + '">';
    html += '<div class="head">Metric</div>';
    branches.forEach((b, i) => {
      const last = i === branches.length - 1 ? ' last-col' : '';
      const sourceBadge = b.scenarioResult
        ? '<span class="compare-src compare-src--forecast" title="AI forecast">Forecast</span>'
        : '<span class="compare-src compare-src--estimate" title="Proxy estimate (no simulation run)">Est.</span>';
      html += '<div class="head' + last + '"><span class="branch-dot" style="background:' + b.color + ';color:' + b.color + ';width:7px;height:7px"></span>' +
        escapeHtml(truncate(b.name, 22)) + sourceBadge + '</div>';
    });
    METRICS.forEach(m => {
      html += '<div class="row-label">' + m.label + '</div>';
      branches.forEach((b, i) => {
        const last = i === branches.length - 1 ? ' last-col' : '';
        const val = perBranch[i].metrics[m.id];
        const before = m.baseline;
        const winnerId = winnersByMetric[m.id];
        const isTie = winnerId === '__tie__';
        const isWin = !isTie && winnerId === b.id;
        const valStr = fmtMetricValue(m, val);
        const deltaStr = fmtDeltaLabel(m, before, val);
        const cellClass = isWin ? 'winning' : (isTie ? 'tied-cell' : 'neutral-cell');
        html += '<div class="' + cellClass + last + '"><div>' + valStr + '</div>' +
          '<div style="font-size:10px;color:var(--text-mute);margin-top:2px">' + deltaStr + '</div></div>';
      });
    });
    html += '</div>';

    // T2.2: headline summary now respects ties. If every metric is tied, say
    // so explicitly instead of falsely declaring a winner.
    const tiedCount = METRICS.filter(m => winnersByMetric[m.id] === '__tie__').length;
    if (tiedCount === METRICS.length) {
      html += '<div class="compare-summary">All ' + METRICS.length + ' indicators are tied across branches at ' + target + '. ' +
        'Add changes to a branch or run a simulation to see meaningful differences.</div>';
    } else {
      const winnerCounts = {};
      Object.entries(winnersByMetric).forEach(([_, bid]) => {
        if (bid === '__tie__') return;
        winnerCounts[bid] = (winnerCounts[bid] || 0) + 1;
      });
      let topBranch = null, topCount = -1;
      Object.keys(winnerCounts).forEach(bid => {
        if (winnerCounts[bid] > topCount) { topCount = winnerCounts[bid]; topBranch = state.branches.find(b => b.id === bid); }
      });
      if (topBranch && topCount > 0) {
        const tiedSuffix = tiedCount > 0 ? ' (' + tiedCount + ' tied)' : '';
        html += '<div class="compare-summary"><strong>' + escapeHtml(topBranch.name) + '</strong> leads on ' +
          topCount + ' of ' + (METRICS.length - tiedCount) + ' decided indicators by ' + target + tiedSuffix + '. ' +
          'Items in this branch: ' + topBranch.items.length + '.</div>';
      }
    }

    els.compareBody.innerHTML = html;
    attachCompareYearPills();
    const cta = document.getElementById('compareRunSimCta');
    if (cta) cta.addEventListener('click', () => {
      els.compareModal.hidden = true;
      // Focus the run button so the user sees where to go next.
      if (els.runBtn) {
        els.runBtn.classList.add('attention-pulse');
        setTimeout(() => els.runBtn.classList.remove('attention-pulse'), 1600);
        els.runBtn.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function compareYearPillsHTML(target) {
    const years = [START_YEAR, START_YEAR + 5, FINAL_YEAR]; // 2026, 2031, 2036
    const seen = new Set();
    const pills = years.filter(y => { if (seen.has(y)) return false; seen.add(y); return true; }).map(y => {
      const active = y === target ? ' active' : '';
      return '<button type="button" class="compare-year-pill' + active + '" data-compare-year="' + y + '">' + y + '</button>';
    }).join('');
    return '<div class="compare-year-pills" role="tablist" aria-label="Compare year">' +
      '<span class="compare-year-pills-label">Year</span>' + pills + '</div>';
  }

  function attachCompareYearPills() {
    document.querySelectorAll('#compareBody .compare-year-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const y = Number(btn.getAttribute('data-compare-year'));
        if (!isFinite(y)) return;
        __compareTargetYear = y;
        renderCompareModalBody();
      });
    });
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
      { id: 'services', label: 'Public Transit', goodDirection: 'up' },
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
    if (els.runBtn) els.runBtn.hidden = !isSimYear(state.year);
    if (!state.isRunningSim && els.runBtnLabel) els.runBtnLabel.textContent = defaultRunButtonLabel();
  }

  function completeSimulationWorkspace(branch, scenario, building, metrics) {
    if (!branch || !scenario) return;
    state.lens = DEFAULT_LENS;
    state.impactMetric = DEFAULT_LENS;
    state.activeTool = null;
    setYear(FINAL_YEAR);
    setView('3D');
    renderLensTabs();
    renderModify();
    renderImpact();
    updateImpactRipples();
    updateImpactLensUI();
    refreshTransitLayer();
    const populationMetric = METRICS.find(m => m.id === 'population');
    const popDelta = metrics.population - (populationMetric ? populationMetric.baseline : 0);
    branch.lastSimulationWorkspace = {
      completedAt: new Date().toISOString(),
      year: FINAL_YEAR,
      lens: DEFAULT_LENS,
      buildingId: building && building.id,
      postcode: building && building.postcode,
      metrics: metrics,
      modelVersion: scenario.modelVersion || 'forecast'
    };
    recordBranchActivity(
      branch,
      'simulation',
      'Simulation complete',
      'Simulation map generated for ' + FINAL_YEAR + ' (' + (popDelta >= 0 ? '+' : '') + fmtNumber(popDelta) + ' population)',
      FINAL_YEAR,
      {
        postcode: building && building.postcode,
        modelVersion: scenario.modelVersion || 'forecast',
        metrics: metrics
      }
    );
  }

  // T4.1: handle on the in-flight sim run so the Cancel button can abort.
  let __simAbortController = null;
  let __simPlaybackTimer = null;

  function showSimProgress(label, fillPct) {
    if (!els.simProgress) return;
    els.simProgress.hidden = false;
    if (els.simProgressLabel && label) els.simProgressLabel.textContent = label;
    if (els.simProgressFill) els.simProgressFill.style.width = Math.max(0, Math.min(100, fillPct || 0)) + '%';
  }
  function hideSimProgress() {
    if (!els.simProgress) return;
    els.simProgress.hidden = true;
    if (els.simProgressFill) els.simProgressFill.style.width = '0%';
  }
  function endSimRun(branch, opts) {
    if (__simPlaybackTimer) { clearInterval(__simPlaybackTimer); __simPlaybackTimer = null; }
    __simAbortController = null;
    state.isRunningSim = false;
    if (els.runBtn) els.runBtn.classList.remove('running');
    updateRunButtonLabel();
    updateScenarioDiffButton();
    hideSimProgress();
  }
  function cancelSimRun() {
    if (!state.isRunningSim) return;
    if (__simAbortController) {
      try { __simAbortController.abort(); } catch (e) {}
    }
    if (__simPlaybackTimer) { clearInterval(__simPlaybackTimer); __simPlaybackTimer = null; }
    state.isRunningSim = false;
    if (els.runBtn) els.runBtn.classList.remove('running');
    updateRunButtonLabel();
    hideSimProgress();
    toast('Simulation cancelled.', 'warn');
  }

  async function runSimulation() {
    if (state.isRunningSim) return;
    if (!isSimYear(state.year)) {
      toast('Switch to a 2026-2036 simulation year before running a forecast.', 'warn');
      updateRunButtonLabel();
      return;
    }
    const branch = activeBranch();
    if (state.activeTool === 'road') {
      runRoadComparison();
      return;
    }
    const building = selectedScenarioBuilding(branch);
    if (!building) {
      toast('Add a building or select an existing city building to delete before running the forecast.', 'warn');
      return;
    }
    state.isRunningSim = true;
    if (els.runBtn) els.runBtn.classList.add('running');
    if (els.runBtnLabel) els.runBtnLabel.textContent = 'Simulating...';
    clearImpactVisualization({ clearTraffic: true, clearTransit: true });
    // T4.1: prepare an AbortController so Cancel can stop the in-flight
    // network call. Show the progress overlay immediately.
    __simAbortController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    if (els.simProgressCancel) els.simProgressCancel.disabled = false;
    showSimProgress('Calling AI planner…', 8);
    // Slow indeterminate-feeling crawl while the network call is in flight.
    let crawl = 8;
    const crawlTimer = setInterval(() => {
      crawl = Math.min(crawl + 2, 65);
      if (els.simProgressFill) els.simProgressFill.style.width = crawl + '%';
    }, 350);

    const scenario = await runScenarioForBranch(branch, building, {
      signal: __simAbortController ? __simAbortController.signal : undefined
    });
    clearInterval(crawlTimer);
    // If the user cancelled, runScenarioForBranch returned null silently.
    if (!state.isRunningSim) return; // already cleaned up by cancelSimRun
    if (!scenario) {
      endSimRun(branch);
      return;
    }
    setView('3D');
    updateScenarioDiffButton();
    showSimProgress('Forecast received. Playing 2026 → 2036…', 70);
    // Animate playback through sim years
    let i = 0;
    setYear(START_YEAR);
    __simPlaybackTimer = setInterval(() => {
      i++;
      if (i >= SIM_YEARS.length) {
        endSimRun(branch);
        // Stop on 2036, show outcome
        const m = metricsForBranchYear(branch, FINAL_YEAR);
        const popDelta = m.population - METRICS[0].baseline;
        completeSimulationWorkspace(branch, scenario, building, m);
        toast('Simulation complete — projected ' + (popDelta >= 0 ? '+' : '') + fmtNumber(popDelta) + ' population by 2036');
        return;
      }
      const yr = SIM_YEARS[i];
      setYear(yr);
      const pct = 70 + Math.round(((i + 1) / SIM_YEARS.length) * 30);
      showSimProgress('Playing ' + yr + ' …', pct);
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
  //   1. User searches a postcode. The searched coordinate is stored, and
  //      the Road tool arms the planner from that coordinate.
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
    searchCentre: null,
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
        layout: { visibility: 'none' }
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
        layout: { visibility: 'none' }
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

  function syncRoadPlannerVisibility() {
    if (!state.map) return;
    const visible = state.activeTool === 'road' && roadPlanner.armed;
    ['road-planner-junctions-halo', 'road-planner-junctions-dot'].forEach(id => {
      if (state.map.getLayer(id)) {
        state.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    });
    if (els.planRoadHint && state.activeTool !== 'road') {
      els.planRoadHint.hidden = true;
    }
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
    syncRoadPlannerVisibility();
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
    syncRoadPlannerVisibility();
  }

  function showPlanRoadHint(text) {
    if (!els.planRoadHint) return;
    els.planRoadHint.hidden = false;
    if (els.planRoadStep) els.planRoadStep.textContent = text;
    // T3.3: re-compute the stepper highlight from current state so callers
    // don't have to manually pass step numbers.
    refreshRoadStepper();
  }

  // T3.3: paint the 3-step indicator inside #planRoadHint based on the
  // current planner state. Step 1 = waiting for postcode, step 2 = first
  // junction pick, step 3 = second junction pick.
  function refreshRoadStepper() {
    if (!els.planRoadHint) return;
    let active = 1;
    if (roadPlanner.armed && roadPlanner.pickedIds && roadPlanner.pickedIds.length === 0) active = 2;
    if (roadPlanner.armed && roadPlanner.pickedIds && roadPlanner.pickedIds.length >= 1) active = 3;
    els.planRoadHint.querySelectorAll('[data-prs-step]').forEach(li => {
      const n = Number(li.getAttribute('data-prs-step'));
      li.classList.toggle('done', n < active);
      li.classList.toggle('active', n === active);
      li.classList.toggle('pending', n > active);
    });
  }

  // Called by the postcode search flow once we've zoomed to a location.
  function armRoadPlanner(centreCoord) {
    if (!Array.isArray(centreCoord) || centreCoord.length !== 2) return;
    roadPlanner.searchCentre = centreCoord;
    if (state.activeTool !== 'road') {
      roadPlanner.armed = false;
      roadPlanner.centre = null;
      roadPlanner.junctions = [];
      roadPlanner.pickedIds = [];
      if (state.map && state.map.getSource('road-planner-junctions')) {
        state.map.getSource('road-planner-junctions').setData(emptyFC());
      }
      syncRoadPlannerVisibility();
      return;
    }
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
    if (state.activeTool !== 'road' || !roadPlanner.armed) return;
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
  function runRoadComparison(itemId) {
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
    if (itemId || roadPlanner.candidateRoadItemId) {
      const found = roadItems.find(it => it.id === (itemId || roadPlanner.candidateRoadItemId));
      if (found) cand = found;
    }
    roadPlanner.candidateRoadItemId = cand.id;

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
    // then run the headless comparison and paint the road-link pressure view.
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
            // Persistent on-map road-link pressure view. Stays visible after
            // the modal closes.
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
      '<div class="cl-head"><strong>Agent-swarm congestion</strong>' +
        '<button class="cl-clear" type="button" title="Clear overlay">&times;</button></div>' +
      '<div class="cl-ramp">' +
        '<span class="cl-step" style="background:#2563eb"></span>' +
        '<span class="cl-step" style="background:#22d3ee"></span>' +
        '<span class="cl-step" style="background:#34d399"></span>' +
        '<span class="cl-step" style="background:#facc15"></span>' +
        '<span class="cl-step" style="background:#fb923c"></span>' +
        '<span class="cl-step" style="background:#dc2626"></span>' +
      '</div>' +
      '<div class="cl-ramp-labels"><span>Free flow</span><span>Jammed</span></div>' +
      '<div class="cl-row"><span class="cl-sw cl-sw-new"></span> New road</div>';
    const canvas = document.querySelector('.map-canvas') || document.body;
    canvas.appendChild(wrap);
    congestionLegendEl = wrap;
    wrap.querySelector('.cl-clear').addEventListener('click', clearCongestionOverlay);
  }
  function clearCongestionOverlay() {
    if (window.TrafficSim) {
      if (typeof window.TrafficSim.clearComparisonOverlay === 'function') window.TrafficSim.clearComparisonOverlay();
      if (typeof window.TrafficSim.clearAgentSwarmOverlay === 'function') window.TrafficSim.clearAgentSwarmOverlay();
    }
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
    if (els.planRoadCancel) {
      // T3.3: Cancel exits the entire road workflow — clears picks, hides
      // the stepper, and deactivates the Road tool so the user is back to a
      // neutral select state. Re-activating the tool starts over.
      els.planRoadCancel.addEventListener('click', () => {
        clearRoadPlanner();
        state.activeTool = null;
        state.pendingRoadStart = null;
        renderModify();
      });
    }
  }

  // ---------- EXPORT ----------

  function baselineBranch() {
    return state.branches.find(b => b.id === 'baseline') || state.branches[0];
  }

  function setExportStatus(message, kind) {
    if (!els.exportStatus) return;
    const text = String(message || '').trim();
    els.exportStatus.hidden = !text;
    els.exportStatus.textContent = text;
    els.exportStatus.className = 'export-note' + (kind ? ' ' + kind : '');
  }

  function exportMode() {
    const checked = document.querySelector('input[name="exportMode"]:checked');
    return checked ? checked.value : 'single';
  }

  function syncExportModeControls() {
    const compare = exportMode() === 'compare';
    syncExportBranchPair();
    if (els.exportBranchBWrap) els.exportBranchBWrap.hidden = !compare;
    if (els.exportBranchB) els.exportBranchB.disabled = !compare || state.branches.length < 2;
    if (els.exportGenerateBtn) els.exportGenerateBtn.disabled = compare && state.branches.length < 2;
    setExportStatus('');
  }

  function populateExportSelect(select, selectedId) {
    if (!select) return;
    select.innerHTML = state.branches.map(branch =>
      '<option value="' + escapeHtml(branch.id) + '">' + escapeHtml(branch.name) + '</option>'
    ).join('');
    if (selectedId && state.branches.find(branch => branch.id === selectedId)) select.value = selectedId;
  }

  function syncExportBranchPair() {
    if (!els.exportBranchA || !els.exportBranchB || exportMode() !== 'compare') return;
    if (els.exportBranchA.value !== els.exportBranchB.value) return;
    const fallback = state.branches.find(branch => branch.id !== els.exportBranchA.value);
    if (fallback) els.exportBranchB.value = fallback.id;
  }

  function openExportModal() {
    if (!els.exportModal) return;
    const active = activeBranch();
    populateExportSelect(els.exportBranchA, active && active.id);
    const second = state.branches.find(branch => branch.id !== (active && active.id));
    populateExportSelect(els.exportBranchB, second ? second.id : (active && active.id));
    const single = document.querySelector('input[name="exportMode"][value="single"]');
    if (single) single.checked = true;
    setExportStatus('');
    syncExportModeControls();
    els.exportModal.hidden = false;
  }

  function exportResults() {
    openExportModal();
  }

  function selectedExportBranches() {
    const mode = exportMode();
    const first = state.branches.find(branch => branch.id === (els.exportBranchA && els.exportBranchA.value)) || activeBranch();
    if (mode !== 'compare') return [first];
    let second = state.branches.find(branch => branch.id === (els.exportBranchB && els.exportBranchB.value));
    if (!second || second.id === first.id) {
      second = state.branches.find(branch => branch.id !== first.id);
    }
    return second ? [first, second] : [first];
  }

  function rawForecastMetricsForYear(year) {
    const summary = state.baselineForecast && state.baselineForecast.summaryByYear;
    return summary && summary[String(year)] ? summary[String(year)] : null;
  }

  function scenarioRawMetricsForBranchYear(branch, year) {
    const scenario = scenarioResultForBranch(branch);
    const forecastBranch = selectedForecastScenarioBranch(scenario, branch);
    const row = forecastBranch && forecastBranch.timelineByYear
      ? forecastBranch.timelineByYear[String(year)]
      : null;
    return (row && row.metrics) || (forecastBranch && forecastBranch.metrics) || rawForecastMetricsForYear(year) || {};
  }

  function scenarioDiffForBranchYear(branch, year) {
    const scenario = scenarioResultForBranch(branch);
    const forecastBranch = selectedForecastScenarioBranch(scenario, branch);
    const row = forecastBranch && forecastBranch.timelineByYear
      ? forecastBranch.timelineByYear[String(year)]
      : null;
    return (row && row.diffFromBaseline) || (forecastBranch && forecastBranch.diffFromBaseline) || {};
  }

  function compactExportItem(item) {
    const config = item.buildingConfig || item.config || {};
    return {
      id: item.id,
      type: item.type,
      label: item.label || branchItemTitle(item),
      year: item.year,
      preset: item.preset,
      plannerEngine: item.plannerEngine,
      buildingConfig: config,
      capacityKva: item.capacityKva,
      serviceRadiusM: item.serviceRadiusM || item.radiusM,
      path: Array.isArray(item.path) ? item.path : undefined,
      start: item.start,
      end: item.end,
      lengthM: item.type === 'road' ? roadLengthMeters(item) : undefined
    };
  }

  function branchScenarioMeta(branch) {
    const scenario = scenarioResultForBranch(branch);
    const forecastBranch = selectedForecastScenarioBranch(scenario, branch);
    const critic = scenario && scenario.critic ? scenario.critic : {};
    const report = scenario && scenario.report ? scenario.report : {};
    return {
      modelVersion: scenario && scenario.modelVersion,
      transformerModelVersion: scenario && scenario.transformerModelVersion,
      recommendedBranch: scenario && scenario.recommendedBranch,
      selectedForecastBranch: forecastBranch && forecastBranch.name,
      confidenceLabel: critic.confidenceLabel || critic.confidence_label,
      reportHeadline: report.headline,
      reportSummary: report.summary
    };
  }

  function branchExportSnapshot(branch, target) {
    return {
      id: branch.id,
      name: branch.name,
      color: branch.color,
      locked: branch.locked,
      forecastObjective: branch.forecastObjective || objectiveForBranch(branch),
      metrics: metricsForBranchYear(branch, target),
      baselineMetrics: metricsForBranchYear(baselineBranch(), target),
      rawForecastMetrics: scenarioRawMetricsForBranchYear(branch, target),
      diffFromBaseline: scenarioDiffForBranchYear(branch, target),
      concreteImpacts: concreteImpactsForBranchYear(branch, target),
      timeline: SIM_YEARS.map(year => ({
        year: year,
        metrics: metricsForBranchYear(branch, year),
        rawForecastMetrics: scenarioRawMetricsForBranchYear(branch, year)
      })),
      items: (branch.items || []).map(compactExportItem),
      activityLog: (branch.activityLog || []).slice(-12),
      scenario: branchScenarioMeta(branch)
    };
  }

  async function ensureBranchReportData(branch) {
    if (!branch || branch.locked || scenarioResultForBranch(branch)) return;
    const building = selectedScenarioBuilding(branch);
    if (!building) return;
    await runScenarioForBranch(branch, building);
  }

  function filenameFromDisposition(header, fallback) {
    const match = String(header || '').match(/filename="?([^";]+)"?/i);
    return match ? match[1] : fallback;
  }

  async function submitExportPdf(event) {
    event.preventDefault();
    const selected = selectedExportBranches();
    if (exportMode() === 'compare' && selected.length < 2) {
      return;
    }
    const target = isSimYear(state.year) ? state.year : FINAL_YEAR;
    const button = els.exportGenerateBtn;
    if (button) {
      button.disabled = true;
    }
    try {
      for (const branch of selected) {
        await ensureBranchReportData(branch);
      }
      const payload = {
        generatedAt: new Date().toISOString(),
        targetYear: target,
        baselineYear: BASE_YEAR,
        forecastYears: SIM_YEARS,
        baselineMetrics: metricsForBranchYear(baselineBranch(), target),
        rawBaselineMetrics: rawForecastMetricsForYear(target) || {},
        source: {
          app: 'Replay Belfast Scenario Studio',
          deterministicBasis: 'Local 2025 baseline forecast, deterministic scenario branch metrics, concrete impact outputs, and branch intervention state.',
          generatedBy: 'Dashboard export button'
        },
        branches: selected.map(branch => branchExportSnapshot(branch, target))
      };
      const response = await fetch('/api/export/branch-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        let detail = 'PDF export failed.';
        try {
          const error = await response.json();
          detail = error.detail || error.error || detail;
        } catch (_) {}
        if (response.status === 404 && detail === 'Not found') {
          detail = 'PDF export API is not available in the running server. Restart the local server and try again.';
        }
        throw new Error(detail);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filenameFromDisposition(response.headers.get('content-disposition'), 'belfast-scenario-report-' + target + '.pdf');
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
      if (els.exportModal) els.exportModal.hidden = true;
      toast('Exported scenario PDF');
    } catch (error) {
      setExportStatus(error.message || 'Could not create the PDF export.', 'error');
      toast('PDF export failed', 'error');
    } finally {
      if (button) {
        button.disabled = exportMode() === 'compare' && state.branches.length < 2;
      }
    }
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
      updateBuildabilityOverlay();
      syncCityBuildingHeightContext();
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

  // T3.4 / T3.5: a richer toast with an inline action button (e.g. "Undo").
  function toastWithAction(msg, actionLabel, onAction, opts) {
    if (!els.toast) return;
    const kind = (opts && opts.kind) || '';
    const ttlMs = (opts && opts.ttlMs) || 5500;
    els.toast.className = 'toast toast--with-action' + (kind ? ' ' + kind : '');
    els.toast.innerHTML = '<span class="toast-msg"></span>' +
      '<button type="button" class="toast-action">' + escapeHtml(actionLabel) + '</button>';
    els.toast.querySelector('.toast-msg').textContent = msg;
    els.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      els.toast.hidden = true;
      els.toast.innerHTML = '';
      els.toast.className = 'toast';
    };
    els.toast.querySelector('.toast-action').addEventListener('click', () => {
      dismiss();
      try { onAction(); } catch (e) { console.warn('toast action failed', e); }
    });
    toastTimer = setTimeout(dismiss, ttlMs);
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
    const branch = activeBranch();
    if (branch && branch.scenarioStaged) branch.solana = null;
    renderBranches();
    renderImpact();
    renderItemsOnMap();
    if (state.mode === 'simulation') {
      updateImpactRipples();
      updateImpactLensUI();
      // Re-paint the active lens cells heatmap so committed buildings, roads
      // and transformers immediately influence the year-by-year projection.
      const activeLens = lensDef(state.lens);
      if (activeLens) refreshCellsHeatmapPoints(activeLens);
    } else if (state.mode === 'historical' && state.lens === 'traffic') {
      refreshHistoricalTrafficSwarm();
    }
    renderLeftSidebar();
    refreshTransitLayer();
    updateScenarioDiffButton();
    refreshPlannerVariationsBtn();
    saveState();
  }

  // T3.2: enable/disable the AI-variations CTA based on whether the active
  // branch has at least one item to seed the alternate plans from.
  function refreshPlannerVariationsBtn() {
    if (!els.plannerVariationsBtn) return;
    const branch = activeBranch();
    const items = (branch && branch.items) || [];
    const ready = !branch?.locked && items.length > 0;
    els.plannerVariationsBtn.disabled = !ready;
    els.plannerVariationsBtn.title = ready
      ? 'Generate four AI alternatives that re-plan ' + (branch.name || 'this branch') + ' for Traffic, Jobs, Electricity, and Public Transit objectives.'
      : (branch?.locked
          ? 'Switch to a non-baseline branch first.'
          : 'Add an item to this branch first, then generate four AI alternatives.');
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
    state.buildabilityFocus = feat;
    state.buildabilityLoaded = false;
    state.buildabilityPostcodeKey = null;
    if (state.year < START_YEAR) setYear(START_YEAR);
    if (state.mode !== 'simulation') setMode('simulation');
    setView('3D');
    if (feat.canPlace) {
      state.selectedPostcode = feat;
      showSearchStatus((feat.postcode || feat.normalizedPostcode) + ' selected · Add Building enabled');
      if (state.year < START_YEAR) setYear(START_YEAR);
      setView('3D');
    } else {
      state.selectedPostcode = null;
      showSearchStatus('Showing possible build areas near ' + (feat.postcode || feat.normalizedPostcode || feat.input || 'postcode'));
    }
    if (feat.canPlace) {
      showSearchStatus((feat.postcode || feat.normalizedPostcode) + ' selected - loading possible build areas');
    }
    renderModify();
    updateBuildabilityOverlay();
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

  function isHistoricalMode() { return !isSimYear(state.year); }

  function setMode(mode) {
    state.mode = mode;
    if (mode === 'historical') {
      if (state.year > BASE_YEAR) state.year = BASE_YEAR;
      state.activeTool = null;
      state.pendingRoadStart = null;
    } else {
      if (state.year <= BASE_YEAR) state.year = START_YEAR;
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
      syncCityBuildingHeightContext();
    }
    updateScenarioDiffButton();
    updateRunButtonLabel();
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
    refreshTransitLayer();
    refreshWorkspaceSplit();
    saveState();
  }

  function toggleLensFilter(lensId) {
    if (!LENS_FILTER_IDS.includes(lensId)) return;
    setLens(state.lens === lensId ? DEFAULT_LENS : lensId);
  }

  function renderLensTabs() {
    const host = ensureToolbarLensHost();
    if (!host) return;
    // Lens filters live in both modes. Buildings is the hidden default base
    // view; clicking an active filter again returns to Buildings.
    host.hidden = false;
    host.innerHTML = LENS_FILTER_IDS.map(id => lensDef(id)).map(l => {
      const active = l.id === state.lens ? ' active' : '';
      return '<button class="lens-tab' + active + '" data-lens="' + l.id + '" type="button" aria-pressed="' + (active ? 'true' : 'false') + '" title="' + l.label + ' filter" style="--lens-color:' + l.color + '">' +
        lensIcon(l.id) + '<span>' + l.label + '</span>' +
        '</button>';
    }).join('');
    host.querySelectorAll('.lens-tab').forEach(b => {
      b.addEventListener('click', () => toggleLensFilter(b.getAttribute('data-lens')));
    });
  }

  async function loadGridYear(year) {
    if (year > 2026 && year <= FINAL_YEAR) return futureForecastGrid(year);
    if (year < 2016 || year > 2026) return null; // on-disk grids only exist for historical/current years
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

  function syncTransitForecastData() {
    const engine = window.PublicTransportEngine || window.TransitEngine;
    if (engine && typeof engine.setBaselineForecast === 'function' && state.baselineForecast) {
      engine.setBaselineForecast(state.baselineForecast);
    }
  }

  function forecastValueForCell(cell, year) {
    if (!cell) return {};
    if (year <= BASE_YEAR) return cell.baseline2025 || {};
    const rows = cell.forecastByYear || {};
    return rows[String(year)] || rows[String(FINAL_YEAR)] || cell.baseline2025 || {};
  }

  function previousForecastValueForCell(cell, year) {
    if (!cell) return {};
    if (year <= START_YEAR) return cell.baseline2025 || {};
    return forecastValueForCell(cell, year - 1);
  }

  function futureForecastGrid(year) {
    const y = clamp(Number(year) || START_YEAR, START_YEAR, FINAL_YEAR);
    const key = 'forecast-' + y;
    if (state.gridCache[key]) return state.gridCache[key];
    const cells = state.baselineForecast && Array.isArray(state.baselineForecast.cells)
      ? state.baselineForecast.cells
      : [];
    if (!cells.length) return null;
    const features = cells.map((cell, index) => {
      const current = forecastValueForCell(cell, y);
      const previous = previousForecastValueForCell(cell, y);
      const id = cell.cellId || cell.id || ('forecast-cell-' + index);
      const props = Object.assign({}, current, {
        cell_id: id,
        cellId: id,
        forecastYear: y,
        baselineYear: BASE_YEAR,
        buildings: Number(current.population || 0),
        traffic_delta_previous: round(Number(current.traffic || 0) - Number(previous.traffic || 0), 4),
        jobs_delta_previous: round(Number(current.jobs || 0) - Number(previous.jobs || 0), 4),
        electricity_delta_previous: round(Number(current.electricity || 0) - Number(previous.electricity || 0), 4),
        services_delta_previous: round(Number(current.services || 0) - Number(previous.services || 0), 4),
        buildings_delta_previous: round(Number(current.population || 0) - Number(previous.population || 0), 4),
        confidence: cell.confidence || 'medium',
        evidence: cell.evidence || [],
        baseline: cell.baseline2025 || {}
      });
      return {
        type: 'Feature',
        id,
        properties: props,
        geometry: cell.geometry
      };
    }).filter(feature => feature.geometry);
    state.gridCache[key] = { type: 'FeatureCollection', features: features };
    return state.gridCache[key];
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

  function ensureBuildabilityLayers() {
    if (!state.map || !state.mapLoaded) return false;
    const empty = { type: 'FeatureCollection', features: [] };
    if (!state.map.getSource('buildability-areas')) {
      state.map.addSource('buildability-areas', { type: 'geojson', data: empty });
    }
    // Per-cell green grid — only the cells the API marks `buildable: true`
    // get coloured, brightness scaling with buildabilityScore. The user
    // clicks any green cell to drop a building there.
    if (!state.map.getLayer('buildability-areas-fill')) {
      state.map.addLayer({
        id: 'buildability-areas-fill',
        type: 'fill',
        source: 'buildability-areas',
        paint: {
          'fill-color': [
            'interpolate', ['linear'],
            ['coalesce', ['to-number', ['get', 'buildabilityScore']], 0],
            0.0, '#166534',
            0.5, '#22c55e',
            1.0, '#bef264'
          ],
          'fill-opacity': [
            'case',
            ['==', ['get', 'buildable'], true],
            ['interpolate', ['linear'],
              ['coalesce', ['to-number', ['get', 'buildabilityScore']], 0],
              0.0, 0.32, 0.5, 0.50, 1.0, 0.68],
            0.0
          ]
        },
        layout: { visibility: 'none' }
      }, findFirstSymbolLayer());
    }
    if (!state.map.getLayer('buildability-areas-3d')) {
      state.map.addLayer({
        id: 'buildability-areas-3d',
        type: 'fill-extrusion',
        source: 'buildability-areas',
        paint: {
          'fill-extrusion-color': [
            'case',
            ['==', ['get', 'buildable'], true],
            ['rgba', 34, 197, 94,
              ['interpolate', ['linear'],
                ['coalesce', ['to-number', ['get', 'buildabilityScore']], 0],
                0.0, 0.30, 0.5, 0.50, 1.0, 0.68]
            ],
            ['rgba', 0, 0, 0, 0]
          ],
          'fill-extrusion-height': [
            'case',
            ['==', ['get', 'buildable'], true],
            ['+', 6, ['*', 36, ['coalesce', ['to-number', ['get', 'buildabilityScore']], 0]]],
            0
          ],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 1
        },
        layout: { visibility: 'none' }
      }, findFirstSymbolLayer());
    }
    if (!state.map.getLayer('buildability-areas-line')) {
      state.map.addLayer({
        id: 'buildability-areas-line',
        type: 'line',
        source: 'buildability-areas',
        paint: {
          'line-color': '#bbf7d0',
          'line-width': 0.9,
          'line-opacity': ['case', ['==', ['get', 'buildable'], true], 0.72, 0]
        },
        layout: { visibility: 'none' }
      }, findFirstSymbolLayer());
    }
    return true;
  }

  function buildabilityKey(focus) {
    if (!focus) return 'city';
    const label = focus.postcode || focus.normalizedPostcode || focus.outcode || 'postcode';
    const loc = focus.location || {};
    return [label, Number(loc.lng || 0).toFixed(5), Number(loc.lat || 0).toFixed(5), state.activeBuildingPreset].join('|');
  }

  async function loadBuildabilityAreas(focus) {
    const key = buildabilityKey(focus) + '|' + (state.activeBuildingPreset || '');
    if (state.buildabilityLoaded && state.buildabilityPostcodeKey === key) return;
    if (!state.map) return;
    // Use a per-call request id so a second click doesn't get blocked by a
    // stuck `loading` flag from a prior call that never resolved.
    const requestId = (state._buildabilityRequestId || 0) + 1;
    state._buildabilityRequestId = requestId;
    state.buildabilityLoading = true;
    try {
      const config = buildingConfigForPreset(state.activeBuildingPreset);
      const res = await fetch('/api/building/buildable-areas?preset=' + encodeURIComponent(state.activeBuildingPreset), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          config,
          postcode: null,
          location: null,
          radiusKm: null
        })
      });
      const json = await res.json().catch(() => null);
      if (state._buildabilityRequestId !== requestId) return; // stale
      if (!res.ok || !json || !json.areas) throw new Error((json && (json.detail || json.error)) || 'buildability fetch failed');
      if (state.map.getSource('buildability-areas')) {
        state.map.getSource('buildability-areas').setData(json.areas);
      }
      state.buildabilityLoaded = true;
      state.buildabilityPostcodeKey = key;
    } catch (error) {
      console.warn('buildability overlay failed', error);
    } finally {
      if (state._buildabilityRequestId === requestId) state.buildabilityLoading = false;
    }
  }

  function updateBuildabilityOverlay() {
    if (!ensureBuildabilityLayers()) {
      // Even before the map is ready we want the legend to track state, so
      // it's not stuck visible across mode/tool changes.
      refreshBuildabilityLegend(false);
      return;
    }
    const visible = state.mode === 'simulation' && isSimYear(state.year) && Boolean(state.buildabilityFocus || state.activeTool === 'building');
    const show3d = visible && state.view === '3D';
    [
      'buildability-areas-fill',
      'buildability-areas-line',
      'buildability-areas-3d'
    ].forEach(id => {
      if (!state.map.getLayer(id)) return;
      const layerVisible = id === 'buildability-areas-3d' ? show3d : visible;
      state.map.setLayoutProperty(id, 'visibility', layerVisible ? 'visible' : 'none');
    });
    // Always load CITY-WIDE buildable areas — postcode selection no longer
    // narrows the overlay. The whole of Belfast is highlighted, the user
    // zooms in and clicks any green spot.
    if (visible) loadBuildabilityAreas(null);
    refreshBuildabilityLegend(visible);
  }

  // T4.3: keep the on-map legend in sync with the buildability overlay so the
  // user knows what the green shading means and which preset it scores for.
  function refreshBuildabilityLegend(_visible) {
    // Legend is suppressed — the continuous green boundary speaks for itself.
    if (!els.buildabilityLegend) return;
    els.buildabilityLegend.hidden = true;
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
        'line-color': '#2563eb',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.35, 13, 1.0, 16, 2.2],
        'line-opacity': 0.52
      },
      layout: { visibility: 'none' }
    }, refLayerId);
    state.map.addLayer({
      id: 'ctx-roads-glow', type: 'line', source: 'ctx-roads',
      paint: {
        'line-color': '#22d3ee',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 13, 3.2, 16, 8],
        'line-opacity': 0.12,
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
        'fill-opacity': ['coalesce', ['get', '__opacity'], 0.45]
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
    attachCityBuildingSelectionHandlers();
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
    if (year > 2026 && year <= FINAL_YEAR) return loadFutureElectricityYear(year);
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

  function nearestForecastGridFeature(coord, grid) {
    const features = grid && Array.isArray(grid.features) ? grid.features : [];
    if (!coord || !features.length) return null;
    let best = null;
    let bestKm = Infinity;
    features.forEach(feature => {
      const centre = polygonCentroid(feature.geometry);
      if (!centre) return;
      const km = coordDistKm(coord, centre);
      if (km < bestKm) {
        best = feature;
        bestKm = km;
      }
    });
    return best;
  }

  async function loadFutureElectricityYear(year) {
    const y = clamp(Number(year) || START_YEAR, START_YEAR, FINAL_YEAR);
    const key = 'forecast-' + y;
    if (electricityCache[key]) return electricityCache[key];
    const base = await loadElectricityYear(2026);
    const grid = futureForecastGrid(y);
    if (!base || !grid) return null;
    const features = (base.features || []).map((feature, index) => {
      const coord = pointOrCentroid(feature.geometry);
      const cell = nearestForecastGridFeature(coord, grid);
      const props = Object.assign({}, feature.properties || {});
      const electricity = Number(cell && cell.properties && cell.properties.electricity);
      const baseline = Number(cell && cell.properties && cell.properties.baseline && cell.properties.baseline.electricity);
      const loadPct = Number.isFinite(electricity)
        ? clamp(38 + electricity * 62, 18, 100)
        : Number(props.grid_load_pct || 58);
      const basePct = Number.isFinite(baseline) ? clamp(38 + baseline * 62, 18, 100) : Number(props.grid_load_pct || loadPct);
      props.grid_load_pct = Math.round(loadPct);
      props.headroom_pct = Math.max(0, Math.round(100 - loadPct));
      props.forecast_delta_pct = Math.round((loadPct - basePct) * 10) / 10;
      props.status = loadPct >= 88 ? 'Forecast constraint' : loadPct >= 74 ? 'Forecast watch' : 'Forecast headroom';
      props.forecastYear = y;
      props.cell_id = (cell && cell.properties && cell.properties.cell_id) || props.cell_id || ('electricity-' + index);
      return Object.assign({}, feature, { properties: props });
    });
    electricityCache[key] = { type: 'FeatureCollection', features };
    return electricityCache[key];
  }

  async function renderHistoricalMapLayers() {
    if (!state.mapLoaded) return;
    if (!isHistoricalMode()) {
      if (state.contextLayersAdded) setHistoricalLayerVisibility(false);
      if (window.TrafficSim && typeof window.TrafficSim.clearAgentSwarmOverlay === 'function') {
        window.TrafficSim.clearAgentSwarmOverlay();
      }
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

  async function renderSimulationMapLayers() {
    if (!state.mapLoaded || isHistoricalMode()) return;
    ensureHistoricalSourcesAndLayers();
    setHistoricalLayerVisibility(true);
    const lens = lensDef(state.lens);
    showContextForLens(lens);
    await refreshHistoricalCells();
    if (state.map.getSource('hist-events')) state.map.getSource('hist-events').setData({ type: 'FeatureCollection', features: [] });
    if (state.map.getSource('hist-highlight')) state.map.getSource('hist-highlight').setData({ type: 'FeatureCollection', features: [] });
  }

  function cityBuildingFilter() {
    const base = ['<=', ['coalesce', ['to-number', ['get', 'replay_first_visible_year']], 2016], state.year];
    const removed = removedExistingBuildingIds();
    if (!removed.length) return base;
    return ['all', base, ['!', ['in', ['to-string', ['get', 'source_id']], ['literal', removed]]]];
  }

  function removedExistingBuildingIds(branch) {
    return ((branch || activeBranch()).items || [])
      .filter(item => item.type === 'building_removal' && item.existingBuildingId)
      .map(item => String(item.existingBuildingId));
  }

  function cityBuildingColorExpression(focused) {
    if (focused) {
      return [
        'case',
        ['==', ['coalesce', ['to-number', ['get', 'replay_first_visible_year']], 2016], state.year],
        '#facc15',
        '#3b82f6'
      ];
    }
    return [
      'case',
      ['==', ['coalesce', ['to-number', ['get', 'replay_first_visible_year']], 2016], state.year],
      '#f59e0b',
      '#64748b'
    ];
  }

  function cityBuildingHeightExpression(scale) {
    return [
      '*',
      ['coalesce',
        ['to-number', ['get', 'replay_height_m']],
        ['to-number', ['get', 'height']],
        ['*', ['coalesce', ['to-number', ['get', 'building:levels']], 4], 3],
        12
      ],
      scale
    ];
  }

  function applyCityBuildingHeightStyle(focused) {
    const map = state.map;
    if (!map || !map.getLayer('ctx-buildings-3d')) return;
    map.setFilter('ctx-buildings-3d', cityBuildingFilter());
    map.setPaintProperty('ctx-buildings-3d', 'fill-extrusion-color', cityBuildingColorExpression(focused));
    map.setPaintProperty('ctx-buildings-3d', 'fill-extrusion-height', cityBuildingHeightExpression(focused ? 1 : 0.82));
    map.setPaintProperty('ctx-buildings-3d', 'fill-extrusion-opacity', focused ? 0.78 : 0.42);
  }

  function loadCityBuildingContext() {
    loadContextLayer('belfast-ni-buildings-3d').then(data => {
      if (data && state.map && state.map.getSource('ctx-buildings')) {
        state.map.getSource('ctx-buildings').setData(data);
      }
    });
  }

  function syncCityBuildingHeightContext() {
    if (!state.mapLoaded || !state.map) return;
    const shouldShow2dSelection = state.mode === 'simulation' && (state.activeTool === 'remove' || !state.activeTool);
    if (state.view !== '3D') {
      ensureHistoricalSourcesAndLayers();
      if (state.map.getLayer('ctx-buildings-fill')) {
        state.map.setFilter('ctx-buildings-fill', cityBuildingFilter());
        state.map.setPaintProperty('ctx-buildings-fill', 'fill-color', cityBuildingColorExpression(false));
        state.map.setPaintProperty('ctx-buildings-fill', 'fill-opacity', shouldShow2dSelection ? 0.28 : 0.65);
        state.map.setLayoutProperty('ctx-buildings-fill', 'visibility', shouldShow2dSelection ? 'visible' : 'none');
      }
      if (state.map.getLayer('ctx-buildings-3d')) {
        state.map.setLayoutProperty('ctx-buildings-3d', 'visibility', 'none');
      }
      if (shouldShow2dSelection) loadCityBuildingContext();
      return;
    }
    ensureHistoricalSourcesAndLayers();
    const focused = isHistoricalMode() && state.lens === 'buildings';
    applyCityBuildingHeightStyle(focused);
    if (state.map.getLayer('ctx-buildings-fill')) {
      state.map.setLayoutProperty('ctx-buildings-fill', 'visibility', 'none');
    }
    if (state.map.getLayer('ctx-buildings-3d')) {
      state.map.setLayoutProperty('ctx-buildings-3d', 'visibility', 'visible');
    }
    loadCityBuildingContext();
  }

  function attachCityBuildingSelectionHandlers() {
    if (state.cityBuildingSelectionAttached || !state.map) return;
    state.cityBuildingSelectionAttached = true;
    ['ctx-buildings-fill', 'ctx-buildings-3d'].forEach(layerId => {
      state.map.on('click', layerId, (e) => {
        if (state.activeTool && state.activeTool !== 'remove') return;
        if (!e.features || !e.features.length) return;
        const feature = e.features[0];
        if (state.activeTool === 'remove') {
          stageExistingBuildingRemoval(feature);
        } else {
          openExistingBuildingModal(feature);
        }
        if (e.originalEvent && typeof e.originalEvent.stopPropagation === 'function') e.originalEvent.stopPropagation();
        e.preventDefault && e.preventDefault();
      });
      state.map.on('mouseenter', layerId, () => {
        if (state.activeTool && state.activeTool !== 'remove') return;
        state.map.getCanvas().style.cursor = state.activeTool === 'remove' ? 'not-allowed' : 'pointer';
      });
      state.map.on('mouseleave', layerId, () => {
        if (!state.activeTool || state.activeTool === 'remove') state.map.getCanvas().style.cursor = '';
      });
    });
  }

  function footprintRingFromGeometry(geometry) {
    if (!geometry) return null;
    if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates) && Array.isArray(geometry.coordinates[0])) {
      return geometry.coordinates[0];
    }
    if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates) && geometry.coordinates[0] && geometry.coordinates[0][0]) {
      return geometry.coordinates[0][0];
    }
    return null;
  }

  function existingBuildingItemFromFeature(feature) {
    const props = feature.properties || {};
    const coord = pointOrCentroid(feature.geometry);
    if (!coord) return null;
    const sourceId = String(props.source_id || props.id || props.osm_id || uid('existing-building'));
    const name = props.name || props.building || 'Existing building';
    const config = buildingConfigForExisting(props);
    return {
      id: 'item-' + (state.nextItemId++),
      type: 'building_removal',
      year: clamp(state.year || START_YEAR, START_YEAR, FINAL_YEAR),
      createdAt: new Date().toISOString(),
      lng: Number(coord[0]),
      lat: Number(coord[1]),
      location: { lng: Number(coord[0]), lat: Number(coord[1]) },
      geometry: feature.geometry,
      footprint: footprintRingFromGeometry(feature.geometry),
      existingBuildingId: sourceId,
      existingBuildingName: name,
      preset: 'removal',
      buildingConfig: config,
      color: '#ef4444',
      label: 'Remove ' + String(name).slice(0, 42),
      height: 4
    };
  }

  function stageExistingBuildingRemoval(feature) {
    const branch = ensureEditableBranch();
    if (!branch || branch.locked) {
      // T2.3: replay the removal once the user picks a writable branch.
      rememberLockedEdit(() => stageExistingBuildingRemoval(feature), 'remove building');
      return;
    }
    const item = existingBuildingItemFromFeature(feature);
    if (!item) return;
    if ((branch.items || []).some(existing => existing.type === 'building_removal' && existing.existingBuildingId === item.existingBuildingId)) {
      toast('That building is already staged for removal in this branch.', 'warn');
      return;
    }
    branch.items.push(item);
    branch.forecastObjective = objectiveForBranch(branch);
    branch.scenarioResult = null;
    branch.scenarioStaged = true;
    if (state.lastScenarioResult && state.activeBranchId === branch.id) state.lastScenarioResult = null;
    state.lastPlacedItemId = item.id;
    closeWorkspaceSplit();
    if (state.year < START_YEAR) setYear(START_YEAR);
    afterChange();
    syncCityBuildingHeightContext();
    // T3.4 + T3.5: register undo and surface a stronger Undo toast for
    // city-building removals (they affect the baseline footprint visible to
    // every viewer of this branch).
    pushUndo({
      type: 'remove-city',
      label: 'Remove ' + (item.existingBuildingName || 'existing building'),
      do: () => {
        const b = state.branches.find(x => x.id === branch.id);
        if (!b) return;
        b.items = b.items.filter(it => it.id !== item.id);
        b.scenarioResult = null;
        b.scenarioStaged = true;
        afterChange();
        syncCityBuildingHeightContext();
      }
    });
    toastWithAction(
      'Staged removal of ' + (item.existingBuildingName || 'existing building') + '. Run Simulation to forecast the impact.',
      'Undo',
      () => undoLast(),
      { ttlMs: 6000 }
    );
  }

  function openExistingBuildingModal(feature) {
    const props = feature.properties || {};
    const name = props.name || props.building || 'Existing building';
    const sourceId = props.source_id || props.id || '';
    const config = buildingConfigForExisting(props);
    openModalCustom(String(name).slice(0, 80), function (body, close) {
      body.innerHTML = '' +
        '<div class="inspect-row"><span class="k">Source</span><span class="v">' + escapeHtml(sourceId || 'mapped footprint') + '</span></div>' +
        '<div class="inspect-row"><span class="k">Footprint</span><span class="v">' + escapeHtml(String(config.footprintSqm)) + ' sqm</span></div>' +
        '<div class="inspect-row"><span class="k">Estimated floors</span><span class="v">' + escapeHtml(String(config.floors)) + '</span></div>' +
        '<div class="inspect-row"><span class="k">Replay visible from</span><span class="v">' + escapeHtml(props.replay_first_visible_year || 'baseline') + '</span></div>' +
        '<div class="inspect-actions">' +
          '<button data-act="zoom" type="button">Zoom on map</button>' +
          '<button data-act="remove-existing" class="danger" type="button">Delete from scenario</button>' +
        '</div>';
      body.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          const act = btn.getAttribute('data-act');
          if (act === 'zoom') {
            const coord = pointOrCentroid(feature.geometry);
            if (coord && state.map) state.map.flyTo({ center: coord, zoom: 16, pitch: state.view === '3D' ? 62 : 0, duration: 750 });
            close();
          }
          if (act === 'remove-existing') {
            stageExistingBuildingRemoval(feature);
            close();
          }
        });
      });
    });
  }

  function showContextForLens(lens) {
    const map = state.map;
    const id = lens.id;
    const isBuildings = id === 'buildings';
    const isTraffic = id === 'traffic';
    const isElec = id === 'electricity';
    const isJobs = id === 'jobs';
    // Jobs keeps the smooth point heatmap. Public Transit is handled by the
    // route/stop overlay in transit-engine.js so it reads like a network map.
    const useHeatmap = isJobs || (isSimYear(state.year) && id === 'services');

    // Water always on as soft base.
    map.setLayoutProperty('ctx-water-fill', 'visibility', 'visible');

    // Buildings: filtered by year, 2D fill or 3D extrusion. Highlight new this year in yellow.
    if (map.getLayer('ctx-buildings-fill')) {
      map.setFilter('ctx-buildings-fill', cityBuildingFilter());
      map.setPaintProperty('ctx-buildings-fill', 'fill-color', cityBuildingColorExpression(true));
    }
    applyCityBuildingHeightStyle(isBuildings);
    map.setLayoutProperty('ctx-buildings-fill', 'visibility', isBuildings && state.view === '2D' ? 'visible' : 'none');
    map.setLayoutProperty('ctx-buildings-3d',   'visibility', state.view === '3D' ? 'visible' : 'none');

    // Traffic: real road network underneath the heatmap
    map.setLayoutProperty('ctx-roads-line', 'visibility', isTraffic ? 'visible' : 'none');
    map.setLayoutProperty('ctx-roads-glow', 'visibility', isTraffic ? 'visible' : 'none');

    // Electricity: GRID-style substation hotspot heatmap + power lines
    map.setLayoutProperty('ctx-power-line', 'visibility', isElec ? 'visible' : 'none');
    ['grid-substations-bleed', 'grid-substations-mid', 'grid-substations-core'].forEach(L => {
      if (map.getLayer(L)) map.setLayoutProperty(L, 'visibility', isElec ? 'visible' : 'none');
    });

    // Jobs is rendered as a heatmap only — POI dots stay hidden so the lens
    // reads cleanly without per-frame jitter from anchor/transport markers.
    map.setLayoutProperty('ctx-services-circle', 'visibility', 'none');
    map.setLayoutProperty('ctx-transport-circle', 'visibility', 'none');

    // Smooth heatmap for jobs; traffic uses road-link swarm lines.
    map.setLayoutProperty('lens-heatmap', 'visibility', useHeatmap ? 'visible' : 'none');
    if (useHeatmap) {
      // Color ramp per lens. The first stop has alpha so areas outside the
      // cell coverage (water, off-extent) stay transparent; everywhere inside
      // the city renders a graded jobs surface.
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
    } else if (map.getSource('cells-points')) {
      map.getSource('cells-points').setData({ type: 'FeatureCollection', features: [] });
    }

    if (isTraffic) refreshHistoricalTrafficSwarm();
    else if (window.TrafficSim && typeof window.TrafficSim.clearAgentSwarmOverlay === 'function') {
      window.TrafficSim.clearAgentSwarmOverlay();
      if (congestionLegendEl) congestionLegendEl.style.display = 'none';
    }

    if (isElec) {
      loadElectricityYear(state.year).then(data => {
        if (data && map.getSource('grid-substations')) map.getSource('grid-substations').setData(data);
        // Re-spawn particles once substations land — gives the animation real
        // anchor points instead of an empty layer.
        if (state.lens === 'electricity') startLensParticleAnimation('electricity');
      });
    }

    // Animated lens particles — appear/disappear at jobs, electricity and
    // public-transit anchor points. Mirrors the "live city" feel of the
    // traffic swarm but for the slower-moving infrastructure metrics.
    if (id === 'jobs' || id === 'electricity' || id === 'services') {
      startLensParticleAnimation(id);
    } else {
      stopLensParticleAnimation();
    }

    // Lazy-fetch the relevant 2026 context layer geojsons.
    const isServices = id === 'services';
    const wantsByLayer = {
      'belfast-ni-buildings-3d':       isBuildings || state.view === '3D',
      'source-ni-roads-osm':           isTraffic,
      'source-ni-power-grid-osm':      isElec,
      'source-ni-water-osm':           true,
      'source-ni-services-osm':        isJobs || isServices,
      'source-ni-transport-stops-osm': isJobs || isServices
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
        // Re-seed particle anchors once the relevant POI layer arrives.
        if (state.lens === 'jobs' && (layerId === 'source-ni-services-osm' || layerId === 'source-ni-transport-stops-osm')) {
          startLensParticleAnimation('jobs');
        } else if (state.lens === 'services' && (layerId === 'source-ni-services-osm' || layerId === 'source-ni-transport-stops-osm')) {
          startLensParticleAnimation('services');
        }
      });
    });
  }

  // Build a point cloud for the smooth heatmap — driven by REAL data, not cell
  // centroids, so the result has organic spatial variation (multiple discrete
  // hotspots) instead of a single huge gradient blob.
  //
  //   traffic  → all geocoded traffic events for the year
  //   jobs     -> job events + transport stops + services POIs (proxy for job access)
  //   services -> drawn separately by transit-engine.js as route lines and stop symbols
  async function refreshCellsHeatmapPoints(lens) {
    if (!state.map || !state.map.getSource('cells-points')) return;
    const features = [];
    const id = lens.id;
    const sim = isSimYear(state.year);

    if (sim && (id === 'jobs' || id === 'services')) {
      const grid = futureForecastGrid(state.year);
      const sourceProp = id === 'jobs' ? 'jobs' : 'services';
      const cells = grid && Array.isArray(grid.features) ? grid.features : [];
      cells.forEach((cell, index) => {
        const c = polygonCentroid(cell.geometry);
        if (!c) return;
        const props = cell.properties || {};
        const value = Number(props[sourceProp]);
        const base = Number(props.baseline && props.baseline[sourceProp]);
        if (!Number.isFinite(value)) return;
        const delta = Number.isFinite(base) ? value - base : 0;
        const w = clamp(
          0.18 + value * (id === 'jobs' ? 1.15 : 1.05) + Math.max(0, delta) * 4,
          0.08,
          id === 'jobs' ? 1.35 : 1.2
        );
        features.push({
          type: 'Feature',
          properties: {
            id: 'forecast-' + id + '-' + (props.cell_id || index),
            w,
            forecast: 1,
            metric: id,
            value,
            delta
          },
          geometry: { type: 'Point', coordinates: c }
        });
      });
    } else {
      // 1) Real events (have coordinates per event)
      const evData = await loadEventsForYearLens(state.year, id);
      const events = evData && evData.events ? evData.events : [];
      events.forEach(ev => {
        if (Array.isArray(ev.coordinates) && ev.coordinates.length === 2) {
          features.push({ type: 'Feature', properties: { w: 1 }, geometry: { type: 'Point', coordinates: ev.coordinates } });
        }
      });
    }

    // 2) Jobs get civic/service POIs as low-weight employment anchors.
    if (id === 'jobs') {
      const services = await loadContextLayer('source-ni-services-osm');
      if (services && services.features) {
        services.features.forEach(f => {
          const c = pointOrCentroid(f.geometry);
          if (c) features.push({ type: 'Feature', properties: { w: sim ? 0.32 : 0.55 }, geometry: { type: 'Point', coordinates: c } });
        });
      }
    }
    if (id === 'jobs' || id === 'services') {
      const transport = await loadContextLayer('source-ni-transport-stops-osm');
      if (transport && transport.features) {
        transport.features.forEach(f => {
          const c = pointOrCentroid(f.geometry);
          const w = id === 'services' ? (sim ? 0.46 : 1.0) : (sim ? 0.36 : 0.7);
          if (c) features.push({ type: 'Feature', properties: { w }, geometry: { type: 'Point', coordinates: c } });
        });
      }
    }

    // 3) Commit-driven adjustments — every staged building/road/transformer
    //    contributes per-lens heat that ramps up year-by-year using a tiny
    //    linear-regression-style coefficient table. Lets a fresh commit
    //    visibly change the city's jobs/electricity/services projections
    //    without waiting for an AI scenario run.
    if (sim) {
      const commitFeatures = branchCommitHeatPoints(activeBranch(), state.year, id);
      for (let i = 0; i < commitFeatures.length; i++) features.push(commitFeatures[i]);
    }

    state.map.getSource('cells-points').setData({ type: 'FeatureCollection', features: features });
  }

  // Yearly evolution coefficients per building preset, derived from a small
  // linear regression on the historical jobs/electricity/services indices.
  // Each coefficient is "units per square metre of footprint per year".
  // Construction starts at item.year, operations ramp 0→1 over 4 years.
  const COMMIT_LENS_COEFFS = {
    jobs: {
      residential: 0.004,
      commercial:  0.052,
      industrial:  0.038,
      mixed_use:   0.024,
      transformer: 0.012,
      road:        0.018
    },
    electricity: {
      residential: 0.018,
      commercial:  0.046,
      industrial:  0.072,
      mixed_use:   0.030,
      transformer: 0.090,
      road:        0.004
    },
    services: {
      residential: 0.011,
      commercial:  0.026,
      industrial:  0.008,
      mixed_use:   0.020,
      transformer: 0.000,
      road:        0.030
    },
    buildings: {
      residential: 0.040,
      commercial:  0.040,
      industrial:  0.040,
      mixed_use:   0.040,
      transformer: 0.000,
      road:        0.000
    },
    traffic: {
      residential: 0.012,
      commercial:  0.038,
      industrial:  0.024,
      mixed_use:   0.022,
      transformer: 0.000,
      road:        0.052
    }
  };

  function commitRampForYear(itemYear, year) {
    const dy = year - (Number(itemYear) || year);
    if (dy < 0) return 0;
    if (dy === 0) return 0.30;            // construction phase
    return Math.min(1, 0.40 + dy * 0.18); // operations ramp
  }

  function commitFootprintScore(item) {
    const cfg = item && item.buildingConfig;
    const m2 = Number(cfg && cfg.footprintSqm) || 1500;
    const floors = Number(cfg && cfg.floors) || 6;
    return Math.sqrt(Math.max(120, m2 * Math.max(1, floors / 4)));
  }

  function branchCommitHeatPoints(branch, year, lensId) {
    if (!branch || !Array.isArray(branch.items)) return [];
    const coeffs = COMMIT_LENS_COEFFS[lensId];
    if (!coeffs) return [];
    const out = [];
    branch.items.forEach(item => {
      if (!item || (Number(item.year) || START_YEAR) > year) return;
      let coord = null;
      let kind = null;
      if (item.type === 'building' && Number.isFinite(Number(item.lng)) && Number.isFinite(Number(item.lat))) {
        coord = [Number(item.lng), Number(item.lat)];
        kind = item.preset || 'residential';
      } else if (item.type === 'infrastructure' && Number.isFinite(Number(item.lng)) && Number.isFinite(Number(item.lat))) {
        coord = [Number(item.lng), Number(item.lat)];
        kind = 'transformer';
      } else if (item.type === 'road') {
        const path = Array.isArray(item.path) && item.path.length >= 2 ? item.path : [item.start, item.end].filter(Array.isArray);
        const loc = locationFromCoords(path);
        if (loc) coord = [loc.lng, loc.lat];
        kind = 'road';
      }
      if (!coord || !kind) return;
      const coeff = coeffs[kind] || 0;
      if (coeff <= 0) return;
      const ramp = commitRampForYear(item.year, year);
      const footprint = commitFootprintScore(item);
      const intensity = clamp(0.35 + coeff * footprint * ramp, 0.18, 1.6);
      out.push({
        type: 'Feature',
        properties: {
          id: 'commit-' + lensId + '-' + (item.id || (kind + '-' + Math.round(coord[0] * 1e4))),
          w: intensity,
          forecast: 1,
          metric: lensId,
          commit: 1,
          itemId: item.id,
          kind: kind
        },
        geometry: { type: 'Point', coordinates: coord }
      });
    });
    return out;
  }

  function branchCommitYearlyJobs(branch, year) {
    if (!branch || !Array.isArray(branch.items)) return 0;
    const jobsCoeffs = COMMIT_LENS_COEFFS.jobs;
    let total = 0;
    branch.items.forEach(item => {
      if (!item || (Number(item.year) || START_YEAR) > year) return;
      let kind = null;
      if (item.type === 'building') kind = item.preset || 'residential';
      else if (item.type === 'infrastructure') kind = 'transformer';
      else if (item.type === 'road') kind = 'road';
      if (!kind) return;
      const coeff = jobsCoeffs[kind] || 0;
      const ramp = commitRampForYear(item.year, year);
      const footprint = commitFootprintScore(item);
      total += coeff * footprint * ramp * 18; // ~jobs-per-unit scale
    });
    return Math.round(total);
  }

  // ---------- ANIMATED LENS PARTICLES (jobs / electricity / services) ----------
  // The traffic lens already has a moving road swarm. The other infrastructure
  // lenses used to be a static heatmap which looked dead. This system spawns
  // colored "dots" at lens-relevant anchor points that fade in, breathe, and
  // fade out — so the user sees a live, evolving city for every metric.

  const LENS_PARTICLE_SOURCE = 'lens-particles';
  const LENS_PARTICLE_GLOW   = 'lens-particles-glow';
  const LENS_PARTICLE_CORE   = 'lens-particles-core';

  const LENS_PARTICLE_CONFIG = {
    jobs:        { color: '#a855f7', count: 240, jitterM: 80,  lifetime: [2.4, 4.8] },
    electricity: { color: '#22d3ee', count: 220, jitterM: 110, lifetime: [1.8, 3.6] },
    services:    { color: '#22c55e', count: 220, jitterM: 50,  lifetime: [2.0, 4.0] }
  };

  let lensParticles = [];
  let lensParticleRaf = null;
  let lensParticleLastTs = 0;
  let activeParticleLens = null;

  function ensureLensParticleLayers() {
    if (!state.map) return false;
    const empty = { type: 'FeatureCollection', features: [] };
    try {
      if (!state.map.getSource(LENS_PARTICLE_SOURCE)) {
        state.map.addSource(LENS_PARTICLE_SOURCE, { type: 'geojson', data: empty });
      }
      if (!state.map.getLayer(LENS_PARTICLE_GLOW)) {
        state.map.addLayer({
          id: LENS_PARTICLE_GLOW,
          type: 'circle',
          source: LENS_PARTICLE_SOURCE,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'phase'], 0, 6, 0.5, 18, 1, 8],
            'circle-color': ['get', 'color'],
            'circle-opacity': ['*', 0.34, ['coalesce', ['get', 'alpha'], 0]],
            'circle-blur': 0.85
          }
        });
      }
      if (!state.map.getLayer(LENS_PARTICLE_CORE)) {
        state.map.addLayer({
          id: LENS_PARTICLE_CORE,
          type: 'circle',
          source: LENS_PARTICLE_SOURCE,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'phase'], 0, 1.5, 0.5, 5.5, 1, 2.0],
            'circle-color': ['get', 'color'],
            'circle-opacity': ['coalesce', ['get', 'alpha'], 0],
            'circle-stroke-color': '#0b1020',
            'circle-stroke-width': 0.9
          }
        });
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function lensParticleAnchors(lensId) {
    const branch = activeBranch();
    const items = (branch && branch.items) || [];
    const anchors = [];
    if (lensId === 'jobs') {
      items.forEach(it => {
        if (it.type === 'building' && (it.preset === 'commercial' || it.preset === 'industrial' || it.preset === 'mixed_use')) {
          if (Number.isFinite(Number(it.lng)) && Number.isFinite(Number(it.lat))) anchors.push([Number(it.lng), Number(it.lat)]);
        }
      });
      const services = state.contextLayersData['source-ni-services-osm'];
      if (services && services.features) {
        services.features.slice(0, 320).forEach(f => {
          const c = pointOrCentroid(f.geometry);
          if (c) anchors.push(c);
        });
      }
      const transport = state.contextLayersData['source-ni-transport-stops-osm'];
      if (transport && transport.features) {
        transport.features.slice(0, 200).forEach(f => {
          const c = pointOrCentroid(f.geometry);
          if (c) anchors.push(c);
        });
      }
    } else if (lensId === 'electricity') {
      items.forEach(it => {
        if (it.type === 'infrastructure' && Number.isFinite(Number(it.lng)) && Number.isFinite(Number(it.lat))) {
          anchors.push([Number(it.lng), Number(it.lat)]);
        }
      });
      const subSrc = state.map && state.map.getSource('grid-substations');
      const data = subSrc && subSrc._data;
      const feats = data && Array.isArray(data.features) ? data.features : [];
      feats.slice(0, 240).forEach(f => {
        const c = pointOrCentroid(f.geometry);
        if (c) anchors.push(c);
      });
    } else if (lensId === 'services') {
      const transport = state.contextLayersData['source-ni-transport-stops-osm'];
      if (transport && transport.features) {
        transport.features.slice(0, 320).forEach(f => {
          const c = pointOrCentroid(f.geometry);
          if (c) anchors.push(c);
        });
      }
      const services = state.contextLayersData['source-ni-services-osm'];
      if (services && services.features) {
        services.features.slice(0, 200).forEach(f => {
          const c = pointOrCentroid(f.geometry);
          if (c) anchors.push(c);
        });
      }
    }
    return anchors;
  }

  function buildLensParticle(anchor, cfg) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * cfg.jitterM / 110000;
    const lat = anchor[1] + Math.sin(angle) * dist;
    const lng = anchor[0] + Math.cos(angle) * dist / Math.max(0.1, Math.cos(anchor[1] * Math.PI / 180));
    return {
      lng: lng,
      lat: lat,
      color: cfg.color,
      age: Math.random() * cfg.lifetime[1],
      lifetime: cfg.lifetime[0] + Math.random() * (cfg.lifetime[1] - cfg.lifetime[0])
    };
  }

  function startLensParticleAnimation(lensId) {
    if (!state.map) return;
    if (!ensureLensParticleLayers()) {
      state.map.once && state.map.once('styledata', () => startLensParticleAnimation(lensId));
      return;
    }
    const cfg = LENS_PARTICLE_CONFIG[lensId];
    if (!cfg) { stopLensParticleAnimation(); return; }
    const anchors = lensParticleAnchors(lensId);
    if (!anchors.length) {
      // No anchors yet — clear any leftover and try again after a short delay
      const src = state.map.getSource(LENS_PARTICLE_SOURCE);
      if (src) src.setData({ type: 'FeatureCollection', features: [] });
      activeParticleLens = lensId;
      setTimeout(() => {
        if (state.lens === lensId) startLensParticleAnimation(lensId);
      }, 600);
      return;
    }
    activeParticleLens = lensId;
    lensParticles = [];
    for (let i = 0; i < cfg.count; i++) {
      const a = anchors[Math.floor(Math.random() * anchors.length)];
      lensParticles.push(buildLensParticle(a, cfg));
    }
    if (lensParticleRaf) cancelAnimationFrame(lensParticleRaf);
    lensParticleLastTs = 0;
    lensParticleRaf = requestAnimationFrame(stepLensParticles);
  }

  function stopLensParticleAnimation() {
    if (lensParticleRaf) cancelAnimationFrame(lensParticleRaf);
    lensParticleRaf = null;
    lensParticles = [];
    activeParticleLens = null;
    if (state.map && state.map.getSource(LENS_PARTICLE_SOURCE)) {
      state.map.getSource(LENS_PARTICLE_SOURCE).setData({ type: 'FeatureCollection', features: [] });
    }
  }

  function stepLensParticles(ts) {
    if (!activeParticleLens || !state.map) return;
    if (!lensParticleLastTs) lensParticleLastTs = ts;
    const dt = Math.min(0.1, (ts - lensParticleLastTs) / 1000);
    lensParticleLastTs = ts;
    const cfg = LENS_PARTICLE_CONFIG[activeParticleLens];
    if (!cfg) return;
    const anchors = lensParticleAnchors(activeParticleLens);
    const features = [];
    for (let i = 0; i < lensParticles.length; i++) {
      const p = lensParticles[i];
      p.age += dt;
      if (p.age >= p.lifetime || !anchors.length) {
        if (anchors.length) {
          const a = anchors[Math.floor(Math.random() * anchors.length)];
          lensParticles[i] = buildLensParticle(a, cfg);
        }
        continue;
      }
      const phase = p.age / p.lifetime;          // 0 → 1 across lifetime
      let alpha;
      if (phase < 0.18)      alpha = phase / 0.18;          // fade in
      else if (phase > 0.72) alpha = (1 - phase) / 0.28;     // fade out
      else                   alpha = 1;
      features.push({
        type: 'Feature',
        properties: { color: p.color, phase: phase, alpha: alpha },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] }
      });
    }
    const src = state.map.getSource(LENS_PARTICLE_SOURCE);
    if (src) src.setData({ type: 'FeatureCollection', features: features });
    lensParticleRaf = requestAnimationFrame(stepLensParticles);
  }

  function trafficSimReady(callback) {
    if (!window.TrafficSim) return false;
    if (window.TrafficSim.isOsmLoaded && !window.TrafficSim.isOsmLoaded() && !state._trafficAgentLoadAttempted) {
      if (!state._trafficAgentLoadQueued && typeof window.TrafficSim.preloadOsm === 'function') {
        state._trafficAgentLoadAttempted = true;
        state._trafficAgentLoadQueued = true;
        window.TrafficSim.preloadOsm('/api/layers/2026/source-ni-roads-osm')
          .then(() => {
            state._trafficAgentLoadQueued = false;
            if (typeof callback === 'function') callback();
          })
          .catch(() => { state._trafficAgentLoadQueued = false; });
      }
      return false;
    }
    return typeof window.TrafficSim.runAgentSwarm === 'function' &&
      typeof window.TrafficSim.showAgentSwarmOverlay === 'function';
  }

  function pointFeatureFromCoord(coord, props) {
    if (!Array.isArray(coord) || coord.length < 2) return null;
    const lng = Number(coord[0]), lat = Number(coord[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return {
      type: 'Feature',
      properties: Object.assign({}, props || {}),
      geometry: { type: 'Point', coordinates: [lng, lat] }
    };
  }

  function mapCentreCoord() {
    if (!state.map || !state.map.getCenter) return [-5.93, 54.597];
    const c = state.map.getCenter();
    return [c.lng, c.lat];
  }

  function focusCoordForTraffic(branch, demandPoints) {
    const items = (branch && branch.items) || [];
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.type === 'road') {
        const path = Array.isArray(it.path) && it.path.length >= 2 ? it.path : [it.start, it.end].filter(Array.isArray);
        const loc = locationFromCoords(path);
        if (loc) return [loc.lng, loc.lat];
      }
      if (Number.isFinite(Number(it.lng)) && Number.isFinite(Number(it.lat))) return [Number(it.lng), Number(it.lat)];
    }
    if (demandPoints && demandPoints.length) {
      let sx = 0, sy = 0, sw = 0;
      demandPoints.forEach(p => {
        const c = p.geometry && p.geometry.coordinates;
        if (!Array.isArray(c)) return;
        const w = Math.max(0.05, Number(p.properties && p.properties.intensity) || 0.2);
        sx += c[0] * w; sy += c[1] * w; sw += w;
      });
      if (sw) return [sx / sw, sy / sw];
    }
    return mapCentreCoord();
  }

  function historicalTrafficCellDemandPoints(grid) {
    const features = grid && Array.isArray(grid.features) ? grid.features : [];
    if (!features.length) return [];
    const values = features
      .map(f => Number(f.properties && f.properties.traffic))
      .filter(Number.isFinite);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    const span = Math.max(0.0001, max - min);
    return features.map((feature, i) => {
      const props = feature.properties || {};
      const coord = polygonCentroid(feature.geometry);
      const value = Number(props.traffic);
      if (!coord || !Number.isFinite(value)) return null;
      const normalised = (value - min) / span;
      const pressure = Number(props.traffic_pressure);
      const delta = Number(props.traffic_delta_previous);
      const pressureScore = Number.isFinite(pressure) ? pressure : normalised;
      const deltaScore = Number.isFinite(delta) ? Math.max(0, delta) * 5 : 0;
      return pointFeatureFromCoord(coord, {
        id: 'historical-traffic-cell-' + (props.cell_id || i),
        intensity: clamp(0.14 + normalised * 0.58 + pressureScore * 0.18 + deltaScore, 0.12, 0.92),
        polarity: -1,
        active: 0,
        cityCell: 1,
        traffic: value
      });
    }).filter(Boolean);
  }

  function historicalTrafficDemandPoints(events, activeEventId, grid) {
    const cityCellPoints = historicalTrafficCellDemandPoints(grid);
    const buckets = new Map();
    const cell = 0.0035; // roughly 250m in Belfast; keeps demand city-wide without thousands of agents.
    (events || []).forEach(ev => {
      const coord = realEventCoords(ev);
      if (!coord) return;
      const lng = Number(coord[0]), lat = Number(coord[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      const key = Math.floor(lng / cell) + '|' + Math.floor(lat / cell);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { sx: 0, sy: 0, weight: 0, count: 0, severity: 0, active: false, id: key };
        buckets.set(key, bucket);
      }
      const sev = ev.severity === 'high' ? 1 : ev.severity === 'medium' ? 0.72 : 0.48;
      const w = sev + 0.18;
      bucket.sx += lng * w;
      bucket.sy += lat * w;
      bucket.weight += w;
      bucket.count += 1;
      bucket.severity += sev;
      if (ev.id && ev.id === activeEventId) bucket.active = true;
    });
    let points = Array.from(buckets.values()).map((b, i) => {
      const densityScore = Math.log1p(b.count) / Math.log1p(18);
      const severityScore = b.count ? b.severity / b.count : 0.5;
      return pointFeatureFromCoord([b.sx / b.weight, b.sy / b.weight], {
        id: 'historical-traffic-city-' + (b.id || i),
        intensity: clamp(0.16 + densityScore * 0.68 + severityScore * 0.16, 0.08, 1),
        polarity: -1,
        active: b.active ? 1 : 0,
        count: b.count
      });
    }).filter(Boolean);
    points.sort((a, b) => {
      const aa = a.properties && a.properties.active ? 1 : 0;
      const ba = b.properties && b.properties.active ? 1 : 0;
      if (aa !== ba) return ba - aa;
      return (Number(b.properties && b.properties.intensity) || 0) -
        (Number(a.properties && a.properties.intensity) || 0);
    });
    if (!cityCellPoints.length) return points.slice(0, 520);
    const eventLimit = Math.max(120, 520 - cityCellPoints.length);
    return cityCellPoints.concat(points.slice(0, eventLimit));
  }

  async function refreshHistoricalTrafficSwarm() {
    if (!isHistoricalMode() || state.lens !== 'traffic') return;
    if (!trafficSimReady(refreshHistoricalTrafficSwarm)) return;
    const requestId = (state._trafficAgentRequestId || 0) + 1;
    state._trafficAgentRequestId = requestId;
    const [data, grid] = await Promise.all([
      loadEventsForYearLens(state.year, 'traffic'),
      loadGridYear(state.year)
    ]);
    if (state._trafficAgentRequestId !== requestId || !isHistoricalMode() || state.lens !== 'traffic') return;
    const events = data && Array.isArray(data.events) ? data.events : [];
    const activeEvent = state.activeEventId ? events.find(e => e.id === state.activeEventId) : null;
    const activeCoord = activeEvent ? realEventCoords(activeEvent) : null;
    const demand = historicalTrafficDemandPoints(events, state.activeEventId, grid);
    if (activeCoord && !demand.some(f => f.properties && f.properties.active)) {
      const activePoint = pointFeatureFromCoord(activeCoord, { id: state.activeEventId || 'selected-traffic-event', intensity: 1, polarity: -1, active: 1 });
      if (activePoint) demand.unshift(activePoint);
    }
    const result = window.TrafficSim.runAgentSwarm({
      demandPoints: demand,
      centre: BELFAST_CENTER,
      radiusKm: 14.5,
      cityWide: true,
      cityCoverage: 'whole-belfast',
      wholeCityRoads: true,
      cityRawSegmentLimit: 26000,
      cityDemandRadiusKm: 0.95,
      density: clamp(260 + demand.length * 0.8, 320, 640),
      durationSeconds: 9,
      seed: (state.year * 2654435761 + demand.length * 97) >>> 0,
      branch: activeBranch(),
      maxSegments: 8200,
      maxFlowSegments: 8200,
      maxPointFeatures: 0,
      showDemandPoints: false
    });
    window.TrafficSim.showAgentSwarmOverlay(result);
    showCongestionLegend();
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
    if (isHistoricalMode()) {
      renderHistoricalBranchesPanel();
      renderLeftSidebar();
    }
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

  function geometryBounds(geom, bounds) {
    if (!geom) return bounds;
    const b = bounds || [Infinity, Infinity, -Infinity, -Infinity];
    function addCoord(coord) {
      if (!Array.isArray(coord) || coord.length < 2) return;
      const lng = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      b[0] = Math.min(b[0], lng);
      b[1] = Math.min(b[1], lat);
      b[2] = Math.max(b[2], lng);
      b[3] = Math.max(b[3], lat);
    }
    function walk(coords) {
      if (!Array.isArray(coords)) return;
      if (typeof coords[0] === 'number') {
        addCoord(coords);
        return;
      }
      coords.forEach(walk);
    }
    if (geom.type === 'Point') addCoord(geom.coordinates);
    else walk(geom.coordinates);
    return b;
  }

  function featureCollectionBounds(features) {
    const bounds = (features || []).reduce((acc, feature) => geometryBounds(feature && feature.geometry, acc), null);
    if (!bounds || !bounds.every(Number.isFinite)) return null;
    return bounds;
  }

  function eventAffectedFeatures(ev, grid) {
    const features = grid && Array.isArray(grid.features) ? grid.features : [];
    return nearestCellsForEvent(ev, features);
  }

  function affectedMetricAverage(features, lens) {
    const values = (features || []).map(f => Number(f.properties && f.properties[lens.valueProp])).filter(Number.isFinite);
    return values.length ? mean(values) : null;
  }

  function affectedMetricRowsHTML(features) {
    const ids = ['traffic', 'jobs', 'electricity', 'services'];
    if (!features || !features.length) return '<div class="event-summary-empty">No grid cells are available for this event yet.</div>';
    return '<div class="event-summary-metric-grid">' + ids.map(id => {
      const lens = lensDef(id);
      const avg = affectedMetricAverage(features, lens);
      const value = avg == null ? 'n/a' : Math.round(avg * 100).toString();
      return '<div class="event-summary-metric-tile" style="--metric-color:' + lens.color + '">' +
        '<span class="event-summary-metric-dot"></span>' +
        '<small>' + escapeHtml(lens.label === 'Public Transit' ? 'Transit' : lens.label) + '</small>' +
        '<b>' + value + '</b>' +
      '</div>';
    }).join('') + '</div>';
  }

  function selectedEventSummaryHTML(ev, features) {
    const lens = lensDef(state.lens);
    const cellCount = features && features.length ? features.length : 0;
    const lensAvg = affectedMetricAverage(features, lens);
    const lensValue = lensAvg == null ? 'n/a' : Math.round(lensAvg * 100);
    const source = simpleSourceName(ev);
    const confidence = ev.confidence || 'medium';
    const note = simpleEventNote(ev);
    const place = [compactPlaceName(ev.area) || 'Belfast', ev.month || String(ev.year || state.year)].filter(Boolean).join(' · ');
    return '' +
      '<div class="event-summary-top">' +
        '<span class="event-summary-icon" style="background:' + lens.color + '">' + lensIcon(lens.id) + '</span>' +
        '<div>' +
          '<div class="event-summary-kicker">Selected event</div>' +
          '<strong>' + escapeHtml(simpleEventTitle(ev)) + '</strong>' +
          '<span>' + escapeHtml(place) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="event-summary-stats">' +
        '<div><span>Affected Area</span><b>' + cellCount + ' cells</b></div>' +
        '<div><span>' + escapeHtml(lens.label) + '</span><b>' + lensValue + '</b></div>' +
      '</div>' +
      (note ? '<p>' + escapeHtml(note) + '</p>' : '') +
      '<div class="event-summary-section-label">Signals in this area</div>' +
      '<div class="event-summary-metrics">' + affectedMetricRowsHTML(features) + '</div>' +
      '<div class="event-summary-source">' +
        '<span>' + escapeHtml(confidence) + ' confidence</span>' +
        '<span>' + escapeHtml(source) + '</span>' +
      '</div>';
  }

  function renderSelectedEventSummary(evOverride, featuresOverride) {
    if (!els.selectedEventSummary) return;
    const ev = evOverride || (state.activeEventId ? (state.eventsForYearCache || []).find(e => e.id === state.activeEventId) : null);
    if (!isHistoricalMode() || !ev) {
      els.selectedEventSummary.hidden = true;
      els.selectedEventSummary.innerHTML = '';
      return;
    }
    const grid = state.gridCache[state.year];
    const features = featuresOverride || eventAffectedFeatures(ev, grid);
    els.selectedEventSummary.style.setProperty('--lens-color', lensDef(state.lens).color);
    els.selectedEventSummary.innerHTML = selectedEventSummaryHTML(ev, features || []);
    els.selectedEventSummary.hidden = false;
    if (!grid) {
      loadGridYear(state.year).then(() => {
        if (state.activeEventId === ev.id) renderSelectedEventSummary(ev);
      });
    }
  }

  async function zoomToEventAffectedArea(ev) {
    if (!ev || !state.map) return;
    const grid = await loadGridYear(state.year);
    const features = eventAffectedFeatures(ev, grid);
    renderSelectedEventSummary(ev, features);
    refreshHighlightedCells();
    const bounds = featureCollectionBounds(features);
    if (bounds) {
      const samePoint = Math.abs(bounds[0] - bounds[2]) < 0.00001 && Math.abs(bounds[1] - bounds[3]) < 0.00001;
      if (!samePoint) {
        state.map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], {
          padding: { top: 90, bottom: 170, left: 120, right: 120 },
          maxZoom: 15.4,
          duration: 850,
          pitch: state.view === '3D' ? 58 : 0,
          bearing: state.view === '3D' ? -24 : 0
        });
        return;
      }
    }
    const c = realEventCoords(ev);
    if (c) {
      state.map.flyTo({
        center: c,
        zoom: 15.2,
        pitch: state.view === '3D' ? 58 : 0,
        bearing: state.view === '3D' ? -24 : 0,
        duration: 750
      });
    }
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
    const fillOpacity = state.lens === 'traffic' ? 0.1 : 0.45;
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
      properties: Object.assign({}, f.properties, { __color: lens.color, __opacity: fillOpacity })
    }));
    state.map.getSource('hist-highlight').setData({ type: 'FeatureCollection', features: features });
  }

  function renderHistoricalModifyPanel() {
    if (!els.modifyList) return;
    // The new layout keeps the same toolbar tools visible in both modes —
    // historical mode used to hijack this strip with lens buttons, but
    // those now live in the right sidebar's tabs. We just dim/disable the
    // editing tools in historical mode so the user knows they can't place.
    if (els.presetSection) els.presetSection.hidden = true;
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
          // Dim, but keep clickable — the click handler already auto-jumps
          // to the first sim year so the chosen tool is meaningful (T1.3).
          if (!btn.dataset.disabledTitle) btn.dataset.disabledTitle = btn.title || '';
          btn.title = (btn.dataset.disabledTitle || btn.getAttribute('aria-label') || 'Tool') +
            ' — available in simulation years (2026–2036). Click to jump to 2026.';
          btn.removeAttribute('disabled');
          btn.setAttribute('aria-disabled', 'true');
          btn.style.opacity = '0.5';
          btn.style.cursor = 'pointer';
        }
      });
    }
    if (els.mapCanvas) els.mapCanvas.classList.remove('placing', 'removing');
    if (els.cursorHint) els.cursorHint.hidden = true;
    updateBuildabilityOverlay();
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
    if (id === 'electricity') return TRANSFORMER_ICON_SVG;
    if (id === 'buildings') return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22V12h6v10"/></svg>';
    if (id === 'services') return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 17h12"/><path d="M6 17v3"/><path d="M18 17v3"/><rect x="4" y="4" width="16" height="13" rx="2"/><path d="M4 10h16"/><circle cx="8" cy="14" r="1"/><circle cx="16" cy="14" r="1"/></svg>';
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
        updateRunButtonLabel();
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
        '<div class="head"><span class="event-symbol" style="background:' + lens.color + '">' + escapeHtml(ev.symbol || '+') + '</span>' + escapeHtml(simpleEventTitle(ev)) + '</div>' +
        '<div class="meta">' + escapeHtml(simpleEventSubtitle(ev)) + '</div>' +
        '<div class="meta">' +
          '<span class="pill" style="background:rgba(255,255,255,0.05);padding:1px 6px;border-radius:8px;color:var(--text-dim);font-size:9.5px">' + escapeHtml(ev.area || 'Belfast') + '</span> ' +
          '<span class="pill" style="background:rgba(255,255,255,0.05);padding:1px 6px;border-radius:8px;color:var(--text-dim);font-size:9.5px">' + escapeHtml(ev.month || state.year) + '</span> ' +
          '<span class="pill" style="background:rgba(255,255,255,0.05);padding:1px 6px;border-radius:8px;color:var(--text-dim);font-size:9.5px">' + escapeHtml(ev.severity || 'Watch') + '</span>' +
        '</div>' +
        '<div class="why">' + escapeHtml(simpleEventNote(ev)) + '</div>' +
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
    renderLeftSidebar();
    renderHistoricalBranchesPanel();
    renderCompareSection();
    if (state.lens === 'traffic') refreshHistoricalTrafficSwarm();
    const ev = (state.eventsForYearCache || []).find(e => e.id === eventId);
    if (ev && state.map) zoomToEventAffectedArea(ev);
    else refreshHighlightedCells();
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
    state.workspaceSplitContext = null;
  }

  // ---- Public transport lens orchestration -----------------------------
  // Paints the Belfast public transport stop network when the active lens is
  // public transit, and overlays per-stop forecast deltas after simulation.
  function refreshTransitLayer() {
    const engine = window.PublicTransportEngine || window.TransitEngine;
    if (!engine || !engine.isLoaded) return;
    if (!engine.isLoaded()) {
      if (typeof engine.preload === 'function' && !state._publicTransportLoadQueued) {
        state._publicTransportLoadQueued = true;
        engine.preload().then(() => {
          state._publicTransportLoadQueued = false;
          refreshTransitLayer();
        });
      }
      return;
    }
    // The lens keeps the internal 'services' id for forecast-model
    // compatibility, but the UI exposes it as Public Transit.
    const isTransit = state.lens === 'transit' || state.lens === 'services';
    if (!isTransit) {
      engine.clear();
      updateTransitImpactCard(null);
      return;
    }
    if (state.mode === 'simulation' && state.isRunningSim) {
      engine.clear();
      updateTransitImpactCard(null);
      return;
    }
    const yr = state.year;
    if (yr < START_YEAR) {
      engine.showForYear(yr);
      updateTransitImpactCard(null);
    } else {
      const branch = activeBranch();
      const result = engine.showForecast({ branch: branch, year: yr });
      updateTransitImpactCard(result);
    }
  }

  // Pin a small "Public transport access" card at the top of the
  // impact stack so the forecast summary text shows up next to the chart.
  function updateTransitImpactCard(result) {
    const host = els.impactStack;
    if (!host) return;
    const isTransit = state.lens === 'transit' || state.lens === 'services';
    let card = host.querySelector('[data-card="transit-summary"]');
    if (!isTransit || !result) { if (card) card.remove(); return; }
    const s = result.summary || {};
    const net = s.netReliefIndex || 0;
    const verdict = net > 0.3 ? 'Net relief' : net < -0.3 ? 'Net strain' : 'Network neutral';
    const verdictClass = net > 0.3 ? 'up' : net < -0.3 ? 'down' : 'neutral';
    const html =
      '<div class="metric-card" data-card="transit-summary">' +
        '<div><div class="name">Public transport access</div>' +
          '<div class="val">' + (s.affectedStops || 0) + ' stops</div></div>' +
        '<div class="delta ' + verdictClass + '">' + escapeHtml(verdict) + '</div>' +
      '</div>';
    if (card) card.outerHTML = html;
    else host.insertAdjacentHTML('afterbegin', html);
  }

  function publicTransportFallbackRoutes(stopPoints, side, grid) {
    const coords = (stopPoints || [])
      .map(feature => feature && feature.geometry && feature.geometry.coordinates)
      .filter(coord => Array.isArray(coord) && coord.length >= 2);
    if (coords.length < 2) return diffFeatureCollection([]);
    const lens = currentScenarioDiffLens();
    const delta = scenarioDiffMeanDelta(grid, lens);
    const deltaColor = Math.abs(delta) < 0.00005 ? '#22d3ee' : scenarioDeltaColour(delta, lens);
    function sampledLine(sorted, id, color, strength, magnitude) {
      if (sorted.length < 2) return null;
      const step = Math.max(1, Math.floor(sorted.length / 28));
      const line = sorted.filter((_, i) => i % step === 0).slice(0, 34);
      if (line.length < 2) return null;
      return {
        type: 'Feature',
        properties: {
          id,
          color,
          strength,
          deltaColor,
          magnitude,
          affectedStops: line.length
        },
        geometry: { type: 'LineString', coordinates: line }
      };
    }
    const routes = [
      sampledLine(coords.slice().sort((a, b) => a[0] - b[0]), 'fallback-east-west', '#22c55e', 0.74, 0.52),
      sampledLine(coords.slice().sort((a, b) => a[1] - b[1]), 'fallback-north-south', '#06b6d4', 0.68, 0.48),
      sampledLine(coords.slice().sort((a, b) => (a[0] + a[1]) - (b[0] + b[1])), 'fallback-diagonal', '#a855f7', 0.58, 0.42)
    ].filter(Boolean);
    if (side !== 'after') return diffFeatureCollection(routes);
    return diffFeatureCollection(routes.map(route => cloneFeatureWithProps(route, {
      color: route.properties.deltaColor,
      strength: route.properties.magnitude,
      magnitude: route.properties.magnitude,
      deltaColor: route.properties.deltaColor
    })));
  }

  async function publicTransportFallbackDiffData(side, year, branch, grid, building) {
    const lens = currentScenarioDiffLens();
    const focus = building || selectedScenarioBuilding(branch || activeBranch());
    const center = focus && Number.isFinite(Number(focus.lng)) && Number.isFinite(Number(focus.lat))
      ? [Number(focus.lng), Number(focus.lat)]
      : mapCentreCoord();
    const transport = await loadContextLayer('source-ni-transport-stops-osm');
    const nearbyStops = nearbyContextFeatures(transport, center, 4.4, 180, null, (feature, distKm) => ({
      __weight: clamp(1 - distKm / 4.4, 0.14, 1)
    }));
    const baseStops = anchorPointFeatures(nearbyStops, (feature, i) => {
      const props = feature.properties || {};
      return Object.assign({}, props, {
        id: props.source_id || props.id || ('pt-stop-' + i),
        color: i % 3 === 0 ? '#22c55e' : (i % 3 === 1 ? '#06b6d4' : '#a855f7'),
        weight: Number.isFinite(Number(props.__weight)) ? Number(props.__weight) : 0.45,
        magnitude: Number.isFinite(Number(props.__weight)) ? Number(props.__weight) : 0.45
      });
    });
    const forecastStops = side === 'after'
      ? scenarioDiffContextPressurePoints(nearbyStops, lens, side, 'pt-fallback-stop', grid, 80).map(feature => {
        const props = feature.properties || {};
        return cloneFeatureWithProps(feature, Object.assign({}, props, {
          deltaColor: props.color || '#22d3ee',
          magnitude: props.magnitude || 0.35
        }));
      }).filter(Boolean)
      : [];
    return {
      base: diffFeatureCollection(baseStops),
      forecast: diffFeatureCollection(forecastStops),
      baseRoutes: publicTransportFallbackRoutes(baseStops, 'before', grid),
      forecastRoutes: side === 'after' ? publicTransportFallbackRoutes(forecastStops.length ? forecastStops : baseStops, 'after', grid) : diffFeatureCollection([])
    };
  }

  async function addPublicTransportDiffLayers(map, side, year, branch, refLayerId, grid, building) {
    if (!map || currentScenarioDiffLens().id !== 'services') return false;
    const engine = window.PublicTransportEngine || window.TransitEngine;
    let base = { type: 'FeatureCollection', features: [] };
    let forecast = { type: 'FeatureCollection', features: [] };
    let baseRoutes = { type: 'FeatureCollection', features: [] };
    let forecastRoutes = { type: 'FeatureCollection', features: [] };
    if (engine && typeof engine.preload === 'function') {
      try {
        await engine.preload();
        base = typeof engine.baseFeatureCollection === 'function'
          ? engine.baseFeatureCollection(year)
          : base;
        forecast = side === 'after' && typeof engine.forecastFeatureCollection === 'function'
          ? engine.forecastFeatureCollection(branch || activeBranch(), year)
          : forecast;
        baseRoutes = typeof engine.baseRouteFeatureCollection === 'function'
          ? engine.baseRouteFeatureCollection(year)
          : baseRoutes;
        forecastRoutes = side === 'after' && typeof engine.forecastRouteFeatureCollection === 'function'
          ? engine.forecastRouteFeatureCollection(branch || activeBranch(), year)
          : forecastRoutes;
      } catch (_) {}
    }
    let hasTransitData = (base.features && base.features.length) ||
      (forecast.features && forecast.features.length) ||
      (baseRoutes.features && baseRoutes.features.length) ||
      (forecastRoutes.features && forecastRoutes.features.length);
    const needsForecastFallback = side === 'after' &&
      !(forecast.features && forecast.features.length) &&
      !(forecastRoutes.features && forecastRoutes.features.length);
    if (!hasTransitData || needsForecastFallback) {
      const fallback = await publicTransportFallbackDiffData(side, year, branch || activeBranch(), grid, building);
      if (!(base.features && base.features.length)) base = fallback.base;
      if (!(baseRoutes.features && baseRoutes.features.length)) baseRoutes = fallback.baseRoutes;
      if (side === 'after' && !(forecast.features && forecast.features.length)) forecast = fallback.forecast;
      if (side === 'after' && !(forecastRoutes.features && forecastRoutes.features.length)) forecastRoutes = fallback.forecastRoutes;
      hasTransitData = (base.features && base.features.length) ||
        (forecast.features && forecast.features.length) ||
        (baseRoutes.features && baseRoutes.features.length) ||
        (forecastRoutes.features && forecastRoutes.features.length);
    }
    if (!hasTransitData) return false;
    map.addSource('pt-diff-base', { type: 'geojson', data: base });
    map.addSource('pt-diff-forecast', { type: 'geojson', data: forecast });
    map.addSource('pt-diff-base-routes', { type: 'geojson', data: baseRoutes });
    map.addSource('pt-diff-forecast-routes', { type: 'geojson', data: forecastRoutes });
    map.addLayer({
      id: 'pt-diff-base-route-line',
      type: 'line',
      source: 'pt-diff-base-routes',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['get', 'strength'], 0, 1.2, 1, 3.1],
        'line-opacity': 0.86
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' }
    }, refLayerId);
    map.addLayer({
      id: 'pt-diff-base-core',
      type: 'circle',
      source: 'pt-diff-base',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.3, 16, 3.4],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 0.7,
        'circle-opacity': 0.88
      }
    }, refLayerId);
    if (side === 'after') {
      map.addLayer({
        id: 'pt-diff-forecast-route-line',
        type: 'line',
        source: 'pt-diff-forecast-routes',
        paint: {
          'line-color': ['get', 'deltaColor'],
          'line-width': ['interpolate', ['linear'], ['get', 'magnitude'], 0, 1.7, 1, 4.6],
          'line-opacity': 0.88,
          'line-dasharray': [1.3, 0.7]
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' }
      }, refLayerId);
      map.addLayer({
        id: 'pt-diff-forecast-core',
        type: 'circle',
        source: 'pt-diff-forecast',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'magnitude'], 0, 2, 1, 5.4],
          'circle-color': ['get', 'deltaColor'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 0.9,
          'circle-opacity': 0.9
        }
      }, refLayerId);
    }
    return true;
  }

  async function openScenarioDiffModal(itemId) {
    if (!els.workspaceSplit) return;
    const branch = activeBranch();
    const scenario = scenarioResultForBranch(branch);
    const primaryBuilding = selectedScenarioBuilding(branch);
    const requestedItem = itemId ? ((branch.items || []).find(item => item.id === itemId) || null) : null;
    if (requestedItem && requestedItem.type === 'road') {
      runRoadComparison(requestedItem.id);
      return;
    }
    const focusItem = (requestedItem && branchItemCenter(requestedItem)) ? requestedItem : primaryBuilding;
    if (!scenario || !primaryBuilding || !focusItem) {
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
    const afterLabel = isBuildingRemovalItem(focusItem) ? 'After removal ' : 'With build ';
    if (els.splitYearBefore) els.splitYearBefore.textContent = 'No-build ' + year;
    if (els.splitYearAfter) els.splitYearAfter.textContent = afterLabel + year;
    if (els.splitTitle) els.splitTitle.textContent = 'Before / After: ' + scenarioDiffFocusLabel(focusItem);

    const branchName = scenarioBranch ? (scenarioBranch.name || scenarioBranch.branchName || 'Selected branch') : branch.name;
    const confidence = scenarioBranch ? scenarioBranch.confidence : (scenario.confidence || 'medium');

    els.workspaceSplit.hidden = false;
    state.workspaceSplitContext = { beforeFc, afterFc, scenario, scenarioBranch, branchId: branch.id, building: focusItem, primaryBuilding, year };
    updateWorkspaceSplitSummary();
    branch.lastScenarioDiff = {
      openedAt: new Date().toISOString(),
      year: year,
      itemId: focusItem.id,
      itemLabel: scenarioDiffFocusLabel(focusItem),
      postcode: focusItem.postcode,
      branchName: branchName,
      confidence: confidence,
      lens: state.lens,
      modelVersion: scenario.modelVersion || 'forecast'
    };
    recordBranchActivity(
      branch,
      'diff',
      'Split diff added',
      'Before/after workspace for ' + scenarioDiffFocusLabel(focusItem),
      year,
      branch.lastScenarioDiff
    );

    const maps = await Promise.all([
      buildScenarioDiffMapInContainer(document.getElementById('splitMapBefore'), 'before', beforeFc, focusItem, year, false, workspaceSplitMaps),
      buildScenarioDiffMapInContainer(document.getElementById('splitMapAfter'), 'after', afterFc, focusItem, year, true, workspaceSplitMaps)
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

  function currentScenarioDiffLens() {
    return SCENARIO_DIFF_LENSES.find(l => l.id === state.lens) ||
      SCENARIO_DIFF_LENSES.find(l => l.id === DEFAULT_LENS) ||
      SCENARIO_DIFF_LENSES[0];
  }

  function scenarioDiffMetricSummary(beforeFc, afterFc, lens) {
    const beforeFeatures = beforeFc && beforeFc.features ? beforeFc.features : [];
    const afterFeatures = afterFc && afterFc.features ? afterFc.features : [];
    if (!beforeFeatures.length || !afterFeatures.length) return null;
    const before = mean(beforeFeatures.map(f => scenarioDiffMetricValue(f, lens)));
    const directAfter = mean(afterFeatures.map(f => scenarioDiffMetricValue(f, lens)));
    let diff = mean(afterFeatures.map(f => scenarioDeltaValue(f, lens)));
    if (!Number.isFinite(diff) || Math.abs(diff) < 0.000001) diff = directAfter - before;
    const after = before + diff;
    const deltaPts = diff * 100;
    const flat = Math.abs(diff) < 0.00005;
    const favourable = flat ? true : (lens.goodDirection === 'up' ? diff > 0 : diff < 0);
    return { before, after, diff, deltaPts, flat, favourable };
  }

  function scenarioDiffFocusCoord(item) {
    return branchItemCenter(item) || (item && Number.isFinite(Number(item.lng)) && Number.isFinite(Number(item.lat))
      ? [Number(item.lng), Number(item.lat)]
      : mapCentreCoord());
  }

  function scenarioDiffFocusLabel(item) {
    if (!item) return 'selected site';
    return item.postcode || item.resolvedPostcode?.postcode || item.existingBuildingName || branchItemTitle(item);
  }

  function scenarioDiffShowsBuilding(item) {
    return !!item && (item.type === 'building' || item.type === 'building_removal');
  }

  function isBuildingRemovalItem(item) {
    return !!item && (item.type === 'building_removal' || item.interventionType === 'building_removal' || item.removal === true);
  }

  function scenarioDiffSummaryHTML(beforeFc, afterFc, scenario, scenarioBranch, branch, building, year) {
    const lens = currentScenarioDiffLens();
    const summary = scenarioDiffMetricSummary(beforeFc, afterFc, lens);
    const postcode = scenarioDiffFocusLabel(building);
    const concrete = scenarioBranch && scenarioBranch.timelineByYear
      ? scenarioBranch.timelineByYear[String(year)]?.concreteImpacts
      : null;
    if (!summary) {
      return '<div class="ai-summary"><div class="ai-summary-head"><strong>AI summary</strong><span>Powered by Gemini</span></div><p>No forecast cells were available for this view.</p></div>';
    }
    const trafficTrips = concrete && concrete.traffic ? Number(concrete.traffic.netDailyTrips) || 0 : 0;
    let direction = summary.flat ? 'keeps ' + lens.label.toLowerCase() + ' broadly steady'
      : (summary.favourable ? 'improves ' : 'worsens ') + lens.label.toLowerCase() + ' by ' + Math.abs(summary.deltaPts).toFixed(Math.abs(summary.deltaPts) < 1 ? 2 : 1) + ' pts';
    if (lens.id === 'traffic' && concrete && concrete.traffic) {
      direction = (trafficTrips >= 0 ? 'adds ' : 'removes ') + fmtConcreteSigned(Math.abs(trafficTrips), 0).replace(/^[+]/, '') + (trafficTrips >= 0 ? ' daily trips and reroutes local road pressure' : ' daily trips and eases local road pressure');
    } else if (lens.id === 'jobs' && concrete && concrete.jobs) {
      direction = (Number(concrete.jobs.netJobsEstimate) >= 0 ? 'adds ' : 'removes ') + fmtConcreteSigned(Math.abs(Number(concrete.jobs.netJobsEstimate) || 0), 0).replace(/^[+]/, '') + ' jobs and shows nearby service-access pressure';
    } else if (lens.id === 'electricity' && concrete && concrete.electricity) {
      const reliefKw = Number(concrete.electricity.transformerReliefKw) || 0;
      const headroomKw = Number(concrete.electricity.localCapacityHeadroomKwChange) || 0;
      direction = (Number(concrete.electricity.peakKwChange) >= 0 ? 'adds ' : 'removes ') + fmtConcreteSigned(Math.abs(Number(concrete.electricity.peakKwChange) || 0), 0).replace(/^[+]/, '') + ' kW peak demand with ' + fmtConcreteSigned(reliefKw, 0) + ' kW transformer relief and ' + fmtConcreteSigned(headroomKw, 0) + ' kW headroom change';
    } else if (lens.id === 'services' && concrete && concrete.services) {
      direction = (Number(concrete.services.netServiceDemand) >= 0 ? 'adds ' : 'removes ') + fmtConcreteSigned(Math.abs(Number(concrete.services.netServiceDemand) || 0), 0).replace(/^[+]/, '') + ' people-equivalent transit demand on nearby stops and routes';
    } else if (lens.id === 'buildings') {
      direction = 'places the proposed building in the local 3D building fabric and shows development pressure around it';
    }
    const branchName = branch && branch.name ? branch.name : 'this branch';
    const concreteBits = [];
    if (concrete && concrete.traffic) concreteBits.push('Traffic ' + fmtConcreteSigned(concrete.traffic.netDailyTrips, 0) + ' daily trips');
    if (concrete && concrete.jobs) concreteBits.push('Jobs ' + fmtConcreteSigned(concrete.jobs.netJobsEstimate, 0));
    if (concrete && concrete.electricity) concreteBits.push('Electricity ' + fmtConcreteSigned(concrete.electricity.peakKwChange, 0) + ' kW peak / ' + fmtConcreteSigned(concrete.electricity.transformerReliefKw, 0) + ' kW relief');
    if (concrete && concrete.services) concreteBits.push('Public Transit ' + fmtConcreteSigned(concrete.services.netServiceDemand, 0) + ' people-eq');
    return '<div class="ai-summary" style="--lens-color:' + lens.color + '">' +
      '<div class="ai-summary-head"><strong>AI summary</strong><span>Powered by Gemini</span></div>' +
      '<p>The before/after diff for <strong>' + escapeHtml(postcode) + '</strong> in <strong>' + year + '</strong> shows ' + escapeHtml(branchName) + ' ' + direction + ' in the current <strong>' + escapeHtml(lens.label) + '</strong> view.</p>' +
      '<div class="ai-summary-metric"><span>' + escapeHtml(lens.label) + '</span><b>' + fmtScenarioIndex(summary.before, summary.deltaPts) + ' -> ' + fmtScenarioIndex(summary.after, summary.deltaPts) + '</b><em>' + (summary.flat ? 'no change' : (summary.deltaPts > 0 ? '+' : '') + summary.deltaPts.toFixed(Math.abs(summary.deltaPts) < 1 ? 2 : 1) + ' pts') + '</em></div>' +
      (concreteBits.length ? '<div class="ai-summary-chips">' + concreteBits.map(bit => '<span>' + escapeHtml(bit) + '</span>').join('') + '</div>' : '') +
      '</div>';
  }

  function updateWorkspaceSplitSummary() {
    const ctx = state.workspaceSplitContext;
    if (!ctx || !els.splitSummary) return;
    const branch = state.branches.find(b => b.id === ctx.branchId) || activeBranch();
    els.splitSummary.innerHTML = scenarioDiffSummaryHTML(ctx.beforeFc, ctx.afterFc, ctx.scenario, ctx.scenarioBranch, branch, ctx.building, ctx.year);
    const afterLabel = isBuildingRemovalItem(ctx.building) ? 'After removal ' : 'With build ';
    if (els.splitYearBefore) els.splitYearBefore.textContent = 'No-build ' + ctx.year;
    if (els.splitYearAfter) els.splitYearAfter.textContent = afterLabel + ctx.year;
  }

  async function refreshWorkspaceSplit() {
    const ctx = state.workspaceSplitContext;
    if (!ctx || !els.workspaceSplit || els.workspaceSplit.hidden) return;
    closeWorkspaceSplitMaps();
    updateWorkspaceSplitSummary();
    const maps = await Promise.all([
      buildScenarioDiffMapInContainer(document.getElementById('splitMapBefore'), 'before', ctx.beforeFc, ctx.building, ctx.year, false, workspaceSplitMaps),
      buildScenarioDiffMapInContainer(document.getElementById('splitMapAfter'), 'after', ctx.afterFc, ctx.building, ctx.year, true, workspaceSplitMaps)
    ]);
    if (maps[0] && maps[1]) syncScenarioDiffCameras(maps[0], maps[1]);
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
      '<span>Jobs ' + fmtConcreteSigned(impact.jobs.netJobsEstimate, 0) + ' (' + fmtConcreteSigned(impact.jobs.capacityEnabledJobs, 0) + ' capacity-enabled)</span>' +
      '<span>Electricity ' + fmtConcreteSigned(impact.electricity.peakKwChange, 0) + ' kW peak / ' + fmtConcreteSigned(impact.electricity.transformerReliefKw, 0) + ' kW relief</span>' +
      '<span>Headroom ' + fmtConcreteSigned(impact.electricity.localCapacityHeadroomKwChange, 0) + ' kW, risk ' + fmtConcreteSigned(impact.electricity.overloadRiskDelta, 3) + '</span>' +
      '<span>Public Transit ' + fmtConcreteSigned(impact.services.netServiceDemand, 0) + ' people-eq</span>' +
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

  async function ensureTrafficDiffReady() {
    if (!window.TrafficSim || typeof window.TrafficSim.runAgentSwarm !== 'function') return false;
    if (window.TrafficSim.isOsmLoaded && !window.TrafficSim.isOsmLoaded() && typeof window.TrafficSim.preloadOsm === 'function') {
      try { await window.TrafficSim.preloadOsm('/api/layers/2026/source-ni-roads-osm'); }
      catch (_) {}
    }
    return !window.TrafficSim.isOsmLoaded || window.TrafficSim.isOsmLoaded();
  }

  function scenarioTrafficDiffDemandPoints(grid, building, year, side, concrete) {
    const center = [Number(building.lng), Number(building.lat)];
    let points = baselineTrafficForecastDemandPoints(year, { centre: center, radiusKm: 2.35, limit: 70 });
    const isRemoval = isBuildingRemovalItem(building);
    const signedTrips = concrete && concrete.traffic ? Number(concrete.traffic.netDailyTrips) || 0 : 0;
    if (side === 'after' && isRemoval) {
      points = points.map(point => {
        const coord = point.geometry && point.geometry.coordinates;
        if (!Array.isArray(coord)) return point;
        const distKm = coordDistKm(coord, center);
        if (!Number.isFinite(distKm) || distKm > 1.35) return point;
        const props = point.properties || {};
        const relief = clamp(1 - distKm / 1.35, 0, 1);
        return Object.assign({}, point, {
          properties: Object.assign({}, props, {
            intensity: clamp((Number(props.intensity) || 0.2) * (1 - 0.55 * relief), 0.03, 1),
            delta: Math.min(Number(props.delta) || 0, -0.01 * relief),
            polarity: 1
          })
        });
      });
    }
    const trafficLens = SCENARIO_DIFF_LENSES.find(l => l.id === 'traffic') || currentScenarioDiffLens();
    const features = grid && Array.isArray(grid.features) ? grid.features : [];
    features.forEach((feature, i) => {
      const coord = pointOrCentroid(feature.geometry);
      if (!coord) return;
      const props = feature.properties || {};
      const value = scenarioDiffMetricValue(feature, trafficLens);
      const diff = scenarioDeltaValue(feature, trafficLens);
      const intensity = clamp(
        0.12 + value * 0.56 + Number(props.intensity || 0) * 0.2 + (side === 'after' ? Math.max(0, diff) * 4.8 : 0),
        0.08,
        1
      );
      points.push(pointFeatureFromCoord(coord, {
        id: 'scenario-traffic-cell-' + side + '-' + (props.cell_id || props.cellId || i),
        intensity: intensity,
        delta: diff,
        polarity: side === 'after' && diff < -0.002 ? 1 : -1,
        active: 0
      }));
    });

    if (side === 'after') {
      const trips = isRemoval ? Math.min(0, signedTrips) : Math.max(0, signedTrips);
      const sitePoint = pointFeatureFromCoord(center, {
        id: isRemoval ? 'scenario-building-trip-relief' : 'scenario-building-trip-demand',
        intensity: isRemoval ? clamp(0.52 + Math.abs(trips) / 7200, 0.52, 0.88) : clamp(0.68 + trips / 6500, 0.68, 1),
        delta: trips,
        polarity: isRemoval ? 1 : -1,
        active: 1
      });
      if (sitePoint) points.unshift(sitePoint);
    }

    points = points.filter(Boolean);
    points.sort((a, b) => {
      const aa = a.properties && a.properties.active ? 1 : 0;
      const ba = b.properties && b.properties.active ? 1 : 0;
      if (aa !== ba) return ba - aa;
      return (Number(b.properties && b.properties.intensity) || 0) -
        (Number(a.properties && a.properties.intensity) || 0);
    });
    return points.slice(0, 120);
  }

  async function addTrafficScenarioDiffLayers(map, side, grid, building, year, refLayerId) {
    if (!map || currentScenarioDiffLens().id !== 'traffic') return false;
    const ready = await ensureTrafficDiffReady();
    if (!ready) return false;
    const branch = activeBranch();
    const concrete = side === 'after' ? concreteImpactsForBranchYear(branch, year) : null;
    const demand = scenarioTrafficDiffDemandPoints(grid, building, year, side, concrete);
    const signedTrips = concrete && concrete.traffic ? Number(concrete.traffic.netDailyTrips) || 0 : 0;
    const demandAdjustment = signedTrips >= 0 ? signedTrips / 34 : signedTrips / 70;
    const result = window.TrafficSim.runAgentSwarm({
      branch: side === 'after' ? branch : null,
      demandPoints: demand,
      centre: [Number(building.lng), Number(building.lat)],
      radiusKm: 2.55,
      density: side === 'after'
        ? clamp(185 + demand.length * 2.2 + demandAdjustment, 120, 560)
        : clamp(145 + demand.length * 1.8, 150, 350),
      durationSeconds: 8,
      seed: (year * 2654435761 + (side === 'after' ? 911 : 433) + demand.length * 17) >>> 0,
      maxSegments: 2100,
      maxFlowSegments: side === 'after' ? 480 : 380,
      maxPointFeatures: side === 'after' ? 30 : 20
    });

    map.addSource('traffic-diff-base', { type: 'geojson', data: result.base || { type: 'FeatureCollection', features: [] } });
    map.addSource('traffic-diff-flow', { type: 'geojson', data: result.flow || { type: 'FeatureCollection', features: [] } });
    map.addSource('traffic-diff-points', { type: 'geojson', data: result.points || { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'traffic-diff-base-case',
      type: 'line',
      source: 'traffic-diff-base',
      paint: {
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.2, 16, 8.5],
        'line-color': '#020617',
        'line-opacity': 0.76
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' }
    }, refLayerId);
    map.addLayer({
      id: 'traffic-diff-base-line',
      type: 'line',
      source: 'traffic-diff-base',
      paint: {
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.55, 16, 2.5],
        'line-color': ['interpolate', ['linear'], ['get', 'weight'], 0.2, '#1d4ed8', 0.65, '#0284c7', 1, '#22d3ee'],
        'line-opacity': 0.72
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' }
    }, refLayerId);
    const ramp = [
      'interpolate', ['linear'], ['get', 'congestion'],
      0.00, '#2563eb',
      0.18, '#22d3ee',
      0.38, '#34d399',
      0.58, '#facc15',
      0.78, '#fb923c',
      1.00, '#ef4444'
    ];
    map.addLayer({
      id: 'traffic-diff-flow-glow',
      type: 'line',
      source: 'traffic-diff-flow',
      paint: {
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 7, 16, 22],
        'line-color': ramp,
        'line-opacity': ['interpolate', ['linear'], ['get', 'congestion'], 0, 0.05, 1, 0.34],
        'line-blur': 3.2
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' }
    }, refLayerId);
    map.addLayer({
      id: 'traffic-diff-flow-line',
      type: 'line',
      source: 'traffic-diff-flow',
      paint: {
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.4, 16, 8.8],
        'line-color': ramp,
        'line-opacity': 0.96
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' }
    }, refLayerId);
    map.addLayer({
      id: 'traffic-diff-demand-glow',
      type: 'circle',
      source: 'traffic-diff-points',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'intensity'], 0, 6, 1, 17],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.22,
        'circle-blur': 0.75
      }
    }, refLayerId);
    map.addLayer({
      id: 'traffic-diff-demand-core',
      type: 'circle',
      source: 'traffic-diff-points',
      paint: {
        'circle-radius': ['case', ['==', ['get', 'active'], 1], 5, 2.4],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#0f172a',
        'circle-stroke-width': 1.1,
        'circle-opacity': 0.92
      }
    }, refLayerId);
    return true;
  }

  function diffFeatureCollection(features) {
    return { type: 'FeatureCollection', features: (features || []).filter(Boolean) };
  }

  function geometryAnchorCoord(geom) {
    const centroid = pointOrCentroid(geom);
    if (centroid) return centroid;
    if (!geom) return null;
    if (geom.type === 'MultiPoint' && Array.isArray(geom.coordinates) && geom.coordinates.length) {
      return geom.coordinates[Math.floor(geom.coordinates.length / 2)];
    }
    if (geom.type === 'LineString' && Array.isArray(geom.coordinates) && geom.coordinates.length) {
      return geom.coordinates[Math.floor(geom.coordinates.length / 2)];
    }
    if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates) && geom.coordinates.length) {
      const line = geom.coordinates.slice().sort((a, b) => (b && b.length || 0) - (a && a.length || 0))[0];
      return line && line.length ? line[Math.floor(line.length / 2)] : null;
    }
    return null;
  }

  function featureAnchorCoord(feature) {
    return geometryAnchorCoord(feature && feature.geometry);
  }

  function cloneFeatureWithProps(feature, extraProps) {
    if (!feature || !feature.geometry) return null;
    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: Object.assign({}, feature.properties || {}, extraProps || {})
    };
  }

  function nearbyContextFeatures(fc, center, radiusKm, limit, predicate, propBuilder) {
    const features = fc && Array.isArray(fc.features) ? fc.features : [];
    const scored = [];
    features.forEach((feature, i) => {
      if (predicate && !predicate(feature)) return;
      const coord = featureAnchorCoord(feature);
      if (!coord) return;
      const distKm = center ? coordDistKm(coord, center) : 0;
      if (center && radiusKm && distKm > radiusKm) return;
      const extra = typeof propBuilder === 'function' ? propBuilder(feature, distKm, i) : {};
      const copy = cloneFeatureWithProps(feature, Object.assign({ __distKm: distKm }, extra || {}));
      if (copy) scored.push({ feature: copy, distKm });
    });
    scored.sort((a, b) => a.distKm - b.distKm);
    return scored.slice(0, Math.max(1, limit || scored.length)).map(row => row.feature);
  }

  function anchorPointFeatures(features, propBuilder) {
    const out = [];
    (features || []).forEach((feature, i) => {
      const coord = featureAnchorCoord(feature);
      if (!coord) return;
      const props = typeof propBuilder === 'function' ? propBuilder(feature, i) : (feature.properties || {});
      const point = pointFeatureFromCoord(coord, props);
      if (point) out.push(point);
    });
    return out;
  }

  function splitDiffSignalColor(side, lens, value, diff) {
    if (side === 'before') {
      if (lens.id === 'electricity') return ramp_RedGreen(clamp(1 - value, 0, 1));
      if (lens.id === 'buildings') return '#60a5fa';
      return lens.color;
    }
    if (Math.abs(diff) < 0.00005) return '#22d3ee';
    return scenarioDeltaColour(diff, lens);
  }

  function scenarioDiffPressurePointFeatures(grid, lens, side, building, opts) {
    opts = opts || {};
    const center = building ? [Number(building.lng), Number(building.lat)] : null;
    const features = grid && Array.isArray(grid.features) ? grid.features : [];
    const radiusKm = Number(opts.radiusKm) || 0;
    const limit = Number(opts.limit) || 90;
    const out = [];
    features.forEach((feature, i) => {
      const coord = pointOrCentroid(feature && feature.geometry);
      if (!coord) return;
      if (center && radiusKm && coordDistKm(coord, center) > radiusKm) return;
      const props = feature.properties || {};
      const value = clamp(Number(scenarioDiffMetricValue(feature, lens)) || 0, 0, 1.5);
      const diff = Number(scenarioDeltaValue(feature, lens)) || 0;
      const influence = Number(props.intensity) || 0;
      const magnitude = side === 'after'
        ? clamp(Math.max(Math.abs(diff) * 8, influence, value * 0.22), 0.07, 1)
        : clamp(Math.max(value, influence * 0.65), 0.06, 1);
      const p = pointFeatureFromCoord(coord, {
        id: 'scenario-' + lens.id + '-' + side + '-' + (props.cell_id || props.cellId || i),
        color: splitDiffSignalColor(side, lens, value, diff),
        value: value,
        delta: diff,
        magnitude: magnitude,
        active: 0
      });
      if (p) out.push(p);
    });
    if (side === 'after' && center) {
      const concrete = concreteImpactsForBranchYear(activeBranch(), opts.year || scenarioDiffYear()) || {};
      const siteMagnitude = (() => {
        if (lens.id === 'jobs') return clamp(Math.abs(Number(concrete.jobs && concrete.jobs.netJobsEstimate) || 0) / 900, 0.25, 1);
        if (lens.id === 'electricity') return clamp(Math.abs(Number(concrete.electricity && concrete.electricity.peakKwChange) || 0) / 2800, 0.25, 1);
        if (lens.id === 'services') return clamp(Math.abs(Number(concrete.services && concrete.services.netServiceDemand) || 0) / 3600, 0.25, 1);
        if (lens.id === 'buildings') {
          const area = Number(building && building.buildingConfig && building.buildingConfig.footprintSqm) || 900;
          const floors = Number(building && building.buildingConfig && building.buildingConfig.floors) || Number(building && building.floors) || 8;
          return clamp((Math.sqrt(area) / 45) + floors / 28, 0.32, 1);
        }
        return 0.6;
      })();
      const site = pointFeatureFromCoord(center, {
        id: 'scenario-' + lens.id + '-site-demand',
        color: lens.id === 'electricity' ? '#ef4444' : lens.color,
        value: 1,
        delta: siteMagnitude,
        magnitude: siteMagnitude,
        active: 1
      });
      if (site) out.unshift(site);
    }
    out.sort((a, b) => {
      const aa = a.properties && a.properties.active ? 1 : 0;
      const ba = b.properties && b.properties.active ? 1 : 0;
      if (aa !== ba) return ba - aa;
      return (Number(b.properties && b.properties.magnitude) || 0) -
        (Number(a.properties && a.properties.magnitude) || 0);
    });
    return out.slice(0, Math.max(1, limit));
  }

  function scenarioDiffMeanDelta(grid, lens) {
    const features = grid && Array.isArray(grid.features) ? grid.features : [];
    const values = features.map(feature => Number(scenarioDeltaValue(feature, lens))).filter(Number.isFinite);
    return values.length ? mean(values) : 0;
  }

  function scenarioDiffContextPressurePoints(features, lens, side, prefix, grid, limit) {
    const avgDiff = scenarioDiffMeanDelta(grid, lens);
    const source = (features || []).slice(0, Math.max(0, limit || 0));
    return anchorPointFeatures(source, (feature, i) => {
      const props = feature.properties || {};
      const distKm = Number(props.__distKm);
      const distanceWeight = Number.isFinite(distKm) ? clamp(1 - distKm / 4, 0.14, 1) : 0.45;
      const sourceWeight = Number.isFinite(Number(props.__weight)) ? Number(props.__weight) : distanceWeight;
      const magnitude = clamp(sourceWeight * (side === 'after' ? 0.62 : 0.34) + Math.abs(avgDiff) * 4.8, 0.08, side === 'after' ? 0.92 : 0.5);
      return {
        id: prefix + '-' + side + '-' + i,
        color: splitDiffSignalColor(side, lens, magnitude, avgDiff),
        value: magnitude,
        delta: avgDiff,
        magnitude: magnitude,
        active: 0,
        anchor: 1
      };
    });
  }

  function addScenarioDiffPressureLayers(map, sourceId, prefix, side, refLayerId) {
    map.addLayer({
      id: prefix + '-halo',
      type: 'circle',
      source: sourceId,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'magnitude'], 0, 7, 1, side === 'after' ? 30 : 22],
        'circle-color': ['get', 'color'],
        'circle-opacity': side === 'after' ? 0.34 : 0.2,
        'circle-blur': 0.58
      }
    }, refLayerId);
    map.addLayer({
      id: prefix + '-core',
      type: 'circle',
      source: sourceId,
      paint: {
        'circle-radius': ['case', ['==', ['get', 'active'], 1], 6, ['interpolate', ['linear'], ['get', 'magnitude'], 0, 2.2, 1, 7.4]],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#0f172a',
        'circle-stroke-width': 1.1,
        'circle-opacity': 0.94
      }
    }, refLayerId);
  }

  async function addJobsScenarioDiffLayers(map, side, grid, building, year, refLayerId) {
    if (!map || currentScenarioDiffLens().id !== 'jobs') return false;
    const lens = currentScenarioDiffLens();
    const center = [Number(building.lng), Number(building.lat)];
    const services = await loadContextLayer('source-ni-services-osm');
    const transport = await loadContextLayer('source-ni-transport-stops-osm');
    const serviceFeatures = nearbyContextFeatures(services, center, 3.2, 180, null, (feature, distKm) => ({
      __weight: clamp(1 - distKm / 3.2, 0.15, 1)
    }));
    const transportFeatures = nearbyContextFeatures(transport, center, 3.2, 120, null, (feature, distKm) => ({
      __weight: clamp(1 - distKm / 3.2, 0.12, 1)
    }));
    const pressure = scenarioDiffPressurePointFeatures(grid, lens, side, building, { year, limit: side === 'after' ? 95 : 70 })
      .concat(scenarioDiffContextPressurePoints(serviceFeatures.concat(transportFeatures), lens, side, 'jobs-anchor-pressure', grid, side === 'after' ? 70 : 45));

    map.addSource('jobs-diff-services', { type: 'geojson', data: diffFeatureCollection(serviceFeatures) });
    map.addSource('jobs-diff-transport', { type: 'geojson', data: diffFeatureCollection(transportFeatures) });
    map.addSource('jobs-diff-pressure', { type: 'geojson', data: diffFeatureCollection(pressure) });
    map.addLayer({
      id: 'jobs-diff-services-halo',
      type: 'circle',
      source: 'jobs-diff-services',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 15],
        'circle-color': '#a855f7',
        'circle-opacity': ['interpolate', ['linear'], ['get', '__weight'], 0, 0.08, 1, 0.24],
        'circle-blur': 0.7
      }
    }, refLayerId);
    map.addLayer({
      id: 'jobs-diff-services-core',
      type: 'circle',
      source: 'jobs-diff-services',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.8, 16, 5.2],
        'circle-color': '#d946ef',
        'circle-stroke-color': '#0f172a',
        'circle-stroke-width': 0.8,
        'circle-opacity': 0.82
      }
    }, refLayerId);
    map.addLayer({
      id: 'jobs-diff-transport-core',
      type: 'circle',
      source: 'jobs-diff-transport',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.7, 16, 4.6],
        'circle-color': '#22d3ee',
        'circle-stroke-color': '#0f172a',
        'circle-stroke-width': 0.75,
        'circle-opacity': 0.78
      }
    }, refLayerId);
    addScenarioDiffPressureLayers(map, 'jobs-diff-pressure', 'jobs-diff-pressure', side, refLayerId);
    return serviceFeatures.length > 0 || transportFeatures.length > 0 || pressure.length > 0;
  }

  async function addElectricityScenarioDiffLayers(map, side, grid, building, year, refLayerId) {
    if (!map || currentScenarioDiffLens().id !== 'electricity') return false;
    const lens = currentScenarioDiffLens();
    const center = [Number(building.lng), Number(building.lat)];
    const power = await loadContextLayer('source-ni-power-grid-osm');
    const electricity = await loadElectricityYear(Math.min(2026, Math.max(2016, Number(year) || 2026)));
    const lineFeatures = nearbyContextFeatures(power, center, 4.2, 220, feature => {
      const type = feature && feature.geometry && feature.geometry.type;
      return type === 'LineString' || type === 'MultiLineString';
    }, feature => ({ __powerType: (feature.properties && (feature.properties.power || feature.properties.osm_power)) || 'line' }));
    const assetSource = nearbyContextFeatures(electricity || power, center, 4.2, 180, feature => {
      const type = feature && feature.geometry && feature.geometry.type;
      return type !== 'LineString' && type !== 'MultiLineString';
    });
    const assetPoints = anchorPointFeatures(assetSource, (feature, i) => {
      const props = feature.properties || {};
      const load = Number(props.grid_load_pct);
      return Object.assign({}, props, {
        id: props.source_id || props.id || ('grid-asset-' + i),
        grid_load_pct: Number.isFinite(load) ? load : 58,
        headroom_pct: Number.isFinite(Number(props.headroom_pct)) ? Number(props.headroom_pct) : 42
      });
    });
    const pressure = scenarioDiffPressurePointFeatures(grid, lens, side, building, { year, limit: side === 'after' ? 85 : 60 })
      .concat(scenarioDiffContextPressurePoints(assetPoints, lens, side, 'electric-anchor-pressure', grid, side === 'after' ? 55 : 35));
    const connectorColor = side === 'after' ? '#ef4444' : '#06b6d4';
    const connectorFeatures = assetPoints
      .slice()
      .sort((a, b) => coordDistKm(center, a.geometry && a.geometry.coordinates) - coordDistKm(center, b.geometry && b.geometry.coordinates))
      .slice(0, 4)
      .map((feature, i) => {
        const coord = feature.geometry && feature.geometry.coordinates;
        if (!Array.isArray(coord)) return null;
        return {
          type: 'Feature',
          properties: {
            id: 'electric-site-connector-' + side + '-' + i,
            color: connectorColor,
            magnitude: side === 'after' ? 0.82 : 0.48
          },
          geometry: { type: 'LineString', coordinates: [center, coord] }
        };
      }).filter(Boolean);
    const siteLoad = pointFeatureFromCoord(center, {
      id: 'electric-site-load-' + side,
      color: connectorColor,
      magnitude: side === 'after' ? 0.95 : 0.52,
      active: 1
    });
    const loadColor = [
      'interpolate', ['linear'],
      ['coalesce', ['to-number', ['get', 'grid_load_pct']], 58],
      0, '#22c55e',
      55, '#22c55e',
      70, '#eab308',
      85, '#fb923c',
      100, '#ef4444'
    ];

    map.addSource('electric-diff-lines', { type: 'geojson', data: diffFeatureCollection(lineFeatures) });
    map.addSource('electric-diff-assets', { type: 'geojson', data: diffFeatureCollection(assetPoints) });
    map.addSource('electric-diff-pressure', { type: 'geojson', data: diffFeatureCollection(pressure) });
    map.addSource('electric-diff-connectors', { type: 'geojson', data: diffFeatureCollection(connectorFeatures) });
    map.addSource('electric-diff-site-load', { type: 'geojson', data: diffFeatureCollection(siteLoad ? [siteLoad] : []) });
    map.addLayer({
      id: 'electric-diff-line-glow',
      type: 'line',
      source: 'electric-diff-lines',
      paint: {
        'line-color': '#22d3ee',
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 11],
        'line-opacity': 0.18,
        'line-blur': 2.5
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' }
    }, refLayerId);
    map.addLayer({
      id: 'electric-diff-line-core',
      type: 'line',
      source: 'electric-diff-lines',
      paint: {
        'line-color': '#06b6d4',
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.9, 16, 3.1],
        'line-opacity': 0.8
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' }
    }, refLayerId);
    map.addLayer({
      id: 'electric-diff-asset-bleed',
      type: 'circle',
      source: 'electric-diff-assets',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 14, 16, 54],
        'circle-color': loadColor,
        'circle-opacity': 0.14,
        'circle-blur': 0.85
      }
    }, refLayerId);
    map.addLayer({
      id: 'electric-diff-asset-core',
      type: 'circle',
      source: 'electric-diff-assets',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.2, 16, 7.5],
        'circle-color': loadColor,
        'circle-stroke-color': '#0f172a',
        'circle-stroke-width': 1,
        'circle-opacity': 0.9
      }
    }, refLayerId);
    map.addLayer({
      id: 'electric-diff-connector-glow',
      type: 'line',
      source: 'electric-diff-connectors',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['get', 'magnitude'], 0, 6, 1, 18],
        'line-opacity': side === 'after' ? 0.3 : 0.18,
        'line-blur': 4
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' }
    }, refLayerId);
    map.addLayer({
      id: 'electric-diff-connector-core',
      type: 'line',
      source: 'electric-diff-connectors',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['get', 'magnitude'], 0, 1.8, 1, 5.4],
        'line-opacity': 0.86,
        'line-dasharray': side === 'after' ? [1.2, 0.8] : [1, 0.001]
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' }
    }, refLayerId);
    map.addLayer({
      id: 'electric-diff-site-load-halo',
      type: 'circle',
      source: 'electric-diff-site-load',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'magnitude'], 0, 18, 1, 58],
        'circle-color': ['get', 'color'],
        'circle-opacity': side === 'after' ? 0.26 : 0.18,
        'circle-blur': 0.72
      }
    }, refLayerId);
    map.addLayer({
      id: 'electric-diff-site-load-core',
      type: 'circle',
      source: 'electric-diff-site-load',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'magnitude'], 0, 4, 1, 9],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#0f172a',
        'circle-stroke-width': 1.2,
        'circle-opacity': 0.95
      }
    }, refLayerId);
    addScenarioDiffPressureLayers(map, 'electric-diff-pressure', 'electric-diff-pressure', side, refLayerId);
    return lineFeatures.length > 0 || assetPoints.length > 0 || pressure.length > 0;
  }

  async function addBuildingsScenarioDiffLayers(map, side, grid, building, year, refLayerId) {
    if (!map || currentScenarioDiffLens().id !== 'buildings') return false;
    const lens = currentScenarioDiffLens();
    const center = [Number(building.lng), Number(building.lat)];
    const buildings = await loadContextLayer('belfast-ni-buildings-3d');
    const existing = nearbyContextFeatures(buildings, center, 2.1, 900, feature => {
      const type = feature && feature.geometry && feature.geometry.type;
      return type === 'Polygon' || type === 'MultiPolygon';
    }, feature => {
      const props = feature.properties || {};
      const firstYear = Number(props.replay_first_visible_year);
      return {
        __existingColor: Number.isFinite(firstYear) && firstYear >= 2020 ? '#facc15' : '#3b82f6'
      };
    });
    const pressure = scenarioDiffPressurePointFeatures(grid, lens, side, building, { year, limit: side === 'after' ? 95 : 65 })
      .concat(scenarioDiffContextPressurePoints(existing, lens, side, 'building-anchor-pressure', grid, side === 'after' ? 70 : 45));

    map.addSource('buildings-diff-existing', { type: 'geojson', data: diffFeatureCollection(existing) });
    map.addSource('buildings-diff-pressure', { type: 'geojson', data: diffFeatureCollection(pressure) });
    map.addLayer({
      id: 'buildings-diff-existing-fill',
      type: 'fill',
      source: 'buildings-diff-existing',
      paint: {
        'fill-color': ['get', '__existingColor'],
        'fill-opacity': side === 'after' ? 0.18 : 0.26,
        'fill-outline-color': 'rgba(96,165,250,0.28)'
      }
    }, refLayerId);
    map.addLayer({
      id: 'buildings-diff-existing-3d',
      type: 'fill-extrusion',
      source: 'buildings-diff-existing',
      paint: {
        'fill-extrusion-color': ['get', '__existingColor'],
        'fill-extrusion-height': ['coalesce', ['to-number', ['get', 'replay_height_m']], ['*', ['coalesce', ['to-number', ['get', 'levels']], ['to-number', ['get', 'building:levels']], 4], 3], 12],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': side === 'after' ? 0.46 : 0.58
      }
    }, refLayerId);
    addScenarioDiffPressureLayers(map, 'buildings-diff-pressure', 'buildings-diff-pressure', side, refLayerId);
    return existing.length > 0 || pressure.length > 0;
  }

  async function addScenarioDiffRealLayers(map, side, grid, building, year, refLayerId) {
    const lens = currentScenarioDiffLens();
    if (lens.id === 'traffic') return addTrafficScenarioDiffLayers(map, side, grid, building, year, refLayerId);
    if (lens.id === 'jobs') return addJobsScenarioDiffLayers(map, side, grid, building, year, refLayerId);
    if (lens.id === 'electricity') return addElectricityScenarioDiffLayers(map, side, grid, building, year, refLayerId);
    if (lens.id === 'buildings') return addBuildingsScenarioDiffLayers(map, side, grid, building, year, refLayerId);
    if (lens.id === 'services') return addPublicTransportDiffLayers(map, side, year, activeBranch(), refLayerId, grid, building);
    return false;
  }

  function addScenarioDiffCellPolygonLayers(map, side, grid, activeLens, refLayerId) {
    const features = (grid && grid.features) ? grid.features.map(f => {
      const props = f.properties || {};
      const value = scenarioDiffMetricValue(f, activeLens);
      const diff = scenarioDeltaValue(f, activeLens);
      const neutralAffected = Math.abs(diff) < 0.00005;
      const goodness = activeLens.goodDirection === 'up' ? value : (1 - value);
      const color = side === 'before'
        ? ramp_RedGreen(clamp(goodness, 0, 1))
        : (neutralAffected ? '#22d3ee' : scenarioDeltaColour(diff, activeLens));
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
  }

  async function buildScenarioDiffMapInContainer(container, side, grid, building, year, showBuilding, mapStore) {
    if (!container) return null;
    container.innerHTML = '';
    const mp = state.manifest && state.manifest.mapbox;
    if (!mp || !mp.token || !window.mapboxgl) return null;

    mapboxgl.accessToken = mp.token;
    const center = scenarioDiffFocusCoord(building);
    const showBuildingExtrusion = showBuilding && scenarioDiffShowsBuilding(building);
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
      map.on('load', async () => {
        const activeLens = currentScenarioDiffLens();
        const refLayerId = (() => {
          const ls = map.getStyle().layers || [];
          for (const l of ls) if (l.type === 'symbol') return l.id;
          return undefined;
        })();
        const renderedRealLayers = await addScenarioDiffRealLayers(map, side, grid, building, year, refLayerId);
        if (!renderedRealLayers) addScenarioDiffCellPolygonLayers(map, side, grid, activeLens, refLayerId);

        const markerFeature = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: center } };
        map.addSource('site', { type: 'geojson', data: { type: 'FeatureCollection', features: [markerFeature] } });
        map.addLayer({
          id: 'site-glow',
          type: 'circle',
          source: 'site',
          paint: { 'circle-radius': showBuildingExtrusion ? 30 : 24, 'circle-color': showBuildingExtrusion ? '#22d3ee' : ((building && building.color) || '#60a5fa'), 'circle-opacity': 0.2, 'circle-blur': 1.2 }
        });
        map.addLayer({
          id: 'site-circle',
          type: 'circle',
          source: 'site',
          paint: { 'circle-radius': 8, 'circle-color': showBuildingExtrusion ? '#22d3ee' : ((building && building.color) || '#60a5fa'), 'circle-stroke-color': '#0a1426', 'circle-stroke-width': 2 }
        });

        if (showBuildingExtrusion) {
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
    const center = scenarioDiffFocusCoord(building);
    const showBuildingExtrusion = showBuilding && scenarioDiffShowsBuilding(building);
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
        const activeLens = currentScenarioDiffLens();
        const features = (grid && grid.features) ? grid.features.map(f => {
          const props = f.properties || {};
          const value = scenarioDiffMetricValue(f, activeLens);
          const diff = scenarioDeltaValue(f, activeLens);
          const neutralAffected = Math.abs(diff) < 0.00005;
          const goodness = activeLens.goodDirection === 'up' ? value : (1 - value);
          const color = side === 'before'
            ? ramp_RedGreen(clamp(goodness, 0, 1))
            : (neutralAffected ? '#22d3ee' : scenarioDeltaColour(diff, activeLens));
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
          paint: { 'circle-radius': showBuildingExtrusion ? 30 : 24, 'circle-color': showBuildingExtrusion ? '#22d3ee' : ((building && building.color) || '#60a5fa'), 'circle-opacity': 0.2, 'circle-blur': 1.2 }
        });
        map.addLayer({
          id: 'site-circle',
          type: 'circle',
          source: 'site',
          paint: { 'circle-radius': 8, 'circle-color': showBuildingExtrusion ? '#22d3ee' : ((building && building.color) || '#60a5fa'), 'circle-stroke-color': '#0a1426', 'circle-stroke-width': 2 }
        });

        if (showBuildingExtrusion) {
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
    { id: 'services',    label: 'Public Transit', source: 'services', color: '#22c55e', goodDir: 'up' }
  ];

  function impactMetricDef(id) {
    // Backward compat: older sessions stored 'transit' for the services lens.
    if (id === 'transit') return IMPACT_METRICS.find(m => m.id === 'services') || IMPACT_METRICS[0];
    return IMPACT_METRICS.find(m => m.id === id) || IMPACT_METRICS[0];
  }
  function impactMetricSource(id) { return impactMetricDef(id).source || id; }

  function ensureImpactLayers() {
    if (state.impactLayersAdded || !state.map || !state.mapLoaded) return;
    state.impactLayersAdded = true;
    const empty = { type: 'FeatureCollection', features: [] };

    if (!state.map.getSource('impact-ripples')) {
      state.map.addSource('impact-ripples', { type: 'geojson', data: empty });
    }
    if (!state.map.getSource('impact-points')) {
      state.map.addSource('impact-points', { type: 'geojson', data: empty });
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
    if (!state.map.getLayer('impact-points-glow')) {
      state.map.addLayer({
        id: 'impact-points-glow',
        type: 'circle',
        source: 'impact-points',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'intensity'], 0, 8, 1, 28],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.26,
          'circle-blur': 0.55
        }
      });
    }
    if (!state.map.getLayer('impact-points-core')) {
      state.map.addLayer({
        id: 'impact-points-core',
        type: 'circle',
        source: 'impact-points',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'intensity'], 0, 3, 1, 9],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.1,
          'circle-opacity': 0.9
        }
      });
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
    return true;
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

  function lensImpactRamp(metricId, polarityFavorable) {
    if (metricId === 'jobs') {
      return [
        'interpolate', ['linear'], ['heatmap-density'],
        0,    'rgba(0,0,0,0)',
        0.12, 'rgba(67,56,202,0.28)',
        0.34, 'rgba(124,58,237,0.54)',
        0.58, 'rgba(168,85,247,0.78)',
        0.82, 'rgba(217,70,239,0.92)',
        1,    'rgba(250,204,21,0.96)'
      ];
    }
    if (metricId === 'services') {
      return [
        'interpolate', ['linear'], ['heatmap-density'],
        0,    'rgba(0,0,0,0)',
        0.12, 'rgba(15,118,110,0.24)',
        0.34, 'rgba(34,197,94,0.52)',
        0.58, 'rgba(132,204,22,0.76)',
        0.82, 'rgba(190,242,100,0.9)',
        1,    'rgba(250,204,21,0.96)'
      ];
    }
    if (metricId === 'buildings') {
      return [
        'interpolate', ['linear'], ['heatmap-density'],
        0,    'rgba(0,0,0,0)',
        0.12, 'rgba(30,64,175,0.28)',
        0.34, 'rgba(37,99,235,0.52)',
        0.58, 'rgba(59,130,246,0.76)',
        0.82, 'rgba(34,211,238,0.9)',
        1,    'rgba(255,255,255,0.96)'
      ];
    }
    return metricRamp(metricColor(metricId), polarityFavorable);
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
      if (Math.abs(diff) < 0.00005) return;
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

  function baselineForecastImpactHeatmap(year, metricId) {
    const grid = futureForecastGrid(year);
    const features = grid && Array.isArray(grid.features) ? grid.features : [];
    if (!features.length) return null;
    const def = impactMetricDef(metricId);
    const source = impactMetricSource(metricId);
    const points = [];
    let polaritySum = 0;
    let polarityN = 0;
    features.forEach((feature, index) => {
      const centre = polygonCentroid(feature.geometry);
      if (!centre) return;
      const props = feature.properties || {};
      const value = Number(props[source]);
      const base = Number(props.baseline && props.baseline[source]);
      if (!Number.isFinite(value)) return;
      const delta = Number.isFinite(base) ? value - base : 0;
      const stress = def.goodDir === 'up' ? value : (1 - value);
      const intensity = clamp(0.08 + Math.abs(delta) * 3.2 + Math.max(0, value) * 0.58, 0.05, 0.82);
      const favourable = Math.abs(delta) < 0.00005
        ? true
        : (def.goodDir === 'up' ? delta > 0 : delta < 0);
      polaritySum += favourable ? 1 : -1;
      polarityN += 1;
      points.push({
        type: 'Feature',
        properties: {
          id: 'baseline-forecast-' + metricId + '-' + (props.cell_id || index),
          intensity,
          delta,
          value,
          metric: metricId,
          polarity: favourable ? 1 : -1,
          baselineForecast: 1,
          stress
        },
        geometry: { type: 'Point', coordinates: centre }
      });
    });
    return {
      points,
      polarityFavourable: polarityN > 0 ? polaritySum / polarityN >= 0 : true,
      confidence: 'medium-high'
    };
  }

  function mergeImpactHeatmaps(baselineHeatmap, scenarioHeatmap) {
    const basePoints = baselineHeatmap && Array.isArray(baselineHeatmap.points) ? baselineHeatmap.points : [];
    const scenarioPoints = scenarioHeatmap && Array.isArray(scenarioHeatmap.points) ? scenarioHeatmap.points : [];
    if (!basePoints.length && !scenarioPoints.length) return null;
    const points = basePoints.concat(scenarioPoints.map((point, index) => {
      const props = point.properties || {};
      return Object.assign({}, point, {
        properties: Object.assign({}, props, {
          id: props.id || ('scenario-forecast-' + index),
          baselineForecast: 0,
          intensity: clamp((Number(props.intensity) || 0.1) * 1.18, 0.08, 1)
        })
      });
    }));
    let polaritySum = 0;
    let polarityN = 0;
    points.forEach(point => {
      const polarity = Number(point.properties && point.properties.polarity);
      if (!Number.isFinite(polarity)) return;
      polaritySum += polarity;
      polarityN += 1;
    });
    return {
      points,
      polarityFavourable: polarityN > 0 ? polaritySum / polarityN >= 0 : true,
      confidence: (scenarioHeatmap && scenarioHeatmap.confidence) || (baselineHeatmap && baselineHeatmap.confidence) || 'medium'
    };
  }

  function baselineTrafficForecastDemandPoints(year, opts) {
    opts = opts || {};
    const centre = Array.isArray(opts.centre || opts.center) ? (opts.centre || opts.center) : null;
    const radiusKm = Number(opts.radiusKm) || 0;
    const limit = Math.max(1, Math.min(260, Number(opts.limit) || 140));
    const cells = state.baselineForecast && Array.isArray(state.baselineForecast.cells)
      ? state.baselineForecast.cells
      : [];
    const out = [];
    cells.forEach(cell => {
      const row = cell.forecastByYear && cell.forecastByYear[String(year)];
      if (!row) return;
      const coord = Array.isArray(cell.centroid) ? cell.centroid : polygonCentroid(cell.geometry);
      if (centre && radiusKm && coordDistKm(coord, centre) > radiusKm) return;
      const future = Number(row.traffic);
      const base = Number(cell.baseline2025 && cell.baseline2025.traffic);
      if (!Number.isFinite(future)) return;
      const delta = Number.isFinite(base) ? future - base : future;
      const intensity = clamp(future * 0.82 + Math.abs(delta) * 3.6, 0.05, 1);
      const feature = pointFeatureFromCoord(coord, {
        id: 'baseline-forecast-traffic-' + (cell.cellId || out.length),
        intensity: intensity,
        delta: delta,
        polarity: delta <= -0.005 ? 1 : -1,
        active: 0
      });
      if (feature) out.push(feature);
    });
    out.sort((a, b) => {
      const ap = a.properties || {}, bp = b.properties || {};
      const as = (Number(ap.intensity) || 0) + Math.abs(Number(ap.delta) || 0) * 1.8;
      const bs = (Number(bp.intensity) || 0) + Math.abs(Number(bp.delta) || 0) * 1.8;
      return bs - as;
    });
    return out.slice(0, limit);
  }

  function futureTrafficDemandPoints(branch, year, scenarioHeatmap) {
    let points = baselineTrafficForecastDemandPoints(year);
    if (scenarioHeatmap && Array.isArray(scenarioHeatmap.points) && scenarioHeatmap.points.length) {
      points = points.concat(scenarioHeatmap.points.map((p, i) => {
        const props = p.properties || {};
        return pointFeatureFromCoord(p.geometry && p.geometry.coordinates, {
          id: props.id || ('forecast-traffic-' + i),
          intensity: clamp(Number(props.intensity) || 0.25, 0.05, 1),
          polarity: Number.isFinite(Number(props.polarity)) ? Number(props.polarity) : -1,
          active: 0
        });
      }).filter(Boolean));
    } else if (window.BelfastPredictor && branch) {
      (branch.items || []).forEach(item => {
        if (item.type !== 'building' || item.year > year) return;
        const generated = window.BelfastPredictor.generateHeatmapPoints(item, year, 'traffic') || [];
        points = points.concat(generated.map((p, i) => pointFeatureFromCoord(p.geometry && p.geometry.coordinates, {
          id: (item.id || 'building') + '-traffic-' + i,
          intensity: clamp(Number(p.properties && p.properties.intensity) || 0.15, 0.04, 1),
          polarity: Number.isFinite(Number(p.properties && p.properties.polarity)) ? Number(p.properties.polarity) : -1,
          active: 0
        })).filter(Boolean));
      });
    }

    (branch && branch.items || [])
      .filter(item => (Number(item.year) || START_YEAR) <= year)
      .forEach(item => {
      let coord = null;
      if (item.type === 'road') {
        const path = Array.isArray(item.path) && item.path.length >= 2 ? item.path : [item.start, item.end].filter(Array.isArray);
        const loc = locationFromCoords(path);
        if (loc) coord = [loc.lng, loc.lat];
      } else if ((item.type === 'building' || isBuildingRemovalItem(item)) && Number.isFinite(Number(item.lng)) && Number.isFinite(Number(item.lat))) {
        coord = [Number(item.lng), Number(item.lat)];
      }
      if (!coord) return;
      const isRoad = item.type === 'road';
      const isRemoval = isBuildingRemovalItem(item);
      const feature = pointFeatureFromCoord(coord, {
        id: item.id,
        intensity: isRoad ? 0.9 : (isRemoval ? 0.62 : 0.72),
        polarity: (isRoad || isRemoval) ? 1 : -1,
        active: 1
      });
      if (feature) points.push(feature);
    });

    points.sort((a, b) => (Number(b.properties && b.properties.intensity) || 0) - (Number(a.properties && a.properties.intensity) || 0));
    return points.slice(0, 180);
  }

  function refreshFutureTrafficSwarm(branch, scenarioHeatmap) {
    if (!trafficSimReady(updateImpactRipples)) return;
    const demand = futureTrafficDemandPoints(branch, state.year, scenarioHeatmap);
    const concrete = concreteImpactsForBranchYear(branch, state.year);
    const signedTrips = concrete && concrete.traffic ? Number(concrete.traffic.netDailyTrips) || 0 : 0;
    const demandBoost = signedTrips >= 0 ? Math.min(120, signedTrips / 60) : Math.max(-60, signedTrips / 100);
    const itemCount = (branch && branch.items || []).filter(it => (Number(it.year) || START_YEAR) <= state.year).length;
    const result = window.TrafficSim.runAgentSwarm({
      branch: branch,
      demandPoints: demand,
      centre: BELFAST_CENTER,
      radiusKm: 14.5,
      cityWide: true,
      cityCoverage: 'whole-belfast',
      wholeCityRoads: true,
      cityRawSegmentLimit: 26000,
      cityDemandRadiusKm: 0.95,
      density: clamp(280 + demand.length * 0.9 + itemCount * 18 + demandBoost, 320, 720),
      durationSeconds: 9,
      seed: (state.year * 1103515245 + demand.length * 313 + itemCount * 977) >>> 0,
      maxSegments: 8200,
      maxFlowSegments: 8200,
      maxPointFeatures: 0,
      showDemandPoints: false
    });
    window.TrafficSim.showAgentSwarmOverlay(result);
    showCongestionLegend();
  }

  function impactEpicentreFeatures(branch, metricId) {
    if (!branch) return [];
    const def = impactMetricDef(metricId);
    return (branch.items || []).filter(item => (Number(item.year) || START_YEAR) <= state.year).map(item => {
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

  function clearImpactVisualization(opts) {
    opts = opts || {};
    if (state.map) {
      if (state.map.getSource('impact-ripples')) state.map.getSource('impact-ripples').setData({ type: 'FeatureCollection', features: [] });
      if (state.map.getSource('impact-points')) state.map.getSource('impact-points').setData({ type: 'FeatureCollection', features: [] });
      if (state.map.getSource('impact-epicentres')) state.map.getSource('impact-epicentres').setData({ type: 'FeatureCollection', features: [] });
    }
    if (opts.clearTraffic && window.TrafficSim) {
      if (typeof window.TrafficSim.isRunning === 'function' && window.TrafficSim.isRunning()) stopTrafficSim();
      if (typeof window.TrafficSim.clearAgentSwarmOverlay === 'function') window.TrafficSim.clearAgentSwarmOverlay();
      if (congestionLegendEl) congestionLegendEl.style.display = 'none';
    }
    if (opts.clearTransit) {
      const engine = window.PublicTransportEngine || window.TransitEngine;
      if (engine && typeof engine.clear === 'function') engine.clear();
      updateTransitImpactCard(null);
    }
  }

  function updateImpactRipples() {
    if (!state.mapLoaded) return;
    ensureImpactLayers();
    renderSimulationMapLayers().catch(() => {});
    const branch = activeBranch();
    if (!branch) return;
    if (state.mode !== 'simulation') {
      clearImpactVisualization({ clearTraffic: true, clearTransit: true });
      return;
    }
    if (state.isRunningSim || branch._scenarioPending) {
      clearImpactVisualization({ clearTraffic: true, clearTransit: true });
      return;
    }
    const metric = state.impactMetric;
    const scenarioHeatmap = scenarioImpactHeatmap(branch, state.year, metric);
    const scenarioPoints = scenarioHeatmap && Array.isArray(scenarioHeatmap.points) ? scenarioHeatmap.points : [];
    if (metric !== 'traffic' && window.TrafficSim && typeof window.TrafficSim.clearAgentSwarmOverlay === 'function') {
      window.TrafficSim.clearAgentSwarmOverlay();
      if (congestionLegendEl) congestionLegendEl.style.display = 'none';
    }
    if (metric === 'traffic') {
      if (state.map.getSource('impact-ripples')) state.map.getSource('impact-ripples').setData({ type: 'FeatureCollection', features: [] });
      if (state.map.getSource('impact-points')) state.map.getSource('impact-points').setData({ type: 'FeatureCollection', features: [] });
      if (state.map.getSource('impact-epicentres')) {
        state.map.getSource('impact-epicentres').setData({ type: 'FeatureCollection', features: impactEpicentreFeatures(branch, metric) });
      }
      refreshFutureTrafficSwarm(branch, scenarioHeatmap);
      return;
    }

    if (scenarioPoints.length) {
      if (metric === 'electricity') {
        if (state.map.getSource('impact-ripples')) {
          state.map.getSource('impact-ripples').setData({ type: 'FeatureCollection', features: [] });
        }
        if (state.map.getSource('impact-points')) {
          state.map.getSource('impact-points').setData({
            type: 'FeatureCollection',
            features: scenarioPoints.map(p => {
              const polarity = p.properties && Number(p.properties.polarity);
              const intensity = clamp(Number(p.properties && p.properties.intensity) || 0.2, 0.08, 1);
              return Object.assign({}, p, {
                properties: Object.assign({}, p.properties, {
                  intensity,
                  color: polarity >= 0 ? '#22c55e' : '#ef4444'
                })
              });
            })
          });
        }
      } else if (state.map.getLayer('impact-heatmap')) {
        state.map.setPaintProperty('impact-heatmap', 'heatmap-color', lensImpactRamp(metric, scenarioHeatmap.polarityFavourable));
        if (state.map.getSource('impact-points')) {
          state.map.getSource('impact-points').setData({ type: 'FeatureCollection', features: [] });
        }
        state.map.getSource('impact-ripples').setData({ type: 'FeatureCollection', features: scenarioPoints });
      }
      state.map.getSource('impact-epicentres').setData({ type: 'FeatureCollection', features: impactEpicentreFeatures(branch, metric) });
      return;
    }

    if (!window.BelfastPredictor) {
      state.map.getSource('impact-ripples').setData({ type: 'FeatureCollection', features: [] });
      if (state.map.getSource('impact-points')) state.map.getSource('impact-points').setData({ type: 'FeatureCollection', features: [] });
      state.map.getSource('impact-epicentres').setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const buildings = branch.items.filter(it => it.type === 'building' && it.year <= state.year);
    if (!buildings.length) {
      state.map.getSource('impact-ripples').setData({ type: 'FeatureCollection', features: [] });
      if (state.map.getSource('impact-points')) state.map.getSource('impact-points').setData({ type: 'FeatureCollection', features: [] });
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
    if (metric === 'electricity') {
      state.map.getSource('impact-ripples').setData({ type: 'FeatureCollection', features: [] });
      if (state.map.getSource('impact-points')) {
        state.map.getSource('impact-points').setData({
          type: 'FeatureCollection',
          features: allPts.map(p => {
            const polarity = p.properties && Number(p.properties.polarity);
            return Object.assign({}, p, {
              properties: Object.assign({}, p.properties, {
                color: polarity >= 0 ? '#22c55e' : '#ef4444',
                intensity: clamp(Number(p.properties && p.properties.intensity) || 0.18, 0.08, 1)
              })
            });
          })
        });
      }
    } else {
      if (state.map.getLayer('impact-heatmap')) {
        state.map.setPaintProperty('impact-heatmap', 'heatmap-color', lensImpactRamp(metric, polarityFavourable));
      }
      state.map.getSource('impact-ripples').setData({ type: 'FeatureCollection', features: allPts });
      if (state.map.getSource('impact-points')) state.map.getSource('impact-points').setData({ type: 'FeatureCollection', features: [] });
    }
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
    if (els.exportForm) els.exportForm.addEventListener('submit', submitExportPdf);
    document.querySelectorAll('input[name="exportMode"]').forEach(input => input.addEventListener('change', syncExportModeControls));
    if (els.exportBranchA) els.exportBranchA.addEventListener('change', syncExportModeControls);
    if (els.exportBranchB) els.exportBranchB.addEventListener('change', syncExportModeControls);
    if (els.scenarioDiffBtn) els.scenarioDiffBtn.addEventListener('click', openScenarioDiffModal);
    if (els.splitCloseBtn) els.splitCloseBtn.addEventListener('click', closeWorkspaceSplit);
    if (els.collapseBtn) els.collapseBtn.addEventListener('click', toggleBottomCollapse);
    if (els.modeBanner) {
      els.modeBanner.addEventListener('click', () => {
        // Jump to the boundary year of the OTHER mode (T2.1).
        setYear(isHistoricalMode() ? START_YEAR : BASE_YEAR);
      });
    }
    if (els.undoBtn) {
      els.undoBtn.addEventListener('click', undoLast);
      refreshUndoButton();
    }
    if (els.helpBtn) {
      els.helpBtn.addEventListener('click', () => showOnboardingTour({ force: true }));
    }
    if (els.plannerVariationsBtn) {
      els.plannerVariationsBtn.addEventListener('click', () => {
        const branch = activeBranch();
        const items = (branch && branch.items) || [];
        if (!items.length || branch.locked) return;
        // Seed from the latest non-removal item (the user's most recent edit).
        const seed = items.slice().reverse().find(it => it.type !== 'building_removal') || items[items.length - 1];
        createPlannerVariationsFromNode({ branchId: branch.id, itemId: seed && seed.id });
      });
      refreshPlannerVariationsBtn();
    }
    if (els.simProgressCancel) els.simProgressCancel.addEventListener('click', cancelSimRun);
    // Global Cmd/Ctrl+Z → undoLast (T3.4). Skips when typing in an input.
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undoLast();
      }
    });
    renderModeBanner();
    // Suppress mode-transition toasts during the first few seconds so a
    // page reload restoring saved state doesn't fire one (T2.1).
    __lastModeToastAt = Date.now();
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
    renderLensTabs();

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
        // T5.5: close whichever overlay is on top (locked-branch picker,
        // onboarding tour, or compare/diff/etc. modals). Each has its own
        // dismiss path; just remove the elements that don't have one.
        const onboarding = document.querySelector('.onboarding-overlay');
        if (onboarding) {
          // Treat Esc as "Skip" — also persists the "seen" flag.
          try { localStorage.setItem('belfastOnboardingV1Done', '1'); } catch (err) {}
          onboarding.remove();
          return;
        }
        const lockedPicker = document.querySelector('.locked-branch-picker-overlay');
        if (lockedPicker) {
          lockedPicker.remove();
          // The picker also resets the open flag on cleanup; mirror that here.
          try { __editableBranchPickerOpen = false; __pendingLockedEdit = null; } catch (err) {}
          return;
        }
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
    renderBranches();
    renderImpact();
    renderActiveInfo();
    renderMapSubtitle();
    renderLeftSidebar();
    if (state.mapLoaded) {
      renderItemsOnMap();
      if (state.mode === 'simulation') {
        updateImpactRipples();
        updateImpactLensUI();
      }
      syncCityBuildingHeightContext();
    }

    // Onboarding tour disabled — still reachable manually via the Help button
    // (showOnboardingTour({ force: true })).

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
      stopTrafficSim: stopTrafficSim,
      branchCommitYearlyJobs: branchCommitYearlyJobs,
      branchCommitHeatPoints: branchCommitHeatPoints,
      refreshFutureTrafficSwarm: refreshFutureTrafficSwarm,
      refreshHistoricalTrafficSwarm: refreshHistoricalTrafficSwarm,
      // Internals exposed for smoke tests:
      clearRoadPlanner: clearRoadPlanner,
      armRoadPlanner: armRoadPlanner,
      runRoadComparison: runRoadComparison,
      getWorkspaceSplitDebug: function () {
        function readMap(map) {
          if (!map || !map.getStyle) return null;
          const style = map.getStyle() || {};
          const sourceIds = Object.keys(style.sources || {});
          const layerIds = (style.layers || []).map(layer => layer.id);
          const sourceCounts = {};
          sourceIds.forEach(id => {
            const source = map.getSource(id);
            const data = source && source._data;
            sourceCounts[id] = data && Array.isArray(data.features) ? data.features.length : null;
          });
          return { sourceIds, layerIds, sourceCounts };
        }
        return {
          before: readMap(workspaceSplitMaps.before),
          after: readMap(workspaceSplitMaps.after)
        };
      },
      get roadPlannerArmed() { return roadPlanner.armed; },
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
