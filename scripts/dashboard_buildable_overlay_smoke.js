// Verifies the city-wide buildable-sites overlay renders the moment the
// Buildings tool is selected — no postcode search required.
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
  await page.addInitScript(() => {
    try { localStorage.setItem('belfastOnboardingV1Done', '1'); } catch (_) {}
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => !!window.BelfastDashboard, null, { timeout: 30000 });
  await page.waitForFunction(() => window.BelfastDashboard.state.mapLoaded === true, null, { timeout: 30000 });

  // Click the Buildings tool — no postcode entered first.
  await page.evaluate(() => document.querySelector('.tool-btn[data-tool="building"]').click());
  await page.waitForFunction(
    () => window.BelfastDashboard.state.activeTool === 'building',
    null,
    { timeout: 5000 }
  );
  // Wait for the city-wide buildable areas to land. The async fetch can take
  // a few seconds the first time round.
  await page.waitForFunction(() => {
    const src = window.BelfastDashboard.state.map.getSource('buildability-areas');
    const data = src && src._data;
    return data && Array.isArray(data.features) && data.features.length > 0;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(1500);

  const summary = await page.evaluate(() => {
    const d = window.BelfastDashboard;
    const src = d.state.map.getSource('buildability-areas');
    const feats = src && src._data && src._data.features ? src._data.features : [];
    const buildable = feats.filter(f => f.properties && f.properties.buildable === true);
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    buildable.forEach(f => {
      const cs = f.geometry && f.geometry.coordinates && f.geometry.coordinates[0];
      if (Array.isArray(cs)) cs.forEach(c => {
        if (Array.isArray(c)) {
          minLng = Math.min(minLng, c[0]); maxLng = Math.max(maxLng, c[0]);
          minLat = Math.min(minLat, c[1]); maxLat = Math.max(maxLat, c[1]);
        }
      });
    });
    return {
      activeTool: d.state.activeTool,
      year: d.state.year,
      mode: d.state.mode,
      selectedPostcode: !!d.state.selectedPostcode,
      total: feats.length,
      buildable: buildable.length,
      fillVisibility: d.state.map.getLayoutProperty('buildability-areas-fill', 'visibility'),
      bbox: buildable.length ? {
        dLng: +(maxLng - minLng).toFixed(3),
        dLat: +(maxLat - minLat).toFixed(3)
      } : null
    };
  });
  if (summary.selectedPostcode) fail('postcode should not be required');
  if (summary.activeTool !== 'building') fail('Building tool not active');
  if (summary.mode !== 'simulation') fail('Should auto-jump to simulation mode');
  if (summary.buildable < 30) fail('expected city-wide coverage (>=30 buildable cells), got ' + summary.buildable);
  if (summary.fillVisibility !== 'visible') fail('buildability-areas-fill should be visible, got ' + summary.fillVisibility);
  if (!summary.bbox || summary.bbox.dLng < 0.10 || summary.bbox.dLat < 0.05) {
    fail('buildable bbox too small to be city-wide: ' + JSON.stringify(summary.bbox));
  }
  console.log('✓ City-wide buildable overlay live — ' + summary.buildable + '/' + summary.total +
    ' cells, ' + summary.bbox.dLng + '° lng × ' + summary.bbox.dLat + '° lat span');

  // Switch preset and verify the overlay re-loads
  const sw = await page.evaluate(async () => {
    const d = window.BelfastDashboard;
    d.state.activeBuildingPreset = 'commercial';
    d.state.buildabilityLoaded = false;
    // Trigger via the preset button click
    const btn = document.querySelector('.preset-btn[data-preset="commercial"]');
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 4000));
    const src = d.state.map.getSource('buildability-areas');
    const feats = src && src._data && src._data.features ? src._data.features : [];
    return {
      preset: d.state.activeBuildingPreset,
      buildable: feats.filter(f => f.properties && f.properties.buildable === true).length
    };
  });
  if (sw.preset !== 'commercial') fail('preset switch failed');
  if (sw.buildable < 5) fail('commercial preset should still surface buildable sites, got ' + sw.buildable);
  console.log('✓ Preset switch (commercial) re-scored buildable sites — ' + sw.buildable + ' cells');

  // Screenshot
  await page.evaluate(() => {
    window.BelfastDashboard.state.map.flyTo({
      center: [-5.9301, 54.5973], zoom: 11.4, pitch: 0, duration: 0
    });
  });
  await page.waitForTimeout(1500);
  const shot = path.join(outDir, 'buildable-overlay.png');
  await page.screenshot({ path: shot, fullPage: false });
  console.log('✓ Screenshot →', shot);

  await browser.close();
  console.log('✓ all city-wide buildable checks passed');
})().catch(err => {
  console.error('✗ FAIL:', err.message);
  process.exit(1);
});
