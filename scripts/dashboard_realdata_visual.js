// Visual screenshots showing real-data improvements.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const url = process.env.URL || "http://localhost:5173";
const outDir = path.resolve(__dirname, "..", "output", "dashboard");

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.BelfastDashboard?.state?.mapLoaded, null, { timeout: 30000 });
  await page.waitForTimeout(1200);

  // 1. Historical traffic 2024 with real events + RAG heatmap
  await page.click(".nav-btn[data-mode-tab='historical']");
  await page.waitForFunction(() => window.BelfastDashboard.state.mode === "historical");
  await page.evaluate(() => window.BelfastDashboard.setYear(2024));
  await page.waitForFunction(() => (window.BelfastDashboard.state.eventsForYearCache || []).length > 100, null, { timeout: 8000 });
  await page.waitForTimeout(1100);
  await page.screenshot({ path: path.join(outDir, "12-real-traffic-rag-2024.png"), fullPage: false });
  console.log("✓ 12-real-traffic-rag-2024.png");

  // 2. Electricity GRID-style heatmap
  await page.evaluate(() => window.BelfastDashboard.setLens("electricity"));
  await page.waitForFunction(() => {
    const src = window.BelfastDashboard.state.map.getSource("grid-substations");
    return src && (src._data?.features?.length || 0) > 100;
  }, null, { timeout: 8000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, "13-electricity-grid-style.png"), fullPage: false });
  console.log("✓ 13-electricity-grid-style.png");

  // 3. Buildings lens 3D
  await page.evaluate(() => { window.BelfastDashboard.setView("3D"); window.BelfastDashboard.setLens("buildings"); window.BelfastDashboard.setYear(2022); });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(outDir, "14-buildings-3d-rag-2022.png"), fullPage: false });
  console.log("✓ 14-buildings-3d-rag-2022.png");

  // 4. Bottom row collapsed for more 3D space
  await page.click("#collapseBtn");
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, "15-collapsed-3d.png"), fullPage: false });
  console.log("✓ 15-collapsed-3d.png");

  // 5. Switch to traffic + select first event for diff
  await page.evaluate(() => { window.BelfastDashboard.setView("2D"); window.BelfastDashboard.setLens("traffic"); window.BelfastDashboard.setYear(2024); });
  await page.click("#collapseBtn"); // re-expand
  await page.waitForTimeout(800);
  const firstId = await page.evaluate(() => window.BelfastDashboard.state.eventsForYearCache?.[0]?.id);
  if (firstId) {
    await page.evaluate(id => window.BelfastDashboard.selectEvent(id), firstId);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(outDir, "16-real-event-selected.png"), fullPage: false });
    console.log("✓ 16-real-event-selected.png");

    await page.click("#openDiffBtn");
    await page.waitForSelector("#diffMapAfter .mapboxgl-canvas", { timeout: 12000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(outDir, "17-diff-modal-real-event.png"), fullPage: false });
    console.log("✓ 17-diff-modal-real-event.png");
  }

  await browser.close();
  console.log("\nSaved to", outDir);
})();
