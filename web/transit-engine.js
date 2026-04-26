/* Public Transport Engine for Belfast.
 *
 * Data model:
 * - Base network: 2026 OSM transport stops served from
 *   /api/layers/2026/source-ni-transport-stops-osm.
 * - Historical evidence: the local infrastructure-events catalogue filtered
 *   to the services/public-access signal.
 * - Forecast signal: the trained BIMS forecast artifact still stores public
 *   transport and service-access pressure in the "services" metric.
 *
 * Public API:
 *   window.PublicTransportEngine.init({ map })
 *   window.PublicTransportEngine.preload()
 *   window.PublicTransportEngine.showForYear(year)
 *   window.PublicTransportEngine.showForecast({ branch, year })
 *   window.PublicTransportEngine.forecastFor(branch, year)
 *   window.PublicTransportEngine.baseFeatureCollection(year)
 *   window.PublicTransportEngine.forecastFeatureCollection(branch, year)
 *   window.PublicTransportEngine.clear()
 *
 * window.TransitEngine is kept as an alias so older dashboard code continues
 * to work while the product language moves to Public Transit.
 */
(function () {
  'use strict';

  const STOPS_URL = '/api/layers/2026/source-ni-transport-stops-osm';
  const EVENTS_URL = '/api/events?signal=services&limit=0';

  const BASE_SOURCE = 'pt-base-stops';
  const BASE_HEAT_LAYER = 'pt-access-heat';
  const BASE_HALO_LAYER = 'pt-stop-halo';
  const BASE_CORE_LAYER = 'pt-stop-core';
  const FORECAST_SOURCE = 'pt-forecast-stops';
  const FORECAST_HALO_LAYER = 'pt-forecast-halo';
  const FORECAST_CORE_LAYER = 'pt-forecast-core';

  const M_PER_DEG_LAT = 111320;
  const M_PER_DEG_LNG = 111320 * Math.cos(54.6 * Math.PI / 180);

  let map = null;
  let stops = null;
  let events = [];
  let loadPromise = null;
  let lastResult = null;

  function emptyFC() {
    return { type: 'FeatureCollection', features: [] };
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function distMetres(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
    const dx = (Number(b[0]) - Number(a[0])) * M_PER_DEG_LNG;
    const dy = (Number(b[1]) - Number(a[1])) * M_PER_DEG_LAT;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function pointFromGeometry(geometry) {
    if (!geometry) return null;
    if (geometry.type === 'Point') return geometry.coordinates;
    if (geometry.type === 'Polygon') return polygonCentroid(geometry.coordinates[0] || []);
    if (geometry.type === 'MultiPolygon') {
      const first = geometry.coordinates && geometry.coordinates[0] && geometry.coordinates[0][0];
      return polygonCentroid(first || []);
    }
    return null;
  }

  function polygonCentroid(ring) {
    if (!Array.isArray(ring) || !ring.length) return null;
    let x = 0;
    let y = 0;
    let n = 0;
    ring.forEach(pt => {
      if (Array.isArray(pt) && Number.isFinite(Number(pt[0])) && Number.isFinite(Number(pt[1]))) {
        x += Number(pt[0]);
        y += Number(pt[1]);
        n += 1;
      }
    });
    return n ? [x / n, y / n] : null;
  }

  function bboxForRing(ring) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ring.forEach(pt => {
      if (!Array.isArray(pt)) return;
      const x = Number(pt[0]);
      const y = Number(pt[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
    return { minX, minY, maxX, maxY };
  }

  function pointInRing(point, ring) {
    const x = Number(point[0]);
    const y = Number(point[1]);
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = Number(ring[i][0]), yi = Number(ring[i][1]);
      const xj = Number(ring[j][0]), yj = Number(ring[j][1]);
      const crosses = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function pointInPolygon(point, geometry) {
    if (!geometry) return false;
    if (geometry.type === 'Polygon') {
      const ring = geometry.coordinates && geometry.coordinates[0];
      return Array.isArray(ring) && pointInRing(point, ring);
    }
    if (geometry.type === 'MultiPolygon') {
      return (geometry.coordinates || []).some(poly => {
        const ring = poly && poly[0];
        return Array.isArray(ring) && pointInRing(point, ring);
      });
    }
    return false;
  }

  function distToSegment(point, a, b) {
    if (!Array.isArray(point) || !Array.isArray(a) || !Array.isArray(b)) return Infinity;
    const apx = (point[0] - a[0]) * M_PER_DEG_LNG;
    const apy = (point[1] - a[1]) * M_PER_DEG_LAT;
    const abx = (b[0] - a[0]) * M_PER_DEG_LNG;
    const aby = (b[1] - a[1]) * M_PER_DEG_LAT;
    const ab2 = abx * abx + aby * aby;
    const t = clamp(ab2 ? (apx * abx + apy * aby) / ab2 : 0, 0, 1);
    const dx = apx - abx * t;
    const dy = apy - aby * t;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function classifyMode(props) {
    const text = Object.keys(props || {}).map(k => String(props[k] || '')).join(' ').toLowerCase();
    if (text.includes('glider')) return 'glider';
    if (text.includes('rail') || text.includes('station') || text.includes('halt')) return 'rail';
    if (text.includes('park & ride') || text.includes('park and ride') || text.includes('parkway')) return 'park_ride';
    return 'bus';
  }

  function modeWeight(mode) {
    if (mode === 'rail') return 1.0;
    if (mode === 'glider') return 0.88;
    if (mode === 'park_ride') return 0.74;
    return 0.52;
  }

  function modeColor(mode) {
    if (mode === 'rail') return '#06b6d4';
    if (mode === 'glider') return '#a855f7';
    if (mode === 'park_ride') return '#15803d';
    return '#16a34a';
  }

  function normaliseStop(feature, index) {
    const props = feature.properties || {};
    const mode = classifyMode(props);
    const name = props.name || props.source_id || ('Stop ' + (index + 1));
    return {
      id: props.source_id || feature.id || ('stop-' + index),
      name,
      mode,
      coord: feature.geometry.coordinates.map(Number),
      firstYear: 2016,
      evidenceCount: 0,
      weight: modeWeight(mode),
      color: modeColor(mode),
    };
  }

  function normaliseEvent(ev) {
    if (!ev || !Array.isArray(ev.coordinates)) return null;
    const year = Number(ev.year) || 2016;
    return {
      id: ev.id,
      year: clamp(year, 2016, 2026),
      coord: ev.coordinates.map(Number),
      title: ev.title || 'Public transport access event',
      confidence: ev.confidence || 'medium',
    };
  }

  function attachEvidenceToStops() {
    if (!Array.isArray(stops) || !Array.isArray(events)) return;
    events.forEach(ev => {
      let best = null;
      let bestD = Infinity;
      stops.forEach(stop => {
        const d = distMetres(ev.coord, stop.coord);
        if (d < bestD) {
          best = stop;
          bestD = d;
        }
      });
      if (best && bestD <= 450) {
        best.firstYear = Math.min(best.firstYear, ev.year);
        best.evidenceCount += 1;
        best.weight = clamp(best.weight + 0.035, 0.35, 1.2);
      }
    });
  }

  function preload() {
    if (stops) return Promise.resolve(stops);
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all([
      fetch(STOPS_URL, { cache: 'force-cache' })
        .then(r => { if (!r.ok) throw new Error('public transport stops ' + r.status); return r.json(); }),
      fetch(EVENTS_URL, { cache: 'force-cache' })
        .then(r => r.ok ? r.json() : { events: [] })
        .catch(() => ({ events: [] }))
    ]).then(([stopData, eventData]) => {
      const features = (stopData && stopData.features) || [];
      stops = features
        .filter(f => f && f.geometry && f.geometry.type === 'Point')
        .map(normaliseStop);
      events = ((eventData && eventData.events) || []).map(normaliseEvent).filter(Boolean);
      attachEvidenceToStops();
      return stops;
    }).catch(err => {
      console.warn('PublicTransportEngine: load failed', err);
      stops = [];
      events = [];
      return stops;
    });
    return loadPromise;
  }

  function isLoaded() {
    return Array.isArray(stops) && stops.length > 0;
  }

  function ensureLayers() {
    if (!map) return false;
    try {
      if (!map.getStyle || !map.getStyle()) return false;
    } catch (_) {
      return false;
    }
    if (!map.getSource(BASE_SOURCE)) map.addSource(BASE_SOURCE, { type: 'geojson', data: emptyFC() });
    if (!map.getSource(FORECAST_SOURCE)) map.addSource(FORECAST_SOURCE, { type: 'geojson', data: emptyFC() });

    if (!map.getLayer(BASE_HEAT_LAYER)) {
      map.addLayer({
        id: BASE_HEAT_LAYER,
        type: 'heatmap',
        source: BASE_SOURCE,
        maxzoom: 17,
        paint: {
          'heatmap-weight': ['get', 'weight'],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.35, 14, 0.75, 17, 1.05],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 16, 14, 34, 17, 58],
          'heatmap-opacity': 0.34,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.18, 'rgba(6,182,212,0.20)',
            0.42, 'rgba(34,197,94,0.36)',
            0.72, 'rgba(132,204,22,0.48)',
            1, 'rgba(250,204,21,0.56)'
          ]
        }
      });
    }
    if (!map.getLayer(BASE_HALO_LAYER)) {
      map.addLayer({
        id: BASE_HALO_LAYER,
        type: 'circle',
        source: BASE_SOURCE,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 14, 7, 17, 13],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.16,
          'circle-blur': 0.45
        }
      });
    }
    if (!map.getLayer(BASE_CORE_LAYER)) {
      map.addLayer({
        id: BASE_CORE_LAYER,
        type: 'circle',
        source: BASE_SOURCE,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 14, 3.5, 17, 5.4],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
          'circle-opacity': 0.9
        }
      });
    }
    if (!map.getLayer(FORECAST_HALO_LAYER)) {
      map.addLayer({
        id: FORECAST_HALO_LAYER,
        type: 'circle',
        source: FORECAST_SOURCE,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'magnitude'], 0, 7, 1, 28],
          'circle-color': ['get', 'deltaColor'],
          'circle-opacity': 0.34,
          'circle-blur': 0.45
        }
      });
    }
    if (!map.getLayer(FORECAST_CORE_LAYER)) {
      map.addLayer({
        id: FORECAST_CORE_LAYER,
        type: 'circle',
        source: FORECAST_SOURCE,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'magnitude'], 0, 2.5, 1, 8],
          'circle-color': ['get', 'deltaColor'],
          'circle-stroke-color': '#0f172a',
          'circle-stroke-width': 1.2,
          'circle-opacity': 0.94
        }
      });
    }
    return true;
  }

  function stopFeature(stop, year) {
    return {
      type: 'Feature',
      properties: {
        id: stop.id,
        name: stop.name,
        mode: stop.mode,
        year: stop.firstYear,
        evidenceCount: stop.evidenceCount,
        weight: stop.weight,
        color: stop.color,
        visibleYear: year
      },
      geometry: { type: 'Point', coordinates: stop.coord }
    };
  }

  function baseFeatureCollection(year) {
    const y = Number(year) || 2026;
    const features = (stops || [])
      .filter(stop => stop.firstYear <= y)
      .map(stop => stopFeature(stop, y));
    return { type: 'FeatureCollection', features };
  }

  function selectedScenarioBranch(branch, year) {
    const scenario = branch && branch.scenarioResult;
    const row = scenario && scenario.timelineByYear && scenario.timelineByYear[String(year)];
    if (!row) return null;
    const objective = branch.forecastObjective || 'user_proposal';
    return (row.branches || []).find(b => b.objective === objective) || (row.branches || [])[0] || null;
  }

  function scenarioCellFeatures(branch, year) {
    const scenario = branch && branch.scenarioResult;
    const chosen = selectedScenarioBranch(branch, year);
    if (chosen && chosen.affectedCellsByYear && chosen.affectedCellsByYear[String(year)]) {
      return chosen.affectedCellsByYear[String(year)].features || [];
    }
    if (scenario && scenario.affectedCellsByYear && scenario.affectedCellsByYear[String(year)]) {
      return scenario.affectedCellsByYear[String(year)].features || [];
    }
    return [];
  }

  function scenarioMetricDelta(branch, year) {
    const scenario = branch && branch.scenarioResult;
    const row = scenario && scenario.timelineByYear && scenario.timelineByYear[String(year)];
    const chosen = selectedScenarioBranch(branch, year);
    if (!row || !chosen || !row.baseline) return 0;
    const after = Number(chosen.metrics && chosen.metrics.services);
    const before = Number(row.baseline && row.baseline.services);
    return Number.isFinite(after) && Number.isFinite(before) ? after - before : 0;
  }

  function cellIndexForBranch(branch, year) {
    return scenarioCellFeatures(branch, year).map(feature => {
      const geometry = feature.geometry;
      const props = feature.properties || {};
      const ring = geometry && geometry.type === 'Polygon'
        ? geometry.coordinates[0]
        : (geometry && geometry.type === 'MultiPolygon' && geometry.coordinates[0] && geometry.coordinates[0][0]);
      const centroid = pointFromGeometry(geometry);
      const deltas = props.deltas || {};
      return {
        geometry,
        bbox: Array.isArray(ring) ? bboxForRing(ring) : null,
        centroid,
        serviceDelta: Number(deltas.services || 0),
        intensity: Number(props.intensity || 0),
        confidence: props.confidence || 'medium'
      };
    }).filter(cell => cell.geometry && cell.centroid);
  }

  function cellForStop(stop, cells) {
    let nearest = null;
    let nearestD = Infinity;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell.bbox) {
        const c = stop.coord;
        if (c[0] >= cell.bbox.minX && c[0] <= cell.bbox.maxX && c[1] >= cell.bbox.minY && c[1] <= cell.bbox.maxY) {
          if (pointInPolygon(c, cell.geometry)) return cell;
        }
      }
      const d = distMetres(stop.coord, cell.centroid);
      if (d < nearestD) {
        nearest = cell;
        nearestD = d;
      }
    }
    return nearestD <= 1100 ? nearest : null;
  }

  function interventionSignal(stop, branch, year) {
    const items = ((branch && branch.items) || []).filter(it => (Number(it.year) || 2026) <= year);
    let roadSupply = 0;
    let demandPressure = 0;
    let nearbyBuildings = 0;

    items.forEach(item => {
      if (item.type === 'road') {
        const path = Array.isArray(item.path) && item.path.length >= 2 ? item.path : [item.start, item.end].filter(Array.isArray);
        for (let i = 0; i + 1 < path.length; i++) {
          const d = distToSegment(stop.coord, path[i], path[i + 1]);
          if (d <= 520) roadSupply += 0.34 * (1 - d / 520);
        }
      } else if (item.type === 'building' && Number.isFinite(Number(item.lng)) && Number.isFinite(Number(item.lat))) {
        const d = distMetres(stop.coord, [Number(item.lng), Number(item.lat)]);
        if (d <= 650) {
          const floors = Number(item.buildingConfig && item.buildingConfig.floors) || 6;
          const footprint = Number(item.buildingConfig && item.buildingConfig.footprintSqm) || 900;
          const scale = clamp((floors * Math.sqrt(footprint)) / 520, 0.25, 1.8);
          demandPressure += 0.18 * scale * (1 - d / 650);
          nearbyBuildings += 1;
        }
      }
    });

    return {
      roadSupply: clamp(roadSupply, 0, 1.2),
      demandPressure: clamp(demandPressure, 0, 1.2),
      nearbyBuildings
    };
  }

  function deltaColor(delta) {
    if (delta > 0.16) return '#16a34a';
    if (delta > 0.04) return '#86efac';
    if (delta < -0.16) return '#dc2626';
    if (delta < -0.04) return '#fb923c';
    return '#94a3b8';
  }

  function forecastFor(branch, year) {
    const y = Number(year) || 2036;
    if (!isLoaded() || !branch) {
      return {
        stops: [],
        summary: {
          networkStops: 0,
          affectedStops: 0,
          improvedStops: 0,
          strainedStops: 0,
          meanModelDelta: 0,
          modelCells: 0,
          dataSources: []
        }
      };
    }

    const cells = cellIndexForBranch(branch, y);
    const cityModelDelta = scenarioMetricDelta(branch, y);
    let affectedStops = 0;
    let improvedStops = 0;
    let strainedStops = 0;
    let relief = 0;
    let strain = 0;
    let modelDeltaSum = 0;

    const rows = stops.map(stop => {
      const cell = cellForStop(stop, cells);
      const modelDelta = (cell ? cell.serviceDelta : 0) + cityModelDelta * 0.35;
      const signals = interventionSignal(stop, branch, y);
      const accessOpportunity = signals.roadSupply + Math.max(0, modelDelta) * 3.2;
      const crowdingRisk = Math.max(0, signals.demandPressure - signals.roadSupply * 0.7) + Math.max(0, -modelDelta) * 2.4;
      const delta = Math.tanh(accessOpportunity - crowdingRisk);
      const magnitude = clamp(
        Math.abs(delta) * 0.72 +
        Math.abs(modelDelta) * 6 +
        signals.roadSupply * 0.42 +
        signals.demandPressure * 0.35 +
        (cell ? cell.intensity * 0.18 : 0),
        0,
        1
      );

      if (magnitude > 0.035) affectedStops += 1;
      if (delta > 0.04) {
        improvedStops += 1;
        relief += delta;
      } else if (delta < -0.04) {
        strainedStops += 1;
        strain += Math.abs(delta);
      }
      modelDeltaSum += modelDelta;

      return {
        stop,
        delta,
        magnitude,
        modelDelta,
        roadSupply: signals.roadSupply,
        demandPressure: signals.demandPressure,
        nearbyBuildings: signals.nearbyBuildings,
        confidence: cell ? cell.confidence : 'medium'
      };
    });

    lastResult = {
      stops: rows,
      summary: {
        networkStops: stops.length,
        affectedStops,
        improvedStops,
        strainedStops,
        totalRelief: relief,
        totalStrain: strain,
        netReliefIndex: relief - strain,
        meanModelDelta: stops.length ? modelDeltaSum / stops.length : 0,
        modelCells: cells.length,
        dataSources: [
          'OSM transport stops 2026',
          'BIMS forecast model services/public-access metric',
          'Scenario affected-cell deltas',
          'User branch interventions'
        ]
      }
    };
    return lastResult;
  }

  function forecastFeatureCollection(branch, year) {
    const result = forecastFor(branch, year);
    const features = result.stops
      .filter(row => row.magnitude > 0.035)
      .map(row => ({
        type: 'Feature',
        properties: {
          id: row.stop.id,
          name: row.stop.name,
          mode: row.stop.mode,
          delta: row.delta,
          modelDelta: row.modelDelta,
          magnitude: row.magnitude,
          roadSupply: row.roadSupply,
          demandPressure: row.demandPressure,
          confidence: row.confidence,
          deltaColor: deltaColor(row.delta)
        },
        geometry: { type: 'Point', coordinates: row.stop.coord }
      }));
    return { type: 'FeatureCollection', features, summary: result.summary };
  }

  function init(opts) {
    map = (opts && opts.map) || null;
    if (!map) return;
    if (map.loaded && map.loaded()) ensureLayers();
    else map.on('load', ensureLayers);
  }

  function setBaseData(year) {
    if (!ensureLayers()) return false;
    const base = map.getSource(BASE_SOURCE);
    if (base) base.setData(baseFeatureCollection(year));
    return true;
  }

  function showForYear(year) {
    if (!setBaseData(year)) {
      if (map && map.once) map.once('styledata', () => showForYear(year));
      return null;
    }
    const forecast = map.getSource(FORECAST_SOURCE);
    if (forecast) forecast.setData(emptyFC());
    return { summary: { networkStops: (stops || []).length, mode: 'historical' } };
  }

  function showForecast(opts) {
    opts = opts || {};
    const year = Number(opts.year) || 2036;
    const branch = opts.branch || null;
    if (!setBaseData(year)) {
      if (map && map.once) map.once('styledata', () => showForecast(opts));
      return null;
    }
    const fc = forecastFeatureCollection(branch, year);
    const forecast = map.getSource(FORECAST_SOURCE);
    if (forecast) forecast.setData(fc);
    return { stops: lastResult ? lastResult.stops : [], summary: fc.summary };
  }

  function clear() {
    if (!map) return;
    const base = map.getSource(BASE_SOURCE);
    const forecast = map.getSource(FORECAST_SOURCE);
    if (base) base.setData(emptyFC());
    if (forecast) forecast.setData(emptyFC());
  }

  function getStopsNear(coord, radiusKm) {
    if (!isLoaded() || !Array.isArray(coord)) return [];
    const radius = (Number(radiusKm) || 1) * 1000;
    return stops.filter(stop => distMetres(stop.coord, coord) <= radius);
  }

  function diagnostics() {
    return {
      loaded: isLoaded(),
      stopCount: (stops || []).length,
      eventCount: events.length,
      lastSummary: lastResult && lastResult.summary,
      sources: {
        stops: STOPS_URL,
        events: EVENTS_URL,
        forecastMetric: 'services'
      }
    };
  }

  const api = {
    init,
    preload,
    isLoaded,
    showForYear,
    showForecast,
    forecastFor,
    baseFeatureCollection,
    forecastFeatureCollection,
    getStopsNear,
    clear,
    diagnostics
  };

  window.PublicTransportEngine = api;
  window.TransitEngine = api;
})();
