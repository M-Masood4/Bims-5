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
 *   window.PublicTransportEngine.baseRouteFeatureCollection(year)
 *   window.PublicTransportEngine.forecastFeatureCollection(branch, year)
 *   window.PublicTransportEngine.forecastRouteFeatureCollection(branch, year)
 *   window.PublicTransportEngine.clear()
 *
 * window.TransitEngine is kept as an alias so older dashboard code continues
 * to work while the product language moves to Public Transit.
 */
(function () {
  'use strict';

  const STOPS_URL = '/api/layers/2026/source-ni-transport-stops-osm';
  const TRANSLINK_STOPS_URL = '/data/derived/2026/translink_belfast_bus_stops_2026.geojson';
  const TRANSLINK_ROUTES_URL = '/data/derived/2026/translink_belfast_route_segments_2026.geojson';
  const EVENTS_URL = '/api/events?signal=services&limit=0';

  const BASE_SOURCE = 'pt-base-stops';
  const ROUTE_SOURCE = 'pt-base-routes';
  const ROUTE_LINE_LAYER = 'pt-route-line';
  const ROUTE_STOP_LAYER = 'pt-route-nodes';
  const BASE_CORE_LAYER = 'pt-stop-core';
  const BASE_SYMBOL_LAYER = 'pt-stop-symbols';
  const FORECAST_SOURCE = 'pt-forecast-stops';
  const FORECAST_ROUTE_SOURCE = 'pt-forecast-routes';
  const FORECAST_ROUTE_LINE_LAYER = 'pt-forecast-route-line';
  const FORECAST_CORE_LAYER = 'pt-forecast-core';

  const M_PER_DEG_LAT = 111320;
  const M_PER_DEG_LNG = 111320 * Math.cos(54.6 * Math.PI / 180);

  let map = null;
  let stops = null;
  let routes = [];
  let officialRouteFeatures = null;
  let officialRouteSummary = null;
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

  function projectOnSegment(point, a, b) {
    if (!Array.isArray(point) || !Array.isArray(a) || !Array.isArray(b)) return 0;
    const apx = (point[0] - a[0]) * M_PER_DEG_LNG;
    const apy = (point[1] - a[1]) * M_PER_DEG_LAT;
    const abx = (b[0] - a[0]) * M_PER_DEG_LNG;
    const aby = (b[1] - a[1]) * M_PER_DEG_LAT;
    const ab2 = abx * abx + aby * aby;
    return clamp(ab2 ? (apx * abx + apy * aby) / ab2 : 0, 0, 1);
  }

  function routeColor(kind) {
    if (kind === 'glider') return '#7c3aed';
    if (kind === 'orbital') return '#16a34a';
    if (kind === 'rail') return '#0ea5e9';
    if (kind === 'future') return '#7c3aed';
    return '#0284c7';
  }

  function routeSpecs() {
    // Major corridors are snapped to the in-app Belfast OSM stop network:
    // current Glider/Metro axes plus the north/south expansion corridor.
    return [
      {
        id: 'glider-g1-east-west',
        name: 'Glider G1 east-west spine',
        kind: 'glider',
        color: '#0284c7',
        anchors: [[-6.055, 54.590], [-6.005, 54.595], [-5.930, 54.598], [-5.865, 54.598], [-5.805, 54.606]]
      },
      {
        id: 'metro-north-south',
        name: 'Metro north-south spine',
        kind: 'bus',
        color: '#16a34a',
        anchors: [[-5.944, 54.681], [-5.935, 54.632], [-5.930, 54.598], [-5.929, 54.563], [-5.938, 54.522]]
      },
      {
        id: 'lagan-cross-city',
        name: 'Lagan cross-city rail/bus spine',
        kind: 'rail',
        color: '#0ea5e9',
        anchors: [[-6.074, 54.553], [-6.005, 54.575], [-5.932, 54.596], [-5.880, 54.620], [-5.815, 54.657]]
      },
      {
        id: 'g3-north-south-expansion',
        name: 'Likely G3 north-south expansion',
        kind: 'future',
        color: '#15803d',
        anchors: [[-6.065, 54.651], [-6.010, 54.622], [-5.932, 54.598], [-5.875, 54.571], [-5.812, 54.533]]
      },
      {
        id: 'glider-g2-titanic-quarter',
        name: 'Glider G2 Titanic Quarter link',
        kind: 'glider',
        color: '#7c3aed',
        anchors: [[-5.945, 54.594], [-5.910, 54.604], [-5.870, 54.606], [-5.832, 54.615]]
      }
    ];
  }

  function nearestStop(coord, maxMetres) {
    let best = null;
    let bestD = Infinity;
    (stops || []).forEach(stop => {
      const d = distMetres(coord, stop.coord);
      if (d < bestD) {
        best = stop;
        bestD = d;
      }
    });
    return best && bestD <= (maxMetres || 900) ? best : null;
  }

  function routeStopsForSpec(spec) {
    const seen = new Set();
    const rows = [];
    for (let i = 0; i + 1 < spec.anchors.length; i++) {
      const a = spec.anchors[i];
      const b = spec.anchors[i + 1];
      (stops || []).forEach(stop => {
        const d = distToSegment(stop.coord, a, b);
        if (d > 420) return;
        const t = projectOnSegment(stop.coord, a, b);
        rows.push({ stop, key: i + t, d });
      });
    }
    spec.anchors.forEach((anchor, index) => {
      const stop = nearestStop(anchor, 950);
      if (stop) rows.push({ stop, key: index, d: 0 });
    });
    return rows
      .sort((a, b) => (a.key - b.key) || (a.d - b.d))
      .filter(row => {
        if (seen.has(row.stop.id)) return false;
        seen.add(row.stop.id);
        return true;
      })
      .filter((row, index, arr) => {
        if (arr.length <= 26) return true;
        const stride = Math.ceil(arr.length / 26);
        return index % stride === 0 || index === arr.length - 1;
      })
      .map(row => row.stop);
  }

  function buildRouteCorridors() {
    routes = routeSpecs().map(spec => {
      const routeStops = routeStopsForSpec(spec);
      const coords = routeStops.length >= 2
        ? routeStops.map(stop => stop.coord)
        : spec.anchors;
      return {
        id: spec.id,
        name: spec.name,
        kind: spec.kind,
        color: spec.color || routeColor(spec.kind),
        stops: routeStops,
        coords
      };
    }).filter(route => route.coords.length >= 2);
    return routes;
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

  function modeSymbol(mode) {
    if (mode === 'rail') return 'R';
    if (mode === 'glider') return 'G';
    if (mode === 'park_ride') return 'P';
    return 'B';
  }

  function normaliseStop(feature, index) {
    const props = feature.properties || {};
    const mode = classifyMode(props);
    const name = props.name || props.source_id || ('Stop ' + (index + 1));
    const servingLineCount = Number(props.servingLineCount);
    const weight = Number(props.weight);
    const routeNode = Number(props.routeNode);
    return {
      id: props.source_id || feature.id || ('stop-' + index),
      name,
      mode,
      coord: feature.geometry.coordinates.map(Number),
      firstYear: 2016,
      evidenceCount: 0,
      servingLineCount: Number.isFinite(servingLineCount) ? servingLineCount : 0,
      routeNode: Number.isFinite(routeNode) ? routeNode : 0,
      weight: Number.isFinite(weight) ? clamp(weight, 0.25, 1.25) : modeWeight(mode),
      color: props.color || modeColor(mode),
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
      fetch(TRANSLINK_STOPS_URL, { cache: 'force-cache' })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null),
      fetch(TRANSLINK_ROUTES_URL, { cache: 'force-cache' })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null),
      fetch(STOPS_URL, { cache: 'force-cache' })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null),
      fetch(EVENTS_URL, { cache: 'force-cache' })
        .then(r => r.ok ? r.json() : { events: [] })
        .catch(() => ({ events: [] }))
    ]).then(([translinkStops, translinkRoutes, osmStops, eventData]) => {
      const stopData = translinkStops && translinkStops.features && translinkStops.features.length ? translinkStops : osmStops;
      const features = (stopData && stopData.features) || [];
      stops = features
        .filter(f => f && f.geometry && f.geometry.type === 'Point')
        .map(normaliseStop);
      officialRouteFeatures = translinkRoutes && Array.isArray(translinkRoutes.features)
        ? translinkRoutes.features.filter(f => f && f.geometry && f.geometry.type === 'LineString')
        : null;
      officialRouteSummary = translinkRoutes && translinkRoutes.summary ? translinkRoutes.summary : null;
      events = ((eventData && eventData.events) || []).map(normaliseEvent).filter(Boolean);
      attachEvidenceToStops();
      buildRouteCorridors();
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
    if (!map.getSource(ROUTE_SOURCE)) map.addSource(ROUTE_SOURCE, { type: 'geojson', data: emptyFC() });
    if (!map.getSource(FORECAST_SOURCE)) map.addSource(FORECAST_SOURCE, { type: 'geojson', data: emptyFC() });
    if (!map.getSource(FORECAST_ROUTE_SOURCE)) map.addSource(FORECAST_ROUTE_SOURCE, { type: 'geojson', data: emptyFC() });

    ['pt-access-heat', 'pt-stop-halo', 'pt-route-glow', 'pt-forecast-route-glow', 'pt-forecast-halo'].forEach(layerId => {
      if (!map.getLayer(layerId)) return;
      try { map.removeLayer(layerId); } catch (_) {}
    });

    if (!map.getLayer(ROUTE_LINE_LAYER)) {
      map.addLayer({
        id: ROUTE_LINE_LAYER,
        type: 'line',
        source: ROUTE_SOURCE,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['get', 'strength'], 0, 0.65, 0.35, 1.25, 0.72, 3.2, 1, 6.2],
          'line-opacity': ['interpolate', ['linear'], ['get', 'strength'], 0, 0.34, 0.45, 0.58, 1, 0.94]
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          'line-sort-key': ['get', 'coverage']
        }
      });
    }
    if (!map.getLayer(ROUTE_STOP_LAYER)) {
      map.addLayer({
        id: ROUTE_STOP_LAYER,
        type: 'circle',
        source: BASE_SOURCE,
        filter: ['==', ['get', 'routeNode'], 1],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 15, 3.4],
          'circle-color': '#ffffff',
          'circle-stroke-color': ['get', 'routeColor'],
          'circle-stroke-width': 1,
          'circle-opacity': 0.72
        }
      });
    }

    if (!map.getLayer(BASE_CORE_LAYER)) {
      map.addLayer({
        id: BASE_CORE_LAYER,
        type: 'circle',
        source: BASE_SOURCE,
        paint: {
          'circle-radius': [
            '+',
            ['interpolate', ['linear'], ['zoom'], 10, 1.1, 14, 2.0, 17, 2.8],
            ['interpolate', ['linear'], ['get', 'servingLineCount'], 0, 0, 24, 0.8, 80, 2.4]
          ],
          'circle-color': ['get', 'routeColor'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 0.6,
          'circle-opacity': 0.84
        }
      });
    }
    if (!map.getLayer(BASE_SYMBOL_LAYER)) {
      map.addLayer({
        id: BASE_SYMBOL_LAYER,
        type: 'symbol',
        source: BASE_SOURCE,
        layout: {
          'text-field': ['get', 'stopSymbol'],
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 10, 5.5, 14, 7.5, 17, 9.5],
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'text-padding': 1
        },
        paint: {
          'text-color': '#0f172a',
          'text-halo-color': '#ffffff',
          'text-halo-width': 0.65,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 12.9, 0, 14, 0.82, 15, 0.96]
        }
      });
    }
    [ROUTE_LINE_LAYER, ROUTE_STOP_LAYER, BASE_CORE_LAYER, BASE_SYMBOL_LAYER].forEach(layerId => {
      if (!map.getLayer(layerId)) return;
      const beforeForecast = map.getLayer(FORECAST_ROUTE_LINE_LAYER) ? FORECAST_ROUTE_LINE_LAYER : undefined;
      try {
        if (beforeForecast) map.moveLayer(layerId, beforeForecast);
        else map.moveLayer(layerId);
      } catch (_) {}
    });
    if (!map.getLayer(FORECAST_ROUTE_LINE_LAYER)) {
      map.addLayer({
        id: FORECAST_ROUTE_LINE_LAYER,
        type: 'line',
        source: FORECAST_ROUTE_SOURCE,
        paint: {
          'line-color': ['get', 'deltaColor'],
          'line-width': ['interpolate', ['linear'], ['get', 'magnitude'], 0, 1.7, 1, 4.6],
          'line-opacity': 0.88,
          'line-dasharray': [1.3, 0.7]
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' }
      });
    }
    if (!map.getLayer(FORECAST_CORE_LAYER)) {
      map.addLayer({
        id: FORECAST_CORE_LAYER,
        type: 'circle',
        source: FORECAST_SOURCE,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'magnitude'], 0, 2, 1, 5.4],
          'circle-color': ['get', 'deltaColor'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 0.9,
          'circle-opacity': 0.9
        }
      });
    }
    return true;
  }

  function routeEventCount(route, year) {
    const y = Number(year) || 2026;
    const coords = route && route.coords ? route.coords : [];
    if (!coords.length || !events.length) return 0;
    return events.filter(ev => {
      if (!ev || ev.year > y) return false;
      for (let i = 0; i + 1 < coords.length; i++) {
        if (distToSegment(ev.coord, coords[i], coords[i + 1]) <= 560) return true;
      }
      return coords.some(coord => distMetres(ev.coord, coord) <= 520);
    }).length;
  }

  function routeStrengthForYear(route, year) {
    const y = Number(year) || 2026;
    const stopDensity = clamp(((route && route.stops && route.stops.length) || 2) / 22, 0.25, 1);
    const timeRamp = clamp((y - 2016) / 10, 0, 1);
    const evidenceRamp = clamp(routeEventCount(route, y) / 5, 0, 1);
    const futureCue = y > 2026 && route && route.kind === 'future' ? clamp((y - 2026) / 10, 0, 1) * 0.18 : 0;
    return clamp(0.18 + stopDensity * 0.34 + timeRamp * 0.24 + evidenceRamp * 0.20 + futureCue, 0.18, 0.98);
  }

  function routeStopMetaForYear(year) {
    const meta = {};
    const y = Number(year) || 2026;
    routes.forEach(route => {
      const strength = routeStrengthForYear(route, y);
      (route.stops || []).forEach(stop => {
        if (stop.firstYear > y) return;
        if (!meta[stop.id] || strength > meta[stop.id].strength) {
          meta[stop.id] = {
            color: route.color,
            routeId: route.id,
            routeName: route.name,
            strength
          };
        }
      });
    });
    return meta;
  }

  function stopFeature(stop, year, routeMeta) {
    const meta = routeMeta || null;
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
        stopSymbol: modeSymbol(stop.mode),
        servingLineCount: stop.servingLineCount || 0,
        routeNode: meta ? 1 : (stop.routeNode || 0),
        routeColor: meta ? meta.color : stop.color,
        routeName: meta ? meta.routeName : '',
        visibleYear: year
      },
      geometry: { type: 'Point', coordinates: stop.coord }
    };
  }

  function baseFeatureCollection(year) {
    const y = Number(year) || 2026;
    const routeMeta = routeStopMetaForYear(y);
    const features = (stops || [])
      .filter(stop => stop.firstYear <= y)
      .map(stop => stopFeature(stop, y, routeMeta[stop.id]));
    return { type: 'FeatureCollection', features };
  }

  function baseRouteFeatureCollection(year) {
    const y = Number(year) || 2026;
    if (officialRouteFeatures && officialRouteFeatures.length) {
      const yearRamp = clamp((y - 2016) / 10, 0.55, 1);
      const features = officialRouteFeatures.map(feature => {
        const props = feature.properties || {};
        const strength = clamp((Number(props.strength) || 0.35) * yearRamp, 0.16, 1);
        return {
          type: 'Feature',
          properties: Object.assign({}, props, {
            strength,
            visibleYear: y,
            official: 1
          }),
          geometry: feature.geometry
        };
      });
      return { type: 'FeatureCollection', features, summary: officialRouteSummary };
    }
    const features = routes.map(route => {
      const strength = routeStrengthForYear(route, y);
      return {
        type: 'Feature',
        properties: {
          id: route.id,
          name: route.name,
          kind: route.kind,
          color: route.color,
          strength,
          stopCount: (route.stops || []).length,
          evidenceCount: routeEventCount(route, y),
          visibleYear: y
        },
        geometry: { type: 'LineString', coordinates: route.coords }
      };
    });
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

  function validCoord(coord) {
    return Array.isArray(coord) &&
      coord.length >= 2 &&
      Number.isFinite(Number(coord[0])) &&
      Number.isFinite(Number(coord[1]));
  }

  function pathForItem(item) {
    if (!item) return [];
    const path = Array.isArray(item.path) && item.path.length >= 2
      ? item.path
      : [item.start, item.end].filter(validCoord);
    return path.filter(validCoord).map(coord => [Number(coord[0]), Number(coord[1])]);
  }

  function pathLengthMetres(path) {
    let metres = 0;
    for (let i = 0; i + 1 < path.length; i++) metres += distMetres(path[i], path[i + 1]);
    return metres;
  }

  function plannedTransitRouteFeatures(branch, year, meanModelDelta) {
    const y = Number(year) || 2036;
    const items = ((branch && branch.items) || []).filter(item => item && item.type === 'road' && (Number(item.year) || 2026) <= y);
    return items.map((item, index) => {
      const path = pathForItem(item);
      if (path.length < 2) return null;
      const text = [
        item.label,
        item.plannerMode,
        item.plannerEngine,
        branch && branch.plannerEngine,
        branch && branch.forecastObjective
      ].filter(Boolean).join(' ').toLowerCase();
      const isTransitPriority = /transit|public|bus|services|glider/.test(text);
      const horizon = clamp((y - (Number(item.year) || 2026)) / 10, 0, 1);
      const lengthScore = clamp(pathLengthMetres(path) / 4200, 0.12, 0.58);
      const delta = clamp(0.1 + lengthScore * 0.22 + horizon * 0.12 + Math.max(0, meanModelDelta || 0) * 4 + (isTransitPriority ? 0.16 : 0.06), 0.08, 0.72);
      const magnitude = clamp(0.25 + lengthScore + horizon * 0.22 + Math.abs(meanModelDelta || 0) * 5, 0.22, 1);
      return {
        type: 'Feature',
        properties: {
          id: 'planned-transit-' + (item.id || index),
          name: isTransitPriority ? 'Planned transit-priority corridor' : 'Likely bus corridor on new road',
          kind: 'planned',
          delta,
          magnitude,
          deltaColor: isTransitPriority ? '#7c3aed' : '#22c55e',
          future: 1,
          year: y,
          sourceItemId: item.id || ''
        },
        geometry: { type: 'LineString', coordinates: path }
      };
    }).filter(Boolean);
  }

  function forecastRouteFeatureCollection(branch, year) {
    const y = Number(year) || 2036;
    const result = forecastFor(branch, y);
    const rowByStopId = {};
    (result.stops || []).forEach(row => { rowByStopId[row.stop.id] = row; });

    const features = routes.map(route => {
      const routeRows = (route.stops || []).map(stop => rowByStopId[stop.id]).filter(Boolean);
      const affected = routeRows.filter(row => row.magnitude > 0.035);
      if (!affected.length) return null;
      const weight = affected.reduce((sum, row) => sum + row.magnitude, 0) || 1;
      const delta = affected.reduce((sum, row) => sum + row.delta * row.magnitude, 0) / weight;
      const magnitude = clamp(
        (weight / Math.max(6, routeRows.length || 1)) * 2.4 +
        Math.abs(delta) * 0.55,
        0.08,
        1
      );
      if (magnitude < 0.08) return null;
      return {
        type: 'Feature',
        properties: {
          id: 'forecast-' + route.id,
          name: route.name,
          kind: route.kind,
          delta,
          magnitude,
          deltaColor: deltaColor(delta),
          affectedStops: affected.length,
          future: 0,
          year: y
        },
        geometry: { type: 'LineString', coordinates: route.coords }
      };
    }).filter(Boolean);

    plannedTransitRouteFeatures(branch, y, result.summary && result.summary.meanModelDelta)
      .forEach(feature => features.push(feature));

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
    const route = map.getSource(ROUTE_SOURCE);
    if (route) route.setData(baseRouteFeatureCollection(year));
    return true;
  }

  function showForYear(year) {
    if (!setBaseData(year)) {
      if (map && map.once) map.once('styledata', () => showForYear(year));
      return null;
    }
    const forecast = map.getSource(FORECAST_SOURCE);
    const forecastRoute = map.getSource(FORECAST_ROUTE_SOURCE);
    if (forecast) forecast.setData(emptyFC());
    if (forecastRoute) forecastRoute.setData(emptyFC());
    return {
      summary: {
        networkStops: (stops || []).length,
        routeSegments: officialRouteFeatures ? officialRouteFeatures.length : routes.length,
        mode: 'historical'
      }
    };
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
    const forecastRoute = map.getSource(FORECAST_ROUTE_SOURCE);
    if (forecastRoute) forecastRoute.setData(forecastRouteFeatureCollection(branch, year));
    return { stops: lastResult ? lastResult.stops : [], summary: fc.summary };
  }

  function clear() {
    if (!map) return;
    const base = map.getSource(BASE_SOURCE);
    const route = map.getSource(ROUTE_SOURCE);
    const forecast = map.getSource(FORECAST_SOURCE);
    const forecastRoute = map.getSource(FORECAST_ROUTE_SOURCE);
    if (base) base.setData(emptyFC());
    if (route) route.setData(emptyFC());
    if (forecast) forecast.setData(emptyFC());
    if (forecastRoute) forecastRoute.setData(emptyFC());
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
      routeCount: officialRouteFeatures ? officialRouteFeatures.length : routes.length,
      eventCount: events.length,
      lastSummary: lastResult && lastResult.summary,
      sources: {
        stops: TRANSLINK_STOPS_URL,
        fallbackStops: STOPS_URL,
        routes: TRANSLINK_ROUTES_URL,
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
    baseRouteFeatureCollection,
    forecastFeatureCollection,
    forecastRouteFeatureCollection,
    getStopsNear,
    clear,
    diagnostics
  };

  window.PublicTransportEngine = api;
  window.TransitEngine = api;
})();
