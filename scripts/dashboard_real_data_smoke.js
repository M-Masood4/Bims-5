// Smoke for the new real-data features:
//   - real /api/events (>50 per year, real titles like "Belfast Grand Central Station opened")
//   - GRID-style electricity substation heatmap
//   - red→amber→green RAG cell heatmap
//   - collapse bottom row toggle
const { chromium } = require("playwright");
const url = process.env.URL || "http://localhost:5173";
function fail(m) { throw new Error(m); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", r => { if (r.status() >= 400) console.log("  HTTP " + r.status() + " " + r.url()); });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.BelfastDashboard?.state?.mapLoaded, null, { timeout: 30000 });

  // Endpoint check directly
  console.log("→ probe /api/events?year=2024&signal=traffic");
  const total = await page.evaluate(async () => {
    const r = await fetch('/api/events?year=2024&signal=traffic&limit=1');
    return (await r.json()).total;
  });
  if (total < 1000) fail("expected >1000 real traffic events for 2024, got " + total);
  console.log("  → " + total + " real traffic events");

  // Switch to historical
  await page.click(".nav-btn[data-mode-tab='historical']");
  await page.waitForFunction(() => window.BelfastDashboard.state.mode === "historical");

  // Real events for traffic at 2024
  await page.evaluate(() => window.BelfastDashboard.setYear(2024));
  await page.waitForFunction(() => (window.BelfastDashboard.state.eventsForYearCache || []).length > 100, null, { timeout: 8000 });

  // Electricity lens — substation source should populate
  console.log("→ switch to electricity, year 2024");
  await page.evaluate(() => { window.BelfastDashboard.setLens("electricity"); window.BelfastDashboard.setYear(2024); });
  await page.waitForFunction(() => {
    const src = window.BelfastDashboard.state.map.getSource("grid-substations");
    return src && src._data && (src._data.features?.length || 0) > 100;
  }, null, { timeout: 8000 });
  const subCount = await page.evaluate(() => window.BelfastDashboard.state.map.getSource("grid-substations")._data.features.length);
  console.log("  → " + subCount + " substations on map");
  // Layers visible
  const layersVisible = await page.evaluate(() => {
    const m = window.BelfastDashboard.state.map;
    return ["grid-substations-bleed", "grid-substations-mid", "grid-substations-core"].map(id => m.getLayoutProperty(id, "visibility") || "visible");
  });
  if (!layersVisible.every(v => v === "visible")) fail("grid layers not all visible: " + JSON.stringify(layersVisible));

  // Switch back to traffic — grid layers should hide
  await page.evaluate(() => window.BelfastDashboard.setLens("traffic"));
  await page.waitForTimeout(400);
  const layersHidden = await page.evaluate(() => {
    const m = window.BelfastDashboard.state.map;
    return ["grid-substations-bleed", "grid-substations-mid", "grid-substations-core"].map(id => m.getLayoutProperty(id, "visibility"));
  });
  if (!layersHidden.every(v => v === "none")) fail("grid layers should be hidden on non-electricity lens: " + JSON.stringify(layersHidden));

  // Collapse bottom row
  console.log("→ toggle collapse");
  const beforeMapHeight = await page.$eval("#map", el => el.getBoundingClientRect().height);
  await page.click("#collapseBtn");
  await page.waitForTimeout(350);
  const afterMapHeight = await page.$eval("#map", el => el.getBoundingClientRect().height);
  if (afterMapHeight <= beforeMapHeight) fail("map should grow when bottom collapsed: " + beforeMapHeight + " → " + afterMapHeight);
  console.log("  → map height " + beforeMapHeight.toFixed(0) + " → " + afterMapHeight.toFixed(0));
  // Bottom panels actually hidden
  const visiblePanels = await page.$$eval(".main > .panel", els => els.filter(e => e.offsetParent !== null).length);
  if (visiblePanels !== 4) fail("expected 4 visible top-row panels when collapsed, got " + visiblePanels);

  // Toggle back
  await page.click("#collapseBtn");
  await page.waitForTimeout(350);
  const restoredHeight = await page.$eval("#map", el => el.getBoundingClientRect().height);
  if (Math.abs(restoredHeight - beforeMapHeight) > 5) fail("map height did not restore: " + beforeMapHeight + " vs " + restoredHeight);

  if (errors.length) {
    console.log("Console errors:");
    errors.forEach(e => console.log("  " + e));
    fail(errors.length + " console errors");
  }
  console.log("✓ All real-data smoke tests passed");
  await browser.close();
})().catch(e => { console.error("✗ FAIL:", e.message); process.exit(1); });
