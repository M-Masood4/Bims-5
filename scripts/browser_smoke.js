const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "output", "playwright");
const url = process.env.MODE_A_URL || "http://localhost:5173";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch (_error) {}
  });

  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.BelfastDashboard?.state, null, { timeout: 30000 });
  await page.waitForSelector("[data-tool='infrastructure']", { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll(".lens-tab").length >= 4, null, { timeout: 30000 });

  const initial = await page.evaluate(() => ({
    toolText: document.querySelector("[data-tool='infrastructure']")?.textContent?.trim() || "",
    lensTabs: Array.from(document.querySelectorAll(".lens-tab")).map((item) => item.textContent.trim()),
    exposed: Boolean(window.BelfastDashboard?.runSimulation),
    year: window.BelfastDashboard.state.year
  }));
  assert(initial.toolText.includes("Transformer"), "Transformer tool label did not render.");
  assert(initial.exposed, "BelfastDashboard test API is not exposed.");
  for (const label of ["Traffic", "Jobs", "Electricity", "Public Transit"]) {
    assert(initial.lensTabs.includes(label), `Missing lens tab ${label}.`);
  }

  const scenarioResult = await page.evaluate(async () => {
    const payload = {
      postcode: "BT7 1NN",
      building: {
        config: {
          size: "medium",
          buildingType: "mixed_use",
          affordabilityMix: "affordable",
          floors: 8,
          footprintSqm: 1500
        },
        location: { lng: -5.931, lat: 54.593 }
      },
      interventions: [
        {
          id: "smoke-road",
          type: "road",
          path: [[-5.935, 54.59], [-5.932, 54.592], [-5.929, 54.594]],
          radiusM: 850
        },
        {
          id: "smoke-transformer",
          type: "transformer",
          location: { lng: -5.931, lat: 54.593 },
          assetClass: "secondary",
          capacityKva: 500,
          serviceRadiusM: 650
        }
      ],
      startYear: 2026,
      baselineYear: 2025,
      horizonYear: 2036
    };
    const scenario = await fetch("/api/simulation/run-multiple", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then((response) => response.json());

    const dash = window.BelfastDashboard;
    dash.createBranch("Transformer Smoke", "#06b6d4", "baseline");
    const branch = dash.activeBranch();
    branch.forecastObjective = "user_proposal";
    branch.scenarioResult = scenario;
    branch.items.push({
      id: "smoke-building",
      type: "building",
      year: 2026,
      lng: -5.931,
      lat: 54.593,
      preset: "residential",
      label: "Smoke building"
    });
    branch.items.push({
      id: "smoke-road",
      type: "road",
      year: 2026,
      path: [[-5.935, 54.59], [-5.932, 54.592], [-5.929, 54.594]],
      start: [-5.935, 54.59],
      end: [-5.929, 54.594],
      label: "Smoke road"
    });
    branch.items.push({
      id: "smoke-transformer",
      type: "infrastructure",
      year: 2026,
      lng: -5.931,
      lat: 54.593,
      label: "Transformer",
      assetClass: "secondary",
      capacityKva: 500,
      serviceRadiusM: 650
    });
    dash.setYear(2036);
    return {
      ok: scenario.ok,
      transformerModelVersion: scenario.transformerModelVersion,
      branchCount: scenario.scenarioBranches?.length || 0,
      concrete: scenario.scenarioBranches?.[0]?.timelineByYear?.["2036"]?.concreteImpacts || null
    };
  });

  assert(scenarioResult.ok, "Deterministic scenario run failed.");
  assert(scenarioResult.transformerModelVersion, "Scenario response did not expose transformerModelVersion.");
  assert(scenarioResult.branchCount >= 1, "Scenario did not return branches.");
  assert(scenarioResult.concrete?.electricity?.transformerReliefKw > 0, "Transformer relief was not positive.");
  assert(scenarioResult.concrete?.electricity?.p10, "Electricity uncertainty bands are missing.");
  assert("capacityEnabledJobs" in (scenarioResult.concrete?.jobs || {}), "Capacity-enabled jobs are missing.");

  // Initial historical grid loads can finish after the injected scenario; force
  // the simulation render once more after those promises settle.
  await page.waitForTimeout(1200);
  const sidebarState = await page.evaluate(() => {
    const dash = window.BelfastDashboard;
    dash.setYear(2036);
    const branch = dash.activeBranch();
    const metrics = dash.metricsForBranchYear(branch, 2036);
    return {
      hasImpactStack: Boolean(document.querySelector("#impactStack")),
      hasImpactTitle: Boolean(document.querySelector("#impactTitle")),
      branchListText: document.querySelector("#branchList")?.textContent || "",
      impactText: document.querySelector("#impactStack")?.textContent || "",
      population: metrics.population,
      traffic: metrics.traffic
    };
  });
  assert(sidebarState.hasImpactStack && sidebarState.hasImpactTitle, "Impact overview did not render in the branch sidebar.");
  assert(sidebarState.branchListText.includes("Smoke road"), "Branch additions did not render in the right sidebar.");
  assert(sidebarState.impactText.includes("Simulation Data"), "Concrete simulation data did not render in the impact panel.");
  assert(sidebarState.impactText.includes("Transformer"), "Transformer concrete impact row did not render.");
  assert(Number.isFinite(sidebarState.population) && Number.isFinite(sidebarState.traffic), "Scenario metrics were not available.");

  const forkMenu = await page.evaluate(() => {
    const el = document.querySelector('.branch-line-item[data-item-id="smoke-road"]');
    if (!el) return { found: false };
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + 10,
      clientY: rect.top + 10,
      view: window
    }));
    const menu = document.querySelector("#nodeMenu");
    const fork = menu?.querySelector('[data-act="fork-here"]');
    return {
      found: true,
      menuOpen: Boolean(menu && !menu.hidden),
      forkVisible: Boolean(fork && !fork.hidden),
      text: menu?.textContent || ""
    };
  });
  assert(forkMenu.found, "Smoke road branch item was not found.");
  assert(forkMenu.menuOpen && forkMenu.forkVisible, "Start-new-branch context action did not appear.");
  await page.locator('#nodeMenu [data-act="fork-here"]').click();
  await page.locator(".modal #newBranchName").fill("Smoke fork from road");
  await page.locator(".modal #newBranchCreate").click();
  await page.waitForFunction(() => window.BelfastDashboard.state.branches.some((branch) => branch.name === "Smoke fork from road"));
  const forked = await page.evaluate(() => {
    const branch = window.BelfastDashboard.state.branches.find((item) => item.name === "Smoke fork from road");
    return {
      activeName: window.BelfastDashboard.activeBranch().name,
      parentId: branch?.parentId || null,
      branchPoint: branch?.branchPoint || null,
      labels: (branch?.items || []).map((item) => item.label || item.type),
      itemCount: (branch?.items || []).length
    };
  });
  assert(forked.activeName === "Smoke fork from road", "Forked branch did not become active.");
  assert(forked.parentId && forked.branchPoint?.sourceItemId === "smoke-road", "Forked branch did not record the source point.");
  assert(forked.labels.includes("Smoke building") && forked.labels.includes("Smoke road"), "Forked branch did not copy items through the selected point.");
  assert(!forked.labels.includes("Transformer"), "Forked branch copied items after the selected point.");

  await page.locator(".lens-tab", { hasText: "Electricity" }).click();
  await page.waitForFunction(() => window.BelfastDashboard.state.lens === "electricity", null, { timeout: 10000 });
  await page.locator(".lens-tab", { hasText: "Jobs" }).click();
  await page.waitForFunction(() => window.BelfastDashboard.state.lens === "jobs", null, { timeout: 10000 });
  const simulatedBranchId = await page.evaluate(() => window.BelfastDashboard.state.branches.find((branch) => branch.name === "Transformer Smoke")?.id || "");
  assert(simulatedBranchId, "Could not find simulated Transformer Smoke branch.");
  await page.locator("#branchSelect").selectOption(simulatedBranchId);
  await page.waitForFunction((id) => window.BelfastDashboard.state.activeBranchId === id, simulatedBranchId, { timeout: 10000 });
  await page.evaluate(() => window.BelfastDashboard.setYear(2036));

  const rendered = await page.evaluate(() => {
    const text = document.querySelector("#impactStack")?.textContent || "";
    return {
      hasConcrete: Boolean(document.querySelector("[data-testid='concrete-impact-data']")),
      hasTransformer: text.includes("Transformer"),
      hasHeadroom: text.includes("headroom"),
      hasConfidence: text.includes("Confidence"),
      hasCapacityJobs: text.includes("capacity-enabled"),
      activeLens: window.BelfastDashboard.state.lens,
      activeYear: window.BelfastDashboard.state.year
    };
  });
  assert(rendered.hasConcrete, "Concrete transformer impact panel did not render.");
  assert(rendered.hasTransformer && rendered.hasHeadroom, "Transformer relief/headroom rows did not render.");
  assert(rendered.hasConfidence, "Transformer confidence text did not render.");
  assert(rendered.hasCapacityJobs, "Capacity-enabled jobs did not render.");
  assert(rendered.activeLens === "jobs", "Jobs lens did not activate.");
  assert(rendered.activeYear === 2036, "Scenario year did not stay on 2036.");

  await page.screenshot({ path: path.join(outputDir, "dashboard-transformer-browser-smoke.png"), fullPage: true });
  await browser.close();

  const filteredErrors = consoleErrors.filter((error) => !/Failed to load resource.*mapbox|favicon/i.test(error));
  assert(filteredErrors.length === 0, `Browser console errors:\n${filteredErrors.join("\n")}`);
  console.log(
    `Browser smoke OK: Transformer tool, branch fork from item point, ${scenarioResult.transformerModelVersion}, active lens ${rendered.activeLens}.`
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
