const yearRange = document.querySelector("#yearRange");
const yearLabel = document.querySelector("#yearLabel");
const phaseLabel = document.querySelector("#phaseLabel");
const modeLabel = document.querySelector("#modeLabel");
const modeHint = document.querySelector("#modeHint");
const sandboxPill = document.querySelector("#sandboxPill");
const toolbox = document.querySelector("#toolbox");
const toolButtons = Array.from(document.querySelectorAll(".tool-card"));
const metricsRoot = document.querySelector("#metrics");
const mapStage = document.querySelector("#mapStage");
const mapStatus = document.querySelector("#mapStatus");
const mapNarrative = document.querySelector("#mapNarrative");
const storyText = document.querySelector("#storyText");
const interventionLayer = document.querySelector("#interventionLayer");
const scenarioLog = document.querySelector("#scenarioLog");
const playButton = document.querySelector("#playButton");

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_YEAR = 2016;
const NOW_YEAR = 2026;
const MAX_YEAR = 2036;

const metricDefinitions = [
  { key: "population", label: "Population capacity", unit: "k", color: "#e86d35" },
  { key: "traffic", label: "Traffic congestion", unit: "%", color: "#ff6b5f" },
  { key: "green", label: "Green space access", unit: "%", color: "#7be0b8" },
  { key: "carbon", label: "Carbon pressure", unit: "%", color: "#ffb000" },
];

const toolEffects = {
  housing: {
    label: "Stacked homes",
    population: 18,
    traffic: 4,
    green: -2,
    carbon: 3,
    narrative: "New stacked homes increase capacity while nudging local services and streets harder.",
  },
  road: {
    label: "Smart road",
    population: 2,
    traffic: -12,
    green: -3,
    carbon: 5,
    narrative: "A smart road unlocks movement, but the model warns about induced emissions.",
  },
  green: {
    label: "Green corridor",
    population: 4,
    traffic: -3,
    green: 16,
    carbon: -10,
    narrative: "A green corridor cools the route and gives denser areas breathing room.",
  },
  transit: {
    label: "Transit hub",
    population: 9,
    traffic: -16,
    green: 3,
    carbon: -7,
    narrative: "A transit hub pulls pressure away from car routes and expands reachable neighbourhoods.",
  },
};

const placementPlan = [
  { x: 446, y: 220 },
  { x: 620, y: 318 },
  { x: 306, y: 404 },
  { x: 528, y: 450 },
  { x: 226, y: 270 },
  { x: 688, y: 238 },
  { x: 390, y: 518 },
  { x: 168, y: 350 },
];

let interventions = [];
let playTimer = 0;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getBaseMetrics(year) {
  const historicProgress = clamp((Math.min(year, NOW_YEAR) - MIN_YEAR) / (NOW_YEAR - MIN_YEAR), 0, 1);
  const futureProgress = clamp((year - NOW_YEAR) / (MAX_YEAR - NOW_YEAR), 0, 1);

  return {
    population: Math.round(336 + historicProgress * 35 + futureProgress * 28),
    traffic: Math.round(48 + historicProgress * 12 + futureProgress * 8),
    green: Math.round(42 - historicProgress * 3 + futureProgress * 2),
    carbon: Math.round(55 - historicProgress * 5 + futureProgress * 6),
  };
}

function getActiveInterventions(year) {
  return interventions.filter((item) => item.year <= year);
}

function getMetrics(year) {
  const metrics = getBaseMetrics(year);
  const activeInterventions = getActiveInterventions(year);

  for (const item of activeInterventions) {
    const effect = toolEffects[item.tool];
    metrics.population += effect.population;
    metrics.traffic += effect.traffic;
    metrics.green += effect.green;
    metrics.carbon += effect.carbon;
  }

  return {
    population: clamp(metrics.population, 300, 620),
    traffic: clamp(metrics.traffic, 15, 96),
    green: clamp(metrics.green, 18, 88),
    carbon: clamp(metrics.carbon, 18, 96),
  };
}

function formatMetric(definition, value) {
  if (definition.key === "population") {
    return `${value}${definition.unit}`;
  }

  return `${value}${definition.unit}`;
}

