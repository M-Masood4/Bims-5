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
  await page.waitForSelector(".metric-card", { state: "attached", timeout: 30000 });
  await page.waitForSelector(".commit", { timeout: 30000 });

  const loaded = await page.evaluate(() => ({
    metricCards: document.querySelectorAll(".metric-card").length,
    lensTabs: document.querySelectorAll(".lens-tab").length,
    commits: document.querySelectorAll(".commit").length,
    toggles: document.querySelectorAll(".switch-row").length,
    navButtons: document.querySelectorAll(".icon-nav button[data-view]").length,
    layout: Boolean(document.querySelector(".topbar") && !document.querySelector(".icon-nav") && document.querySelector(".bottom-deck") && document.querySelector(".selected-card")),
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
  assert(loaded.commits === 5, "Default change list should show all infrastructure changes.");
  assert(loaded.toggles >= 3, "Filtered product layer toggles did not render.");
  assert(loaded.navButtons === 0, "Left product navigation should be removed.");
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

  await page.locator("#studioTool").click();
  await page.waitForFunction(() => window.BelfastGitModeA?.state?.activeView === "studio");
  await page.waitForFunction(() => document.querySelector("#scenarioStudio")?.textContent?.includes("2036 Scenario Studio"));
  await page.locator("#scenarioStudio [data-studio-action='add-building']").click();
  await page.waitForFunction(() => window.BelfastScenarioStudio?.state?.placing === true);
  const studioDropPoint = await page.evaluate(() => {
    const { state } = window.BelfastGitModeA;
    const point = state.map.project([-5.905, 54.607]);
    return { x: point.x, y: point.y };
  });
  await page.mouse.click(studioDropPoint.x, studioDropPoint.y);
  await page.waitForFunction(() => Boolean(window.BelfastScenarioStudio?.state?.validation));
  await page.waitForFunction(() => document.querySelector("#scenarioStudio")?.textContent?.includes("Placement status"));
  await page.waitForFunction(() => {
    const source = window.BelfastGitModeA?.state?.map?.getSource("studio-building-handles");
    return Boolean(source && window.BelfastScenarioStudio?.state?.geometry);
  });
  await page.locator("#studioTool").click();
  await page.waitForFunction(() => window.BelfastGitModeA?.state?.activeView === "overview");

  await page.locator('[data-change-filter="building"]').click();
  await page.waitForFunction(() => window.BelfastGitModeA?.state?.changeFilter === "building");
  await page.waitForFunction(() => document.querySelectorAll(".commit").length === 1);
  await page.locator('[data-change-filter="employment"]').click();
  await page.waitForFunction(() => window.BelfastGitModeA?.state?.changeFilter === "employment");
  await page.waitForFunction(() => document.querySelectorAll(".commit").length === 1);
  await page.locator('[data-change-filter="all"]').click();
  await page.waitForFunction(() => document.querySelectorAll(".commit").length === 5);

  const electricityCounts = await page.evaluate(async () => {
    const [a, b] = await Promise.all([
      fetch("/data/mode-a/electricity_2016.geojson", { cache: "no-store" }).then((response) => response.json()),
      fetch("/data/mode-a/electricity_2026.geojson", { cache: "no-store" }).then((response) => response.json())
    ]);
    return {
      y2016: a.features.length,
      y2026: b.features.length,
      dated: b.features.filter((feature) => feature.properties?.visibility_basis === "OSM metadata timestamp").length,
      later: b.features.filter((feature) => (feature.properties?.replay_first_visible_year || 2016) > 2016).length
    };
  });
  assert(electricityCounts.y2026 >= electricityCounts.y2016, "Electricity features should grow or hold steady over time.");
  assert(electricityCounts.dated > 0, "Electricity layer should include Overpass timestamp-backed assets.");
  assert(electricityCounts.later > 0, "Electricity layer should include post-2016 mapped appearances.");

  await page.locator("#fitTool").click();
  await page.locator("#playButton").click();
  await page.waitForTimeout(1200);
  await page.locator("#playButton").click();
  await page.locator(".lens-tab", { hasText: "Traffic" }).click();
  await page.waitForFunction(() => window.BelfastGitModeA?.state?.metric === "traffic");

  await page.locator("#yearSlider").evaluate((slider) => {
    slider.value = "2023";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector("#currentYearLabel")?.textContent?.trim() === "2023");
  await page.locator(".commit", { hasText: "Road / corridor change" }).first().click();
  await page.waitForFunction(() => window.BelfastGitModeA?.state?.selectedCommit?.type === "traffic");
  await page.waitForFunction(() => document.querySelectorAll("button[data-cell-id]").length >= 20);
  await page.locator("[data-impact-metric='electricity']").click();
  await page.waitForFunction(() => window.BelfastGitModeA?.state?.metric === "electricity");
  await page.locator("[data-impact-metric='buildings']").click();
  await page.waitForFunction(() => window.BelfastGitModeA?.state?.metric === "buildings");
  await page.locator("[data-impact-metric='traffic']").click();
  await page.waitForFunction(() => document.querySelector("#selectedChange")?.textContent?.includes("Impact table"));
  await page.locator("button[data-cell-id]").first().click();
  await page.waitForFunction(() => Boolean(window.BelfastGitModeA?.state?.selectedCellId));
  await page.waitForFunction(() => document.querySelector("#selectedChange")?.textContent?.includes("Changes affecting this cell"));
  await page.locator("#resetSelection").click();
  await page.waitForFunction(() => !window.BelfastGitModeA?.state?.selectedCommit && !window.BelfastGitModeA?.state?.selectedCellId);
  await page.waitForFunction(() => document.querySelector("#evidencePanel")?.textContent?.toLowerCase().includes("evidence"));
  const clickPoint = await page.evaluate(async () => {
    const grid = await fetch("/data/mode-a/grid_2023.geojson", { cache: "no-store" }).then((response) => response.json());
    const feature = grid.features[120] || grid.features[0];
    const coords = [];
    const walk = (node) => {
      if (!Array.isArray(node)) return;
      if (typeof node[0] === "number" && typeof node[1] === "number") {
        coords.push(node);
      } else {
        node.forEach(walk);
      }
    };
    walk(feature.geometry.coordinates);
    const lon = coords.reduce((sum, item) => sum + item[0], 0) / coords.length;
    const lat = coords.reduce((sum, item) => sum + item[1], 0) / coords.length;
    const { state } = window.BelfastGitModeA;
    state.map.jumpTo({ center: [lon, lat], zoom: 13.4, pitch: 44, bearing: -20 });
    const point = state.map.project([lon, lat]);
    return { x: point.x, y: point.y, cellId: feature.properties.cell_id };
  });
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await page.waitForFunction((cellId) => window.BelfastGitModeA?.state?.selectedCellId === cellId, clickPoint.cellId);
  await page.waitForFunction(() => document.querySelector("#selectedChange")?.textContent?.includes("Selected grid cell"));
  await page.locator("#resetSelection").click();
  await page.waitForFunction(() => !window.BelfastGitModeA?.state?.selectedCellId);
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
