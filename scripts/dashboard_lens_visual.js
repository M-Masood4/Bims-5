// Visual confirmation: each lens shows its real geometry, no event dots on map.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const url = process.env.URL || "http://localhost:53496";
const outDir = path.resolve(__dirname, "..", "output", "dashboard");

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", e => console.log("pageerror:", e.message));

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.BelfastDashboard?.state?.mapLoaded, null, { timeout: 30000 });
  await page.waitForTimeout(1200);

  await page.click(".nav-btn[data-mode-tab='historical']");
  await page.waitForFunction(() => window.BelfastDashboard.state.mode === "historical");

  // Buildings 2D — should show building footprints (not blue event dots)
  await page.evaluate(() => { window.BelfastDashboard.setView("2D"); window.BelfastDashboard.setLens("buildings"); window.BelfastDashboard.setYear(2024); });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, "18-buildings-2d-footprints.png") });
  console.log("✓ 18-buildings-2d-footprints.png");

  // Buildings 3D — extruded
  await page.evaluate(() => window.BelfastDashboard.setView("3D"));
  await page.waitForTimeout(2200);
  await page.screenshot({ path: path.join(outDir, "19-buildings-3d-extrusions.png") });
  console.log("✓ 19-buildings-3d-extrusions.png");

  // Traffic — real road network, no event dots
  await page.evaluate(() => { window.BelfastDashboard.setView("2D"); window.BelfastDashboard.setLens("traffic"); });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: path.join(outDir, "20-traffic-roads.png") });
  console.log("✓ 20-traffic-roads.png");

  // Jobs — services + transport stops
  await page.evaluate(() => window.BelfastDashboard.setLens("jobs"));
  await page.waitForTimeout(2200);
  await page.screenshot({ path: path.join(outDir, "21-jobs-services-transport.png") });
  console.log("✓ 21-jobs-services-transport.png");

  // Click an event from the side panel — should zoom to that area
  await page.evaluate(() => { window.BelfastDashboard.setLens("traffic"); });
  await page.waitForTimeout(1200);
  const firstId = await page.evaluate(() => window.BelfastDashboard.state.eventsForYearCache?.[0]?.id);
  if (firstId) {
    await page.evaluate(id => window.BelfastDashboard.selectEvent(id), firstId);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, "22-event-click-zoom.png") });
    console.log("✓ 22-event-click-zoom.png");
  }

  await browser.close();
  console.log("\nSaved to", outDir);
})();
