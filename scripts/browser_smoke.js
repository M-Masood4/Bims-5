const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "output", "playwright");
const url = process.env.MODE_A_URL || "http://localhost:5173";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".mapboxgl-canvas", { timeout: 30000 });
  await page.waitForFunction(() => window.BelfastGitModeA?.state?.map?.loaded(), null, { timeout: 30000 });
  await page.waitForSelector(".metric-card", { timeout: 30000 });
  await page.waitForSelector(".commit", { timeout: 30000 });

  const loaded = await page.evaluate(() => ({
    metricCards: document.querySelectorAll(".metric-card").length,
    commits: document.querySelectorAll(".commit").length,
    toggles: document.querySelectorAll(".switch-row").length,
    canvas: Boolean(document.querySelector(".mapboxgl-canvas")),
    year: document.querySelector("#currentYearLabel")?.textContent?.trim(),
    cells: window.BelfastGitModeA.state.modeA.cellCount,
    sources: window.BelfastGitModeA.state.modeA.sources.length
  }));
  assert(loaded.canvas, "Mapbox canvas did not render.");
  assert(loaded.metricCards >= 5, "Metric cards did not render.");
  assert(loaded.commits >= 5, "City commits did not render.");
  assert(loaded.toggles >= 7, "Layer toggles did not render.");
  assert(loaded.year === "2026", "Initial year is not 2026.");
  assert(loaded.cells >= 100, "Mode A grid is too small.");
  assert(loaded.sources >= 5, "Source evidence list is too small.");

  await page.locator("#yearSlider").evaluate((slider) => {
    slider.value = "2021";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector("#currentYearLabel")?.textContent?.trim() === "2021");
  await page.locator(".commit").first().click();
  await page.waitForFunction(() => document.querySelector("#evidencePanel")?.textContent?.includes("Evidence"));
  await page.locator("#toggle3d").click();
  await page.waitForTimeout(750);

  await page.screenshot({ path: path.join(outputDir, "mode-a-browser-smoke.png"), fullPage: true });
  await browser.close();

  const filteredErrors = consoleErrors.filter((error) => !/Failed to load resource.*mapbox|favicon/i.test(error));
  assert(filteredErrors.length === 0, `Browser console errors:\n${filteredErrors.join("\n")}`);
  console.log(`Browser smoke OK: ${loaded.metricCards} cards, ${loaded.commits} commits, ${loaded.toggles} toggles, ${loaded.cells} cells.`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
