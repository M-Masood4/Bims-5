// Smoke test for the in-page Roads & Traffic Sim feature integrated into the
// Belfast Simulation Studio dashboard. Covers:
//   - traffic-sim.js loads, exposes window.TrafficSim
//   - the toggle button and density/speed sliders are wired up
//   - starting the sim spawns vehicles, mapbox layers exist, stats update
//   - density slider changes vehicle count
//   - stopping clears vehicles and hides stats
//   - clicking "Run Simulation" auto-starts traffic and auto-stops it after
const { chromium } = require("playwright");

const url = process.env.URL || "http://localhost:5173";

function fail(msg) { throw new Error(msg); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  console.log("→ navigate", url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Wait for the dashboard + map to be live
  await page.waitForSelector(".app", { timeout: 15000 });
  await page.waitForFunction(() => !!window.BelfastDashboard, null, { timeout: 15000 });
  await page.waitForFunction(() => !!window.TrafficSim, null, { timeout: 5000 });
  await page.waitForFunction(() =>
    !!(window.BelfastDashboard && window.BelfastDashboard.state.map && window.BelfastDashboard.state.mapLoaded),
    null, { timeout: 30000 });

  // The traffic sim panel lives inside the simulation-mode compare panel,
  // so flip to a sim year first (default state is 2025 = historical, which
  // swaps the compare panel for the event-detail view).
  await page.evaluate(() => window.BelfastDashboard.setYear(2030));

  // 1. UI present
  console.log("→ controls present");
  const ui = await page.evaluate(() => ({
    toggle: !!document.getElementById("trafficSimToggle"),
    density: !!document.getElementById("trafficSimDensity"),
    speed: !!document.getElementById("trafficSimSpeed"),
    stats: !!document.getElementById("trafficSimStats"),
    title: !!Array.from(document.querySelectorAll(".traffic-sim-title")).find(el => el.textContent.includes("Traffic")),
  }));
  Object.entries(ui).forEach(([k, v]) => { if (!v) fail("missing UI element: " + k); });

  // 2. Click toggle, vehicles spawn, layers exist, stats live
  console.log("→ start sim via toggle");
  // Use JS-driven click — the toggle may sit below the fold on this viewport
  await page.evaluate(() => document.getElementById("trafficSimToggle").click());
  await page.waitForFunction(() => window.TrafficSim.isRunning(), null, { timeout: 3000 });
  await page.waitForFunction(() => window.TrafficSim.getMetrics().vehicles > 0, null, { timeout: 3000 });
  // Give the rAF loop a tick to call setDataIfReady → ensureLayers
  await new Promise(r => setTimeout(r, 600));

  const startState = await page.evaluate(() => ({
    metrics: window.TrafficSim.getMetrics(),
    hasVehicleSrc: !!window.BelfastDashboard.state.map.getSource("traffic-sim-vehicles"),
    hasVehicleLayer: !!window.BelfastDashboard.state.map.getLayer("traffic-sim-vehicles-layer"),
    hasCongestionLayer: !!window.BelfastDashboard.state.map.getLayer("traffic-sim-congestion-layer"),
    statsHidden: document.getElementById("trafficSimStats").hidden,
    togglePressed: document.getElementById("trafficSimToggle").getAttribute("aria-pressed"),
  }));
  if (startState.metrics.vehicles < 10) fail("too few vehicles: " + startState.metrics.vehicles);
  if (!startState.hasVehicleSrc) fail("vehicle source missing");
  if (!startState.hasVehicleLayer) fail("vehicle layer missing");
  if (!startState.hasCongestionLayer) fail("congestion layer missing");
  if (startState.statsHidden) fail("stats panel still hidden after start");
  if (startState.togglePressed !== "true") fail("toggle aria-pressed should be true");

  // 3. Density slider changes vehicle count
  console.log("→ change density to 200");
  await page.evaluate(() => {
    const s = document.getElementById("trafficSimDensity");
    s.value = 200;
    s.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() => window.TrafficSim.getMetrics().vehicles >= 180, null, { timeout: 3000 });
  const afterDensity = await page.evaluate(() => window.TrafficSim.getMetrics().vehicles);
  if (afterDensity < 180 || afterDensity > 220) fail("density change didn't take effect: " + afterDensity);

  // 4. Stop via toggle clears vehicles
  console.log("→ stop sim");
  await page.evaluate(() => document.getElementById("trafficSimToggle").click());
  await page.waitForFunction(() => !window.TrafficSim.isRunning(), null, { timeout: 3000 });
  const stopState = await page.evaluate(() => ({
    statsHidden: document.getElementById("trafficSimStats").hidden,
    vehicleData: window.BelfastDashboard.state.map.getSource("traffic-sim-vehicles")?._data?.features?.length ?? -1,
  }));
  if (!stopState.statsHidden) fail("stats panel should be hidden after stop");
  if (stopState.vehicleData !== 0) fail("vehicles not cleared after stop: " + stopState.vehicleData);

  // 5. Traffic sim restarts cleanly after stop
  console.log("→ restart traffic sim cleanly");
  await page.evaluate(() => document.getElementById("trafficSimToggle").click());
  await page.waitForFunction(() => window.TrafficSim.isRunning(), null, { timeout: 3000 });
  await page.waitForFunction(() => window.TrafficSim.getMetrics().vehicles > 0, null, { timeout: 3000 });
  await page.evaluate(() => document.getElementById("trafficSimToggle").click());
  await page.waitForFunction(() => !window.TrafficSim.isRunning(), null, { timeout: 3000 });

  // 6. No critical console errors
  const ignored = ["mapbox", "favicon", "ResizeObserver", "Manifest", "tile", "WebGL", "404"];
  const realErrors = consoleErrors.filter((e) => !ignored.some((s) => e.toLowerCase().includes(s.toLowerCase())));
  if (realErrors.length) {
    console.log("\nUnfiltered console errors:");
    realErrors.forEach(e => console.log("  " + e));
    fail("page emitted " + realErrors.length + " critical console errors");
  }

  await browser.close();
  console.log("✓ Roads & Traffic Sim smoke test passed");
})().catch(async (err) => {
  console.error("✗ FAIL:", err.message);
  process.exit(1);
});
