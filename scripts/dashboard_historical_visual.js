// Visual screenshots for historical mode + diff modal.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const url = process.env.URL || "http://localhost:5173";
const outDir = path.resolve(__dirname, "..", "output", "dashboard");

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", e => console.log("pageerror:", e.message));

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.BelfastDashboard?.state?.mapLoaded, null, { timeout: 30000 });
  await page.waitForTimeout(1200);

  // 1. Switch to historical mode (default lens=traffic, year=2026)
  await page.click(".nav-btn[data-mode-tab='historical']");
  await page.waitForFunction(() => window.BelfastDashboard.state.mode === "historical");
  await page.evaluate(() => window.BelfastDashboard.setYear(2024));
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outDir, "07-historical-traffic-2024.png"), fullPage: false });
  console.log("✓ 07-historical-traffic-2024.png");

  // 2. Buildings lens at 2020 (3D)
  await page.evaluate(() => { window.BelfastDashboard.setView("3D"); window.BelfastDashboard.setLens("buildings"); window.BelfastDashboard.setYear(2020); });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: path.join(outDir, "08-historical-buildings-2020-3d.png"), fullPage: false });
  console.log("✓ 08-historical-buildings-2020-3d.png");

  // 3. Electricity lens at 2024 (2D)
  await page.evaluate(() => { window.BelfastDashboard.setView("2D"); window.BelfastDashboard.setLens("electricity"); window.BelfastDashboard.setYear(2024); });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outDir, "09-historical-electricity-2024.png"), fullPage: false });
  console.log("✓ 09-historical-electricity-2024.png");

  // 4. Select an event in 2016 traffic, open diff modal
  await page.evaluate(() => { window.BelfastDashboard.setLens("traffic"); window.BelfastDashboard.setYear(2016); });
  await page.waitForTimeout(700);
  const firstEventId = await page.evaluate(() => window.BelfastDashboard.eventsForCurrentYearAndLens()[0]?.id);
  if (firstEventId) {
    await page.evaluate((id) => window.BelfastDashboard.selectEvent(id), firstEventId);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(outDir, "10-historical-event-selected.png"), fullPage: false });
    console.log("✓ 10-historical-event-selected.png");

    // Open diff modal
    await page.click("#openDiffBtn");
    await page.waitForSelector("#diffMapAfter .mapboxgl-canvas", { timeout: 12000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, "11-diff-modal.png"), fullPage: false });
    console.log("✓ 11-diff-modal.png");
  }

  await browser.close();
  console.log("\nAll screenshots saved to", outDir);
})();
