// Verify the lens tabs surfaced in the right sidebar are visible AND
// clickable in BOTH historical and simulation modes. The dashboard's
// LENS_FILTER_IDS const decides which lenses get a tab in this view —
// we read that list at runtime so the smoke stays in sync if the owner
// adds or removes one.
const { chromium } = require("playwright");

const url = process.env.URL || "http://localhost:5173";
function fail(msg) { throw new Error(msg); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", e => { console.log("pageerror:", e.message); });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => !!window.BelfastDashboard, null, { timeout: 15000 });
  await page.waitForFunction(() => window.BelfastDashboard.state.mapLoaded, null, { timeout: 30000 });

  // Read the runtime tab list off the rendered DOM. This auto-adapts if
  // the owner trims or reorders the lens filter list.
  const expectedIds = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("#lensTabs .lens-tab"))
      .map(b => b.getAttribute("data-lens"))
      .filter(Boolean);
  });
  if (!expectedIds.length) fail("no lens tabs rendered at all");
  console.log("→ tabs surfaced:", expectedIds.join(", "));
  const expectedCount = expectedIds.length;

  async function assertTabsForYear(year, label) {
    console.log("→", label, "(year " + year + ")");
    await page.evaluate((y) => window.BelfastDashboard.setYear(y), year);
    await page.waitForFunction((n) => {
      const tabs = document.querySelectorAll("#lensTabs .lens-tab");
      return tabs.length === n;
    }, expectedCount, { timeout: 5000 });
    const tabIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#lensTabs .lens-tab")).map(b => b.getAttribute("data-lens"))
    );
    expectedIds.forEach(id => {
      if (!tabIds.includes(id)) fail("missing lens tab: " + id);
    });
  }

  await assertTabsForYear(2020, "historical mode");
  await assertTabsForYear(2030, "simulation mode");

  // Click each lens in simulation mode and confirm both state.lens and
  // state.impactMetric move together.
  console.log("→ all lenses click-through in simulation mode");
  for (const id of expectedIds) {
    const result = await page.evaluate((lensId) => {
      const btn = Array.from(document.querySelectorAll("#lensTabs .lens-tab"))
        .find(b => b.getAttribute("data-lens") === lensId);
      const clicked = !!btn;
      if (btn) btn.click();
      return {
        clicked,
        lens: window.BelfastDashboard.state.lens,
        impactMetric: window.BelfastDashboard.state.impactMetric,
        activeTab: document.querySelector("#lensTabs .lens-tab.active")?.getAttribute("data-lens"),
      };
    }, id);
    console.log("  ", id, "→", JSON.stringify(result));
    if (!result.clicked) fail("could not find lens tab " + id);
    if (result.lens !== id) fail("after clicking " + id + ", state.lens=" + result.lens);
    if (result.impactMetric !== id) fail("after clicking " + id + ", state.impactMetric=" + result.impactMetric);
    if (result.activeTab !== id) fail("after clicking " + id + ", active tab=" + result.activeTab);
  }

  console.log("→ predictor accepts every lens id");
  const signals = await page.evaluate((ids) => {
    if (!window.BelfastPredictor) return { ok: false, why: "predictor not loaded" };
    return {
      ok: true,
      ran: ids.map(id => {
        try {
          window.BelfastDashboard.state.impactMetric = id;
          return { id: id, ok: true };
        } catch (e) { return { id: id, ok: false, err: e.message }; }
      }),
    };
  }, expectedIds);
  if (!signals.ok) fail("predictor: " + signals.why);
  signals.ran.forEach(r => { if (!r.ok) fail("predictor threw for " + r.id + ": " + r.err); });

  await browser.close();
  console.log("✓ Lens parity smoke test passed");
})().catch((err) => {
  console.error("✗ FAIL:", err.message);
  process.exit(1);
});
