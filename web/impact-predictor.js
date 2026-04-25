/* ================================================================
   BELFAST IMPACT PREDICTOR
   Distance + recency-weighted kNN over the past-events catalog.

   For a proposed building, finds nearby historical events of each
   signal type (traffic / jobs / electricity / buildings / services),
   weighs them by distance and recency, and combines the resulting
   "context score" with the building's own characteristics to produce
   per-year predicted deltas across population, traffic, jobs,
   transit, opportunity, air, housing, economy.

   Also returns:
   - per-cell intensity samples (for the map heatmap ripple)
   - top-K most similar past events (for explainability)
   - a confidence score based on local sample size

   The predictor is a closed-form, deterministic regressor — no
   training step at runtime. The "training data" is the OSM /
   public-records event catalog already shipped with the app.
   ================================================================ */

(function (global) {
  'use strict';

  const BASE_YEAR = 2026;
  const SIGNALS = ['traffic', 'jobs', 'electricity', 'buildings', 'services'];

  // ---------- BUILDING CHARACTERISTICS ----------

  // Per-preset structural footprint (residents, jobs, traffic trips/day, etc.)
  const PRESET_PROFILE = {
    residential: { residents: 220, jobs: 4,   trips: 380, footprint: 'med', mix: 'res' },
    commercial:  { residents: 0,   jobs: 180, trips: 540, footprint: 'lrg', mix: 'comm' },
    industrial:  { residents: 0,   jobs: 90,  trips: 320, footprint: 'lrg', mix: 'ind' },
    mixed_use:   { residents: 140, jobs: 110, trips: 460, footprint: 'lrg', mix: 'mix' }
  };

  // Mapping signal → which output metrics that signal informs
  // Traffic events near the site → site will sit in a high-traffic context
  // Jobs events near → strong commercial context
  // Services events → well-served (transit, schools, retail) → opportunity high
  // Buildings events → ongoing development → housing pressure
  // Electricity events → infrastructure capacity
  const SIGNAL_INFLUENCE = {
    traffic:     { traffic: +0.28, transit: -0.12, opportunity: -0.04, air: -0.14 },
    jobs:        { jobs: +0.32, opportunity: +0.18, economy: +0.20, traffic: +0.06 },
    electricity: { economy: +0.06, air: +0.04, housing: +0.02 },
    buildings:   { housing: +0.22, population: +0.18, opportunity: +0.05, air: -0.08 },
    services:    { transit: +0.30, opportunity: +0.22, jobs: +0.05, fairness: +0.10 }
  };

  // Per-preset baseline year-over-year delta. Numbers are tuned to
  // produce visually meaningful but not absurd ripples by year +5.
  const PRESET_BASE_YOY = {
    residential: { population: 110, traffic: 0.0035, air: -0.18, housing: -0.012, economy: 0.018, jobs: 0.0008, transit: -0.001, opportunity: 0.005, fairness: 0.004 },
    commercial:  { population: 18,  traffic: 0.0060, air: -0.12, housing: -0.002, economy: 0.075, jobs: 0.0090, transit: -0.002, opportunity: 0.011, fairness: 0.002 },
    industrial:  { population: 6,   traffic: 0.0085, air: -0.55, housing: 0.000,  economy: 0.100, jobs: 0.0070, transit: -0.003, opportunity: 0.004, fairness: -0.002 },
    mixed_use:   { population: 70,  traffic: 0.0045, air: -0.22, housing: -0.008, economy: 0.050, jobs: 0.0055, transit: 0.001,  opportunity: 0.010, fairness: 0.006 }
  };

  // ---------- STATE ----------

  const eventsBySignal = { traffic: [], jobs: [], electricity: [], buildings: [], services: [] };
  let loaded = false;
  let loadingPromise = null;

  // ---------- DATA LOAD ----------

  async function loadAllSignals() {
    if (loaded) return;
    if (loadingPromise) return loadingPromise;
    loadingPromise = (async () => {
      const fetches = SIGNALS.map(async (sig) => {
        try {
          const res = await fetch('/api/events?signal=' + sig + '&limit=5000');
          if (!res.ok) throw new Error('signal ' + sig + ' ' + res.status);
          const json = await res.json();
          if (Array.isArray(json.events)) {
            eventsBySignal[sig] = json.events.filter(e => Array.isArray(e.coordinates) && e.coordinates.length === 2);
          }
        } catch (e) {
          console.warn('[BelfastPredictor] failed to load signal', sig, e);
        }
      });
      await Promise.all(fetches);
      loaded = true;
      // Notify any listeners
      try { document.dispatchEvent(new CustomEvent('belfast-predictor-ready')); } catch (_) {}
    })();
    return loadingPromise;
  }

  // ---------- GEOMETRY ----------

  function haversineMeters(lng1, lat1, lng2, lat2) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLng = (lng2 - lng1) * toRad;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
              Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function circlePolygon(lng, lat, radiusM, segments) {
    segments = segments || 48;
    const coords = [];
    const dLat = radiusM / 111111;
    const dLng = radiusM / (111111 * Math.cos(lat * Math.PI / 180));
    for (let i = 0; i <= segments; i++) {
      const ang = (i / segments) * 2 * Math.PI;
      coords.push([lng + dLng * Math.cos(ang), lat + dLat * Math.sin(ang)]);
    }
    return coords;
  }

  // ---------- CORE PREDICTION ----------

  // Returns weighted context scores per signal for events within radius around (lng,lat).
  function contextScores(lng, lat, opts) {
    const radiusM = (opts && opts.radiusM) || 1500;
    const out = { traffic: 0, jobs: 0, electricity: 0, buildings: 0, services: 0 };
    const counts = { traffic: 0, jobs: 0, electricity: 0, buildings: 0, services: 0 };
    let nearestAll = [];

    SIGNALS.forEach(sig => {
      const arr = eventsBySignal[sig];
      if (!arr || !arr.length) return;
      arr.forEach(ev => {
        const c = ev.coordinates;
        const d = haversineMeters(lng, lat, c[0], c[1]);
        if (d > radiusM) return;
        // Distance decay (sigma = 600m) — events within 600m count nearly fully,
        // events beyond ~1.2km contribute only a fraction.
        const distW = Math.exp(-(d * d) / (2 * 600 * 600));
        // Recency decay (newer matters more, half-life ~6 yrs)
        const ageY = Math.max(0, BASE_YEAR - (ev.year || BASE_YEAR));
        const recW = Math.exp(-ageY / 6);
        // Confidence multiplier
        const confW = ev.confidence === 'high' ? 1.0 : ev.confidence === 'medium' ? 0.7 : 0.45;
        const w = distW * recW * confW;
        out[sig] += w;
        counts[sig] += 1;
        nearestAll.push({ ev: ev, dist: d, weight: w });
      });
    });

    // Total nearby for confidence
    const totalNearby = counts.traffic + counts.jobs + counts.electricity + counts.buildings + counts.services;

    // Sort all nearby for nearest events
    nearestAll.sort((a, b) => a.dist - b.dist);

    return { scores: out, counts: counts, totalNearby: totalNearby, nearest: nearestAll };
  }

  // Predict per-year deltas for a placed building at the given current year.
  // building: { lng, lat, year (placed), preset }
  // currentYear: the timeline year being shown
  function predictForBuilding(building, currentYear) {
    if (!building || typeof building.lng !== 'number') return null;
    const preset = building.preset || 'residential';
    const placedYear = building.year || (BASE_YEAR + 1);
    const yearsSince = Math.max(0, currentYear - placedYear);

    const ctx = contextScores(building.lng, building.lat, { radiusM: 1500 });

    // S-curve year ramp — peaks around year 7 since placement
    // 1 / (1 + e^-(t-2.5))  → 0.08 at year 0, 0.5 at year 2.5, 0.92 at year 5
    const ramp = 1 / (1 + Math.exp(-(yearsSince - 2.5) * 0.7));
    // Linear additive years for cumulative metrics (population, economy)
    const cumYears = yearsSince;

    const base = PRESET_BASE_YOY[preset] || PRESET_BASE_YOY.residential;

    // Compute per-metric context multiplier from signal influence weights
    const totalCtxWeight = Math.max(0.001, ctx.scores.traffic + ctx.scores.jobs + ctx.scores.electricity + ctx.scores.buildings + ctx.scores.services);
    const metricCtx = {};
    Object.keys(SIGNAL_INFLUENCE).forEach(sig => {
      const inf = SIGNAL_INFLUENCE[sig];
      const sigShare = ctx.scores[sig] / totalCtxWeight; // 0..1
      Object.keys(inf).forEach(m => {
        metricCtx[m] = (metricCtx[m] || 0) + inf[m] * sigShare;
      });
    });

    const out = {};
    Object.keys(base).forEach(m => {
      // Cumulative-style metrics (additive every year)
      const cum = base[m] * cumYears;
      // Apply context multiplier (1 + metricCtx[m])
      const ctxMul = 1 + (metricCtx[m] || 0);
      // Apply S-curve ramp on the marginal portion
      out[m] = cum * ctxMul * (0.4 + 0.6 * ramp);
    });

    // Surface confidence
    let confidence = 'low';
    if (ctx.totalNearby > 80) confidence = 'high';
    else if (ctx.totalNearby > 25) confidence = 'medium';

    return {
      yearsSince: yearsSince,
      ramp: ramp,
      deltas: out,            // { population, traffic, air, housing, economy, jobs, transit, opportunity, fairness }
      contextScores: ctx.scores,
      contextCounts: ctx.counts,
      totalNearby: ctx.totalNearby,
      confidence: confidence,
      nearest: ctx.nearest.slice(0, 12) // for similar-events overlay
    };
  }

  // ---------- HEATMAP CELLS ----------

  // For a building at (lng,lat), generate a fine grid of sample points within
  // a 1.5km radius, each carrying a predicted intensity (0..1) for the chosen
  // metric. The intensity decays with distance and respects per-cell context
  // (e.g. cells closer to historical traffic events get a stronger traffic
  // ripple). These points are rendered as a heatmap on the map.
  function generateHeatmapPoints(building, currentYear, metric) {
    if (!building) return [];
    const placed = building.year || (BASE_YEAR + 1);
    const yearsSince = Math.max(0, currentYear - placed);
    if (yearsSince <= 0) return [];

    // Centre prediction (used to scale per-cell intensity)
    const centerPred = predictForBuilding(building, currentYear);
    if (!centerPred) return [];
    const centerVal = Math.abs(centerPred.deltas[metric] || 0);
    if (centerVal <= 0) return [];

    // Polarity: +1 means "increase is bad" for traffic/housing/air-negative; -1 means "increase is good"
    // Determined by metric goodDirection.
    const goodDir = metricGoodDirection(metric);
    const polarity = (centerPred.deltas[metric] >= 0)
      ? (goodDir === 'up' ? +1 : -1)  // increase: good (+1) for up-good, bad (-1) for down-good
      : (goodDir === 'up' ? -1 : +1); // decrease: bad for up-good, good for down-good
    // polarity > 0 means "this delta is a positive thing for the city"

    const points = [];
    // Polar grid: 6 distance rings × 24 angular steps = 144 sample points
    const RINGS = [120, 280, 460, 680, 940, 1280];
    const ANGULAR = 24;
    for (let r = 0; r < RINGS.length; r++) {
      const dist = RINGS[r];
      // Distance attenuation: gaussian at sigma 700m
      const distAtt = Math.exp(-(dist * dist) / (2 * 700 * 700));
      for (let a = 0; a < ANGULAR; a++) {
        const ang = (a / ANGULAR) * 2 * Math.PI;
        const dLat = dist / 111111;
        const dLng = dist / (111111 * Math.cos(building.lat * Math.PI / 180));
        const lng = building.lng + dLng * Math.cos(ang);
        const lat = building.lat + dLat * Math.sin(ang);
        // Tiny per-cell context boost: count nearby past events of relevant signal
        const cellCtx = localSignalDensity(lng, lat, signalForMetric(metric));
        const intensity = Math.min(1, distAtt * (1 + cellCtx * 0.4) * Math.min(1, Math.abs(centerVal) * 14));
        if (intensity < 0.04) continue;
        points.push({
          type: 'Feature',
          properties: {
            intensity: intensity,
            polarity: polarity,
            yearsSince: yearsSince,
            metric: metric,
            buildingId: building.id || null
          },
          geometry: { type: 'Point', coordinates: [lng, lat] }
        });
      }
    }
    return points;
  }

  function metricGoodDirection(metric) {
    // 'up' = higher is better (jobs, transit, opportunity, economy, population, air, fairness)
    // 'down' = lower is better (traffic, housing pressure)
    if (metric === 'traffic' || metric === 'housing') return 'down';
    return 'up';
  }

  function signalForMetric(metric) {
    if (metric === 'traffic') return 'traffic';
    if (metric === 'jobs' || metric === 'economy') return 'jobs';
    if (metric === 'transit' || metric === 'opportunity' || metric === 'fairness') return 'services';
    if (metric === 'housing' || metric === 'population') return 'buildings';
    if (metric === 'air') return 'electricity';
    return 'traffic';
  }

  // Lightweight density at a single point (count of nearby events of one signal,
  // distance-weighted).
  function localSignalDensity(lng, lat, signal) {
    const arr = eventsBySignal[signal];
    if (!arr || !arr.length) return 0;
    let total = 0;
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i].coordinates;
      const d = haversineMeters(lng, lat, c[0], c[1]);
      if (d > 800) continue;
      total += Math.exp(-(d * d) / (2 * 350 * 350));
    }
    return total;
  }

  // ---------- SIMILAR PAST EVENTS ----------

  function similarEvents(building, k) {
    if (!building || typeof building.lng !== 'number') return [];
    k = k || 5;
    const preset = building.preset || 'residential';
    // Prefer events whose signal aligns with the preset's expected dominant impact
    const presetSignal = preset === 'industrial' ? 'jobs'
                       : preset === 'commercial' ? 'jobs'
                       : preset === 'mixed_use' ? 'services'
                       : 'buildings';
    const candidates = [];
    SIGNALS.forEach(sig => {
      const arr = eventsBySignal[sig];
      if (!arr) return;
      arr.forEach(ev => {
        const c = ev.coordinates;
        if (!c) return;
        const d = haversineMeters(building.lng, building.lat, c[0], c[1]);
        if (d > 2500) return;
        // Score: closer + same-signal + recent + high-confidence wins
        const distScore = Math.exp(-d / 700);
        const signalScore = sig === presetSignal ? 1.4 : (sig === 'buildings' ? 1.1 : 0.9);
        const recencyScore = Math.exp(-Math.max(0, BASE_YEAR - (ev.year || BASE_YEAR)) / 5);
        const confScore = ev.confidence === 'high' ? 1.0 : ev.confidence === 'medium' ? 0.8 : 0.55;
        candidates.push({
          ev: ev,
          dist: d,
          score: distScore * signalScore * recencyScore * confScore
        });
      });
    });
    candidates.sort((a, b) => b.score - a.score);
    // Deduplicate by source (avoid 5 nearly-identical OSM ways)
    const seen = new Set();
    const out = [];
    for (let i = 0; i < candidates.length && out.length < k; i++) {
      const ev = candidates[i].ev;
      const key = (ev.title || '') + '|' + (ev.year || '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: ev.id,
        title: ev.title || ev.category || 'Past event',
        area: ev.area || '',
        year: ev.year,
        signal: ev.signal,
        coordinates: ev.coordinates,
        distM: Math.round(candidates[i].dist),
        confidence: ev.confidence
      });
    }
    return out;
  }

  // ---------- AGGREGATE FOR BRANCH ----------

  // Sum predicted deltas over all buildings in a branch.
  function predictForBranch(branch, currentYear) {
    const empty = { population: 0, traffic: 0, air: 0, housing: 0, economy: 0, jobs: 0, transit: 0, opportunity: 0, fairness: 0 };
    if (!branch || !branch.items || !branch.items.length) {
      return { deltas: empty, totalBuildings: 0, confidence: 'low', perBuilding: [] };
    }
    const out = Object.assign({}, empty);
    let confSum = 0; let confN = 0;
    const perBuilding = [];
    branch.items.forEach(item => {
      if (item.type !== 'building') return;
      const pred = predictForBuilding(item, currentYear);
      if (!pred) return;
      Object.keys(out).forEach(m => { out[m] += pred.deltas[m] || 0; });
      confSum += pred.confidence === 'high' ? 1 : pred.confidence === 'medium' ? 0.5 : 0.2;
      confN += 1;
      perBuilding.push({ item: item, prediction: pred });
    });
    const avgConf = confN > 0 ? confSum / confN : 0;
    return {
      deltas: out,
      totalBuildings: perBuilding.length,
      confidence: avgConf > 0.7 ? 'high' : avgConf > 0.35 ? 'medium' : 'low',
      perBuilding: perBuilding
    };
  }

  // ---------- EXPORTS ----------

  global.BelfastPredictor = {
    BASE_YEAR: BASE_YEAR,
    SIGNALS: SIGNALS,
    loadAllSignals: loadAllSignals,
    isReady: function () { return loaded; },
    eventsBySignal: eventsBySignal,
    predictForBuilding: predictForBuilding,
    predictForBranch: predictForBranch,
    generateHeatmapPoints: generateHeatmapPoints,
    similarEvents: similarEvents,
    metricGoodDirection: metricGoodDirection,
    haversineMeters: haversineMeters,
    circlePolygon: circlePolygon
  };

})(window);
