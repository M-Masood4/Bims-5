// Per-lens visual proof: smooth heatmaps + year-filtered buildings + GRID hotspots.
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

  // Buildings 2D — year 2018 (early)
  await page.evaluate(() => { window.BelfastDashboard.setView("2D"); window.BelfastDashboard.setLens("buildings"); window.BelfastDashboard.setYear(2018); });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, "23-buildings-2018.png") });
  console.log("✓ 23-buildings-2018.png");

  // Buildings 2D — year 2024 (more buildings now)
  await page.evaluate(() => window.BelfastDashboard.setYear(2024));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, "24-buildings-2024.png") });
  console.log("✓ 24-buildings-2024.png");

  // Buildings 3D — year 2024 — newly visible buildings highlighted yellow
  await page.evaluate(() => window.BelfastDashboard.setView("3D"));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, "25-buildings-3d-2024.png") });
  console.log("✓ 25-buildings-3d-2024.png");

  // Traffic continuous heatmap
  await page.evaluate(() => { window.BelfastDashboard.setView("2D"); window.BelfastDashboard.setLens("traffic"); window.BelfastDashboard.setYear(2024); });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: path.join(outDir, "26-traffic-heatmap.png") });
  console.log("✓ 26-traffic-heatmap.png");

  // Jobs continuous heatmap
  await page.evaluate(() => window.BelfastDashboard.setLens("jobs"));
  await page.waitForTimeout(2200);
  await page.screenshot({ path: path.join(outDir, "27-jobs-heatmap.png") });
  console.log("✓ 27-jobs-heatmap.png");

  // Services continuous heatmap
  await page.evaluate(() => window.BelfastDashboard.setLens("services"));
  await page.waitForTimeout(2200);
  await page.screenshot({ path: path.join(outDir, "28-services-heatmap.png") });
  console.log("✓ 28-services-heatmap.png");

  // Electricity GRID hotspots
  await page.evaluate(() => window.BelfastDashboard.setLens("electricity"));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, "29-electricity-hotspots.png") });
  console.log("✓ 29-electricity-hotspots.png");

  await browser.close();
  console.log("\nSaved to", outDir);
})();
