// Visual / interactive smoke for the dashboard.
// Captures full-page screenshots in a few key states to confirm UI quality.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const url = process.env.URL || "http://localhost:5173";
const outDir = path.resolve(__dirname, "..", "output", "dashboard");

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", e => console.log("pageerror:", e.message));
  page.on("console", m => { if (m.type() === "error") console.log("console.error:", m.text()); });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.BelfastDashboard?.state?.mapLoaded, null, { timeout: 30000 });
  await page.waitForTimeout(1200);

  // 1. baseline 2026 historical
  await page.screenshot({ path: path.join(outDir, "01-baseline-2026.png"), fullPage: false });
  console.log("✓ 01-baseline-2026.png");

  // 2. switch to simulation 2036, building tool active
  await page.evaluate(() => {
    window.BelfastDashboard.setYear(2036);
  });
  await page.click(".modify-btn[data-tool='building']");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, "02-tool-building.png"), fullPage: false });
  console.log("✓ 02-tool-building.png");

  // 3. add a few items at different years on Green branch
  await page.evaluate(() => {
    const d = window.BelfastDashboard;
    d.state.activeBranchId = "green";
    d.setYear(2027);
    d.state.activeBuildingPreset = "residential";
    d.addItemAt("building", -5.92, 54.605);
    d.setYear(2029);
    d.state.activeBuildingPreset = "commercial";
    d.addItemAt("building", -5.94, 54.59);
    d.setYear(2031);
    d.addItemAt("park", -5.91, 54.595);
    d.addItemAt("infrastructure", -5.945, 54.61);
    d.setYear(2034);
    d.addRoadItem([-5.96, 54.595], [-5.91, 54.605]);
    d.setYear(2036);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, "03-green-branch-2036.png"), fullPage: false });
  console.log("✓ 03-green-branch-2036.png");

  // 4. open compare modal
  await page.evaluate(() => window.BelfastDashboard.openCompareModal());
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, "04-compare-modal.png"), fullPage: false });
  console.log("✓ 04-compare-modal.png");
  await page.click("#compareModal .modal-close");

  // 5. inspect a placed item
  const itemId = await page.evaluate(() => {
    const b = window.BelfastDashboard.state.branches.find(b => b.id === "green");
    return b.items[0].id;
  });
  await page.evaluate((id) => {
    const item = window.BelfastDashboard.activeBranch().items.find(i => i.id === id);
    // openInspectModal isn't exposed; use the timeline node click
  }, itemId);
  // Just click the first node in the branch timeline
  const nodes = await page.$$("#branchTimelineSvg .timeline-node");
  if (nodes.length) {
    await nodes[0].click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, "05-inspect-item.png"), fullPage: false });
    console.log("✓ 05-inspect-item.png");
    await page.click("#inspectModal .modal-close").catch(() => {});
  }

  // 6. switch to 3D view
  await page.evaluate(() => window.BelfastDashboard.setView("3D"));
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outDir, "06-3d-view.png"), fullPage: false });
  console.log("✓ 06-3d-view.png");

  await browser.close();
  console.log("\nAll screenshots saved to", outDir);
})();
