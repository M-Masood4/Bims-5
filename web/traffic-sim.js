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
  const NETWORK_SOURCE_ID = 'traffic-sim-road-network';
  const NETWORK_CASE_LAYER_ID = 'traffic-sim-road-network-case';
  const NETWORK_LAYER_ID = 'traffic-sim-road-network-line';
  const CONGESTION_SOURCE_ID = 'traffic-sim-congestion';
  const CONGESTION_GLOW_LAYER_ID = 'traffic-sim-congestion-glow';
  const CONGESTION_LAYER_ID = 'traffic-sim-congestion-layer';
  const AGENT_BASE_SOURCE_ID = 'traffic-agent-swarm-base';
  const AGENT_FLOW_SOURCE_ID = 'traffic-agent-swarm-flow';
  const AGENT_POINT_SOURCE_ID = 'traffic-agent-swarm-points';
  const AGENT_BASE_CASE_LAYER_ID = 'traffic-agent-swarm-base-case';
  const AGENT_BASE_LAYER_ID = 'traffic-agent-swarm-base-line';
  const AGENT_FLOW_GLOW_LAYER_ID = 'traffic-agent-swarm-flow-glow';
  const AGENT_FLOW_LAYER_ID = 'traffic-agent-swarm-flow-line';
  const AGENT_POINT_GLOW_LAYER_ID = 'traffic-agent-swarm-point-glow';
  const AGENT_POINT_LAYER_ID = 'traffic-agent-swarm-point';

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
  function clamp01(n) { return Math.max(0, Math.min(1, Number(n) || 0)); }
  function midpoint(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
  function distKm(a, b) { return distMetres(a, b) / 1000; }
  function pointSegmentDistanceKm(p, a, b) {
    const ax = a[0] * M_PER_DEG_LNG, ay = a[1] * M_PER_DEG_LAT;
    const bx = b[0] * M_PER_DEG_LNG, by = b[1] * M_PER_DEG_LAT;
    const px = p[0] * M_PER_DEG_LNG, py = p[1] * M_PER_DEG_LAT;
    const vx = bx - ax, vy = by - ay;
    const wx = px - ax, wy = py - ay;
    const c = vx * vx + vy * vy;
    const t = c > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / c)) : 0;
    const qx = ax + vx * t, qy = ay + vy * t;
    return Math.hypot(px - qx, py - qy) / 1000;
  }
  function highwayWeight(hw) {
    if (!hw) return 0.45;
    if (hw.indexOf('motorway') === 0) return 1.0;
    if (hw.indexOf('trunk') === 0) return 0.92;
    if (hw.indexOf('primary') === 0) return 0.84;
    if (hw.indexOf('secondary') === 0) return 0.72;
    if (hw.indexOf('tertiary') === 0) return 0.58;
    if (hw === 'residential') return 0.42;
    if (hw === 'service') return 0.24;
    return 0.48;
  }

  function seededRandom(seed) {
    let x = (seed == null ? 0xb1f55 : seed) >>> 0;
    return function () {
      x = (x * 1664525 + 1013904223) >>> 0;
      return (x & 0xffffff) / 0xffffff;
    };
  }

  function weightedPick(items, weightFn, rand01) {
    let total = 0;
    for (let i = 0; i < items.length; i++) total += Math.max(0.0001, weightFn(items[i]));
    let roll = rand01() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= Math.max(0.0001, weightFn(items[i]));
      if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
  }

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
    vehiclePreviewMs: 4000,
    vehiclePreviewUntil: 0,
    vehiclesVisible: true,
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
        highway: s.highway || '',
        occupants: new Set(),
      }));
    // Drop vehicles whose segment vanished
    state.vehicles = state.vehicles.filter(v => state.segments.find(s => s.id === v.segmentId));
  }

  function userRoadSegmentsFromBranch(branch) {
    const out = [];
    const items = (branch && branch.items) || [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.type !== 'road') continue;
      if (Array.isArray(it.path) && it.path.length >= 2) {
        for (let j = 0; j + 1 < it.path.length; j++) {
          out.push({
            id: 'u-' + it.id + '-' + j,
            a: it.path[j],
            b: it.path[j + 1],
            source: 'user',
            highway: 'primary',
          });
        }
      } else if (Array.isArray(it.start) && Array.isArray(it.end)) {
        out.push({ id: 'u-' + it.id, a: it.start, b: it.end, source: 'user', highway: 'primary' });
      }
    }
    return out;
  }

  function setSegmentsFromBranch(branch) {
    if (!branch) { setSegments([]); return; }
    setSegments([...sampleOsmSegments(), ...userRoadSegmentsFromBranch(branch)]);
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
  let osmWholeCitySamples = new Map();
  const OSM_CELL = 0.001;          // ≈110m at this latitude
  const WHOLE_CITY_CELL_LNG = 0.006;
  const WHOLE_CITY_CELL_LAT = 0.004;

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
        osmWholeCitySamples = new Map();
        return segs;
      })
      .catch(err => {
        console.warn('TrafficSim: failed to preload OSM roads, falling back to synthetic grid', err);
        osmAllSegments = [];
        osmGrid = new Map();
        osmWholeCitySamples = new Map();
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
                out.push({
                  id: 'osm-' + (id++),
                  a: coords[j],
                  b: coords[j + 1],
                  source: 'osm',
                  highway: (feats[i].properties && feats[i].properties.highway) || '',
                });
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

  function osmSegmentsForDemandCoverage(demand, radiusKm, maxRawSegments) {
    if (!isOsmLoaded() || !demand.length) return [];
    const out = [];
    const seen = new Set();
    const points = demand.slice().sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return b.weight - a.weight;
    });
    for (let i = 0; i < points.length && out.length < maxRawSegments; i++) {
      const local = osmSegmentsNear(points[i].coord, radiusKm);
      for (let j = 0; j < local.length && out.length < maxRawSegments; j++) {
        const seg = local[j];
        const key = seg.id || (seg.a.join(',') + '>' + seg.b.join(','));
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(seg);
      }
    }
    return out;
  }

  function segmentStableKey(seg) {
    if (seg && seg.id) return String(seg.id);
    return seg && Array.isArray(seg.a) && Array.isArray(seg.b)
      ? seg.a.join(',') + '>' + seg.b.join(',')
      : '';
  }

  function wholeCityBucketKey(seg) {
    const mid = midpoint(seg.a, seg.b);
    return Math.floor(mid[0] / WHOLE_CITY_CELL_LNG) + '|' + Math.floor(mid[1] / WHOLE_CITY_CELL_LAT);
  }

  function segmentPriority(seg) {
    return highwayWeight(seg.highway) * 1000 + Math.min(300, distMetres(seg.a, seg.b));
  }

  function osmSegmentsForWholeCity(maxRawSegments) {
    if (!isOsmLoaded()) return [];
    const limit = Math.max(1200, Math.min(osmAllSegments.length, Math.round(Number(maxRawSegments) || 24000)));
    const cacheKey = String(limit);
    if (osmWholeCitySamples.has(cacheKey)) return osmWholeCitySamples.get(cacheKey);
    if (osmAllSegments.length <= limit) {
      const all = osmAllSegments.slice();
      osmWholeCitySamples.set(cacheKey, all);
      return all;
    }

    const buckets = new Map();
    for (let i = 0; i < osmAllSegments.length; i++) {
      const seg = osmAllSegments[i];
      if (!seg || !Array.isArray(seg.a) || !Array.isArray(seg.b)) continue;
      const key = wholeCityBucketKey(seg);
      let bucket = buckets.get(key);
      if (!bucket) { bucket = []; buckets.set(key, bucket); }
      bucket.push(seg);
    }
    const bucketList = Array.from(buckets.values())
      .map(bucket => bucket.sort((a, b) => segmentPriority(b) - segmentPriority(a)))
      .sort((a, b) => segmentPriority(b[0]) - segmentPriority(a[0]));

    const out = [];
    const seen = new Set();
    let cursor = 0;
    while (out.length < limit) {
      let added = false;
      for (let i = 0; i < bucketList.length && out.length < limit; i++) {
        const seg = bucketList[i][cursor];
        if (!seg) continue;
        const key = segmentStableKey(seg);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(seg);
        added = true;
      }
      if (!added) break;
      cursor++;
    }
    osmWholeCitySamples.set(cacheKey, out);
    return out;
  }

  function selectWholeCityScoredSegments(scored, maxSegments) {
    const buckets = new Map();
    for (let i = 0; i < scored.length; i++) {
      const entry = scored[i];
      if (!entry || !entry.raw || !Array.isArray(entry.raw.a) || !Array.isArray(entry.raw.b)) continue;
      const key = wholeCityBucketKey(entry.raw);
      let bucket = buckets.get(key);
      if (!bucket) { bucket = []; buckets.set(key, bucket); }
      bucket.push(entry);
    }
    const bucketList = Array.from(buckets.values())
      .map(bucket => bucket.sort((a, b) => b.score - a.score))
      .sort((a, b) => b[0].score - a[0].score);
    const selected = [];
    const seen = new Set();
    const coverageTarget = Math.min(maxSegments, Math.max(Math.ceil(maxSegments * 0.55), bucketList.length));
    let cursor = 0;
    while (selected.length < coverageTarget) {
      let added = false;
      for (let i = 0; i < bucketList.length && selected.length < coverageTarget; i++) {
        const entry = bucketList[i][cursor];
        if (!entry) continue;
        const key = segmentStableKey(entry.raw);
        if (seen.has(key)) continue;
        seen.add(key);
        selected.push(entry);
        added = true;
      }
      if (!added) break;
      cursor++;
    }
    for (let i = 0; i < scored.length && selected.length < maxSegments; i++) {
      const entry = scored[i];
      const key = segmentStableKey(entry.raw);
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push(entry);
    }
    return selected;
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
        if (dx < 7) segs.push({ id: 'syn-' + (id++), a, b: b1, source: 'osm', highway: 'secondary' });
        if (dy < 5) segs.push({ id: 'syn-' + (id++), a, b: b2, source: 'osm', highway: 'tertiary' });
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

  function buildNetworkFeatures() {
    const feats = [];
    for (let i = 0; i < state.segments.length; i++) {
      const s = state.segments[i];
      feats.push({
        type: 'Feature',
        properties: {
          source: s.source || 'osm',
          highway: s.highway || '',
          weight: highwayWeight(s.highway),
          user: s.source === 'user' ? 1 : 0,
        },
        geometry: { type: 'LineString', coordinates: [s.a, s.b] },
      });
    }
    return { type: 'FeatureCollection', features: feats };
  }

  function buildCongestionFeatures() {
    const feats = [];
    for (let i = 0; i < state.segments.length; i++) {
      const s = state.segments[i];
      const cap = Math.max(2, Math.floor(s.length / 60));
      const ratio = Math.min(1, s.occupants.size / cap);
      if (ratio < 0.05) continue;
      feats.push({
        type: 'Feature',
        properties: {
          congestion: ratio,
          weight: highwayWeight(s.highway),
          user: s.source === 'user' ? 1 : 0,
          highway: s.highway || '',
        },
        geometry: { type: 'LineString', coordinates: [s.a, s.b] },
      });
    }
    return { type: 'FeatureCollection', features: feats };
  }

  function ensureLayers() {
    const map = state.map;
    if (!map || !map.isStyleLoaded || !map.isStyleLoaded()) return false;

    if (!map.getSource(NETWORK_SOURCE_ID)) {
      map.addSource(NETWORK_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer(NETWORK_CASE_LAYER_ID)) {
      map.addLayer({
        id: NETWORK_CASE_LAYER_ID,
        type: 'line',
        source: NETWORK_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 13, 3.2, 16, 7.5],
          'line-color': '#020617',
          'line-opacity': 0.72,
        },
      });
    }
    if (!map.getLayer(NETWORK_LAYER_ID)) {
      map.addLayer({
        id: NETWORK_LAYER_ID,
        type: 'line',
        source: NETWORK_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.45, 14, 1.4, 16, 2.6],
          'line-color': ['case', ['==', ['get', 'user'], 1], '#22d3ee', '#2563eb'],
          'line-opacity': ['case', ['==', ['get', 'user'], 1], 0.84, 0.56],
        },
      });
    }

    if (!map.getSource(CONGESTION_SOURCE_ID)) {
      map.addSource(CONGESTION_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer(CONGESTION_GLOW_LAYER_ID)) {
      map.addLayer({
        id: CONGESTION_GLOW_LAYER_ID,
        type: 'line',
        source: CONGESTION_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 12, 16, 22],
          'line-color': ['interpolate', ['linear'], ['get', 'congestion'],
            0.05, '#22d3ee',
            0.25, '#34d399',
            0.45, '#facc15',
            0.70, '#fb923c',
            1.0,  '#ef4444'],
          'line-opacity': ['interpolate', ['linear'], ['get', 'congestion'], 0.05, 0.08, 1, 0.32],
          'line-blur': 3,
        },
      });
    }
    if (!map.getLayer(CONGESTION_LAYER_ID)) {
      map.addLayer({
        id: CONGESTION_LAYER_ID,
        type: 'line',
        source: CONGESTION_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 5.5, 16, 9],
          'line-color': ['interpolate', ['linear'], ['get', 'congestion'],
            0.05, '#22d3ee',
            0.25, '#34d399',
            0.45, '#facc15',
            0.70, '#fb923c',
            1.0,  '#ef4444'],
          'line-opacity': 0.92,
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
    const network = state.map.getSource(NETWORK_SOURCE_ID);
    if (network) network.setData(buildNetworkFeatures());
    const veh = state.map.getSource(VEHICLE_SOURCE_ID);
    if (veh) {
      veh.setData(state.vehiclesVisible
        ? buildVehicleFeatures()
        : { type: 'FeatureCollection', features: [] });
    }
    const cong = state.map.getSource(CONGESTION_SOURCE_ID);
    if (cong) cong.setData(buildCongestionFeatures());
  }

  function clearMapData() {
    if (!state.map) return;
    const network = state.map.getSource(NETWORK_SOURCE_ID);
    if (network) network.setData({ type: 'FeatureCollection', features: [] });
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
    if (state.vehiclePreviewUntil && performance.now() >= state.vehiclePreviewUntil) {
      state.vehiclesVisible = false;
      state.vehiclePreviewUntil = 0;
    }
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

  function previewVehicles(ms) {
    const previewMs = typeof ms === 'number' ? ms : state.vehiclePreviewMs;
    state.vehiclesVisible = previewMs !== 0;
    state.vehiclePreviewUntil = previewMs > 0 ? performance.now() + previewMs : 0;
    setDataIfReady();
  }

  function start(opts) {
    if (opts && typeof opts.density === 'number') state.targetCount = clampInt(opts.density, 0, 400);
    if (opts && typeof opts.speed === 'number') state.speedMultiplier = Math.max(0.1, Math.min(3, opts.speed));
    if (opts && typeof opts.congestionFeedback === 'boolean') state.congestionFeedback = opts.congestionFeedback;
    const previewMs = opts && typeof opts.vehiclePreviewMs === 'number'
      ? opts.vehiclePreviewMs
      : state.vehiclePreviewMs;
    previewVehicles(previewMs);
    refreshSegments();
    if (state.running) return;
    state.running = true;
    state.lastTs = 0;
    state.rafId = requestAnimationFrame(loop);
  }

  function stop() {
    state.running = false;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = null;
    state.vehiclePreviewUntil = 0;
    state.vehiclesVisible = true;
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
    return [...sampleOsmSegments(), ...userRoadSegmentsFromBranch(branch)];
  }

  // ----- agent-swarm road pressure overlay ---------------------------------
  // This mirrors the trafficjam visual approach: run simple agents through the
  // local road graph, aggregate per-link volume/occupancy, then render coloured
  // road outlines instead of a blob heatmap.

  function normaliseDemandPoints(points) {
    const out = [];
    const raw = Array.isArray(points) ? points : [];
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      let coord = null;
      let props = {};
      if (Array.isArray(p) && p.length >= 2) {
        coord = [Number(p[0]), Number(p[1])];
      } else if (p && p.geometry && p.geometry.type === 'Point') {
        coord = p.geometry.coordinates;
        props = p.properties || {};
      } else if (p && Array.isArray(p.coord)) {
        coord = p.coord;
        props = p;
      } else if (p && Array.isArray(p.coordinates)) {
        coord = p.coordinates;
        props = p;
      }
      if (!Array.isArray(coord) || coord.length < 2) continue;
      const lng = Number(coord[0]), lat = Number(coord[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const intensity = Number(props.intensity ?? props.weight ?? props.w ?? 1);
      const polarity = Number(props.polarity ?? props.pressure ?? -1);
      out.push({
        id: props.id || ('demand-' + i),
        coord: [lng, lat],
        weight: clamp01(intensity) || 0.2,
        polarity: Number.isFinite(polarity) ? polarity : -1,
        active: !!props.active,
      });
    }
    return out;
  }

  function demandCentre(points) {
    if (!points.length) {
      return (state.map && state.map.getCenter)
        ? [state.map.getCenter().lng, state.map.getCenter().lat]
        : [-5.93, 54.597];
    }
    let sx = 0, sy = 0, sw = 0;
    for (let i = 0; i < points.length; i++) {
      const w = Math.max(0.05, points[i].weight);
      sx += points[i].coord[0] * w;
      sy += points[i].coord[1] * w;
      sw += w;
    }
    return sw ? [sx / sw, sy / sw] : points[0].coord;
  }

  function segmentDemandScore(seg, demand, centre, radiusKm) {
    const hw = highwayWeight(seg.highway);
    let score = 0.08 + hw * 0.34;
    if (centre) {
      score += Math.max(0, 1 - pointSegmentDistanceKm(centre, seg.a, seg.b) / Math.max(0.1, radiusKm)) * 0.18;
    }
    for (let i = 0; i < demand.length; i++) {
      const p = demand[i];
      const sigma = p.active ? 0.18 : 0.36;
      const d = pointSegmentDistanceKm(p.coord, seg.a, seg.b);
      const pressure = p.polarity >= 0 ? 0.38 : 1.0;
      score += p.weight * pressure * Math.exp(-(d * d) / (2 * sigma * sigma));
    }
    return score;
  }

  function lineFeatureForSegment(seg, props) {
    return {
      type: 'Feature',
      properties: Object.assign({
        id: seg.id,
        source: seg.source || 'osm',
        highway: seg.highway || '',
        weight: highwayWeight(seg.highway),
      }, props || {}),
      geometry: { type: 'LineString', coordinates: [seg.a, seg.b] },
    };
  }

  function runAgentSwarm(opts) {
    opts = opts || {};
    const demand = normaliseDemandPoints(opts.demandPoints || opts.points || []);
    const cityWide = !!opts.cityWide || opts.scope === 'city';
    const wholeCityRoads = cityWide && (opts.wholeCityRoads || opts.cityCoverage === 'whole-city' || opts.cityCoverage === 'whole-belfast');
    const centre = Array.isArray(opts.centre) ? opts.centre : demandCentre(demand);
    const radiusLimit = cityWide ? 24 : 6;
    const radiusFloor = cityWide ? 4 : 0.35;
    const radiusKm = Math.max(radiusFloor, Math.min(radiusLimit, Number(opts.radiusKm) || (demand.length ? 2.2 : 1.4)));
    const seed = opts.seed == null ? 0xb1f55 : opts.seed;
    const rand01 = seededRandom(seed);
    const density = clampInt(opts.density || Math.min(420, Math.max(120, 90 + demand.length * 16)), 20, 650);
    const durationSeconds = Math.max(1, Math.min(45, Number(opts.durationSeconds) || 8));
    const dt = 0.1;
    const speedMul = Math.max(0.1, Math.min(3, Number(opts.speed) || state.speedMultiplier || 1));

    let raw = Array.isArray(opts.segments) && opts.segments.length
      ? opts.segments
      : (isOsmLoaded()
        ? (cityWide
          ? (wholeCityRoads
            ? osmSegmentsForWholeCity(Math.max(1200, Math.min(36000, Number(opts.cityRawSegmentLimit) || 24000)))
            : osmSegmentsForDemandCoverage(
              demand,
              Math.max(0.55, Math.min(1.2, Number(opts.cityDemandRadiusKm) || 0.78)),
              Math.max(1200, Math.min(18000, Number(opts.cityRawSegmentLimit) || 12000))
            ))
          : osmSegmentsNear(centre, radiusKm * 1.25))
        : sampleOsmSegments());
    if (cityWide && !raw.length && isOsmLoaded()) raw = osmAllSegments.slice();
    raw = raw.concat(userRoadSegmentsFromBranch(opts.branch));

    let scored = [];
    const scoringCentre = cityWide ? null : centre;
    for (let i = 0; i < raw.length; i++) {
      const s = raw[i];
      if (!s || !Array.isArray(s.a) || !Array.isArray(s.b)) continue;
      if (!cityWide && centre && pointSegmentDistanceKm(centre, s.a, s.b) > radiusKm) continue;
      const score = segmentDemandScore(s, demand, scoringCentre, radiusKm);
      scored.push({ raw: s, score: score });
    }
    if (!scored.length) {
      return {
        base: { type: 'FeatureCollection', features: [] },
        flow: { type: 'FeatureCollection', features: [] },
        points: { type: 'FeatureCollection', features: [] },
        summary: { vehicles: 0, avgSpeed: 0, congested: 0 },
      };
    }

    scored.sort((a, b) => b.score - a.score);
    const maxSegmentLimit = wholeCityRoads ? 9200 : cityWide ? 5600 : 2600;
    const maxSegments = Math.max(200, Math.min(maxSegmentLimit, Number(opts.maxSegments) || (cityWide ? 4200 : 1800)));
    if (scored.length > maxSegments) {
      scored = wholeCityRoads ? selectWholeCityScoredSegments(scored, maxSegments) : scored.slice(0, maxSegments);
    }

    const segments = scored.map((entry, i) => ({
      id: entry.raw.id || ('swarm-' + i),
      a: entry.raw.a,
      b: entry.raw.b,
      length: Math.max(20, distMetres(entry.raw.a, entry.raw.b)),
      source: entry.raw.source || 'osm',
      highway: entry.raw.highway || '',
      spawnWeight: Math.max(0.02, entry.score),
      occupants: new Set(),
      occSum: 0,
      occSamples: 0,
      through: 0,
    }));

    const vehicles = [];
    for (let i = 0; i < density; i++) {
      const seg = weightedPick(segments, s => s.spawnWeight, rand01);
      const v = {
        id: i,
        segmentId: seg.id,
        t: rand01(),
        forward: rand01() > 0.5,
        baseSpeed: (7 + rand01() * 8) * (0.88 + highwayWeight(seg.highway) * 0.28),
        jitter: 0.82 + rand01() * 0.36,
        totalSpeed: 0,
        samples: 0,
      };
      seg.occupants.add(v.id);
      vehicles.push(v);
    }

    const segById = new Map(segments.map(s => [s.id, s]));
    function neighbour(prev, fromPoint) {
      const candidates = [];
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (s.id === prev.id) continue;
        if (distMetres(s.a, fromPoint) < 28 || distMetres(s.b, fromPoint) < 28) {
          candidates.push(s);
          if (candidates.length >= 10) break;
        }
      }
      return candidates.length
        ? weightedPick(candidates, s => s.spawnWeight, rand01)
        : weightedPick(segments, s => s.spawnWeight, rand01);
    }

    let speedSum = 0, speedCount = 0, congestedSamples = 0;
    const ticks = Math.max(1, Math.floor(durationSeconds / dt));
    for (let tick = 0; tick < ticks; tick++) {
      for (let i = 0; i < segments.length; i++) {
        segments[i].occSum += segments[i].occupants.size;
        segments[i].occSamples++;
      }
      for (let i = 0; i < vehicles.length; i++) {
        const v = vehicles[i];
        const seg = segById.get(v.segmentId);
        if (!seg) continue;
        const cap = Math.max(2, Math.floor(seg.length / 55));
        const congestion = Math.min(1, seg.occupants.size / cap);
        const eff = v.baseSpeed * v.jitter * speedMul * (1 - 0.66 * congestion);
        speedSum += eff;
        speedCount++;
        if (congestion > 0.55) congestedSamples++;
        v.totalSpeed += eff;
        v.samples++;
        v.t += (v.forward ? 1 : -1) * (eff / seg.length) * dt;
        if (v.t > 1 || v.t < 0) {
          seg.occupants.delete(v.id);
          seg.through++;
          const fromPoint = v.t > 1 ? seg.b : seg.a;
          const next = neighbour(seg, fromPoint);
          const forward = distMetres(next.a, fromPoint) < distMetres(next.b, fromPoint);
          v.segmentId = next.id;
          v.t = forward ? 0 : 1;
          v.forward = forward;
          next.occupants.add(v.id);
        }
      }
    }

    let maxThrough = 1, maxSpawn = 1;
    for (let i = 0; i < segments.length; i++) {
      maxThrough = Math.max(maxThrough, segments[i].through);
      maxSpawn = Math.max(maxSpawn, segments[i].spawnWeight);
    }

    const baseFeatures = [];
    let flowFeatures = [];
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const cap = Math.max(2, Math.floor(s.length / 55));
      const occRatio = (s.occSamples ? s.occSum / s.occSamples : 0) / cap;
      const throughRatio = s.through / maxThrough;
      const demandRatio = s.spawnWeight / maxSpawn;
      const congestion = clamp01(occRatio * 0.58 + throughRatio * 0.28 + demandRatio * 0.52);
      baseFeatures.push(lineFeatureForSegment(s, { congestion: 0, flow: 0 }));
      if (congestion >= 0.18 || s.source === 'user') {
        flowFeatures.push(lineFeatureForSegment(s, {
          congestion: congestion,
          flow: throughRatio,
          demand: demandRatio,
          volume: s.through,
        }));
      }
    }
    flowFeatures.sort((a, b) => (b.properties.congestion || 0) - (a.properties.congestion || 0));
    const maxFlowLimit = wholeCityRoads ? 1800 : cityWide ? 1400 : 900;
    const maxFlowSegments = Math.max(80, Math.min(maxFlowLimit, Number(opts.maxFlowSegments) || (cityWide ? 900 : 420)));
    if (flowFeatures.length > maxFlowSegments) flowFeatures = flowFeatures.slice(0, maxFlowSegments);

    let pointData = demand.slice().sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return b.weight - a.weight;
    });
    const maxPointFeatures = Math.max(0, Math.min(80, Number(opts.maxPointFeatures) || 24));
    if (pointData.length > maxPointFeatures) pointData = pointData.slice(0, maxPointFeatures);
    const pointFeatures = pointData.map((p, i) => ({
      type: 'Feature',
      properties: {
        id: p.id || ('demand-' + i),
        intensity: p.weight,
        active: p.active ? 1 : 0,
        polarity: p.polarity,
        color: p.polarity >= 0 ? '#22c55e' : (p.active ? '#ef4444' : '#facc15'),
      },
      geometry: { type: 'Point', coordinates: p.coord },
    }));

    return {
      base: { type: 'FeatureCollection', features: baseFeatures },
      flow: { type: 'FeatureCollection', features: flowFeatures },
      points: { type: 'FeatureCollection', features: pointFeatures },
      summary: {
        vehicles: vehicles.length,
        avgSpeed: speedCount ? speedSum / speedCount : 0,
        congested: speedCount ? congestedSamples / speedCount : 0,
      },
    };
  }

  function ensureAgentSwarmLayers() {
    if (!state.map) return false;
    const empty = { type: 'FeatureCollection', features: [] };
    if (!state.map.getSource(AGENT_BASE_SOURCE_ID)) state.map.addSource(AGENT_BASE_SOURCE_ID, { type: 'geojson', data: empty });
    if (!state.map.getSource(AGENT_FLOW_SOURCE_ID)) state.map.addSource(AGENT_FLOW_SOURCE_ID, { type: 'geojson', data: empty });
    if (!state.map.getSource(AGENT_POINT_SOURCE_ID)) state.map.addSource(AGENT_POINT_SOURCE_ID, { type: 'geojson', data: empty });

    if (!state.map.getLayer(AGENT_BASE_CASE_LAYER_ID)) {
      state.map.addLayer({
        id: AGENT_BASE_CASE_LAYER_ID,
        type: 'line',
        source: AGENT_BASE_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 13, 3.5, 16, 8],
          'line-color': '#020617',
          'line-opacity': 0.74,
        },
      });
    }
    if (!state.map.getLayer(AGENT_BASE_LAYER_ID)) {
      state.map.addLayer({
        id: AGENT_BASE_LAYER_ID,
        type: 'line',
        source: AGENT_BASE_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.45, 13, 1.2, 16, 2.4],
          'line-color': ['interpolate', ['linear'], ['get', 'weight'], 0.2, '#1d4ed8', 0.65, '#0284c7', 1.0, '#22d3ee'],
          'line-opacity': 0.72,
        },
      });
    }
    if (!state.map.getLayer(AGENT_FLOW_GLOW_LAYER_ID)) {
      state.map.addLayer({
        id: AGENT_FLOW_GLOW_LAYER_ID,
        type: 'line',
        source: AGENT_FLOW_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 13, 13, 16, 24],
          'line-color': ['interpolate', ['linear'], ['get', 'congestion'],
            0.00, '#2563eb',
            0.18, '#22d3ee',
            0.38, '#34d399',
            0.58, '#facc15',
            0.78, '#fb923c',
            1.00, '#ef4444'],
          'line-opacity': ['interpolate', ['linear'], ['get', 'congestion'], 0, 0.04, 1, 0.26],
          'line-blur': 3.2,
        },
      });
    }
    if (!state.map.getLayer(AGENT_FLOW_LAYER_ID)) {
      state.map.addLayer({
        id: AGENT_FLOW_LAYER_ID,
        type: 'line',
        source: AGENT_FLOW_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.2, 13, 4.8, 16, 9.5],
          'line-color': ['interpolate', ['linear'], ['get', 'congestion'],
            0.00, '#2563eb',
            0.18, '#22d3ee',
            0.38, '#34d399',
            0.58, '#facc15',
            0.78, '#fb923c',
            1.00, '#ef4444'],
          'line-opacity': 0.96,
        },
      });
    }
    if (!state.map.getLayer(AGENT_POINT_GLOW_LAYER_ID)) {
      state.map.addLayer({
        id: AGENT_POINT_GLOW_LAYER_ID,
        type: 'circle',
        source: AGENT_POINT_SOURCE_ID,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'intensity'], 0, 7, 1, 18],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.22,
          'circle-blur': 0.8,
        },
      });
    }
    if (!state.map.getLayer(AGENT_POINT_LAYER_ID)) {
      state.map.addLayer({
        id: AGENT_POINT_LAYER_ID,
        type: 'circle',
        source: AGENT_POINT_SOURCE_ID,
        paint: {
          'circle-radius': ['case', ['==', ['get', 'active'], 1], 5, 3],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#111827',
          'circle-stroke-width': 1.2,
          'circle-opacity': 0.96,
        },
      });
    }
    return true;
  }

  function showAgentSwarmOverlay(result) {
    if (!ensureAgentSwarmLayers()) {
      if (state.map && state.map.once) state.map.once('styledata', () => showAgentSwarmOverlay(result));
      return false;
    }
    const base = result && result.base ? result.base : { type: 'FeatureCollection', features: [] };
    const flow = result && result.flow ? result.flow : { type: 'FeatureCollection', features: [] };
    const points = result && result.points ? result.points : { type: 'FeatureCollection', features: [] };
    const baseSrc = state.map.getSource(AGENT_BASE_SOURCE_ID);
    const flowSrc = state.map.getSource(AGENT_FLOW_SOURCE_ID);
    const pointSrc = state.map.getSource(AGENT_POINT_SOURCE_ID);
    if (baseSrc) baseSrc.setData(base);
    if (flowSrc) flowSrc.setData(flow);
    if (pointSrc) pointSrc.setData(points);
    return true;
  }

  function clearAgentSwarmOverlay() {
    if (!state.map) return;
    const empty = { type: 'FeatureCollection', features: [] };
    const baseSrc = state.map.getSource(AGENT_BASE_SOURCE_ID);
    const flowSrc = state.map.getSource(AGENT_FLOW_SOURCE_ID);
    const pointSrc = state.map.getSource(AGENT_POINT_SOURCE_ID);
    if (baseSrc) baseSrc.setData(empty);
    if (flowSrc) flowSrc.setData(empty);
    if (pointSrc) pointSrc.setData(empty);
  }

  // ----- comparison overlay (the on-map road-link pressure view) -----------
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
          'line-color': ['interpolate', ['linear'], ['get', 'after'],
            0.00, '#2563eb',
            0.18, '#22d3ee',
            0.38, '#34d399',
            0.58, '#facc15',
            0.78, '#fb923c',
            1.00, '#ef4444'],
          'line-opacity': ['interpolate', ['linear'], ['get', 'after'], 0, 0.28, 1, 0.96],
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
    runAgentSwarm: runAgentSwarm,
    showAgentSwarmOverlay: showAgentSwarmOverlay,
    clearAgentSwarmOverlay: clearAgentSwarmOverlay,
    previewVehicles: previewVehicles,
    sampleOsmSegments: sampleOsmSegments,
    showComparisonOverlay: showComparisonOverlay,
    clearComparisonOverlay: clearComparisonOverlay,
    preloadOsm: preloadOsm,
    isOsmLoaded: isOsmLoaded,
  };
})();
