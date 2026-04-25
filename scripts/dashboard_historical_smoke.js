// Smoke test for the new HISTORICAL mode + diff modal.
const { chromium } = require("playwright");

const url = process.env.URL || "http://localhost:5173";
function fail(m) { throw new Error(m); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const consoleErrors = [];
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", e => consoleErrors.push("pageerror: " + e.message));
  page.on("response", r => { if (r.status() >= 400) console.log("  HTTP " + r.status() + " " + r.url()); });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.BelfastDashboard?.state?.mapLoaded, null, { timeout: 30000 });

  // Switch to historical mode
  console.log("→ switch to historical");
  await page.click(".nav-btn[data-mode-tab='historical']");
  await page.waitForFunction(() => window.BelfastDashboard.state.mode === "historical", null, { timeout: 5000 });

  // Lens tabs visible, 5 of them
  await page.waitForSelector(".lens-tabs:not([hidden]) .lens-tab", { timeout: 5000 });
  const lensCount = await page.$$eval(".lens-tabs .lens-tab", els => els.length);
  if (lensCount !== 5) fail("expected 5 lens tabs, got " + lensCount);

  // Modify panel should now show 5 lens buttons
  const modifyLenses = await page.$$eval("#modifyList .lens-mb", els => els.length);
  if (modifyLenses !== 5) fail("expected 5 lens buttons in modify panel, got " + modifyLenses);

  // Year should be 2026 (clamped from 2036 default)
  const year = await page.$eval("#tlYearNow", el => el.textContent.trim());
  if (year !== "2026") fail("year should clamp to 2026, got " + year);

  // Set year to 2024 — should show traffic events for that year
  console.log("→ setYear 2024");
  await page.evaluate(() => window.BelfastDashboard.setYear(2024));
  await page.waitForFunction(() => document.querySelector("#tlYearNow")?.textContent === "2024", null, { timeout: 3000 });
  await page.waitForTimeout(500);

  // Events list should be present (traffic lens, year 2024)
  const events = await page.evaluate(() => window.BelfastDashboard.eventsForCurrentYearAndLens());
  if (!Array.isArray(events) || !events.length) fail("expected events for 2024 traffic, got " + JSON.stringify(events).slice(0, 200));
  console.log("  → " + events.length + " events for 2024 traffic");

  // First event should appear in branches panel as event-item (display capped at 80)
  const eventItems = await page.$$eval(".event-item", els => els.length);
  const expectedItems = Math.min(80, events.length);
  if (eventItems !== expectedItems) fail("event items count mismatch: " + eventItems + " vs expected " + expectedItems);
  if (events.length < 50) fail("expected real-events catalog (>50), got " + events.length);

  // Map heatmap source has 308 cells
  const cellCount = await page.evaluate(() => {
    const src = window.BelfastDashboard.state.map.getSource("hist-cells");
    return src ? (src._data?.features?.length || 0) : 0;
  });
  if (cellCount !== 308) fail("expected 308 grid cells in heatmap, got " + cellCount);

  // Switch lens to electricity
  console.log("→ switch lens to electricity");
  await page.evaluate(() => window.BelfastDashboard.setLens("electricity"));
  await page.waitForFunction(() => window.BelfastDashboard.state.lens === "electricity", null, { timeout: 3000 });

  // Switch year to 2022 (which should have electricity events maybe)
  await page.evaluate(() => window.BelfastDashboard.setYear(2022));
  await page.waitForTimeout(400);

  // Switch back to traffic + 2016
  await page.evaluate(() => { window.BelfastDashboard.setLens("traffic"); window.BelfastDashboard.setYear(2016); });
  await page.waitForFunction(() => document.querySelector("#tlYearNow")?.textContent === "2016", null, { timeout: 3000 });
  await page.waitForTimeout(500);

  // Select first event
  console.log("→ selectEvent");
  const firstEventId = await page.evaluate(() => window.BelfastDashboard.eventsForCurrentYearAndLens()[0]?.id);
  if (!firstEventId) fail("no event id available for 2016 traffic");
  await page.evaluate((id) => window.BelfastDashboard.selectEvent(id), firstEventId);
  await page.waitForFunction((id) => window.BelfastDashboard.state.activeEventId === id, firstEventId, { timeout: 3000 });

  // Compare panel should now show event detail with diff button
  await page.waitForSelector("#openDiffBtn", { timeout: 3000 });

  // Highlighted cells source should have features (the event's cellIds)
  const hlCount = await page.evaluate(() => {
    const src = window.BelfastDashboard.state.map.getSource("hist-highlight");
    return src ? (src._data?.features?.length || 0) : 0;
  });
  if (hlCount === 0) fail("expected highlighted cells for selected event, got 0");
  console.log("  → highlighted " + hlCount + " cells");

  // Open diff modal
  console.log("→ openDiffModal");
  await page.click("#openDiffBtn");
  await page.waitForSelector("#diffModal:not([hidden])", { timeout: 3000 });
  await page.waitForFunction(() => document.querySelector("#diffStats .diff-stat"), null, { timeout: 8000 });
  const diffStats = await page.$$eval("#diffStats .diff-stat", els => els.length);
  if (diffStats !== 5) fail("expected 5 diff stats, got " + diffStats);

  // Both mini maps should have rendered canvases
  await page.waitForSelector("#diffMapBefore .mapboxgl-canvas", { timeout: 12000 });
  await page.waitForSelector("#diffMapAfter .mapboxgl-canvas", { timeout: 12000 });

  // Close diff modal
  await page.click("#diffModal .modal-close");
  await page.waitForFunction(() => document.querySelector("#diffModal").hasAttribute("hidden"), null, { timeout: 3000 });

  // Switch back to simulation mode — branches panel must restore
  console.log("→ back to simulation");
  await page.click(".nav-btn[data-mode-tab='simulation']");
  await page.waitForFunction(() => window.BelfastDashboard.state.mode === "simulation", null, { timeout: 5000 });
  // Branch list class must restore
  const branchListClass = await page.$eval("#branchList", el => el.className);
  if (!branchListClass.includes("branch-list") || branchListClass.includes("events-list")) fail("branch list class did not restore: " + branchListClass);
  // Modify list must show original 5 modify-btn buttons (not lens-mb)
  const origBtns = await page.$$eval("#modifyList .modify-btn:not(.lens-mb)", els => els.length);
  if (origBtns !== 5) fail("expected 5 original modify-btn after restoring, got " + origBtns);

  if (consoleErrors.length) {
    console.log("Console errors:");
    consoleErrors.forEach(e => console.log("  " + e));
    fail("page emitted " + consoleErrors.length + " console errors");
  }

  console.log("✓ All historical-mode smoke tests passed");
  await browser.close();
})().catch(err => {
  console.error("✗ FAIL:", err.message);
  process.exit(1);
});