function renderMetrics(metrics) {
  metricsRoot.replaceChildren(
    ...metricDefinitions.map((definition) => {
      const row = document.createElement("article");
      row.className = "metric";

      const top = document.createElement("div");
      top.className = "metric__top";

      const label = document.createElement("span");
      label.textContent = definition.label;

      const value = document.createElement("span");
      value.textContent = formatMetric(definition, metrics[definition.key]);

      const meter = document.createElement("div");
      meter.className = "meter";
      meter.setAttribute("role", "meter");
      meter.setAttribute("aria-label", definition.label);
      meter.setAttribute("aria-valuemin", "0");
      meter.setAttribute("aria-valuemax", definition.key === "population" ? "620" : "100");
      meter.setAttribute("aria-valuenow", String(metrics[definition.key]));
      meter.setAttribute("aria-valuetext", formatMetric(definition, metrics[definition.key]));
      meter.style.setProperty("--meter-color", definition.color);

      const fill = document.createElement("span");
      const percent = definition.key === "population" ? ((metrics.population - 300) / 320) * 100 : metrics[definition.key];
      fill.style.setProperty("--value", `${clamp(percent, 0, 100)}%`);

      top.append(label, value);
      meter.append(fill);
      row.append(top, meter);
      return row;
    }),
  );
}

function getPhase(year) {
  if (year < 2020) return "baseline recovery";
  if (year < 2024) return "regeneration pressure";
  if (year <= NOW_YEAR) return "present-day reading";
  if (year < 2032) return "future sandbox";
  return "long-range scenario";
}

function getStory(year, activeCount) {
  if (year <= 2018) {
    return "Belfast is shown with early regeneration energy: modest capacity, fragile transport flow, and clear opportunities around the river corridor.";
  }

  if (year <= 2022) {
    return "The model increases density around central districts and the harbour edge, while congestion begins to rise on cross-city arteries.";
  }

  if (year <= NOW_YEAR) {
    return "By 2026, growth is visible but constrained: the city has stronger mixed-use cores, yet traffic pressure and green access remain uneven.";
  }

  if (activeCount === 0) {
    return "The future baseline projects continued growth through 2036. Add interventions to see how planning choices reshape the forecast.";
  }

  return `${activeCount} future intervention${activeCount === 1 ? " is" : "s are"} active in this scenario, reshaping capacity, movement, green access, and carbon pressure through ${year}.`;
}

function updateMapStyles(year, metrics) {
  const historicProgress = clamp((Math.min(year, NOW_YEAR) - MIN_YEAR) / (NOW_YEAR - MIN_YEAR), 0, 1);
  const futureProgress = clamp((year - NOW_YEAR) / (MAX_YEAR - NOW_YEAR), 0, 1);

  mapStage.style.setProperty("--density-core", (0.25 + historicProgress * 0.28 + futureProgress * 0.08).toFixed(2));
  mapStage.style.setProperty("--density-harbour", (0.2 + historicProgress * 0.22 + futureProgress * 0.13).toFixed(2));
  mapStage.style.setProperty("--density-south", (0.18 + historicProgress * 0.16 + metrics.green / 420).toFixed(2));
  mapStage.style.setProperty("--density-west", (0.18 + historicProgress * 0.14 + futureProgress * 0.1).toFixed(2));
  mapStage.style.setProperty("--density-growth", (0.14 + futureProgress * 0.26).toFixed(2));
  mapStage.style.setProperty("--road-opacity", (0.28 + metrics.traffic / 150).toFixed(2));
}

