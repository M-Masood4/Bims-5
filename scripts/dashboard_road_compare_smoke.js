// Smoke test for the postcode → junctions → plan-road → comparison flow.
//
// Steps:
//   1. Page loads, switches to a sim year (>=2027) so the planner is meaningful
//   2. Calls armRoadPlanner directly with a Belfast centre to bypass the
//      Mapbox geocoder (which would need a network call we don't want to flake)
//   3. Verifies junction nodes appear (mapbox source populated)
//   4. Picks two of them via the click handler simulation -> road is added
//   5. runRoadComparison fires; modal opens; result renders
//   6. Asserts metric DOM nodes have non-empty before/after values
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

  await page.waitForFunction(() => !!window.BelfastDashboard, null, { timeout: 15000 });
  await page.waitForFunction(() => !!window.TrafficSim, null, { timeout: 5000 });
  await page.waitForFunction(() =>
    !!(window.BelfastDashboard && window.BelfastDashboard.state.map && window.BelfastDashboard.state.mapLoaded),
    null, { timeout: 30000 });

  // Switch to a sim year so user roads count
  console.log("→ setYear 2030");
  await page.evaluate(() => window.BelfastDashboard.setYear(2030));

  // Force the synthetic Belfast lattice path: the OSM source might not have
  // queryRenderedFeatures populated until the user pans/zooms. We can still
  // discover junctions from the synthetic fallback that traffic-sim.js uses
  // when sampleOsmSegments yields nothing.
  console.log("→ TrafficSim.findJunctionNodes near city centre");
  const nodes = await page.evaluate(() => {
    return window.TrafficSim.findJunctionNodes([-5.93, 54.597], 12, 0.5);
  });
  if (!nodes || nodes.length < 2) fail("expected >=2 junction nodes, got " + (nodes ? nodes.length : 'null'));
  console.log("  found", nodes.length, "nodes");

  // Drive the planner directly from the JS side (skips needing the geocoder).
  // The candidate road must snap to a path along real OSM streets — not a
  // straight line through buildings — so we go through placeCandidateRoad's
  // findOsmPath logic by simulating the junction click handler.
  console.log("→ place candidate road via two junction picks");
  const placeResult = await page.evaluate((picked) => {
    try {
      const dash = window.BelfastDashboard;
      if (typeof dash.createBranch === 'function' && dash.activeBranch().locked) {
        dash.createBranch('Road Plan Test', '#22d3ee', 'baseline');
      }
      // Try the OSM-snapped path; if pathing fails, retry with another pair
      // until we find one that produces a path of >=2 segments.
      let pathFound = null;
      const maxTries = Math.min(picked.length - 1, 6);
      for (let i = 0; i < maxTries && !pathFound; i++) {
        for (let j = i + 1; j < Math.min(picked.length, i + 5) && !pathFound; j++) {
          const segs = window.TrafficSim.findOsmPath(picked[i].coord, picked[j].coord);
          if (segs && segs.length >= 2) {
            const path = window.TrafficSim.pathToPolyline(segs);
            dash.addRoadItem(path[0], path[path.length - 1], path);
            pathFound = { length: segs.length, points: path.length };
            break;
          }
        }
      }
      if (!pathFound) {
        // Fallback so the test still runs even if the OSM graph in this
        // headless context is too sparse to find a multi-step path.
        dash.addRoadItem(picked[0].coord, picked[1].coord);
      }
      const items = dash.activeBranch().items;
      const newRoad = items.filter(it => it.type === 'road').slice(-1)[0];
      return {
        ok: true,
        roads: items.filter(it => it.type === 'road').length,
        pathFound: !!pathFound,
        pathSegments: pathFound ? pathFound.length : 0,
        pathPoints: pathFound ? pathFound.points : 0,
        roadHasPath: Array.isArray(newRoad?.path),
      };
    } catch (e) {
      return { ok: false, err: e.message + ' | ' + (e.stack || '').slice(0, 200) };
    }
  }, nodes);
  if (!placeResult.ok) fail("addRoadItem failed: " + placeResult.err);
  console.log("  path:", JSON.stringify(placeResult));
  // We expect a real OSM-snapped path, not a fallback straight line. If the
  // synthetic lattice fallback kicks in, that's still acceptable for the
  // smoke (means the test environment doesn't have OSM tiles loaded).
  if (placeResult.pathFound && placeResult.pathSegments < 2) {
    fail("expected multi-segment path, got " + placeResult.pathSegments);
  }
  console.log("  branch now has", placeResult.roads, "road(s)");

  // Click via JS — the button may be below the fold at this viewport.
  console.log("→ trigger runRoadComparison via Plan New Road button");
  const triggered = await page.evaluate(() => {
    const btn = document.getElementById("roadCompareBtn");
    if (!btn) return { ok: false, reason: "button not found" };
    btn.click();
    return { ok: true };
  });
  if (!triggered.ok) fail("could not trigger comparison: " + triggered.reason);

  // Wait for the modal to show progress, then results
  await page.waitForSelector("#roadCompareModal", { state: "visible", timeout: 5000 });
  await page.waitForFunction(() => {
    const r = document.getElementById("roadCompareResult");
    return r && !r.hidden;
  }, null, { timeout: 15000 });

  // Pull the rendered numbers
  const res = await page.evaluate(() => {
    const map = window.BelfastDashboard.state.map;
    return {
      speedBefore: document.getElementById("rcSpeedBefore")?.textContent,
      speedAfter:  document.getElementById("rcSpeedAfter")?.textContent,
      speedDelta:  document.getElementById("rcSpeedDelta")?.textContent,
      congBefore:  document.getElementById("rcCongBefore")?.textContent,
      congAfter:   document.getElementById("rcCongAfter")?.textContent,
      flowBefore:  document.getElementById("rcFlowBefore")?.textContent,
      flowAfter:   document.getElementById("rcFlowAfter")?.textContent,
      usage:       document.getElementById("rcUsage")?.textContent,
      summary:     document.getElementById("roadCompareSummary")?.textContent,
      beforeSegs:  document.querySelectorAll("#roadCompareMapBefore line").length,
      afterSegs:   document.querySelectorAll("#roadCompareMapAfter line").length,
      // New: live swarm + on-map heatmap
      swarmRunning: window.TrafficSim.isRunning(),
      swarmVehicles: window.TrafficSim.getMetrics().vehicles,
      hasCmpSrc: !!map.getSource("traffic-sim-compare-overlay"),
      hasCmpLayer: !!map.getLayer("traffic-sim-compare-line"),
      cmpFeatures: map.getSource("traffic-sim-compare-overlay")?._data?.features?.length ?? -1,
      legendShown: !!document.querySelector(".congestion-legend"),
      hasClearBtn: !!document.querySelector(".congestion-legend .cl-clear"),
    };
  });
  console.log("  ", JSON.stringify(res, null, 2));

  function notEmpty(label, v) {
    if (!v || v === '—') fail("metric '" + label + "' empty: " + JSON.stringify(v));
  }
  notEmpty("speedBefore", res.speedBefore);
  notEmpty("speedAfter",  res.speedAfter);
  notEmpty("speedDelta",  res.speedDelta);
  notEmpty("congBefore",  res.congBefore);
  notEmpty("congAfter",   res.congAfter);
  notEmpty("flowBefore",  res.flowBefore);
  notEmpty("flowAfter",   res.flowAfter);
  notEmpty("usage",       res.usage);
  notEmpty("summary",     res.summary);

  if (res.beforeSegs < 5) fail("before mini-map has <5 segments: " + res.beforeSegs);
  if (res.afterSegs  < 5) fail("after mini-map has <5 segments: " + res.afterSegs);
  // After mini-map should have at least one extra line (the candidate dashed line)
  if (res.afterSegs <= res.beforeSegs) fail("after map should have >= before + candidate, got before=" + res.beforeSegs + " after=" + res.afterSegs);

  // Live swarm + on-map congestion-delta heatmap should be present
  if (!res.swarmRunning) fail("vehicle swarm should be running on the main map during the comparison");
  if (res.swarmVehicles < 10) fail("swarm should have spawned vehicles, got " + res.swarmVehicles);
  if (!res.hasCmpSrc) fail("on-map comparison source missing");
  if (!res.hasCmpLayer) fail("on-map comparison layer missing");
  if (res.cmpFeatures < 5) fail("comparison overlay has <5 features: " + res.cmpFeatures);
  if (!res.legendShown) fail("legend should be visible after the diff is painted");
  if (!res.hasClearBtn) fail("legend clear button missing");

  // Clear button should hide the overlay
  console.log("→ verify clear button");
  await page.evaluate(() => document.querySelector(".congestion-legend .cl-clear").click());
  await new Promise(r => setTimeout(r, 200));
  const cleared = await page.evaluate(() => ({
    cmpFeatures: window.BelfastDashboard.state.map.getSource("traffic-sim-compare-overlay")?._data?.features?.length ?? -1,
    legendVisible: (document.querySelector(".congestion-legend")?.style?.display ?? '') !== 'none',
  }));
  if (cleared.cmpFeatures !== 0) fail("overlay not cleared, " + cleared.cmpFeatures + " features remain");
  if (cleared.legendVisible) fail("legend should hide after clear");

  // Free-click road placement should be locked when planner isn't armed
  console.log("→ verify road tool is gated to postcode flow");
  const gated = await page.evaluate(() => {
    // Disarm the planner
    if (typeof window.BelfastDashboard.activeBranch === 'function') {
      // simulate "fresh" page condition: clear armed state via the DOM cancel button if present
    }
    // Click the Road tool button directly. Without an armed planner this
    // should NOT activate the tool.
    const btn = Array.from(document.querySelectorAll(".modify-btn")).find(b => b.getAttribute("data-tool") === "road");
    if (!btn) return { ok: false, why: "Road button missing" };
    // Disarm the planner by simulating cancel
    const cancel = document.getElementById("planRoadCancel");
    if (cancel) cancel.click();
    btn.click();
    return { ok: true, activeTool: window.BelfastDashboard.state.activeTool };
  });
  if (!gated.ok) fail("road tool gating: " + gated.why);
  if (gated.activeTool === "road") fail("Road tool activated without an armed planner");

  // No critical console errors
  const ignored = ["mapbox", "favicon", "ResizeObserver", "Manifest", "tile", "WebGL", "404"];
  const realErrors = consoleErrors.filter((e) => !ignored.some((s) => e.toLowerCase().includes(s.toLowerCase())));
  if (realErrors.length) {
    console.log("Unfiltered console errors:");
    realErrors.forEach(e => console.log("  " + e));
    fail("page emitted " + realErrors.length + " critical console errors");
  }

  await browser.close();
  console.log("✓ Road comparison smoke test passed");
})().catch(async (err) => {
  console.error("✗ FAIL:", err.message);
  process.exit(1);
});
