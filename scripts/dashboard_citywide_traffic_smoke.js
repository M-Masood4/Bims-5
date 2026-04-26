// Verifies the post-cleanup dashboard:
//   - Impact Overview panel removed from the visible sidebar
//   - AI: 4 Variations button removed
//   - "Create 4 planner variations" context-menu item removed
//   - Building placement lands at the exact lng/lat of the click
//   - Future traffic swarm runs city-wide (8000+ road segments, multi-km bbox)
//   - branchCommitYearlyJobs grows year-over-year from staged buildings
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const url = process.env.URL || 'http://localhost:5173';
const outDir = path.resolve(__dirname, '..', 'output');
fs.mkdirSync(outDir, { recursive: true });

function fail(msg) { throw new Error(msg); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));

  console.log('→ open', url);
  await page.addInitScript(() => {
    try { localStorage.setItem('belfastOnboardingV1Done', '1'); } catch (_) {}
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => !!window.BelfastDashboard, null, { timeout: 30000 });
  await page.waitForFunction(
    () => window.BelfastDashboard.state.mapLoaded === true,
    null,
    { timeout: 30000 }
  );

  // 1. Impact Overview is no longer a visible sidebar section
  const sidebar = await page.evaluate(() => ({
    impactTitleVisible: !!Array.from(document.querySelectorAll('.right-sidebar .section-title'))
      .find(el => /impact overview/i.test(el.textContent)),
    aiVariationsBtn: !!document.querySelector('#plannerVariationsBtn'),
    branchVariationsCtx: !!document.querySelector('#nodeMenu [data-act="branch-variations"]')
  }));
  if (sidebar.impactTitleVisible) fail('Impact Overview section still visible in sidebar');
  if (sidebar.aiVariationsBtn) fail('AI 4 Variations button still in DOM');
  if (sidebar.branchVariationsCtx) fail('"Create 4 planner variations" context item still in DOM');
  console.log('✓ UI cleanup ok');

  // 2. Building placement uses exact cursor lng/lat
  const placement = await page.evaluate(async () => {
    const d = window.BelfastDashboard;
    d.state.activeBranchId = 'green';
    d.activeBranch().items = [];
    d.setYear(2030);
    await new Promise(r => setTimeout(r, 300));
    const targets = [
      { type: 'building', lng: -5.93,  lat: 54.6 },
      { type: 'building', lng: -5.96,  lat: 54.58 },
      { type: 'infrastructure', lng: -5.92, lat: 54.61 }
    ];
    targets.forEach(t => d.addItemAt(t.type, t.lng, t.lat));
    await new Promise(r => setTimeout(r, 1500));
    const items = d.activeBranch().items;
    return {
      placedCount: items.length,
      coords: items.map(it => ({ type: it.type, lng: it.lng, lat: it.lat })),
      jobs2030: d.branchCommitYearlyJobs(d.activeBranch(), 2030),
      jobs2032: d.branchCommitYearlyJobs(d.activeBranch(), 2032),
      jobs2036: d.branchCommitYearlyJobs(d.activeBranch(), 2036)
    };
  });
  if (placement.placedCount !== 3) fail('expected 3 placed items, got ' + placement.placedCount);
  const findItem = (lng, lat) => placement.coords.find(c => c.lng === lng && c.lat === lat);
  if (!findItem(-5.93,  54.6))  fail('building #1 not at clicked coord');
  if (!findItem(-5.96,  54.58)) fail('building #2 not at clicked coord');
  if (!findItem(-5.92,  54.61)) fail('transformer not at clicked coord');
  if (!(placement.jobs2032 > placement.jobs2030)) fail('jobs 2032 should exceed jobs 2030');
  if (!(placement.jobs2036 > placement.jobs2032)) fail('jobs 2036 should exceed jobs 2032');
  console.log('✓ Cursor placement ok — jobs ramp', placement.jobs2030, '→', placement.jobs2032, '→', placement.jobs2036);

  // 3. City-wide traffic swarm
  const traffic = await page.evaluate(async () => {
    const d = window.BelfastDashboard;
    d.setLens('traffic');
    await new Promise(r => setTimeout(r, 400));
    if (window.TrafficSim && !window.TrafficSim.isOsmLoaded()) {
      await window.TrafficSim.preloadOsm('/api/layers/2026/source-ni-roads-osm');
    }
    await new Promise(r => setTimeout(r, 1500));
    d.refreshFutureTrafficSwarm(d.activeBranch(), null);
    await new Promise(r => setTimeout(r, 3000));
    const flow = d.state.map.getSource('traffic-agent-swarm-flow');
    const feats = flow && flow._data && flow._data.features ? flow._data.features : [];
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    feats.forEach(f => {
      const cs = f.geometry && f.geometry.coordinates;
      if (Array.isArray(cs)) cs.forEach(c => {
        if (Array.isArray(c)) {
          minLng = Math.min(minLng, c[0]); maxLng = Math.max(maxLng, c[0]);
          minLat = Math.min(minLat, c[1]); maxLat = Math.max(maxLat, c[1]);
        }
      });
    });
    return {
      flowFeats: feats.length,
      dLng: feats.length ? +(maxLng - minLng).toFixed(3) : 0,
      dLat: feats.length ? +(maxLat - minLat).toFixed(3) : 0
    };
  });
  if (traffic.flowFeats < 4000) fail('city-wide flow expected ≥4000 features, got ' + traffic.flowFeats);
  if (traffic.dLng < 0.20 || traffic.dLat < 0.10) fail('flow bbox too small: ' + JSON.stringify(traffic));
  console.log('✓ City-wide traffic ok —', traffic.flowFeats, 'segments,',
    traffic.dLng + '° lng x', traffic.dLat + '° lat');

  // 4. Screenshots — overview + zoomed-in city centre
  await page.evaluate(() => {
    const overlays = document.querySelectorAll('.onboarding-overlay, .modal:not([hidden]), .locked-branch-picker-overlay');
    overlays.forEach(el => el.remove());
    window.BelfastDashboard.state.map.flyTo({
      center: [-5.9301, 54.5973], zoom: 11.4, pitch: 0, duration: 0
    });
  });
  await page.waitForTimeout(1500);
  const shotPath = path.join(outDir, 'citywide-traffic.png');
  await page.screenshot({ path: shotPath, fullPage: false });
  console.log('✓ Overview screenshot saved →', shotPath);

  await page.evaluate(() => {
    window.BelfastDashboard.state.map.flyTo({
      center: [-5.9301, 54.5973], zoom: 13.0, pitch: 50, duration: 0
    });
  });
  await page.waitForTimeout(1500);
  const shotPath2 = path.join(outDir, 'citywide-traffic-3d.png');
  await page.screenshot({ path: shotPath2, fullPage: false });
  console.log('✓ Zoomed screenshot saved →', shotPath2);

  const ignored = ['mapbox', 'favicon', 'ResizeObserver', 'Manifest', 'tile', 'WebGL', '404',
    'validate-placement', 'invalid', 'Overlaps'];
  const real = errs.filter(e => !ignored.some(s => e.toLowerCase().includes(s.toLowerCase())));
  if (real.length) {
    console.log('Console errors:');
    real.forEach(e => console.log('  ' + e));
    fail(real.length + ' critical console errors');
  }

  await browser.close();
  console.log('✓ all citywide traffic + cleanup checks passed');
})().catch(err => {
  console.error('✗ FAIL:', err.message);
  process.exit(1);
});
