/* Traffic Sim — lightweight in-page roads simulator that lives inside the
   existing Belfast simulation studio. Adapts the core idea of the trafficjam
   prototype (vehicles moving over a road graph with congestion feedback)
   without dragging in the React app or microservices.

   Integration points:
     - read user roads from window.BelfastDashboard.activeBranch().items (type:'road')
     - read OSM roads under the cursor from the existing 'source-ni-roads-osm' source
     - draw moving vehicles as a mapbox geojson source/layer
     - publish metrics (avg speed, congested%) so the dashboard can surface them

   Public API (window.TrafficSim):
     init({ map })
     start({ density?, speed?, congestionFeedback? })
     stop()
     toggle()
     setDensity(n)        // 0..400
     setSpeed(n)          // 0..3 (multiplier)
     getMetrics()         // { vehicles, avgSpeed, congested }
     isRunning()
     setSegmentsFromBranch(branch) // user roads
*/
(function () {
  'use strict';

  const VEHICLE_SOURCE_ID = 'traffic-sim-vehicles';
  const VEHICLE_LAYER_ID = 'traffic-sim-vehicles-layer';
  const CONGESTION_SOURCE_ID = 'traffic-sim-congestion';
  const CONGESTION_LAYER_ID = 'traffic-sim-congestion-layer';

  // --- math helpers (operate on [lng,lat]) ----------------------------------

  // Approx metres per degree at Belfast latitude (54.6°). Good enough for
  // local-scale animation; we are not doing geodesy here.
  const M_PER_DEG_LAT = 111320;
  const M_PER_DEG_LNG = 111320 * Math.cos(54.6 * Math.PI / 180);

  function distMetres(a, b) {
    const dx = (b[0] - a[0]) * M_PER_DEG_LNG;
    const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  function rand(min, max) { return min + Math.random() * (max - min); }

  // --- segment book-keeping --------------------------------------------------

  const state = {
    map: null,
    running: false,
    rafId: null,
    lastTs: 0,
    segments: [],          // {id, a:[lng,lat], b:[lng,lat], length, source:'user'|'osm', occupants:Set}
    vehicles: [],          // see spawnVehicle
    targetCount: 80,
    speedMultiplier: 1.0,
    congestionFeedback: true,
    metrics: { vehicles: 0, avgSpeed: 0, congested: 0 },
    onMetrics: null,
  };

  function clearVehicles() {
    state.vehicles = [];
    state.segments.forEach(s => s.occupants.clear && s.occupants.clear());
  }

  function setSegments(rawSegments) {
    // rawSegments: array of {id, a, b, source}
    state.segments = rawSegments
      .filter(s => Array.isArray(s.a) && Array.isArray(s.b) && s.a.length === 2 && s.b.length === 2)
      .map(s => ({
        id: s.id,
        a: s.a,
        b: s.b,
        length: Math.max(20, distMetres(s.a, s.b)),
        source: s.source || 'osm',
        occupants: new Set(),
      }));
    // Drop vehicles whose segment vanished
    state.vehicles = state.vehicles.filter(v => state.segments.find(s => s.id === v.segmentId));
  }

  function setSegmentsFromBranch(branch) {
    if (!branch) { setSegments([]); return; }
    const userRoads = (branch.items || [])
      .filter(it => it.type === 'road' && Array.isArray(it.start) && Array.isArray(it.end))
      .map(it => ({ id: 'u-' + it.id, a: it.start, b: it.end, source: 'user' }));
    setSegments([...sampleOsmSegments(), ...userRoads]);
  }

  // ----- Real OSM road network ---------------------------------------------
  // The dashboard publishes a GeoJSON file of all Belfast roads via the
  // replay manifest. Loading it once here gives us authoritative geometry
  // for the candidate-road snapping and vehicle simulation, instead of the
  // synthetic lattice that produced the buildings-spanning straight lines
  // the user flagged.
  //
  // segments are stored in a coarse spatial grid keyed on ~110m cells so we
  // can pull a city-block-radius slice in O(k) instead of scanning the
  // whole graph (~70k segments) on every junction lookup.
  let osmAllSegments = null;       // Array<{id, a, b, source:'osm', highway}>
  let osmGrid = null;              // Map<gridKey, Array<segIndex>>
  let osmLoadPromise = null;
  const OSM_CELL = 0.001;          // ≈110m at this latitude

  function osmGridKey(coord) {
    return Math.round(coord[0] / OSM_CELL) + '|' + Math.round(coord[1] / OSM_CELL);
  }

  function indexSegmentInGrid(idx, coord) {
    const k = osmGridKey(coord);
    let arr = osmGrid.get(k);
    if (!arr) { arr = []; osmGrid.set(k, arr); }
    arr.push(idx);
  }

  // Highway tags we route vehicles on — drop pedestrian / cycle / footway.
  const DRIVABLE = new Set([
    'motorway', 'motorway_link',
    'trunk', 'trunk_link',
    'primary', 'primary_link',
    'secondary', 'secondary_link',
    'tertiary', 'tertiary_link',
    'unclassified',
    'residential',
    'living_street',
    'service',
    'road',
  ]);

  function preloadOsm(url) {
    if (osmAllSegments) return Promise.resolve(osmAllSegments);
    if (osmLoadPromise) return osmLoadPromise;
    osmLoadPromise = fetch(url, { cache: 'force-cache' })
      .then(r => { if (!r.ok) throw new Error('osm fetch ' + r.status); return r.json(); })
      .then(data => {
        const segs = [];
        const grid = new Map();
        const feats = (data && data.features) || [];
        for (let i = 0; i < feats.length; i++) {
          const f = feats[i];
          const g = f.geometry;
          if (!g) continue;
          const hw = (f.properties && f.properties.highway) || '';
          if (!DRIVABLE.has(hw)) continue;
          const coordSets = g.type === 'LineString' ? [g.coordinates]
                          : g.type === 'MultiLineString' ? g.coordinates : [];
          for (let cs = 0; cs < coordSets.length; cs++) {
            const coords = coordSets[cs];
            for (let j = 0; j + 1 < coords.length; j++) {
              const idx = segs.length;
              segs.push({
                id: 'osm-' + idx,
                a: coords[j],
                b: coords[j + 1],
                source: 'osm',
                highway: hw,
              });
              const k1 = osmGridKey(coords[j]);
              const k2 = osmGridKey(coords[j + 1]);
              let bucket = grid.get(k1);
              if (!bucket) { bucket = []; grid.set(k1, bucket); }
              bucket.push(idx);
              if (k2 !== k1) {
                bucket = grid.get(k2);
                if (!bucket) { bucket = []; grid.set(k2, bucket); }
                bucket.push(idx);
              }
            }
          }
        }
        osmGrid = grid;
        osmAllSegments = segs;
        return segs;
      })
      .catch(err => {
        console.warn('TrafficSim: failed to preload OSM roads, falling back to synthetic grid', err);
        osmAllSegments = [];
        osmGrid = new Map();
        return osmAllSegments;
      });
    return osmLoadPromise;
  }

  function isOsmLoaded() { return Array.isArray(osmAllSegments) && osmAllSegments.length > 0; }

  // Pull OSM segments within `radiusKm` of `centre`. Used by the planner —
  // we don't need every road in Belfast on every junction lookup, only the
  // ones around the searched postcode.
  function osmSegmentsNear(centre, radiusKm) {
    if (!isOsmLoaded()) return [];
    const cellsPerKm = Math.ceil(1 / OSM_CELL / 110); // crude but good enough
    const reach = Math.max(1, Math.ceil(radiusKm * cellsPerKm));
    const cx = Math.round(centre[0] / OSM_CELL);
    const cy = Math.round(centre[1] / OSM_CELL);
    const seen = new Set();
    const out = [];
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        const bucket = osmGrid.get((cx + dx) + '|' + (cy + dy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const idx = bucket[i];
          if (seen.has(idx)) continue;
          seen.add(idx);
          out.push(osmAllSegments[idx]);
        }
      }
    }
    return out;
  }

  // Public sampling — used by the simulator. Pulls a generous slice around
  // the map centre so the swarm has plenty of road to drive on. Falls back
  // to the synthetic lattice ONLY if neither the loaded geojson nor the
  // mapbox source can give us anything (offline / failed fetch).
  function sampleOsmSegments() {
    // Prefer the preloaded, authoritative GeoJSON
    if (isOsmLoaded()) {
      const centre = (state.map && state.map.getCenter)
        ? [state.map.getCenter().lng, state.map.getCenter().lat]
        : [-5.93, 54.597];
      // 1.2km radius = a few hundred segments around the viewport
      const near = osmSegmentsNear(centre, 1.2);
      if (near.length) return near;
    }
    // Fallback: try the rendered mapbox source (less authoritative — only
    // returns features actually drawn in the current viewport).
    if (state.map) {
      const sourceId = 'source-ni-roads-osm';
      if (state.map.getSource(sourceId)) {
        let feats = [];
        try {
          const layers = state.map.getStyle().layers
            .filter(l => l.source === sourceId)
            .map(l => l.id);
          if (layers.length) {
            feats = state.map.queryRenderedFeatures({ layers });
          } else {
            feats = state.map.querySourceFeatures(sourceId);
          }
        } catch (e) { feats = []; }
        if (feats.length) {
          const out = [];
          let id = 0;
          const stride = Math.max(1, Math.floor(feats.length / 200));
          for (let i = 0; i < feats.length; i += stride) {
            const g = feats[i].geometry;
            if (!g) continue;
            const lines = g.type === 'LineString' ? [g.coordinates]
                        : g.type === 'MultiLineString' ? g.coordinates : [];
            lines.forEach(coords => {
              for (let j = 0; j + 1 < coords.length; j++) {
                out.push({ id: 'osm-' + (id++), a: coords[j], b: coords[j + 1], source: 'osm' });
                if (out.length > 600) return;
              }
            });
            if (out.length > 600) break;
          }
          if (out.length) return out;
        }
      }
    }
    // Last resort — never used for road planning (the dashboard now blocks
    // the planner until preloadOsm resolves), but kept so the swarm still
    // animates if everything else fails.
    return syntheticBelfastSegments();
  }

  // Synthetic Belfast lattice — used when OSM context isn't ready yet so the
  // sim still has something to animate.
  function syntheticBelfastSegments() {
    const C = [-5.93, 54.597]; // city centre
    const segs = [];
    let id = 0;
    const stepLng = 0.006, stepLat = 0.0035;
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -7; dx <= 7; dx++) {
        const a = [C[0] + dx * stepLng, C[1] + dy * stepLat];
        const b1 = [C[0] + (dx + 1) * stepLng, C[1] + dy * stepLat];
        const b2 = [C[0] + dx * stepLng, C[1] + (dy + 1) * stepLat];
        if (dx < 7) segs.push({ id: 'syn-' + (id++), a, b: b1, source: 'osm' });
        if (dy < 5) segs.push({ id: 'syn-' + (id++), a, b: b2, source: 'osm' });
      }
    }
    return segs;
  }

  // --- vehicle population ----------------------------------------------------

  function spawnVehicle(forceId) {
    if (!state.segments.length) return null;
    const seg = state.segments[Math.floor(Math.random() * state.segments.length)];
    const v = {
      id: forceId != null ? forceId : (state.vehicles.length + state.metrics.vehicles + Math.random()),
      segmentId: seg.id,
      t: Math.random(),                       // 0..1 along segment
      forward: Math.random() > 0.5,
      speed: rand(7, 14) * (seg.source === 'user' ? 1.15 : 1.0),  // m/s base
      jitter: rand(0.85, 1.15),
      onUserRoad: seg.source === 'user',
    };
    seg.occupants.add(v.id);
    return v;
  }

  function ensurePopulation() {
    if (!state.segments.length) return;
    while (state.vehicles.length < state.targetCount) {
      const v = spawnVehicle();
      if (!v) break;
      state.vehicles.push(v);
    }
    while (state.vehicles.length > state.targetCount) {
      const dropped = state.vehicles.pop();
      const seg = segmentById(dropped.segmentId);
      if (seg) seg.occupants.delete(dropped.id);
    }
  }

  function segmentById(id) {
    for (let i = 0; i < state.segments.length; i++) if (state.segments[i].id === id) return state.segments[i];
    return null;
  }

  function neighbouringSegment(prev) {
    // Pick a segment whose 'a' or 'b' is near prev's 'b'. Otherwise jump.
    const target = prev.b;
    const candidates = [];
    for (let i = 0; i < state.segments.length; i++) {
      const s = state.segments[i];
      if (s.id === prev.id) continue;
      if (distMetres(s.a, target) < 25 || distMetres(s.b, target) < 25) {
        candidates.push(s);
        if (candidates.length >= 6) break;
      }
    }
    return candidates.length
      ? candidates[Math.floor(Math.random() * candidates.length)]
      : state.segments[Math.floor(Math.random() * state.segments.length)];
  }

  // --- step & render ---------------------------------------------------------

  function step(dtSeconds) {
    let totalSpeed = 0, congestedCount = 0;
    const speedMul = state.speedMultiplier;

    for (let i = 0; i < state.vehicles.length; i++) {
      const v = state.vehicles[i];
      const seg = segmentById(v.segmentId);
      if (!seg) {
        v.segmentId = state.segments[Math.floor(Math.random() * state.segments.length)].id;
        v.t = 0;
        continue;
      }
      // Congestion: slow down proportionally to occupants on segment
      const occ = seg.occupants.size;
      const cap = Math.max(2, Math.floor(seg.length / 60));
      const congestion = state.congestionFeedback ? Math.min(1, occ / cap) : 0;
      const effSpeed = v.speed * v.jitter * speedMul * (1 - 0.7 * congestion);
      const fracPerSecond = effSpeed / seg.length;

      v.t += (v.forward ? 1 : -1) * fracPerSecond * dtSeconds;
      totalSpeed += effSpeed;
      if (congestion > 0.55) congestedCount++;

      if (v.t > 1 || v.t < 0) {
        seg.occupants.delete(v.id);
        const next = neighbouringSegment(seg);
        // Decide direction along next segment based on which end we matched
        const fromPoint = v.t > 1 ? seg.b : seg.a;
        const forward = distMetres(next.a, fromPoint) < distMetres(next.b, fromPoint);
        v.segmentId = next.id;
        v.t = forward ? 0 : 1;
        v.forward = forward;
        next.occupants.add(v.id);
      }
    }

    state.metrics = {
      vehicles: state.vehicles.length,
      avgSpeed: state.vehicles.length ? totalSpeed / state.vehicles.length : 0,
      congested: state.vehicles.length ? congestedCount / state.vehicles.length : 0,
    };
    if (typeof state.onMetrics === 'function') {
      try { state.onMetrics(state.metrics); } catch (e) { /* ignore */ }
    }
  }

  function buildVehicleFeatures() {
    const feats = new Array(state.vehicles.length);
    for (let i = 0; i < state.vehicles.length; i++) {
      const v = state.vehicles[i];
      const seg = segmentById(v.segmentId);
      if (!seg) continue;
      const t = Math.max(0, Math.min(1, v.t));
      const p = lerp(seg.a, seg.b, t);
      // colour by speed (red slow, green fast) and tag user roads cyan-ish
      const norm = Math.min(1, v.speed * v.jitter * state.speedMultiplier / 18);
      feats[i] = {
        type: 'Feature',
        properties: {
          speed: norm,
          user: v.onUserRoad ? 1 : 0,
        },
        geometry: { type: 'Point', coordinates: p },
      };
    }
    return { type: 'FeatureCollection', features: feats.filter(Boolean) };
  }

  function buildCongestionFeatures() {
    const feats = [];
    for (let i = 0; i < state.segments.length; i++) {
      const s = state.segments[i];
      const cap = Math.max(2, Math.floor(s.length / 60));
      const ratio = Math.min(1, s.occupants.size / cap);
      if (ratio < 0.15) continue;
      feats.push({
        type: 'Feature',
        properties: { congestion: ratio, user: s.source === 'user' ? 1 : 0 },
        geometry: { type: 'LineString', coordinates: [s.a, s.b] },
      });
    }
    return { type: 'FeatureCollection', features: feats };
  }

  function ensureLayers() {
    const map = state.map;
    if (!map || !map.isStyleLoaded || !map.isStyleLoaded()) return false;

    if (!map.getSource(CONGESTION_SOURCE_ID)) {
      map.addSource(CONGESTION_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer(CONGESTION_LAYER_ID)) {
      map.addLayer({
        id: CONGESTION_LAYER_ID,
        type: 'line',
        source: CONGESTION_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['get', 'congestion'], 0, 2, 1, 6],
          'line-color': ['interpolate', ['linear'], ['get', 'congestion'],
            0.15, '#fde68a',
            0.4,  '#fb923c',
            0.7,  '#ef4444',
            1.0,  '#7f1d1d'],
          'line-opacity': 0.55,
        },
      });
    }
    if (!map.getSource(VEHICLE_SOURCE_ID)) {
      map.addSource(VEHICLE_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer(VEHICLE_LAYER_ID)) {
      map.addLayer({
        id: VEHICLE_LAYER_ID,
        type: 'circle',
        source: VEHICLE_SOURCE_ID,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 14, 3, 16, 4],
          // colour ramp green→amber→red as speed decreases
          'circle-color': ['interpolate', ['linear'], ['get', 'speed'],
            0,    '#dc2626',
            0.4,  '#fb923c',
            0.7,  '#facc15',
            1.0,  '#22c55e'],
          'circle-stroke-width': ['case', ['==', ['get', 'user'], 1], 1.4, 0],
          'circle-stroke-color': '#22d3ee',
          'circle-opacity': 0.95,
        },
      });
    }
    return true;
  }

  function setDataIfReady() {
    if (!state.map) return;
    if (!ensureLayers()) return;
    const veh = state.map.getSource(VEHICLE_SOURCE_ID);
    if (veh) veh.setData(buildVehicleFeatures());
    const cong = state.map.getSource(CONGESTION_SOURCE_ID);
    if (cong) cong.setData(buildCongestionFeatures());
  }

  function clearMapData() {
    if (!state.map) return;
    const veh = state.map.getSource(VEHICLE_SOURCE_ID);
    if (veh) veh.setData({ type: 'FeatureCollection', features: [] });
    const cong = state.map.getSource(CONGESTION_SOURCE_ID);
    if (cong) cong.setData({ type: 'FeatureCollection', features: [] });
  }

  function loop(ts) {
    if (!state.running) return;
    if (!state.lastTs) state.lastTs = ts;
    const dt = Math.min(0.1, (ts - state.lastTs) / 1000);
    state.lastTs = ts;

    if (!state.segments.length) {
      // Try to refresh segments — OSM might have just finished loading
      const dash = window.BelfastDashboard;
      const branch = dash && typeof dash.activeBranch === 'function' ? dash.activeBranch() : null;
      setSegmentsFromBranch(branch);
    }
    ensurePopulation();
    step(dt);
    setDataIfReady();
    state.rafId = requestAnimationFrame(loop);
  }

  // --- public API ------------------------------------------------------------

  function init(opts) {
    state.map = (opts && opts.map) || null;
    state.onMetrics = (opts && opts.onMetrics) || null;
    if (state.map && state.map.on) {
      state.map.on('styledata', () => { if (state.running) ensureLayers(); });
    }
  }

  function refreshSegments() {
    const dash = window.BelfastDashboard;
    const branch = dash && typeof dash.activeBranch === 'function' ? dash.activeBranch() : null;
    setSegmentsFromBranch(branch);
  }

  function start(opts) {
    if (state.running) return;
    if (opts && typeof opts.density === 'number') state.targetCount = clampInt(opts.density, 0, 400);
    if (opts && typeof opts.speed === 'number') state.speedMultiplier = Math.max(0.1, Math.min(3, opts.speed));
    if (opts && typeof opts.congestionFeedback === 'boolean') state.congestionFeedback = opts.congestionFeedback;
    refreshSegments();
    state.running = true;
    state.lastTs = 0;
    state.rafId = requestAnimationFrame(loop);
  }

  function stop() {
    state.running = false;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = null;
    clearVehicles();
    clearMapData();
  }

  function toggle() { if (state.running) stop(); else start(); }

  function setDensity(n) {
    state.targetCount = clampInt(n, 0, 400);
  }
  function setSpeed(n) {
    state.speedMultiplier = Math.max(0.1, Math.min(3, n));
  }

  function clampInt(n, lo, hi) {
    n = Math.round(Number(n) || 0);
    return Math.max(lo, Math.min(hi, n));
  }

  // --- junction discovery + comparison sim ---------------------------------
  // Used by the postcode-driven "plan a road" workflow: the user enters a
  // postcode, we sample road endpoints near that point, render them as
  // clickable nodes; user picks two, we wire a candidate road; runComparison
  // simulates with and without it and returns the diff.

  // Find candidate junction nodes (road endpoints, deduped) near a point.
  // count = how many to return; radiusKm = max distance from centre.
  function findJunctionNodes(centre, count, radiusKm) {
    if (!Array.isArray(centre) || centre.length !== 2) return [];
    count = count || 14;
    radiusKm = radiusKm || 0.6;
    // Prefer the loaded OSM geojson — it's the authoritative source for
    // junction coordinates. sampleOsmSegments() only returns the slice near
    // the map's current centre, which can leave us with too few endpoints
    // around a postcode the user just searched far from the centre.
    const segs = isOsmLoaded()
      ? osmSegmentsNear(centre, Math.max(radiusKm * 1.5, 0.8))
      : sampleOsmSegments();
    if (!segs.length) return [];
    // Bucket endpoints to ~10m grid so near-duplicates merge into one node.
    const cell = 0.0001; // ≈11m at this latitude
    const nodes = new Map();
    function add(coord, segId) {
      if (!coord || coord.length < 2) return;
      const dKm = Math.hypot(
        (coord[0] - centre[0]) * M_PER_DEG_LNG,
        (coord[1] - centre[1]) * M_PER_DEG_LAT
      ) / 1000;
      if (dKm > radiusKm) return;
      const key = Math.round(coord[0] / cell) + ',' + Math.round(coord[1] / cell);
      const existing = nodes.get(key);
      if (existing) {
        existing.degree++;
        existing.dist = Math.min(existing.dist, dKm);
      } else {
        nodes.set(key, { lng: coord[0], lat: coord[1], degree: 1, dist: dKm });
      }
    }
    for (let i = 0; i < segs.length; i++) {
      add(segs[i].a, segs[i].id);
      add(segs[i].b, segs[i].id);
    }
    if (!nodes.size) return [];
    // Prefer high-degree (real intersections) but also reach further nodes
    // so the user gets a spread instead of all clustered at one point.
    const arr = Array.from(nodes.values())
      .sort((x, y) => (y.degree - x.degree) || (x.dist - y.dist));
    const picked = [];
    const minSpacingKm = Math.max(0.04, radiusKm / 4);
    for (let i = 0; i < arr.length && picked.length < count; i++) {
      const n = arr[i];
      let tooClose = false;
      for (let j = 0; j < picked.length; j++) {
        const p = picked[j];
        const dKm = Math.hypot(
          (n.lng - p.lng) * M_PER_DEG_LNG,
          (n.lat - p.lat) * M_PER_DEG_LAT
        ) / 1000;
        if (dKm < minSpacingKm) { tooClose = true; break; }
      }
      if (!tooClose) picked.push(n);
    }
    return picked.map((n, i) => ({
      id: 'junction-' + i,
      coord: [n.lng, n.lat],
      degree: n.degree,
    }));
  }

  // ---- Shortest path along the OSM road graph -----------------------------
  // Given two coordinates (typically picked junctions), finds a sequence of
  // sampled OSM segments that connect them. The candidate "new road" is then
  // built from this sequence so it follows actual streets instead of cutting
  // diagonally through buildings.
  //
  // Returns an array of {a, b, source, length} segments forming a connected
  // path from `from` to `to`. Returns null if no path exists within budget.
  function findOsmPath(from, to, opts) {
    opts = opts || {};
    // Pull a generous slice of OSM around the midpoint so Dijkstra has a
    // dense, connected graph to work with. Otherwise we'd be limited to
    // whichever roads happened to be in the rendered viewport.
    let segs;
    if (opts.segments && opts.segments.length) {
      segs = opts.segments;
    } else if (isOsmLoaded()) {
      const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
      const reach = Math.max(0.6, distMetres(from, to) / 1000 * 1.2 + 0.4);
      segs = osmSegmentsNear(mid, reach);
    } else {
      segs = sampleOsmSegments();
    }
    if (!segs.length) return null;

    // Bucket all endpoints into a spatial grid (~11m cells) so we can
    // discover edges that share a node by spatial proximity rather than
    // exact coordinate equality.
    const cell = 0.0001;
    function key(coord) {
      return Math.round(coord[0] / cell) + ',' + Math.round(coord[1] / cell);
    }
    const nodeIndex = new Map();   // key -> nodeId
    const nodes = [];              // [{coord:[lng,lat]}]
    function nodeFor(coord) {
      const k = key(coord);
      let id = nodeIndex.get(k);
      if (id == null) {
        id = nodes.length;
        nodeIndex.set(k, id);
        nodes.push({ coord: coord });
      }
      return id;
    }
    // Adjacency: nodeId -> [{to: nodeId, w: length, seg: {a,b,source}}]
    const adj = [];
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const u = nodeFor(s.a);
      const v = nodeFor(s.b);
      const w = Math.max(20, distMetres(s.a, s.b));
      while (adj.length <= Math.max(u, v)) adj.push([]);
      adj[u].push({ to: v, w: w, seg: { a: s.a, b: s.b, source: s.source || 'osm' } });
      adj[v].push({ to: u, w: w, seg: { a: s.b, b: s.a, source: s.source || 'osm' } });
    }
    if (!adj.length) return null;

    // Snap from/to to the nearest known node within ~80m
    function snap(coord) {
      let best = -1, bestKm = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const dx = (nodes[i].coord[0] - coord[0]) * M_PER_DEG_LNG;
        const dy = (nodes[i].coord[1] - coord[1]) * M_PER_DEG_LAT;
        const km = Math.hypot(dx, dy) / 1000;
        if (km < bestKm) { bestKm = km; best = i; }
      }
      return (bestKm <= 0.1) ? best : -1;
    }
    const src = snap(from);
    const dst = snap(to);
    if (src < 0 || dst < 0 || src === dst) return null;

    // Plain Dijkstra. Graph is small (a few hundred nodes), so a simple
    // priority-queue implemented as a sorted array is plenty fast.
    const dist = new Array(nodes.length).fill(Infinity);
    const prev = new Array(nodes.length).fill(null);
    dist[src] = 0;
    const queue = [{ id: src, d: 0 }];
    let visited = 0;
    while (queue.length) {
      // pop min
      let mi = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i].d < queue[mi].d) mi = i;
      const cur = queue.splice(mi, 1)[0];
      if (cur.d > dist[cur.id]) continue;
      if (cur.id === dst) break;
      const edges = adj[cur.id] || [];
      for (let j = 0; j < edges.length; j++) {
        const e = edges[j];
        const nd = cur.d + e.w;
        if (nd < dist[e.to]) {
          dist[e.to] = nd;
          prev[e.to] = { from: cur.id, edge: e };
          queue.push({ id: e.to, d: nd });
        }
      }
      if (++visited > 4000) break; // safety budget
    }
    if (dist[dst] === Infinity) return null;

    // Walk prev back from dst → src to recover the path of edges.
    const path = [];
    let cursor = dst;
    while (prev[cursor]) {
      const step = prev[cursor];
      path.unshift({
        a: step.edge.seg.a,
        b: step.edge.seg.b,
        source: step.edge.seg.source,
        length: step.edge.w,
      });
      cursor = step.from;
    }
    return path;
  }

  // Convenience: turn a path (array of segments) into an array of points
  // [[lng,lat], ...] for rendering as a polyline.
  function pathToPolyline(path) {
    if (!path || !path.length) return [];
    const pts = [path[0].a];
    for (let i = 0; i < path.length; i++) pts.push(path[i].b);
    return pts;
  }

  // Run a head-to-head simulation with and without a candidate road. Both
  // runs use the same RNG seed and starting positions so the only variable
  // is the road graph. Returns aggregated metrics + per-segment occupancy
  // so the UI can colour the diff.
  function runComparison(opts) {
    opts = opts || {};
    const baseSegments = (opts.baseSegments || []).map(s => Object.assign({}, s));
    // candidate can be a single segment {a,b,source,id} or an array of them
    // (for multi-segment "new road" that follows OSM streets).
    const candidateRaw = opts.candidate;
    const candidates = !candidateRaw ? []
      : Array.isArray(candidateRaw) ? candidateRaw
      : [candidateRaw];
    const allSegments = baseSegments.concat(
      candidates.map((c, i) => Object.assign({}, c, {
        id: c.id || ('cand-' + i),
        source: 'candidate',
      }))
    );

    const density = clampInt(opts.density, 1, 600);
    const speedMul = Math.max(0.1, Math.min(3, opts.speed || 1));
    const totalSeconds = Math.max(1, Math.min(60, opts.durationSeconds || 6));
    const dt = 0.1; // 10 Hz simulated step
    const seed = (opts.seed != null) ? opts.seed >>> 0 : 0xb1f55;

    function runOne(segs, label) {
      const segments = segs.map(s => ({
        id: s.id,
        a: s.a, b: s.b,
        length: Math.max(20, distMetres(s.a, s.b)),
        source: s.source || 'osm',
        occupants: new Set(),
        // accumulated stats:
        occSum: 0, occSamples: 0,
        through: 0,
      }));
      if (!segments.length) return null;
      const segById = new Map(segments.map(s => [s.id, s]));
      // Seeded RNG so both runs share initial vehicle layout
      let rng = seed >>> 0;
      function rand01() { rng = (rng * 1664525 + 1013904223) >>> 0; return (rng & 0xffffff) / 0xffffff; }

      const vehicles = [];
      for (let i = 0; i < density; i++) {
        const seg = segments[Math.floor(rand01() * segments.length)];
        const v = {
          id: i,
          segmentId: seg.id,
          t: rand01(),
          forward: rand01() > 0.5,
          baseSpeed: 7 + rand01() * 7,
          jitter: 0.85 + rand01() * 0.3,
          onUserRoad: seg.source === 'user',
          onCandidate: seg.source === 'candidate',
          totalDist: 0,
        };
        seg.occupants.add(v.id);
        vehicles.push(v);
      }

      function neighbour(prev) {
        const target = prev.b;
        const candidates = [];
        for (let i = 0; i < segments.length; i++) {
          const s = segments[i];
          if (s.id === prev.id) continue;
          if (distMetres(s.a, target) < 25 || distMetres(s.b, target) < 25) {
            candidates.push(s);
            if (candidates.length >= 6) break;
          }
        }
        return candidates.length
          ? candidates[Math.floor(rand01() * candidates.length)]
          : segments[Math.floor(rand01() * segments.length)];
      }

      let speedSum = 0, speedCount = 0, congestedSampleCount = 0;
      let candidateUsage = 0;     // vehicles entering the candidate road
      const ticks = Math.floor(totalSeconds / dt);
      for (let tick = 0; tick < ticks; tick++) {
        // Sample occupancy at start of tick
        for (let i = 0; i < segments.length; i++) {
          segments[i].occSum += segments[i].occupants.size;
          segments[i].occSamples++;
        }
        for (let i = 0; i < vehicles.length; i++) {
          const v = vehicles[i];
          const seg = segById.get(v.segmentId);
          if (!seg) continue;
          const occ = seg.occupants.size;
          const cap = Math.max(2, Math.floor(seg.length / 60));
          const congestion = Math.min(1, occ / cap);
          const eff = v.baseSpeed * v.jitter * speedMul * (1 - 0.7 * congestion);
          speedSum += eff;
          speedCount++;
          if (congestion > 0.55) congestedSampleCount++;
          v.t += (v.forward ? 1 : -1) * (eff / seg.length) * dt;
          v.totalDist += eff * dt;
          if (v.t > 1 || v.t < 0) {
            seg.occupants.delete(v.id);
            seg.through++;
            const fromPoint = v.t > 1 ? seg.b : seg.a;
            const next = neighbour(seg);
            const forward = distMetres(next.a, fromPoint) < distMetres(next.b, fromPoint);
            v.segmentId = next.id;
            v.t = forward ? 0 : 1;
            v.forward = forward;
            next.occupants.add(v.id);
            if (next.source === 'candidate') candidateUsage++;
          }
        }
      }

      const segmentStats = segments.map(s => ({
        id: s.id,
        a: s.a, b: s.b,
        source: s.source,
        avgOcc: s.occSamples ? s.occSum / s.occSamples : 0,
        capacity: Math.max(2, Math.floor(s.length / 60)),
        through: s.through,
      }));
      return {
        label: label,
        vehicles: vehicles.length,
        avgSpeed: speedCount ? speedSum / speedCount : 0,
        congested: speedCount ? congestedSampleCount / speedCount : 0,
        throughput: vehicles.reduce((sum, v) => sum + v.totalDist, 0),
        candidateUsage: candidateUsage,
        segments: segmentStats,
      };
    }

    const before = runOne(baseSegments, 'before');
    const after  = runOne(allSegments, 'after');
    if (!before || !after) return null;

    // Per-segment diff: positive = more congested with new road, negative = relieved.
    const beforeBySeg = new Map(before.segments.map(s => [s.id, s]));
    const segmentDeltas = after.segments.map(s => {
      const b = beforeBySeg.get(s.id);
      const baseRatio = b ? (b.avgOcc / Math.max(1, b.capacity)) : 0;
      const afterRatio = s.avgOcc / Math.max(1, s.capacity);
      return {
        id: s.id, a: s.a, b: s.b, source: s.source,
        baseRatio: baseRatio, afterRatio: afterRatio,
        delta: afterRatio - baseRatio,
      };
    });

    return {
      before: {
        avgSpeed: before.avgSpeed,
        congested: before.congested,
        throughput: before.throughput,
        vehicles: before.vehicles,
      },
      after: {
        avgSpeed: after.avgSpeed,
        congested: after.congested,
        throughput: after.throughput,
        vehicles: after.vehicles,
        candidateUsage: after.candidateUsage,
      },
      segmentDeltas: segmentDeltas,
    };
  }

  // Build segment array for a branch (OSM context + user roads, no candidate).
  // Roads with a `path` polyline expand into a chain of sub-segments so the
  // sim routes vehicles along the actual street alignment.
  function segmentsForBranch(branch) {
    const userRoads = [];
    const items = (branch && branch.items) || [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.type !== 'road') continue;
      if (Array.isArray(it.path) && it.path.length >= 2) {
        for (let j = 0; j + 1 < it.path.length; j++) {
          userRoads.push({
            id: 'u-' + it.id + '-' + j,
            a: it.path[j],
            b: it.path[j + 1],
            source: 'user',
          });
        }
      } else if (Array.isArray(it.start) && Array.isArray(it.end)) {
        userRoads.push({ id: 'u-' + it.id, a: it.start, b: it.end, source: 'user' });
      }
    }
    return [...sampleOsmSegments(), ...userRoads];
  }

  // ----- comparison overlay (the on-map "diff heatmap") --------------------
  // Mirrors the look of the historical Traffic lens: thick coloured lines
  // along the road network showing where the candidate road relieves or
  // worsens congestion. Lives on the main map, not in the modal.

  const CMP_SOURCE_ID  = 'traffic-sim-compare-overlay';
  const CMP_LAYER_BG   = 'traffic-sim-compare-bg';
  const CMP_LAYER_LINE = 'traffic-sim-compare-line';
  const CMP_LAYER_NEW  = 'traffic-sim-compare-new';
  const CMP_LAYER_NEW_GLOW = 'traffic-sim-compare-new-glow';

  function ensureCompareLayers() {
    // We need a map; the style doesn't have to be fully loaded — addSource /
    // addLayer queue safely once the basic 'load' event has fired and
    // state.map is non-null.
    if (!state.map) return false;
    if (!state.map.getSource(CMP_SOURCE_ID)) {
      state.map.addSource(CMP_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    // Soft underlay to make coloured deltas pop against the dark basemap
    if (!state.map.getLayer(CMP_LAYER_BG)) {
      state.map.addLayer({
        id: CMP_LAYER_BG,
        type: 'line',
        source: CMP_SOURCE_ID,
        filter: ['!=', ['get', 'kind'], 'new'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 11],
          'line-color': '#020617',
          'line-opacity': 0.55,
        },
      });
    }
    if (!state.map.getLayer(CMP_LAYER_LINE)) {
      state.map.addLayer({
        id: CMP_LAYER_LINE,
        type: 'line',
        source: CMP_SOURCE_ID,
        filter: ['!=', ['get', 'kind'], 'new'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.4, 16, 7],
          // delta < 0 → relief (green ramp); delta > 0 → worse (red ramp)
          'line-color': ['interpolate', ['linear'], ['get', 'delta'],
            -0.40, '#16a34a',
            -0.10, '#86efac',
             0.00, '#94a3b8',
             0.10, '#fb923c',
             0.40, '#dc2626'],
          'line-opacity': ['interpolate', ['linear'], ['abs', ['get', 'delta']], 0, 0.35, 0.4, 0.95],
        },
      });
    }
    if (!state.map.getLayer(CMP_LAYER_NEW_GLOW)) {
      state.map.addLayer({
        id: CMP_LAYER_NEW_GLOW,
        type: 'line',
        source: CMP_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'new'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 14, 16, 24],
          'line-color': '#22d3ee',
          'line-opacity': 0.18,
          'line-blur': 4,
        },
      });
      state.map.addLayer({
        id: CMP_LAYER_NEW,
        type: 'line',
        source: CMP_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'new'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 9],
          'line-color': '#22d3ee',
          'line-dasharray': [2, 1.4],
          'line-opacity': 0.95,
        },
      });
    }
    return true;
  }

  // Render the segmentDeltas + the candidate road as a persistent overlay.
  // Pass null/empty to clear.
  function showComparisonOverlay(segmentDeltas, candidate) {
    if (!ensureCompareLayers()) {
      // Try once more after the next styledata tick.
      if (state.map && state.map.once) {
        state.map.once('styledata', () => showComparisonOverlay(segmentDeltas, candidate));
      }
      return false;
    }
    const features = [];
    if (segmentDeltas && segmentDeltas.length) {
      for (let i = 0; i < segmentDeltas.length; i++) {
        const s = segmentDeltas[i];
        if (Math.abs(s.delta) < 0.02 && Math.abs(s.afterRatio) < 0.05) continue; // hide quiet roads
        features.push({
          type: 'Feature',
          properties: { kind: 'segment', delta: s.delta, after: s.afterRatio, source: s.source || 'osm' },
          geometry: { type: 'LineString', coordinates: [s.a, s.b] },
        });
      }
    }
    // candidate can be a single {a,b} or an array of segments (multi-step
    // path along real streets). Render each step so the new road traces the
    // OSM geometry instead of a straight line through buildings.
    const candList = !candidate ? []
      : Array.isArray(candidate) ? candidate
      : [candidate];
    for (let i = 0; i < candList.length; i++) {
      const c = candList[i];
      if (!c || !c.a || !c.b) continue;
      features.push({
        type: 'Feature',
        properties: { kind: 'new' },
        geometry: { type: 'LineString', coordinates: [c.a, c.b] },
      });
    }
    const src = state.map.getSource(CMP_SOURCE_ID);
    if (src) src.setData({ type: 'FeatureCollection', features: features });
    return true;
  }

  function clearComparisonOverlay() {
    if (!state.map) return;
    const src = state.map.getSource(CMP_SOURCE_ID);
    if (src) src.setData({ type: 'FeatureCollection', features: [] });
  }

  window.TrafficSim = {
    init: init,
    start: start,
    stop: stop,
    toggle: toggle,
    setDensity: setDensity,
    setSpeed: setSpeed,
    setSegmentsFromBranch: setSegmentsFromBranch,
    refreshSegments: refreshSegments,
    getMetrics: function () { return Object.assign({}, state.metrics); },
    isRunning: function () { return state.running; },
    findJunctionNodes: findJunctionNodes,
    findOsmPath: findOsmPath,
    pathToPolyline: pathToPolyline,
    runComparison: runComparison,
    segmentsForBranch: segmentsForBranch,
    sampleOsmSegments: sampleOsmSegments,
    showComparisonOverlay: showComparisonOverlay,
    clearComparisonOverlay: clearComparisonOverlay,
    preloadOsm: preloadOsm,
    isOsmLoaded: isOsmLoaded,
  };
})();