function createInterventionShape(item, index) {
  const group = document.createElementNS(SVG_NS, "g");
  const placement = placementPlan[index % placementPlan.length];
  group.classList.add("intervention", `intervention--${item.tool}`);
  group.setAttribute("aria-label", `${toolEffects[item.tool].label} added in ${item.year}`);

  if (item.tool === "housing") {
    for (let level = 0; level < 3; level += 1) {
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(placement.x - 18 + level * 6));
      rect.setAttribute("y", String(placement.y - 30 - level * 14));
      rect.setAttribute("width", "32");
      rect.setAttribute("height", "34");
      rect.setAttribute("rx", "5");
      group.append(rect);
    }
  }

  if (item.tool === "road") {
    const line = document.createElementNS(SVG_NS, "path");
    line.setAttribute("d", `M ${placement.x - 56} ${placement.y + 34} C ${placement.x - 20} ${placement.y - 20}, ${placement.x + 30} ${placement.y + 56}, ${placement.x + 70} ${placement.y - 14}`);
    group.append(line);
  }

  if (item.tool === "green") {
    const leaf = document.createElementNS(SVG_NS, "ellipse");
    leaf.setAttribute("cx", String(placement.x));
    leaf.setAttribute("cy", String(placement.y));
    leaf.setAttribute("rx", "48");
    leaf.setAttribute("ry", "20");
    leaf.setAttribute("transform", `rotate(-28 ${placement.x} ${placement.y})`);
    group.append(leaf);
  }

  if (item.tool === "transit") {
    const outer = document.createElementNS(SVG_NS, "circle");
    outer.setAttribute("cx", String(placement.x));
    outer.setAttribute("cy", String(placement.y));
    outer.setAttribute("r", "28");
    const inner = document.createElementNS(SVG_NS, "circle");
    inner.setAttribute("cx", String(placement.x));
    inner.setAttribute("cy", String(placement.y));
    inner.setAttribute("r", "10");
    inner.setAttribute("fill", "#090d0d");
    group.append(outer, inner);
  }

  return group;
}

function renderInterventions(year) {
  const activeInterventions = getActiveInterventions(year);
  interventionLayer.replaceChildren(
    ...activeInterventions.map((item, index) => createInterventionShape(item, index)),
  );
}

function renderScenarioLog() {
  if (interventions.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No interventions yet. Future scenarios unlock after 2026.";
    scenarioLog.replaceChildren(empty);
    return;
  }

  scenarioLog.replaceChildren(
    ...interventions.map((item) => {
      const entry = document.createElement("li");
      entry.textContent = `${item.year}: ${toolEffects[item.tool].label}`;
      return entry;
    }),
  );
}

function updateToolState(year) {
  const unlocked = year > NOW_YEAR;
  sandboxPill.textContent = unlocked ? "Sandbox open" : "Locked until 2027";
  sandboxPill.classList.toggle("is-open", unlocked);
  toolbox.setAttribute("aria-disabled", String(!unlocked));

  for (const button of toolButtons) {
    button.disabled = !unlocked;
  }
}

function updateUi() {
  const year = Number(yearRange.value);
  const activeInterventions = getActiveInterventions(year);
  const metrics = getMetrics(year);
  const sandboxOpen = year > NOW_YEAR;

  yearLabel.textContent = String(year);
  phaseLabel.textContent = getPhase(year);
  modeLabel.textContent = sandboxOpen ? "Future sandbox" : "Historic playback";
  modeHint.textContent = sandboxOpen
    ? "Add planning interventions and compare their effects through 2036."
    : "Move the year slider beyond 2026 to unlock interventions.";
  mapStatus.textContent = sandboxOpen ? "Scenario forecast active" : "Historic view loaded";
  mapNarrative.textContent = activeInterventions.at(-1)?.tool
    ? toolEffects[activeInterventions.at(-1).tool].narrative
    : "Belfast evolves as the slider moves: density, mobility pressure, and green access change together.";
  storyText.textContent = getStory(year, activeInterventions.length);

  updateToolState(year);
  updateMapStyles(year, metrics);
  renderMetrics(metrics);
  renderInterventions(year);
}

function addIntervention(tool) {
  const year = Number(yearRange.value);
  if (year <= NOW_YEAR || !toolEffects[tool]) return;

  interventions = [...interventions, { tool, year }];
  renderScenarioLog();
  updateUi();
}

function togglePlayback() {
  if (playTimer) {
    window.clearInterval(playTimer);
    playTimer = 0;
    playButton.textContent = "Play years";
    playButton.setAttribute("aria-pressed", "false");
    return;
  }

  playButton.textContent = "Pause";
  playButton.setAttribute("aria-pressed", "true");
  playTimer = window.setInterval(() => {
    const nextYear = Number(yearRange.value) >= MAX_YEAR ? MIN_YEAR : Number(yearRange.value) + 1;
    yearRange.value = String(nextYear);
    updateUi();
  }, 850);
}

yearRange.addEventListener("input", updateUi);
playButton.addEventListener("click", togglePlayback);

for (const button of toolButtons) {
  button.addEventListener("click", () => addIntervention(button.dataset.tool));
}

renderScenarioLog();
updateUi();
