// Verifies animated particles render for jobs/electricity/public-transit lenses.
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

  await page.evaluate(() => {
    const d = window.BelfastDashboard;
    d.setYear(2030);
  });
  await page.waitForTimeout(1200);

  for (const lens of ['jobs', 'electricity', 'services']) {
    const before = await page.evaluate((l) => {
      const d = window.BelfastDashboard;
      d.setLens(l);
      return d.state.lens;
    }, lens);
    if (before !== lens) fail(`failed to set lens ${lens}, got ${before}`);
    await page.waitForTimeout(2500);

    // Sample particles three times to ensure they animate (alpha changes)
    const samples = await page.evaluate(async () => {
      const samples = [];
      for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 350));
        const src = window.BelfastDashboard.state.map.getSource('lens-particles');
        const feats = src && src._data && src._data.features ? src._data.features : [];
        const alphaSum = feats.reduce((s,f)=>s+(f.properties.alpha||0),0);
        samples.push({
          n: feats.length,
          avgAlpha: feats.length ? alphaSum / feats.length : 0,
          color: feats[0]?.properties?.color
        });
      }
      return samples;
    });
    const counts = samples.map(s => s.n);
    const avgAlphas = samples.map(s => s.avgAlpha.toFixed(2));
    const color = samples[0].color;
    if (!counts.every(n => n > 100)) fail(`${lens}: too few particles ${counts.join(',')}`);
    // alphas should differ across samples — that's the breathing animation
    if (avgAlphas[0] === avgAlphas[1] && avgAlphas[1] === avgAlphas[2]) {
      fail(`${lens}: alphas all identical, no animation detected: ${avgAlphas.join(',')}`);
    }
    console.log(`✓ ${lens}: ${counts.join('/')} particles, color=${color}, alphas=${avgAlphas.join(',')}`);

    // Position the map for screenshot
    await page.evaluate(() => {
      window.BelfastDashboard.state.map.flyTo({
        center: [-5.9301, 54.5973], zoom: 11.4, pitch: 0, duration: 0
      });
    });
    await page.waitForTimeout(1200);
    const shotPath = path.join(outDir, `lens-particles-${lens}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    console.log(`✓ Saved ${shotPath}`);
  }

  await browser.close();
  console.log('✓ all lens particle checks passed');
})().catch(err => {
  console.error('✗ FAIL:', err.message);
  process.exit(1);
});
