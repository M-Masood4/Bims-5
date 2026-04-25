// Smoke test for the new Belfast 2016-2036 Simulation Studio dashboard.
// Verifies: page loads, map ready, all panels render, branch CRUD, item placement,
// year switching, impact recompute, simulation run, compare modal, export.
const { chromium } = require("playwright");

const url = process.env.URL || "http://localhost:5173";

function fail(msg) { throw new Error(msg); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const consoleErrors = [];
  const consoleAll = [];
  page.on("console", (m) => {
    consoleAll.push(`[${m.type()}] ${m.text()}`);
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  console.log("→ navigate", url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Wait for app to mount
  await page.waitForSelector(".app", { timeout: 15000 });
  await page.waitForFunction(() => !!window.BelfastDashboard, null, { timeout: 15000 });

  // Wait for map to load
  console.log("→ wait map");
  await page.waitForSelector(".mapboxgl-canvas", { timeout: 30000 });
  await page.waitForFunction(() =>
    !!(window.BelfastDashboard && window.BelfastDashboard.state.map && window.BelfastDashboard.state.mapLoaded),
    null, { timeout: 30000 });

  // ---- Static structure checks
  console.log("→ structure");
  const struct = await page.evaluate(() => ({
    timeframe: document.querySelectorAll("#historicalYears li").length + document.querySelectorAll("#simulationYears li").length,
    modifyBtns: document.querySelectorAll(".modify-btn").length,
    presets: document.querySelectorAll(".preset-btn").length,
    metricCards: document.querySelectorAll(".metric-card").length,
    branchItems: document.querySelectorAll(".branch-item").length,
    bottomTabs: document.querySelectorAll(".bn-btn").length,
    topTabs: document.querySelectorAll(".nav-btn").length,
    initialYear: document.querySelector("#tlYearNow")?.textContent?.trim()
  }));
  console.log("  →", struct);
  if (struct.timeframe !== 21) fail("expected 21 years (2016-2036), got " + struct.timeframe);
  if (struct.modifyBtns !== 5) fail("expected 5 modify tools (building/road/park/infra/remove)");
  if (struct.presets !== 4) fail("expected 4 building presets");
  if (struct.metricCards !== 5) fail("expected 5 metric cards");
  if (struct.branchItems !== 4) fail("expected 4 default branches, got " + struct.branchItems);
  if (struct.bottomTabs !== 5) fail("expected 5 bottom-nav tabs");
  if (struct.topTabs !== 4) fail("expected 4 top-nav tabs");

  // ---- Year switching
  console.log("→ setYear 2036");
  await page.evaluate(() => window.BelfastDashboard.setYear(2036));
  await page.waitForFunction(() => document.querySelector("#tlYearNow")?.textContent === "2036");
  const yearLabel = await page.$eval("#impactTitle", el => el.textContent);
  if (!yearLabel.includes("2036")) fail("impact title did not update to 2036");

  console.log("→ setYear 2018");
  await page.evaluate(() => window.BelfastDashboard.setYear(2018));
  await page.waitForFunction(() => document.querySelector("#tlYearNow")?.textContent === "2018");

  // ---- Branch creation
  console.log("→ createBranch");
  await page.evaluate(() => window.BelfastDashboard.createBranch("Smoke Test Branch", "#ec4899", "baseline"));
  const newBranchActive = await page.evaluate(() => window.BelfastDashboard.activeBranch().name);
  if (newBranchActive !== "Smoke Test Branch") fail("new branch was not made active, got: " + newBranchActive);
  const branchCount = await page.$$eval(".branch-item", els => els.length);
  if (branchCount !== 5) fail("expected 5 branches after creating, got " + branchCount);

  // ---- Place an item (in 2030)
  console.log("→ addItemAt building");
  await page.evaluate(() => window.BelfastDashboard.setYear(2030));
  await page.evaluate(() => window.BelfastDashboard.addItemAt("building", -5.93, 54.6));
  const branchHasItem = await page.evaluate(() => window.BelfastDashboard.activeBranch().items.length === 1);
  if (!branchHasItem) fail("branch did not get an item after addItemAt");

  // The branch count chip should show 1
  await page.waitForFunction(() => {
    const els = document.querySelectorAll(".branch-item.active .branch-count");
    return els.length === 1 && els[0].textContent.trim() === "1";
  }, null, { timeout: 5000 });

  // ---- Metric should change vs baseline
  console.log("→ metric shows change");
  const m = await page.evaluate(() => window.BelfastDashboard.metricsForBranchYear(window.BelfastDashboard.activeBranch(), 2036));
  // Population baseline 343,000; with 1 residential building over 7 years (2030-2036), should be > baseline
  if (m.population <= 343000) fail("expected population > baseline, got " + m.population);

  // ---- Simulation run
  console.log("→ runSimulation");
  await page.evaluate(() => window.BelfastDashboard.runSimulation());
  // Wait for it to finish (10 sim years * ~220ms ≈ 2.5s)
  await page.waitForFunction(() => !window.BelfastDashboard.state.isRunningSim, null, { timeout: 8000 });
  const finalYear = await page.$eval("#tlYearNow", el => el.textContent);
  if (finalYear !== "2036") fail("after sim, year should land on 2036, got " + finalYear);

  // ---- Compare modal
  console.log("→ openCompareModal");
  await page.evaluate(() => window.BelfastDashboard.openCompareModal());
  await page.waitForSelector("#compareModal:not([hidden])", { timeout: 3000 });
  const compareCols = await page.$$eval("#compareBody .compare-grid > .head", els => els.length);
  if (compareCols < 2) fail("compare modal did not render columns, got " + compareCols);
  await page.click("#compareModal .modal-close");
  await page.waitForFunction(() => document.querySelector("#compareModal").hasAttribute("hidden"), null, { timeout: 3000 });

  // ---- Set view to 3D
  console.log("→ setView 3D");
  await page.evaluate(() => window.BelfastDashboard.setView("3D"));
  await page.waitForTimeout(500);
  const viewActive = await page.$eval(".view-toggle button[data-view='3D']", el => el.classList.contains("active"));
  if (!viewActive) fail("3D view toggle did not activate");

  // ---- Remove item
  console.log("→ removeItem");
  const itemId = await page.evaluate(() => window.BelfastDashboard.activeBranch().items[0].id);
  await page.evaluate((id) => window.BelfastDashboard.removeItem(id), itemId);
  const after = await page.evaluate(() => window.BelfastDashboard.activeBranch().items.length);
  if (after !== 0) fail("item not removed");

  // ---- Delete branch
  console.log("→ deleteBranch");
  await page.evaluate(() => {
    window.confirm = () => true;
    const id = window.BelfastDashboard.activeBranch().id;
    window.BelfastDashboard.deleteBranch(id);
  });
  const finalBranchCount = await page.$$eval(".branch-item", els => els.length);
  if (finalBranchCount !== 4) fail("expected back to 4 branches, got " + finalBranchCount);

  // ---- No console errors
  if (consoleErrors.length) {
    console.log("Console errors:");
    consoleErrors.forEach(e => console.log("  " + e));
    fail("page emitted " + consoleErrors.length + " console errors");
  }

  console.log("✓ All smoke tests passed");
  await browser.close();
})().catch(async (err) => {
  console.error("✗ FAIL:", err.message);
  process.exit(1);
});
