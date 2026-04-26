// Current Belfast 2016-2036 dashboard smoke.
// Verifies the live DOM shell, timeline, tools, branch CRUD, impact panel,
// compare modal, 3D toggle, and scenario diff affordance.
const { chromium } = require("playwright");

const url = process.env.URL || "http://localhost:5173";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push("pageerror: " + error.message));
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch (_error) {}
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.BelfastDashboard?.state), null, { timeout: 30000 });
  await page.waitForSelector(".mapboxgl-canvas", { timeout: 30000 });
  await page.waitForFunction(() => window.BelfastDashboard.state.mapLoaded, null, { timeout: 30000 });
  await page.evaluate(() => window.BelfastDashboard.setYear(2026));
  await page.waitForFunction(() => document.querySelector("#tlYearNow")?.textContent === "2026", null, { timeout: 10000 });

  const structure = await page.evaluate(() => ({
    timelineDots: document.querySelectorAll("#timelineDots .t-dot").length,
    tools: Array.from(document.querySelectorAll("#modifyList .tool-btn")).map((button) => button.getAttribute("data-tool")),
    presets: document.querySelectorAll("#presetGrid .preset-btn").length,
    lensTabs: Array.from(document.querySelectorAll(".lens-tab")).map((button) => button.getAttribute("data-lens")),
    branchOptions: document.querySelectorAll("#branchSelect option").length,
    impactCards: document.querySelectorAll("#impactStack .metric-card").length,
    initialYear: document.querySelector("#tlYearNow")?.textContent?.trim()
  }));
  assert(structure.timelineDots === 21, `expected 21 timeline dots, got ${structure.timelineDots}`);
  for (const tool of ["select", "building", "road", "infrastructure", "remove"]) {
    assert(structure.tools.includes(tool), `missing tool ${tool}`);
  }
  for (const lens of ["buildings", "traffic", "jobs", "electricity", "services"]) {
    assert(structure.lensTabs.includes(lens), `missing lens ${lens}`);
  }
  assert(structure.presets >= 4, `expected building presets, got ${structure.presets}`);
  assert(structure.branchOptions >= 4, `expected default branches, got ${structure.branchOptions}`);
  assert(structure.impactCards >= 5, `expected impact metric cards, got ${structure.impactCards}`);
  assert(structure.initialYear === "2026", `expected year 2026, got ${structure.initialYear}`);

  await page.evaluate(() => window.BelfastDashboard.createBranch("Smoke Test Branch", "#ec4899", "baseline"));
  await page.waitForFunction(() => window.BelfastDashboard.activeBranch().name === "Smoke Test Branch", null, { timeout: 5000 });
  await page.evaluate(() => window.BelfastDashboard.addItemAt("building", -5.93, 54.6));
  await page.evaluate(() => window.BelfastDashboard.addItemAt("park", -5.928, 54.601));
  await page.evaluate(() => window.BelfastDashboard.addItemAt("infrastructure", -5.932, 54.599));
  const branchState = await page.evaluate(() => ({
    itemCount: window.BelfastDashboard.activeBranch().items.length,
    itemTypes: window.BelfastDashboard.activeBranch().items.map((item) => item.type),
    listText: document.querySelector("#branchList")?.textContent || "",
    metrics: window.BelfastDashboard.metricsForBranchYear(window.BelfastDashboard.activeBranch(), 2036)
  }));
  assert(branchState.itemCount >= 3, `expected staged items, got ${branchState.itemCount}`);
  for (const type of ["building", "park", "infrastructure"]) {
    assert(branchState.itemTypes.includes(type), `branch is missing staged ${type} item`);
  }
  assert(branchState.listText.length > 0, "branch additions panel did not render");
  assert(branchState.metrics.population > 343000, "staged building did not affect forecast population");

  await page.evaluate(() => window.BelfastDashboard.setYear(2036));
  await page.waitForFunction(() => document.querySelector("#tlYearNow")?.textContent === "2036", null, { timeout: 10000 });
  await page.evaluate(() => window.BelfastDashboard.openCompareModal());
  await page.waitForSelector("#compareModal:not([hidden])", { timeout: 5000 });
  const compareText = await page.locator("#compareBody").textContent();
  assert(/Smoke Test Branch|Baseline/.test(compareText || ""), "compare modal did not include branch context");
  await page.click("#compareModal .modal-close");
  await page.waitForFunction(() => document.querySelector("#compareModal").hasAttribute("hidden"), null, { timeout: 5000 });

  await page.evaluate(() => window.BelfastDashboard.setView("3D"));
  await page.waitForFunction(() => window.BelfastDashboard.state.view === "3D", null, { timeout: 5000 });
  const viewActive = await page.locator(".map-ctrl-btn[data-view='3D']").evaluate((button) => button.classList.contains("active"));
  assert(viewActive, "3D map control did not activate");

  const disabledDiff = await page.locator("#scenarioDiffBtn").isDisabled();
  assert(!disabledDiff, "scenario diff button is disabled for a branch with staged interventions");

  const itemId = await page.evaluate(() => {
    const items = window.BelfastDashboard.activeBranch().items;
    return items[items.length - 1]?.id;
  });
  assert(itemId, "could not find a staged item to remove");
  await page.evaluate((id) => window.BelfastDashboard.removeItem(id), itemId);
  const afterRemove = await page.evaluate(() => window.BelfastDashboard.activeBranch().items.length);
  assert(afterRemove === branchState.itemCount - 1, `expected one item removed, got ${branchState.itemCount} -> ${afterRemove}`);

  await page.evaluate(() => {
    window.confirm = () => true;
    window.BelfastDashboard.deleteBranch(window.BelfastDashboard.activeBranch().id);
  });
  const finalBranch = await page.evaluate(() => window.BelfastDashboard.activeBranch().id);
  assert(finalBranch === "baseline", `expected fallback to baseline, got ${finalBranch}`);

  const filteredErrors = consoleErrors.filter((error) => !/Failed to load resource.*mapbox|favicon/i.test(error));
  assert(filteredErrors.length === 0, `Browser console errors:\n${filteredErrors.join("\n")}`);
  await browser.close();
  console.log("Dashboard smoke OK: current shell, tools, branch CRUD, impact panel, compare, and 3D view.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
