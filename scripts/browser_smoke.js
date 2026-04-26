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
  await page.evaluate(() => window.BelfastDashboard.setYear(2036));
  await page.waitForFunction(() => {
    const text = document.querySelector("#impactStack")?.textContent || "";
    return text.includes("Transformer") && text.includes("headroom") && text.includes("Confidence");
  }, null, { timeout: 30000 });

  await page.locator(".lens-tab", { hasText: "Electricity" }).click();
  await page.waitForFunction(() => window.BelfastDashboard.state.lens === "electricity", null, { timeout: 10000 });
  await page.locator(".lens-tab", { hasText: "Jobs" }).click();
  await page.waitForFunction(() => window.BelfastDashboard.state.lens === "jobs", null, { timeout: 10000 });

  const rendered = await page.evaluate(() => {
    const text = document.querySelector("#impactStack")?.textContent || "";
    return {
      hasConcrete: Boolean(document.querySelector("[data-testid='concrete-impact-data']")),
      hasTransformer: text.includes("Transformer"),
      hasHeadroom: text.includes("headroom"),
      hasConfidence: text.includes("Confidence"),
      hasCapacityJobs: text.includes("capacity-enabled"),
      activeLens: window.BelfastDashboard.state.lens,
      activeYear: window.BelfastDashboard.state.year,
      panelText: text.slice(0, 600)
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
    `Browser smoke OK: Transformer tool, building+road+transformer scenario, ${scenarioResult.transformerModelVersion}, active lens ${rendered.activeLens}.`
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
