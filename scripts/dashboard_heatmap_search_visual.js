// Verify the smooth city-wide heatmap + postcode search.
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
  await page.waitForTimeout(1500);

  await page.click(".nav-btn[data-mode-tab='historical']");
  await page.waitForFunction(() => window.BelfastDashboard.state.mode === "historical");

  // Traffic — should now blanket the map green→red, no discrete dots
  await page.evaluate(() => { window.BelfastDashboard.setView("2D"); window.BelfastDashboard.setLens("traffic"); window.BelfastDashboard.setYear(2024); });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, "30-traffic-blanket-heatmap.png") });
  console.log("✓ 30-traffic-blanket-heatmap.png");

  // Jobs blanket
  await page.evaluate(() => window.BelfastDashboard.setLens("jobs"));
  await page.waitForTimeout(2200);
  await page.screenshot({ path: path.join(outDir, "31-jobs-blanket-heatmap.png") });
  console.log("✓ 31-jobs-blanket-heatmap.png");

  // Postcode search BT1 (Belfast city centre)
  await page.evaluate(() => window.BelfastDashboard.setLens("traffic"));
  await page.waitForTimeout(800);
  await page.fill("#postcodeInput", "BT1");
  await page.click("#postcodeForm button[type='submit']");
  await page.waitForTimeout(2200);
  await page.screenshot({ path: path.join(outDir, "32-search-BT1.png") });
  console.log("✓ 32-search-BT1.png");

  // Postcode search BT9 (Stranmillis area)
  await page.fill("#postcodeInput", "BT9");
  await page.click("#postcodeForm button[type='submit']");
  await page.waitForTimeout(2200);
  await page.screenshot({ path: path.join(outDir, "33-search-BT9.png") });
  console.log("✓ 33-search-BT9.png");

  // Test suggestion list with partial input
  await page.fill("#postcodeInput", "Belfast");
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outDir, "34-search-suggestions.png") });
  console.log("✓ 34-search-suggestions.png");

  await browser.close();
  console.log("\nSaved to", outDir);
})();
