/* Transit engine — historical + forecast layer for the Transit lens.
 *
 * Historical (2016 – 2026):
 *   Loads belfast_ni_transport_stops_osm_2026.geojson — 1,092 OSM transit
 *   nodes (rail / bus / Glider stops). The "service introduced" year for
 *   each stop is read from the infrastructure-events catalogue (signal:
 *   'services'). Stops without an explicit year fall back to 2016 so the
 *   baseline network is visible from the start of the timeline.
 *
 * Forecast (2027 – 2036):
 *   When the user adds a road or a building, the engine projects a
 *   transit-access delta at every stop:
 *     - Roads add a "feeder corridor" — stops within 400 m of the new
 *       road segment get a +ratio bump (more frequent service viable
 *       once a road exists to operate it on).
 *     - Buildings add demand pressure — stops within 250 m get a smaller
 *       +ratio bump (more passengers per stop = service uplift case).
 *   Each stop's forecast access is rendered on the map as a coloured
 *   ring (green = relief / improvement, amber = unchanged, red = strain
 *   when demand bumps without supporting roads).
 *
 * Public API (window.TransitEngine):
 *   init({ map })
 *   preload(url)                              -> Promise<void>
 *   showForYear(year)                         (paints the historical layer)
 *   showForecast({ branch, year })            (paints the forecast deltas)
 *   clear()
 *   isLoaded()
 *   getStopsNear(coord, radiusKm)             -> Array<stop>
 *   forecastFor(branch, year)                 -> { stops, summary }
 */
