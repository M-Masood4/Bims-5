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
    lensTabs: document.querySelectorAll(".lens-tab").length,
    commits: document.querySelectorAll(".commit").length,
    toggles: document.querySelectorAll(".switch-row").length,
    layout: Boolean(document.querySelector(".topbar") && document.querySelector(".icon-nav") && document.querySelector(".bottom-deck") && document.querySelector(".selected-card")),
    canvas: Boolean(document.querySelector(".mapboxgl-canvas")),
    year: document.querySelector("#currentYearLabel")?.textContent?.trim(),
    cells: window.BelfastGitModeA.state.modeA.cellCount,
    sources: window.BelfastGitModeA.state.modeA.sources.length,
    metrics: window.BelfastGitModeA.metrics,
    electricity: Boolean(window.BelfastGitModeA.state.map.getLayer("electricity-line")),
    selectionLayer: Boolean(window.BelfastGitModeA.state.map.getLayer("commit-selection-fill"))
  }));
  assert(loaded.canvas, "Mapbox canvas did not render.");
  assert(loaded.layout, "Reference-style replay layout did not render.");
  assert(loaded.metricCards === 5, "Five metric cards did not render.");
  assert(loaded.lensTabs === 5, "Five top lens tabs did not render.");
  assert(loaded.commits === 5, "Five city commits did not render.");
  assert(loaded.toggles === 6, "The six product layer toggles did not render.");
  assert(loaded.electricity, "Electricity replay layer did not render.");
  assert(loaded.selectionLayer, "Commit selection highlight layer did not render.");
  assert(JSON.stringify(loaded.metrics) === JSON.stringify(["traffic", "jobs", "electricity", "buildings", "services"]), "Browser metric registry is not the required five-signal set.");
  assert(loaded.year === "2026", "Initial year is not 2026.");
  assert(loaded.cells >= 100, "Mode A grid is too small.");
  assert(loaded.sources >= 5, "Source evidence list is too small.");

  for (const label of ["Traffic", "Jobs", "Electricity", "Buildings", "Services"]) {
    await page.locator(".lens-tab", { hasText: label }).click();
    await page.waitForFunction((expected) => window.BelfastGitModeA?.state?.metric === expected, label.toLowerCase());
  }

  for (let index = 0; index < 6; index += 1) {
    await page.locator(".switch-row").nth(index).click();
    await page.waitForTimeout(80);
    await page.locator(".switch-row").nth(index).click();
  }

  await page.locator("#darkMap").click();
  await page.waitForFunction(() => window.BelfastGitModeA?.state?.map?.getLayer("mode-a-grid-fill"), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.locator("#lightMap").click();
  await page.waitForFunction(() => window.BelfastGitModeA?.state?.map?.getLayer("mode-a-grid-fill"), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.locator("#fitTool").click();
  await page.locator("#playButton").click();
  await page.waitForTimeout(1200);
  await page.locator("#playButton").click();

  await page.locator("#yearSlider").evaluate((slider) => {
    slider.value = "2023";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector("#currentYearLabel")?.textContent?.trim() === "2023");
  await page.locator(".commit", { hasText: "Traffic" }).click();
  await page.waitForFunction(() => window.BelfastGitModeA?.state?.selectedCommit?.type === "traffic");
  await page.waitForFunction(() => document.querySelector("#selectedChange")?.textContent?.includes("Affected signals"));
  await page.waitForFunction(() => document.querySelector("#evidencePanel")?.textContent?.includes("Evidence"));
  await page.waitForFunction(() => {
    const source = window.BelfastGitModeA?.state?.map?.getSource("commit-selection");
    return Boolean(source && window.BelfastGitModeA.state.selectedCommit);
  });
  await page.locator("#toggle3d").click();
  await page.waitForTimeout(750);
  await page.locator("#toggle3d").click();
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    const { state } = window.BelfastGitModeA;
    state.map.jumpTo({
      center: state.manifest.viewport.center,
      zoom: 11.85,
      pitch: 54,
      bearing: -20
    });
  });
  await page.waitForTimeout(500);

  await page.screenshot({ path: path.join(outputDir, "mode-a-browser-smoke.png"), fullPage: true });
  await browser.close();

  const filteredErrors = consoleErrors.filter((error) => !/Failed to load resource.*mapbox|favicon/i.test(error));
  assert(filteredErrors.length === 0, `Browser console errors:\n${filteredErrors.join("\n")}`);
  console.log(`Browser smoke OK: ${loaded.metricCards} cards, ${loaded.lensTabs} lens tabs, ${loaded.commits} commits, ${loaded.toggles} toggles, ${loaded.cells} cells.`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