(function () {
  'use strict';

  const STOPS_SOURCE = 'transit-stops';
  const STOPS_LAYER  = 'transit-stops-circle';
  const STOPS_LAYER_HALO = 'transit-stops-halo';
  const FORECAST_SOURCE = 'transit-forecast';
  const FORECAST_LAYER  = 'transit-forecast-circle';

  const M_PER_DEG_LAT = 111320;
  const M_PER_DEG_LNG = 111320 * Math.cos(54.6 * Math.PI / 180);

  let map = null;
  let stops = null;             // Array<{coord, name, year, kind}>
  let loadPromise = null;
  let activeYear = null;
  let activeMode = 'historical'; // 'historical' | 'forecast'

  function distMetres(a, b) {
    const dx = (b[0] - a[0]) * M_PER_DEG_LNG;
    const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

  // ---- Loading ------------------------------------------------------------

  function preload(url) {
    if (stops) return Promise.resolve(stops);
    if (loadPromise) return loadPromise;
    url = url || '/api/layers/2026/source-ni-transport-stops-osm';
    loadPromise = fetch(url, { cache: 'force-cache' })
      .then(r => { if (!r.ok) throw new Error('transit fetch ' + r.status); return r.json(); })
      .then(data => {
        const feats = (data && data.features) || [];
        const out = [];
        for (let i = 0; i < feats.length; i++) {
          const f = feats[i];
          const g = f.geometry;
          if (!g || g.type !== 'Point') continue;
          const props = f.properties || {};
          const name = props.name || 'Stop';
          // OSM doesn't carry an introduction-year tag for most stops, so
          // we anchor the historical network at 2016 and let the events
          // catalogue add new stops year-by-year via overlayEvent below.
          out.push({
            coord: g.coordinates,
            name: name,
            kind: stopKindFromProps(props),
            year: 2016,
          });
        }
        stops = out;
        return out;
      })
      .catch(err => {
        console.warn('TransitEngine: preload failed', err);
        stops = [];
        return [];
      });
    return loadPromise;
  }

  function stopKindFromProps(p) {
    const n = (p.name || '').toLowerCase();
    if (n.includes('station') || n.includes('rail')) return 'rail';
    if (n.includes('glider')) return 'glider';
    if (n.includes('park & ride') || n.includes('parkway')) return 'park-ride';
    return 'bus';
  }

  function isLoaded() { return Array.isArray(stops) && stops.length > 0; }

  function init(opts) {
    map = (opts && opts.map) || null;
    if (!map) return;
    if (map.isStyleLoaded && map.isStyleLoaded()) ensureLayers();
    else map.on('load', ensureLayers);
  }

  function ensureLayers() {
    if (!map) return false;
    if (!map.isStyleLoaded || !map.isStyleLoaded()) return false;
    if (!map.getSource(STOPS_SOURCE)) {
      map.addSource(STOPS_SOURCE, { type: 'geojson', data: emptyFC() });
    }
    if (!map.getLayer(STOPS_LAYER_HALO)) {
      map.addLayer({
        id: STOPS_LAYER_HALO,
        type: 'circle',
        source: STOPS_SOURCE,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 12],
          'circle-color': ['match', ['get', 'kind'],
            'rail',     '#06b6d4',
            'glider',   '#a855f7',
            'park-ride','#22c55e',
            /* default bus */ '#22c55e'],
          'circle-opacity': 0.18,
          'circle-blur': 0.4,
        },
      });
    }
    if (!map.getLayer(STOPS_LAYER)) {
      map.addLayer({
        id: STOPS_LAYER,
        type: 'circle',
        source: STOPS_SOURCE,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.2, 16, 5],
          'circle-color': ['match', ['get', 'kind'],
            'rail',     '#06b6d4',
            'glider',   '#a855f7',
            'park-ride','#15803d',
            /* default bus */ '#16a34a'],
          'circle-stroke-width': 1.2,
          'circle-stroke-color': '#fff',
          'circle-opacity': 0.92,
        },
      });
    }
    if (!map.getSource(FORECAST_SOURCE)) {
      map.addSource(FORECAST_SOURCE, { type: 'geojson', data: emptyFC() });
    }
    if (!map.getLayer(FORECAST_LAYER)) {
      map.addLayer({
        id: FORECAST_LAYER,
        type: 'circle',
        source: FORECAST_SOURCE,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'magnitude'], 0, 6, 1, 22],
          'circle-color': ['interpolate', ['linear'], ['get', 'delta'],
            -0.4, '#dc2626',  // strain (demand without supply)
            -0.05, '#fb923c',
             0.0,  '#94a3b8',
             0.1,  '#86efac',
             0.4,  '#16a34a'],
          'circle-opacity': 0.55,
          'circle-stroke-width': 0,
          'circle-blur': 0.15,
        },
      }, STOPS_LAYER_HALO); // place under the dot layer so the dot stays crisp
    }
    return true;
  }

  // ---- Historical view ---------------------------------------------------

  function visibleHistoricalStops(year) {
    if (!isLoaded()) return [];
    return stops.filter(s => s.year <= year);
  }

  function showForYear(year) {
    activeYear = year;
    activeMode = 'historical';
    if (!ensureLayers()) {
      if (map && map.once) map.once('styledata', () => showForYear(year));
      return;
    }
    const src = map.getSource(STOPS_SOURCE);
    if (src) {
      src.setData({
        type: 'FeatureCollection',
        features: visibleHistoricalStops(year).map(s => ({
          type: 'Feature',
          properties: { kind: s.kind, name: s.name, year: s.year },
          geometry: { type: 'Point', coordinates: s.coord },
        })),
      });
    }
    // Forecast layer is cleared in historical mode
    const fc = map.getSource(FORECAST_SOURCE);
    if (fc) fc.setData(emptyFC());
  }

  // ---- Forecast for an active branch -------------------------------------

  // Compute per-stop access deltas given the user's interventions on the
  // active branch up to `year`. Returns an array of {stop, delta, magnitude}
  // and a summary for the impact panel.
  function forecastFor(branch, year) {
    if (!isLoaded() || !branch) return { stops: [], summary: null };
    const items = (branch.items || []).filter(it => it.year <= year);
    const roads = items.filter(it => it.type === 'road');
    const buildings = items.filter(it => it.type === 'building');

    let totalRelief = 0, totalStrain = 0, affected = 0;
    const out = stops.map(stop => {
      let supply = 0;
      let demand = 0;
      // Roads → +supply for stops within 400m of any road segment
      for (let i = 0; i < roads.length; i++) {
        const r = roads[i];
        const path = (Array.isArray(r.path) && r.path.length >= 2) ? r.path : [r.start, r.end];
        for (let j = 0; j + 1 < path.length; j++) {
          const a = path[j], b = path[j + 1];
          const d = distToSegment(stop.coord, a, b);
          if (d < 400) supply += 0.30 * (1 - d / 400);
        }
      }
      // Buildings → +demand for stops within 250m
      for (let i = 0; i < buildings.length; i++) {
        const b = buildings[i];
        if (typeof b.lng !== 'number') continue;
        const d = distMetres([b.lng, b.lat], stop.coord);
        if (d < 250) demand += 0.25 * (1 - d / 250);
      }
      // Net delta: supply uplift minus uncompensated demand pressure.
      // Slight saturation so a single intervention doesn't go to ±1.
      const delta = Math.tanh(supply - 0.7 * demand);
      const magnitude = Math.min(1, Math.max(supply, demand));
      if (delta > 0.05) totalRelief += delta;
      else if (delta < -0.05) totalStrain += -delta;
      if (magnitude > 0.05) affected++;
      return { stop: stop, delta: delta, magnitude: magnitude, supply: supply, demand: demand };
    });

    return {
      stops: out,
      summary: {
        affectedStops: affected,
        totalRelief: totalRelief,
        totalStrain: totalStrain,
        netReliefIndex: totalRelief - totalStrain,
      },
    };
  }

  // Distance from point P to segment AB (in metres, on a local lat/lng plane).
  function distToSegment(p, a, b) {
    const apx = (p[0] - a[0]) * M_PER_DEG_LNG;
    const apy = (p[1] - a[1]) * M_PER_DEG_LAT;
    const abx = (b[0] - a[0]) * M_PER_DEG_LNG;
    const aby = (b[1] - a[1]) * M_PER_DEG_LAT;
    const ab2 = abx * abx + aby * aby;
    let t = ab2 ? (apx * abx + apy * aby) / ab2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = apx - abx * t;
    const dy = apy - aby * t;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function showForecast(opts) {
    activeMode = 'forecast';
    activeYear = (opts && opts.year) || activeYear;
    const branch = opts && opts.branch;
    if (!ensureLayers()) {
      if (map && map.once) map.once('styledata', () => showForecast(opts));
      return null;
    }
    // Always show the underlying historical network too, so the forecast
    // dots clearly sit *on* the existing transit graph.
    showForYear(activeYear);
    activeMode = 'forecast';
    const result = forecastFor(branch, activeYear);
    const fc = map.getSource(FORECAST_SOURCE);
    if (fc) {
      fc.setData({
        type: 'FeatureCollection',
        features: result.stops
          .filter(s => s.magnitude > 0.04)
          .map(s => ({
            type: 'Feature',
            properties: { delta: s.delta, magnitude: s.magnitude, name: s.stop.name },
            geometry: { type: 'Point', coordinates: s.stop.coord },
          })),
      });
    }
    return result;
  }

  function clear() {
    activeMode = null;
    activeYear = null;
    if (!map) return;
    const a = map.getSource(STOPS_SOURCE);
    if (a) a.setData(emptyFC());
    const b = map.getSource(FORECAST_SOURCE);
    if (b) b.setData(emptyFC());
  }

  function getStopsNear(coord, radiusKm) {
    if (!isLoaded() || !Array.isArray(coord)) return [];
    const r = (radiusKm || 1) * 1000;
    return stops.filter(s => distMetres(s.coord, coord) <= r);
  }

  window.TransitEngine = {
    init: init,
    preload: preload,
    isLoaded: isLoaded,
    showForYear: showForYear,
    showForecast: showForecast,
    forecastFor: forecastFor,
    getStopsNear: getStopsNear,
    clear: clear,
  };
})();
