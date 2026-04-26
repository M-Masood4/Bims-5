const fs = require("fs");
const http = require("http");
const path = require("path");
const childProcess = require("child_process");
const scenarioStudio = require("./lib/scenario-studio");

const rootDir = __dirname;
const webDir = path.join(rootDir, "web");
const manifestPath = path.join(rootDir, "api", "replay-manifest.json");
const eventsCatalogPath = path.join(rootDir, "data", "derived", "2026", "belfast_infrastructure_events_2016_2026.json");
const port = Number(process.env.PORT || 5173);
loadLocalEnv(path.join(rootDir, ".env.local"));

let eventsCache = null;
let eventsByYearSignal = null;
function loadEventsCatalog() {
  if (eventsCache) return eventsCache;
  if (!fs.existsSync(eventsCatalogPath)) return null;
  try {
    const raw = fs.readFileSync(eventsCatalogPath, "utf8");
    const json = JSON.parse(raw);
    eventsCache = json;
    eventsByYearSignal = {};
    (json.events || []).forEach((ev) => {
      if (!ev || !ev.year || !ev.signal) return;
      const k = ev.year + "|" + ev.signal;
      if (!eventsByYearSignal[k]) eventsByYearSignal[k] = [];
      eventsByYearSignal[k].push(ev);
    });
    return eventsCache;
  } catch (e) {
    console.warn("events catalog load failed", e.message);
    return null;
  }
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".tif": "image/tiff"
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function loadLocalEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key]) continue;
    let value = match[2] || "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function readRequestBody(req, limitBytes = 64_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > limitBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function geminiKey() {
  return process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GEMINI_KEY ||
    process.env.gemini_api ||
    process.env.GEMINI_API ||
    process.env.GOOGLE_API_KEY ||
    "";
}

function fallbackCommitExplanation(payload) {
  const commit = payload.commit || {};
  const signal = commit.type || payload.signal || "signal";
  const area = commit.area || "Belfast";
  const year = payload.year || commit.year || "the selected year";
  const delta = typeof commit.delta === "number" ? `${commit.delta >= 0 ? "+" : ""}${Math.round(commit.delta * 100)}%` : "changed";
  return `In ${year}, ${signal} around ${area} is the selected city diff (${delta} vs 2016). The map highlight comes from replay grid cells and the evidence trail lists the local datasets behind the change.`;
}

function extractGeminiText(payload) {
  return (payload.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "")
    .join("\n")
    .trim();
}

function extractJsonFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Gemini returned an empty response.");
  try {
    return JSON.parse(raw);
  } catch (_error) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const startObject = raw.indexOf("{");
    const startArray = raw.indexOf("[");
    const start = startObject === -1 ? startArray : startArray === -1 ? startObject : Math.min(startObject, startArray);
    const end = raw.lastIndexOf(raw[start] === "[" ? "]" : "}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error("Gemini did not return valid JSON.");
  }
}

async function readJsonRequest(req, limitBytes = 512_000) {
  const raw = await readRequestBody(req, limitBytes);
  return raw ? JSON.parse(raw) : {};
}

async function callGeminiJson({ agentName, prompt, temperature = 0.25, maxOutputTokens = 1400, responseJsonSchema = null }) {
  const apiKey = geminiKey();
  if (!apiKey) {
    const error = new Error("Gemini API key is required for Scenario Studio. Add GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY to .env.local.");
    error.statusCode = 503;
    throw error;
  }
  const model = process.env.GEMINI_SCENARIO_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const generationConfig = {
    temperature,
    maxOutputTokens,
    responseMimeType: "application/json",
    thinkingConfig: { thinkingBudget: 0 }
  };
  if (responseJsonSchema) generationConfig.responseJsonSchema = responseJsonSchema;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig
    })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(`${agentName} Gemini call failed with ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
    error.statusCode = 502;
    throw error;
  }
  const payload = await response.json();
  const text = extractGeminiText(payload);
  try {
    return { model, json: extractJsonFromText(text), rawText: text };
  } catch (parseError) {
    const snippet = text ? ` Response started: ${text.replace(/\s+/g, " ").slice(0, 180)}` : "";
    const error = new Error(`${agentName} did not return valid JSON: ${parseError.message}.${snippet}`);
    error.statusCode = 502;
    throw error;
  }
}

function compactBuilding(building) {
  return {
    location: building.location,
    config: building.config,
    delivery: building.delivery,
    validation: building.validation
  };
}

function compactSiteContext(siteContext) {
  return {
    validation: siteContext.validation,
    nearestCellId: siteContext.nearestCellId,
    deprivationWeight: siteContext.deprivationWeight,
    baselineMetrics: siteContext.baselineMetrics,
    nearbyTransport: siteContext.nearbyTransport,
    nearbyServices: siteContext.nearbyServices,
    greenContext: siteContext.greenContext,
    floodOrWaterContext: siteContext.floodOrWaterContext
  };
}

function fallbackScenarioStudioResponse(payload, building, validation, siteContext, detail = "") {
  const coordinator = scenarioStudio.buildCoordinatorPlan(payload);
  const specialistAgents = scenarioStudio.buildSpecialistRecommendations({ building, siteContext });
  const variants = scenarioStudio.generateFallbackVariants({ building, siteContext }, rootDir).scenarioVariants;
  const forecast = scenarioStudio.runForecastScenario({
    scenarioId: payload.scenarioId || payload.scenario_id || "housing_growth",
    postcode: payload.postcode || building.postcode,
    resolvedPostcode: payload.resolvedPostcode || building.resolvedPostcode,
    building,
    variants
  }, rootDir);
  const simulation = forecast.simulation;
  const critic = scenarioStudio.critiqueSimulation({
    branches: forecast.branches,
    siteContext,
    recommendedBranch: forecast.recommendedBranch
  });
  const report = scenarioStudio.reportSimulation({
    branches: forecast.branches,
    criticNotes: critic
  });
  return {
    ...forecast,
    ok: true,
    geminiRequired: false,
    fallback: true,
    fallbackReason: detail || "Deterministic local scenario workflow used.",
    coordinator,
    building,
    validation,
    siteContext,
    siteAgent: {
      site_status: validation.status,
      site_label: validation.siteLabel || validation.site_label,
      warnings: validation.warnings || [],
      positive_factors: validation.positiveFactors || validation.positive_factors || [],
      confidence: validation.confidence || "medium"
    },
    specialistAgents,
    variants,
    simulation,
    critic,
    report
  };
}

function compactBranches(branches) {
  return (branches || []).map((branch) => ({
    name: branch.name,
    objective: branch.objective,
    description: branch.description,
    metrics: branch.metrics,
    diffFromBaseline: branch.diffFromBaseline,
    score: branch.score,
    recommended: branch.recommended,
    interventions: (branch.interventions || []).map((item) => ({
      type: item.type || item.interventionType,
      mode: item.mode,
      size: item.size || item.config?.size,
      buildingType: item.buildingType || item.building_type || item.config?.buildingType,
      affordabilityMix: item.affordabilityMix || item.affordability_mix || item.config?.affordabilityMix,
      rationale: item.rationale
    }))
  }));
}

function requireKeys(object, keys, label) {
  for (const key of keys) {
    if (object?.[key] === undefined) throw new Error(`${label} missing required key: ${key}`);
  }
  return object;
}

const BUILDING_INTENT_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["building"] },
    location_name: { type: "string" },
    location: {
      type: ["object", "null"],
      properties: {
        lng: { type: "number" },
        lat: { type: "number" }
      }
    },
    size: { type: "string", enum: ["small", "medium", "large", "custom"] },
    buildingType: { type: "string", enum: ["apartments", "mixed_use", "office", "community"] },
    affordabilityMix: { type: "string", enum: ["market", "affordable", "social", "student"] }
  },
  required: ["type", "location_name", "size", "buildingType", "affordabilityMix"]
};

const COORDINATOR_SCHEMA = {
  type: "object",
  properties: {
    next_steps: { type: "array", items: { type: "string" } },
    required_agents: { type: "array", items: { type: "string" } },
    active_scenario: { type: "string" }
  },
  required: ["next_steps", "required_agents", "active_scenario"]
};

const SITE_AGENT_SCHEMA = {
  type: "object",
  properties: {
    site_status: { type: "string", enum: ["valid", "warning", "invalid"] },
    site_label: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
    positive_factors: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["low", "medium", "medium-high", "high"] }
  },
  required: ["site_status", "site_label", "warnings", "positive_factors", "confidence"]
};

const SPECIALIST_RECOMMENDATIONS_SCHEMA = {
  type: "object",
  properties: {
    agents: {
      type: "array",
      items: {
        type: "object",
        properties: {
          agent: { type: "string" },
          risk: { type: "string", enum: ["low", "medium", "medium-high", "high"] },
          opportunity: { type: "string", enum: ["low", "medium", "high"] },
          reason: { type: "string" },
          recommended_variant: {
            type: "object",
            properties: {
              add_mobility_corridor: { type: "boolean" },
              mode: { type: "string" },
              radius_m: { type: "integer" },
              buildingType: { type: "string" },
              commercialShare: { type: "number" },
              communityShare: { type: "number" },
              energyStandard: { type: "string" },
              solarOrStorageAssumption: { type: "boolean" },
              affordabilityMix: { type: "string" },
              connectToOpportunityHub: { type: "boolean" },
              addGreenCorridor: { type: "boolean" },
              bufferRadiusM: { type: "integer" }
            }
          }
        },
        required: ["agent", "risk", "opportunity", "reason", "recommended_variant"]
      }
    }
  },
  required: ["agents"]
};

const SCENARIO_VARIANTS_SCHEMA = {
  type: "object",
  properties: {
    scenario_variants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          branchName: { type: "string" },
          objective: {
            type: "string",
            enum: ["user_proposal", "traffic_mitigation", "jobs_optimised", "fairness_first", "green_mitigation", "balanced"]
          },
          description: { type: "string" },
          interventions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["building", "mobility_corridor", "green_corridor", "opportunity_hub"] },
                locationName: { type: "string" },
                size: { type: "string", enum: ["small", "medium", "large", "custom"] },
                buildingType: { type: "string", enum: ["apartments", "mixed_use", "office", "community"] },
                affordabilityMix: { type: "string", enum: ["market", "affordable", "social", "student"] },
                mode: { type: "string" },
                radius_m: { type: "integer" },
                bufferRadiusM: { type: "integer" },
                energyStandard: { type: "string" },
                rationale: { type: "string" }
              },
              required: ["type", "rationale"]
            }
          },
          assumptions: { type: "array", items: { type: "string" } }
        },
        required: ["branchName", "objective", "description", "interventions", "assumptions"]
      }
    }
  },
  required: ["scenario_variants"]
};

const CRITIC_SCHEMA = {
  type: "object",
  properties: {
    confidenceLabel: { type: "string", enum: ["low", "medium", "medium-high", "high"] },
    humanReviewRequired: { type: "boolean" },
    warnings: { type: "array", items: { type: "string" } },
    unsupportedClaims: { type: "array", items: { type: "string" } },
    recommendedBranch: { type: "string" },
    recommendations: { type: "array", items: { type: "string" } }
  },
  required: ["confidenceLabel", "humanReviewRequired", "warnings", "unsupportedClaims", "recommendedBranch", "recommendations"]
};

const REPORTER_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    city_commits: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } }
  },
  required: ["headline", "summary", "city_commits", "recommendations", "warnings"]
};

function coordinatorPrompt(payload, building) {
  return [
    "You are the Coordinator Agent for Replay Belfast's 2036 Scenario Studio.",
    "Your job is to orchestrate a multi-agent city simulation workflow.",
    "Rules:",
    "- Do not calculate final metrics.",
    "- Do not invent numeric impacts.",
    "- Decide which specialist agents are needed.",
    "- Return only structured JSON.",
    "- Prioritise transparent, auditable planning.",
    "Return this JSON shape:",
    "{\"next_steps\":[\"validate_site\",\"gather_site_context\",\"generate_scenario_variants\",\"run_simulations\",\"critique_results\",\"summarise\"],\"required_agents\":[\"Site Agent\",\"Mobility Agent\",\"Economy Agent\",\"Energy Agent\",\"Fairness Agent\",\"Environment Agent\",\"Critic Agent\",\"Reporter Agent\"],\"active_scenario\":\"Housing Growth\"}",
    "Input:",
    JSON.stringify({
      event: "building_dropped",
      active_scenario: payload.active_scenario || payload.activeScenario || "Housing Growth",
      building: compactBuilding(building)
    })
  ].join("\n");
}

function siteAgentPrompt(building, siteContext) {
  return [
    "You are the Site Agent for Replay Belfast.",
    "Use the provided deterministic validation and site context. Do not override invalid constraints.",
    "Return only JSON with: site_status, site_label, warnings, positive_factors, confidence.",
    "Input:",
    JSON.stringify({
      building: compactBuilding(building),
      site_context: compactSiteContext(siteContext)
    })
  ].join("\n");
}

function variantPrompt(building, siteContext, specialistSeeds = []) {
  return [
    "You are the Scenario Variant Agent.",
    "Given a proposed building intervention in Belfast, create 5-6 executable scenario branches:",
    "1. User Proposal",
    "2. Traffic-Safe Variant",
    "3. Jobs-Optimised Variant",
    "4. Fairness-First Variant",
    "5. Green-Mitigation Variant",
    "6. Optional Balanced branch",
    "Rules:",
    "- Do not create final impact numbers.",
    "- Gemini decides what to test; the deterministic simulation engine calculates impacts later.",
    "- Each branch must be executable by the deterministic simulation engine.",
    "- Each branch must contain only supported intervention types: building, mobility_corridor, green_corridor, opportunity_hub.",
    "- Include assumptions clearly.",
    "- Return only JSON.",
    "Schema:",
    "{\"scenario_variants\":[{\"branchName\":\"Original Housing Proposal\",\"objective\":\"user_proposal|traffic_mitigation|jobs_optimised|fairness_first|green_mitigation|balanced\",\"description\":\"short\",\"interventions\":[{\"type\":\"building|mobility_corridor|green_corridor|opportunity_hub\",\"size\":\"small|medium|large|custom\",\"buildingType\":\"apartments|mixed_use|office|community\",\"affordabilityMix\":\"market|affordable|social|student\",\"mode\":\"transit_first\",\"radius_m\":700,\"rationale\":\"short\"}],\"assumptions\":[\"short\"]}]}",
    "Input:",
    JSON.stringify({
      building: compactBuilding(building),
      site_context: compactSiteContext(siteContext),
      specialist_context: specialistSeeds
    })
  ].join("\n");
}

function specialistPrompt(building, siteContext) {
  return [
    "You are a panel of specialist Gemini agents for Replay Belfast.",
    "Agents: Population Agent, Mobility Agent, Economy Agent, Energy Agent, Environment Agent, Fairness Agent.",
    "Use only the building and site context. Do not invent final simulation metrics.",
    "For each agent, return a short structured recommendation that can inform scenario branches.",
    "Return only JSON with this shape:",
    "{\"agents\":[{\"agent\":\"Mobility Agent\",\"risk\":\"low|medium|medium-high|high\",\"opportunity\":\"low|medium|high\",\"reason\":\"short\",\"recommended_variant\":{}}]}",
    "Input:",
    JSON.stringify({
      building: compactBuilding(building),
      site_context: compactSiteContext(siteContext)
    })
  ].join("\n");
}

function criticPrompt(simulation, siteContext) {
  return [
    "You are the Simulation Critic Agent.",
    "You receive deterministic simulation outputs for several Belfast 2036 branches.",
    "Your job:",
    "- Identify weak assumptions.",
    "- Flag uncertain or overconfident claims.",
    "- Recommend which branch is most balanced.",
    "- Decide if human planner review is required.",
    "Rules:",
    "- Never change metric values.",
    "- Never invent new metrics.",
    "- Explain uncertainty clearly.",
    "Return only JSON with this shape:",
    "{\"confidenceLabel\":\"low|medium|medium-high|high\",\"humanReviewRequired\":true,\"warnings\":[\"short\"],\"unsupportedClaims\":[\"short\"],\"recommendedBranch\":\"branch name\",\"recommendations\":[\"short\"]}",
    "Input:",
    JSON.stringify({
      site_context: compactSiteContext(siteContext),
      branches: compactBranches(simulation.branches),
      recommended_by_score: simulation.recommendedBranch
    })
  ].join("\n");
}

function reporterPrompt(simulation, critic) {
  return [
    "You are the Reporter Agent for Replay Belfast.",
    "Turn deterministic simulation results into a clear explanation for planners and residents.",
    "Rules:",
    "- Use only provided metrics.",
    "- Do not invent numbers.",
    "- Produce short city commits.",
    "- Explain who benefits and what trade-offs remain.",
    "Return only JSON with this shape:",
    "{\"headline\":\"short\",\"summary\":\"short\",\"city_commits\":[\"+ short\",\"! short\"],\"recommendations\":[\"short\"],\"warnings\":[\"short\"]}",
    "Input:",
    JSON.stringify({
      branches: compactBranches(simulation.branches),
      critic_notes: critic
    })
  ].join("\n");
}

const EXPORT_REPORT_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    executiveSummary: { type: "string" },
    comparisonSummary: { type: "string" },
    branchNarratives: {
      type: "array",
      items: {
        type: "object",
        properties: {
          branchName: { type: "string" },
          explanation: { type: "string" },
          opportunities: { type: "array", items: { type: "string" } },
          risks: { type: "array", items: { type: "string" } },
          nextSteps: { type: "array", items: { type: "string" } }
        },
        required: ["branchName", "explanation", "opportunities", "risks", "nextSteps"]
      }
    },
    methodNotes: { type: "array", items: { type: "string" } }
  },
  required: ["headline", "executiveSummary", "comparisonSummary", "branchNarratives", "methodNotes"]
};

const REPORT_DISPLAY_METRICS = [
  { id: "population", label: "Population", unit: "people", direction: "up" },
  { id: "traffic", label: "Traffic Congestion", unit: "index", direction: "down" },
  { id: "air", label: "Air Quality Index", unit: "AQI", direction: "up" },
  { id: "housing", label: "Housing Demand", unit: "index", direction: "down" },
  { id: "economy", label: "Economic Output", unit: "GBP billions", direction: "up" }
];

const REPORT_FORECAST_METRICS = [
  "traffic",
  "population",
  "jobs",
  "economy",
  "housingPressure",
  "services",
  "electricity",
  "environmentAir",
  "greenScore",
  "fairness",
  "fiscalBalance",
  "planningViability"
];

const CONCRETE_KEYS = {
  traffic: ["dailyTripsAdded", "roadReliefTrips", "netDailyTrips", "meanCongestionDelta", "journeyTimeDeltaPct"],
  jobs: ["grossJobsEstimate", "capacityEnabledJobs", "netJobsEstimate", "employmentAccessDelta"],
  electricity: ["peakKwChange", "transformerReliefKw", "overloadRiskDelta", "loadIndexDelta", "p10", "p50", "p90"],
  services: ["demandAdded", "capacityRelief", "netServiceDemand", "accessDelta"],
  buildings: ["units", "floors", "footprintSqm", "grossFloorAreaSqm"]
};

function cleanText(value, fallback = "") {
  const text = value === undefined || value === null ? fallback : String(value);
  return text.replace(/\s+/g, " ").trim();
}

function htmlEscape(value) {
  return cleanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numericObject(input) {
  const output = {};
  Object.entries(input || {}).forEach(([key, value]) => {
    const n = numberOrNull(value);
    if (n !== null) output[key] = n;
  });
  return output;
}

function reportDeltaLabel(value) {
  const n = numberOrNull(value);
  if (n === null) return "n/a";
  if (Math.abs(n) >= 1000) return `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString("en-GB")}`;
  if (Math.abs(n) >= 10) return `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
  return `${n >= 0 ? "+" : ""}${n.toFixed(3)}`;
}

function reportValue(metric, value) {
  const n = numberOrNull(value);
  if (n === null) return "n/a";
  if (metric.id === "population") return Math.round(n).toLocaleString("en-GB");
  if (metric.id === "economy") return `GBP ${n.toFixed(2)}B`;
  if (metric.id === "air") return `${Math.round(n)} AQI`;
  return n.toFixed(3);
}

function rawSignalValue(value) {
  const n = numberOrNull(value);
  if (n === null) return cleanText(value || "n/a");
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString("en-GB");
  return n.toFixed(3);
}

function slugify(value, fallback = "report") {
  return cleanText(value, fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || fallback;
}

function normalizeReportItem(item = {}) {
  const type = cleanText(item.type || item.interventionType || "item");
  const label = cleanText(item.label || item.title || item.name || type);
  const config = item.buildingConfig || item.config || {};
  return {
    id: cleanText(item.id || ""),
    type,
    label,
    year: numberOrNull(item.year) || null,
    preset: cleanText(item.preset || config.size || ""),
    plannerEngine: cleanText(item.plannerEngine || ""),
    details: {
      buildingType: cleanText(config.buildingType || item.buildingType || ""),
      affordabilityMix: cleanText(config.affordabilityMix || item.affordabilityMix || ""),
      floors: numberOrNull(config.floors || item.floors),
      footprintSqm: numberOrNull(config.footprintSqm || item.footprintSqm),
      capacityKva: numberOrNull(item.capacityKva || config.capacityKva),
      serviceRadiusM: numberOrNull(item.serviceRadiusM || item.radiusM || config.serviceRadiusM),
      pathPoints: arrayOf(item.path).length,
      roadLengthM: numberOrNull(item.lengthM)
    }
  };
}

function normalizeTimelineRow(row = {}) {
  const year = numberOrNull(row.year);
  if (year === null) return null;
  return {
    year,
    metrics: numericObject(row.metrics),
    rawForecastMetrics: numericObject(row.rawForecastMetrics)
  };
}

function normalizeReportBranch(input = {}, index = 0) {
  return {
    id: cleanText(input.id || `branch-${index + 1}`),
    name: cleanText(input.name || input.branchName || `Branch ${index + 1}`, `Branch ${index + 1}`),
    color: cleanText(input.color || "#3b82f6"),
    locked: Boolean(input.locked),
    forecastObjective: cleanText(input.forecastObjective || input.objective || "user_proposal"),
    metrics: numericObject(input.metrics),
    baselineMetrics: numericObject(input.baselineMetrics),
    rawForecastMetrics: numericObject(input.rawForecastMetrics),
    diffFromBaseline: numericObject(input.diffFromBaseline),
    concreteImpacts: input.concreteImpacts && typeof input.concreteImpacts === "object" ? input.concreteImpacts : null,
    timeline: arrayOf(input.timeline).map(normalizeTimelineRow).filter(Boolean).slice(0, 40),
    items: arrayOf(input.items).map(normalizeReportItem).slice(0, 80),
    activityLog: arrayOf(input.activityLog).slice(-12).map((entry) => ({
      title: cleanText(entry.title || entry.type || "Activity"),
      detail: cleanText(entry.detail || ""),
      year: numberOrNull(entry.year),
      createdAt: cleanText(entry.createdAt || "")
    })),
    scenario: {
      modelVersion: cleanText(input.scenario?.modelVersion || input.modelVersion || ""),
      transformerModelVersion: cleanText(input.scenario?.transformerModelVersion || input.transformerModelVersion || ""),
      recommendedBranch: cleanText(input.scenario?.recommendedBranch || input.recommendedBranch || ""),
      reportHeadline: cleanText(input.scenario?.reportHeadline || ""),
      reportSummary: cleanText(input.scenario?.reportSummary || ""),
      confidenceLabel: cleanText(input.scenario?.confidenceLabel || "")
    }
  };
}

function buildExportReportModel(payload = {}) {
  const branches = arrayOf(payload.branches).slice(0, 2).map(normalizeReportBranch);
  if (!branches.length) {
    const error = new Error("At least one branch is required for PDF export.");
    error.statusCode = 400;
    throw error;
  }
  const targetYear = numberOrNull(payload.targetYear || payload.year) || 2036;
  const baselineYear = numberOrNull(payload.baselineYear) || 2025;
  const forecastYears = arrayOf(payload.forecastYears).map(numberOrNull).filter((year) => year !== null);
  const baselineMetrics = numericObject(payload.baselineMetrics || branches[0].baselineMetrics);
  const rawBaselineMetrics = numericObject(payload.rawBaselineMetrics || payload.baselineRawForecastMetrics || {});
  return {
    generatedAt: cleanText(payload.generatedAt || new Date().toISOString()),
    targetYear,
    baselineYear,
    forecastYears: forecastYears.length ? forecastYears : Array.from({ length: 11 }, (_, i) => 2026 + i),
    exportMode: branches.length === 2 ? "two_branch" : "single_branch",
    baselineMetrics,
    rawBaselineMetrics,
    branches,
    source: {
      app: cleanText(payload.source?.app || "Replay Belfast Scenario Studio"),
      deterministicBasis: cleanText(payload.source?.deterministicBasis || "Local 2025 baseline forecast, deterministic scenario branches, and branch intervention data."),
      generatedBy: cleanText(payload.source?.generatedBy || "Export button"),
      note: cleanText(payload.source?.note || "")
    }
  };
}

function compactReportForGemini(report) {
  return {
    targetYear: report.targetYear,
    baselineYear: report.baselineYear,
    exportMode: report.exportMode,
    baselineMetrics: report.baselineMetrics,
    rawBaselineMetrics: report.rawBaselineMetrics,
    branches: report.branches.map((branch) => ({
      name: branch.name,
      forecastObjective: branch.forecastObjective,
      metrics: branch.metrics,
      rawForecastMetrics: branch.rawForecastMetrics,
      diffFromBaseline: branch.diffFromBaseline,
      itemCount: branch.items.length,
      items: branch.items.slice(0, 12),
      concreteImpacts: branch.concreteImpacts,
      scenario: branch.scenario
    }))
  };
}

function fallbackExportExplanation(report, detail = "") {
  const branchNames = report.branches.map((branch) => branch.name).join(" and ");
  const first = report.branches[0];
  const second = report.branches[1];
  const comparison = second
    ? `${first.name} and ${second.name} are compared against the same ${report.baselineYear} no-build baseline. Differences in the tables come directly from the deterministic branch metrics supplied by the dashboard.`
    : `${first.name} is compared against the ${report.baselineYear} no-build baseline. Differences in the tables come directly from deterministic branch metrics supplied by the dashboard.`;
  return {
    headline: `${branchNames} scenario report`,
    executiveSummary: `This export packages the selected ${report.targetYear} branch data into a planner-ready PDF. Numeric values are deterministic outputs from the local forecast and branch state; narrative notes are constrained to those supplied values.`,
    comparisonSummary: comparison,
    branchNarratives: report.branches.map((branch) => ({
      branchName: branch.name,
      explanation: `${branch.name} includes ${branch.items.length} staged item${branch.items.length === 1 ? "" : "s"} and uses the ${branch.forecastObjective || "user_proposal"} objective. Review the scorecard, timeline, and concrete impact tables before treating the branch as delivery-ready.`,
      opportunities: [
        "Use the KPI scorecard to identify where the branch improves against the no-build baseline.",
        "Use the intervention inventory to audit what drove the deterministic forecast."
      ],
      risks: [
        "Forecast outputs are proxy estimates and do not replace engineering, transport, or planning review."
      ],
      nextSteps: [
        "Validate high-impact measures with service owners.",
        "Use the concrete impact table to decide where deeper evidence is needed."
      ]
    })),
    methodNotes: [
      "Gemini was not used for this export narrative." + (detail ? ` ${detail}` : ""),
      "The PDF structure, headings, and table titles are deterministic and remain the same for every export."
    ],
    geminiUsed: false,
    model: null,
    error: detail
  };
}

async function buildExportExplanation(report) {
  if (!geminiKey()) return fallbackExportExplanation(report, "No Gemini key is configured.");
  try {
    const gemini = await callGeminiJson({
      agentName: "PDF Export Reporter",
      temperature: 0.2,
      maxOutputTokens: 2200,
      responseJsonSchema: EXPORT_REPORT_SCHEMA,
      prompt: [
        "You are the PDF Export Reporter for Replay Belfast.",
        "Explain the selected scenario branch export using only the deterministic data provided.",
        "Rules:",
        "- Do not invent metrics, sources, places, dates, or claims.",
        "- Keep wording useful to city planners and residents.",
        "- Refer to tables by their fixed titles only when helpful.",
        "- If two branches are supplied, compare them clearly. If one branch is supplied, compare it to the baseline.",
        "- Return only JSON matching the schema.",
        "Deterministic export payload:",
        JSON.stringify(compactReportForGemini(report))
      ].join("\n")
    });
    const parsed = requireKeys(gemini.json, ["headline", "executiveSummary", "comparisonSummary", "branchNarratives", "methodNotes"], "PDF Export Reporter response");
    return { ...parsed, geminiUsed: true, model: gemini.model };
  } catch (error) {
    return fallbackExportExplanation(report, `Gemini explanation failed: ${error.message}`);
  }
}

function tableHtml(title, headers, rows) {
  const bodyRows = rows.length ? rows : [headers.map((_, index) => index === 0 ? "No data supplied" : "")];
  return [
    `<h3>${htmlEscape(title)}</h3>`,
    "<table>",
    "<thead><tr>",
    headers.map((header) => `<th>${htmlEscape(header)}</th>`).join(""),
    "</tr></thead>",
    "<tbody>",
    bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${htmlEscape(cell)}</td>`).join("")}</tr>`).join(""),
    "</tbody>",
    "</table>"
  ].join("");
}

function listHtml(items) {
  const safeItems = arrayOf(items).filter((item) => cleanText(item));
  if (!safeItems.length) return "<p class=\"muted\">No notes supplied.</p>";
  return `<ul>${safeItems.map((item) => `<li>${htmlEscape(item)}</li>`).join("")}</ul>`;
}

function scopeRows(report, explanation) {
  return [
    ["Export mode", report.exportMode === "two_branch" ? "Two branch comparison" : "Single branch report"],
    ["Target year", String(report.targetYear)],
    ["Baseline year", String(report.baselineYear)],
    ["Branches exported", report.branches.map((branch) => branch.name).join("; ")],
    ["Deterministic basis", report.source.deterministicBasis],
    ["Gemini narrative", explanation.geminiUsed ? `Used ${explanation.model}` : "Not used; deterministic fallback narrative"],
    ["Generated at", report.generatedAt]
  ];
}

function branchSummaryRows(report) {
  const a = report.branches[0];
  const b = report.branches[1] || null;
  const cell = (branch, key) => branch ? key(branch) : "-";
  return [
    ["Branch name", cell(a, (branch) => branch.name), cell(b, (branch) => branch.name)],
    ["Branch id", cell(a, (branch) => branch.id), cell(b, (branch) => branch.id)],
    ["Forecast objective", cell(a, (branch) => branch.forecastObjective), cell(b, (branch) => branch.forecastObjective)],
    ["Staged items", cell(a, (branch) => String(branch.items.length)), cell(b, (branch) => String(branch.items.length))],
    ["Scenario model", cell(a, (branch) => branch.scenario.modelVersion || "deterministic forecast"), cell(b, (branch) => branch.scenario.modelVersion || "deterministic forecast")],
    ["Transformer model", cell(a, (branch) => branch.scenario.transformerModelVersion || "not supplied"), cell(b, (branch) => branch.scenario.transformerModelVersion || "not supplied")],
    ["Recommended branch", cell(a, (branch) => branch.scenario.recommendedBranch || "not supplied"), cell(b, (branch) => branch.scenario.recommendedBranch || "not supplied")],
    ["Confidence", cell(a, (branch) => branch.scenario.confidenceLabel || "not supplied"), cell(b, (branch) => branch.scenario.confidenceLabel || "not supplied")]
  ];
}

function kpiRows(report) {
  const a = report.branches[0];
  const b = report.branches[1] || null;
  return REPORT_DISPLAY_METRICS.map((metric) => {
    const baseline = report.baselineMetrics[metric.id];
    const aValue = a.metrics[metric.id];
    const bValue = b ? b.metrics[metric.id] : null;
    const aNum = numberOrNull(aValue);
    const bNum = numberOrNull(bValue);
    const baseNum = numberOrNull(baseline);
    const delta = b
      ? (aNum === null || bNum === null ? null : bNum - aNum)
      : (aNum === null || baseNum === null ? null : aNum - baseNum);
    const readoutBase = b ? `${b.name} minus ${a.name}` : `${a.name} minus baseline`;
    return [
      metric.label,
      reportValue(metric, baseline),
      reportValue(metric, aValue),
      b ? reportValue(metric, bValue) : "-",
      reportDeltaLabel(delta),
      `${readoutBase}; ${metric.direction === "up" ? "higher is better" : "lower is better"}`
    ];
  });
}

function rawSignalRows(report) {
  const rows = [];
  for (const metric of REPORT_FORECAST_METRICS) {
    const baseline = report.rawBaselineMetrics[metric];
    const values = report.branches.map((branch) => branch.rawForecastMetrics[metric]);
    const aValue = numberOrNull(values[0]);
    const bValue = numberOrNull(values[1]);
    const diff = report.branches[1]
      ? (aValue === null || bValue === null ? null : bValue - aValue)
      : report.branches[0].diffFromBaseline[metric];
    rows.push([
      metric,
      baseline === undefined ? "n/a" : rawSignalValue(baseline),
      rawSignalValue(values[0]),
      report.branches[1] ? rawSignalValue(values[1]) : "-",
      reportDeltaLabel(diff)
    ]);
  }
  return rows;
}

function timelineRows(report) {
  const years = report.forecastYears.filter((year) => year >= 2026 && year <= 2036);
  const rows = [];
  for (const year of years) {
    for (const metric of REPORT_DISPLAY_METRICS) {
      const aRow = report.branches[0].timeline.find((row) => row.year === year);
      const bRow = report.branches[1]?.timeline.find((row) => row.year === year);
      rows.push([
        String(year),
        metric.label,
        reportValue(metric, report.baselineMetrics[metric.id]),
        reportValue(metric, aRow?.metrics?.[metric.id]),
        report.branches[1] ? reportValue(metric, bRow?.metrics?.[metric.id]) : "-"
      ]);
    }
  }
  return rows;
}

function concreteImpactRows(report) {
  const rows = [];
  for (const branch of report.branches) {
    const impacts = branch.concreteImpacts || {};
    for (const [domain, value] of Object.entries(impacts)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const keys = CONCRETE_KEYS[domain] || Object.keys(value).filter((key) => key !== "method" && key !== "modelBasis").slice(0, 8);
      for (const key of keys) {
        if (value[key] === undefined) continue;
        rows.push([
          branch.name,
          domain,
          key,
          rawSignalValue(value[key]),
          cleanText(value.method || value.modelBasis || impacts.modelBasis || "deterministic scenario output")
        ]);
      }
    }
  }
  return rows.slice(0, 90);
}

function interventionRows(report) {
  const rows = [];
  for (const branch of report.branches) {
    for (const item of branch.items) {
      const details = [];
      if (item.details.buildingType) details.push(`type ${item.details.buildingType}`);
      if (item.details.affordabilityMix) details.push(`mix ${item.details.affordabilityMix}`);
      if (item.details.floors !== null) details.push(`${item.details.floors} floors`);
      if (item.details.footprintSqm !== null) details.push(`${item.details.footprintSqm} sqm footprint`);
      if (item.details.capacityKva !== null) details.push(`${item.details.capacityKva} kVA`);
      if (item.details.serviceRadiusM !== null) details.push(`${item.details.serviceRadiusM} m radius`);
      if (item.details.pathPoints) details.push(`${item.details.pathPoints} path points`);
      rows.push([
        branch.name,
        item.year === null ? "n/a" : String(item.year),
        item.type,
        item.label,
        details.join("; ") || "No extra deterministic details supplied"
      ]);
    }
  }
  return rows;
}

function narrativeHtml(report, explanation) {
  return report.branches.map((branch) => {
    const narrative = arrayOf(explanation.branchNarratives).find((item) => item.branchName === branch.name) || {};
    return [
      `<div class="narrative">`,
      `<h3>${htmlEscape(branch.name)}</h3>`,
      `<p>${htmlEscape(narrative.explanation || `${branch.name} is included in this export.`)}</p>`,
      `<div class="note-grid">`,
      `<div><h4>Opportunities</h4>${listHtml(narrative.opportunities)}</div>`,
      `<div><h4>Risks</h4>${listHtml(narrative.risks)}</div>`,
      `<div><h4>Next Steps</h4>${listHtml(narrative.nextSteps)}</div>`,
      `</div>`,
      `</div>`
    ].join("");
  }).join("");
}

function renderBranchReportHtml(report, explanation) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${htmlEscape(explanation.headline)}</title>
<style>
@page { size: A4; margin: 14mm 12mm 16mm; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; color: #172033; font-size: 10.5px; line-height: 1.42; margin: 0; }
.cover { border-bottom: 2px solid #172033; padding-bottom: 14px; margin-bottom: 16px; }
.kicker { color: #526173; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; font-size: 9px; }
h1 { font-size: 24px; line-height: 1.1; margin: 5px 0 8px; }
h2 { font-size: 15px; margin: 18px 0 8px; padding-top: 6px; border-top: 1px solid #d8dee8; }
h3 { font-size: 11px; margin: 12px 0 5px; color: #253145; }
h4 { font-size: 10px; margin: 0 0 4px; color: #4b5b70; text-transform: uppercase; letter-spacing: 0.04em; }
p { margin: 0 0 8px; }
.meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }
.meta div { border: 1px solid #d8dee8; background: #f8fafc; padding: 7px; border-radius: 6px; }
.meta span { display: block; color: #64748b; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em; }
.meta strong { display: block; margin-top: 2px; font-size: 11px; }
table { width: 100%; border-collapse: collapse; margin: 4px 0 12px; page-break-inside: auto; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; page-break-after: auto; }
th { background: #172033; color: #fff; text-align: left; padding: 5px 6px; font-size: 8.8px; text-transform: uppercase; letter-spacing: 0.04em; }
td { border: 1px solid #d8dee8; padding: 5px 6px; vertical-align: top; }
tbody tr:nth-child(even) td { background: #f8fafc; }
.summary { border-left: 4px solid #2563eb; background: #f8fafc; padding: 10px 12px; margin: 8px 0 12px; }
.narrative { border: 1px solid #d8dee8; border-radius: 7px; padding: 9px; margin-bottom: 10px; }
.note-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
ul { margin: 0; padding-left: 15px; }
li { margin-bottom: 3px; }
.muted { color: #64748b; }
.footer-note { margin-top: 10px; color: #64748b; font-size: 9px; }
.page-break { break-before: page; }
</style>
</head>
<body>
  <section class="cover">
    <div class="kicker">Replay Belfast Scenario Export</div>
    <h1>${htmlEscape(explanation.headline)}</h1>
    <p>${htmlEscape(explanation.comparisonSummary)}</p>
    <div class="meta">
      <div><span>Target year</span><strong>${htmlEscape(report.targetYear)}</strong></div>
      <div><span>Export mode</span><strong>${htmlEscape(report.exportMode === "two_branch" ? "Two branches" : "One branch")}</strong></div>
      <div><span>Gemini</span><strong>${htmlEscape(explanation.geminiUsed ? explanation.model : "Fallback narrative")}</strong></div>
    </div>
  </section>

  <h2>Section 1. Export Scope</h2>
  ${tableHtml("Table 1. Export Scope and Data Sources", ["Field", "Value"], scopeRows(report, explanation))}

  <h2>Section 2. Executive Explanation</h2>
  <div class="summary">${htmlEscape(explanation.executiveSummary)}</div>

  <h2>Section 3. Branch Summary</h2>
  ${tableHtml("Table 2. Branch Summary", ["Field", "Branch A", "Branch B"], branchSummaryRows(report))}

  <h2>Section 4. KPI Scorecard</h2>
  ${tableHtml("Table 3. KPI Scorecard", ["Metric", "Baseline", "Branch A", "Branch B", "Delta", "Readout"], kpiRows(report))}
  ${tableHtml("Table 4. Deterministic Forecast Signals", ["Signal", "Baseline", "Branch A", "Branch B", "Delta"], rawSignalRows(report))}

  <h2 class="page-break">Section 5. Forecast Timeline</h2>
  ${tableHtml("Table 5. Forecast Timeline", ["Year", "Metric", "Baseline", "Branch A", "Branch B"], timelineRows(report))}

  <h2>Section 6. Concrete Impact Details</h2>
  ${tableHtml("Table 6. Concrete Impact Details", ["Branch", "Domain", "Measure", "Value", "Method / Basis"], concreteImpactRows(report))}

  <h2>Section 7. Intervention Inventory</h2>
  ${tableHtml("Table 7. Intervention Inventory", ["Branch", "Year", "Type", "Label", "Deterministic Details"], interventionRows(report))}

  <h2>Section 8. Gemini Planning Notes</h2>
  ${narrativeHtml(report, explanation)}

  <h2>Section 9. Method and Caveats</h2>
  ${listHtml(explanation.methodNotes)}
  <p class="footer-note">The headings and table titles in this PDF are fixed. Only branch content, metric values, and bounded narrative explanations change between exports.</p>
</body>
</html>`;
}

async function renderPdfFromHtml(html) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: "<div style=\"font-family:Arial,sans-serif;font-size:8px;color:#64748b;width:100%;padding:0 12mm;text-align:right;\">Replay Belfast Scenario Export - page <span class=\"pageNumber\"></span> of <span class=\"totalPages\"></span></div>",
      margin: { top: "14mm", right: "12mm", bottom: "16mm", left: "12mm" }
    });
  } finally {
    await browser.close();
  }
}

async function handleBranchReportExport(req, res) {
  try {
    const payload = await readJsonRequest(req, 4_000_000);
    const report = buildExportReportModel(payload);
    const explanation = await buildExportExplanation(report);
    const html = renderBranchReportHtml(report, explanation);
    const pdf = await renderPdfFromHtml(html);
    const filename = `belfast-${slugify(report.branches.map((branch) => branch.name).join("-vs-"), "branch-report")}-${report.targetYear}.pdf`;
    res.writeHead(200, {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-length": pdf.length,
      "cache-control": "no-store",
      "x-gemini-used": explanation.geminiUsed ? "true" : "false"
    });
    res.end(pdf);
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      ok: false,
      error: "Could not export branch report PDF",
      detail: error.message
    });
  }
}

async function handleGeminiCommitExplanation(req, res) {
  let payload = {};
  try {
    const raw = await readRequestBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch (error) {
    sendJson(res, 400, { error: "Invalid JSON body", detail: error.message });
    return;
  }

  const fallback = fallbackCommitExplanation(payload);
  const apiKey = geminiKey();
  if (!apiKey) {
    sendJson(res, 200, { ok: false, fallback: true, explanation: fallback });
    return;
  }

  const commit = payload.commit || {};
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const prompt = [
    "You are writing one concise planning readout for Replay Belfast.",
    "Use only the provided commit JSON. Do not invent exact facts.",
    "Explain what changed, why the map highlight matters, and what a planner should inspect next.",
    "Keep it to 55 words or fewer.",
    JSON.stringify({
      year: payload.year,
      signal: payload.signal,
      title: commit.title,
      area: commit.area,
      delta: commit.delta,
      confidence: commit.confidence,
      evidence: commit.evidence,
      affectedSignals: commit.affectedSignals,
    })
  ].join("\n");

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.35, maxOutputTokens: 140 }
      })
    });
    if (!response.ok) {
      sendJson(res, 200, { ok: false, fallback: true, explanation: fallback, detail: `Gemini ${response.status}` });
      return;
    }
    const geminiPayload = await response.json();
    const generated = extractGeminiText(geminiPayload);
    const explanation = generated.length >= 80 ? generated : fallback;
    sendJson(res, 200, { ok: true, fallback: explanation === fallback, model, explanation });
  } catch (error) {
    sendJson(res, 200, { ok: false, fallback: true, explanation: fallback, detail: error.message });
  }
}

async function handleParseBuildingIntent(req, res) {
  try {
    const payload = await readJsonRequest(req);
    const promptText = String(payload.prompt || "");
    const gemini = await callGeminiJson({
      agentName: "Building Intent Parser",
      temperature: 0.15,
      maxOutputTokens: 500,
      responseJsonSchema: BUILDING_INTENT_SCHEMA,
      prompt: [
        "You are the building-intent parser for Replay Belfast.",
        "Parse the user's request into one building intervention. Return only JSON.",
        "Allowed size: small, medium, large, custom.",
        "Allowed buildingType: apartments, mixed_use, office, community.",
        "Allowed affordabilityMix: market, affordable, social, student.",
        "Known Belfast places include Titanic Quarter, Cathedral Quarter, City Centre, Queen's Quarter, Waterfront, Belfast Harbour, Falls, Shankill, East Belfast.",
        "Return shape:",
        "{\"type\":\"building\",\"location_name\":\"Titanic Quarter\",\"size\":\"large\",\"buildingType\":\"apartments\",\"affordabilityMix\":\"affordable\"}",
        "Prompt:",
        promptText
      ].join("\n")
    });
    const parsed = requireKeys(gemini.json, ["type", "size", "buildingType", "affordabilityMix"], "Building intent");
    const known = scenarioStudio.parseBuildingIntentFallback(`${parsed.location_name || ""} ${promptText}`);
    sendJson(res, 200, {
      ok: true,
      geminiRequired: true,
      model: gemini.model,
      type: "building",
      location_name: parsed.location_name || known.location_name,
      location: parsed.location || known.location || null,
      size: parsed.size === "custom" || scenarioStudio.SIZE_PRESETS[parsed.size] ? parsed.size : "medium",
      buildingType: scenarioStudio.TYPE_PRESETS[parsed.buildingType] ? parsed.buildingType : scenarioStudio.canonicalBuildingType(parsed.buildingType),
      affordabilityMix: scenarioStudio.AFFORDABILITY_PRESETS[parsed.affordabilityMix] ? parsed.affordabilityMix : scenarioStudio.canonicalAffordability(parsed.affordabilityMix)
    });
  } catch (error) {
    sendJson(res, error.statusCode || 502, {
      ok: false,
      geminiRequired: true,
      error: "Could not parse building intent with Gemini",
      detail: error.message
    });
  }
}

async function handleValidatePlacement(req, res) {
  try {
    const payload = await readJsonRequest(req);
    const validation = scenarioStudio.validatePlacement({
      ...payload,
      requireResolvedPostcode: Boolean(payload.requireResolvedPostcode || payload.require_resolved_postcode)
    }, rootDir);
    const siteContext = scenarioStudio.getSiteContext({ ...payload, validation }, rootDir);
    sendJson(res, validation.status === "invalid" ? 422 : 200, {
      ...validation,
      siteContext
    });
  } catch (error) {
    sendJson(res, 400, { error: "Could not validate placement", detail: error.message });
  }
}

function featureCenter(feature) {
  const coords = [];
  function visit(value) {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      coords.push(value);
      return;
    }
    value.forEach(visit);
  }
  visit(feature && feature.geometry && feature.geometry.coordinates);
  if (!coords.length) return null;
  const sum = coords.reduce((acc, coord) => {
    acc[0] += Number(coord[0]) || 0;
    acc[1] += Number(coord[1]) || 0;
    return acc;
  }, [0, 0]);
  return { lng: sum[0] / coords.length, lat: sum[1] / coords.length };
}

function distanceKm(a, b) {
  if (!a || !b) return Infinity;
  const lat1 = Number(a.lat);
  const lat2 = Number(b.lat);
  const lng1 = Number(a.lng);
  const lng2 = Number(b.lng);
  if (![lat1, lat2, lng1, lng2].every(Number.isFinite)) return Infinity;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const rLat1 = lat1 * toRad;
  const rLat2 = lat2 * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function handleBuildableAreas(req, res) {
  try {
    const payload = req.method === "POST" ? await readJsonRequest(req) : {};
    const gridPath = path.join(webDir, "data", "mode-a", "grid_2026.geojson");
    const grid = JSON.parse(fs.readFileSync(gridPath, "utf8"));
    const config = scenarioStudio.deriveBuildingStats(payload.config || payload.building_config || {});
    const rawLocation = payload.location || {};
    const focus = Number.isFinite(Number(rawLocation.lng)) && Number.isFinite(Number(rawLocation.lat))
      ? { lng: Number(rawLocation.lng), lat: Number(rawLocation.lat) }
      : null;
    const requestedRadiusKm = Number(payload.radiusKm ?? payload.radius_km ?? 1.15);
    const radiusKm = focus
      ? Math.max(0.25, Math.min(4, Number.isFinite(requestedRadiusKm) ? requestedRadiusKm : 1.15))
      : null;
    const features = (grid.features || []).map((feature) => {
      const center = featureCenter(feature);
      const distanceFromFocusKm = focus && center ? distanceKm(focus, center) : null;
      if (radiusKm && (!Number.isFinite(distanceFromFocusKm) || distanceFromFocusKm > radiusKm)) {
        return null;
      }
      let validation = { status: "invalid", warnings: ["Could not resolve grid-cell centre"], buildabilityScore: 0 };
      if (center) {
        validation = scenarioStudio.validatePlacement({
          location: center,
          config,
          requireResolvedPostcode: false
        }, rootDir);
      }
      const props = feature.properties || {};
      const planningCandidate =
        Number(props.green_cover || 0) < 0.62 &&
        Number(props.buildings || 0) < 0.72 &&
        Number(props.traffic_pressure || 0) < 0.6 &&
        (
          Number(props.development_pressure || 0) > 0.12 ||
          Number(props.planning_intensity || 0) > 0.09 ||
          Number(props.transit_access || 0) > 0.22
        );
      const buildable = validation.status !== "invalid" && planningCandidate;
      const score = Number(validation.buildabilityScore || 0.55);
      return {
        ...feature,
        properties: {
          ...props,
          buildable,
          buildabilityStatus: validation.status,
          buildabilityScore: validation.buildabilityScore || 0,
          buildabilityWarnings: validation.warnings || [],
          distanceFromFocusKm,
          __buildableOpacity: buildable ? Math.max(0.18, Math.min(0.48, 0.18 + score * 0.26)) : 0,
          __buildableOpacity3d: buildable ? Math.max(0.18, Math.min(0.36, 0.16 + score * 0.18)) : 0,
          __buildableHeight: buildable ? Math.round(10 + score * 34) : 0
        }
      };
    }).filter(Boolean);
    sendJson(res, 200, {
      ok: true,
      preset: payload.preset || null,
      postcode: payload.postcode || null,
      radiusKm,
      count: features.length,
      buildableCount: features.filter((feature) => feature.properties.buildable).length,
      areas: { type: "FeatureCollection", features }
    });
  } catch (error) {
    sendJson(res, 500, { error: "Could not calculate buildable areas", detail: error.message });
  }
}

function handleResolvePostcode(req, res, requestUrl) {
  try {
    const postcode = requestUrl.searchParams.get("postcode") || requestUrl.searchParams.get("q") || "";
    if (!postcode.trim()) {
      sendJson(res, 400, { error: "postcode query is required" });
      return;
    }
    const resolved = scenarioStudio.resolvePostcode(postcode, rootDir);
    sendJson(res, 200, {
      ok: resolved.precision !== "invalid",
      ...resolved
    });
  } catch (error) {
    sendJson(res, 400, { error: "Could not resolve postcode", detail: error.message });
  }
}

async function handleGenerateBuildingVariants(req, res) {
  try {
    const payload = await readJsonRequest(req);
    const building = scenarioStudio.createBuildingIntervention(payload.building || payload, rootDir);
    const siteContext = payload.siteContext || scenarioStudio.getSiteContext({ location: building.location, geometry: building.geometry, config: building.config, validation: building.validation }, rootDir);
    const specialists = payload.specialistAgents || [];
    const gemini = await callGeminiJson({
      agentName: "Scenario Variant Agent",
      temperature: 0.35,
      maxOutputTokens: 3500,
      responseJsonSchema: SCENARIO_VARIANTS_SCHEMA,
      prompt: variantPrompt(building, siteContext, specialists)
    });
    const variants = scenarioStudio.sanitizeScenarioVariants(gemini.json, building, rootDir, { strict: true });
    sendJson(res, 200, {
      ok: true,
      geminiRequired: true,
      model: gemini.model,
      variants,
      scenario_variants: variants
    });
  } catch (error) {
    sendJson(res, error.statusCode || 502, {
      ok: false,
      geminiRequired: true,
      error: "Could not generate scenario variants with Gemini",
      detail: error.message
    });
  }
}

async function handleRunMultipleSimulations(req, res) {
  try {
    const payload = await readJsonRequest(req, 1_500_000);
    const result = scenarioStudio.runMultipleSimulations(payload, rootDir);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, error.statusCode || 400, {
      error: "Could not run deterministic simulations",
      detail: error.message,
      postcode: error.postcode,
      validation: error.validation
    });
  }
}

async function handleExplainSimulation(req, res) {
  try {
    const payload = await readJsonRequest(req, 1_500_000);
    const simulation = payload.simulation || { branches: payload.branches || [] };
    const critic = payload.criticNotes || payload.critic || {};
    const gemini = await callGeminiJson({
      agentName: "Reporter Agent",
      temperature: 0.3,
      maxOutputTokens: 2500,
      responseJsonSchema: REPORTER_SCHEMA,
      prompt: reporterPrompt(simulation, critic)
    });
    const report = requireKeys(gemini.json, ["headline", "summary", "city_commits", "recommendations"], "Reporter Agent response");
    sendJson(res, 200, {
      ok: true,
      geminiRequired: true,
      model: gemini.model,
      ...report
    });
  } catch (error) {
    sendJson(res, error.statusCode || 502, {
      ok: false,
      geminiRequired: true,
      error: "Could not explain simulation with Gemini",
      detail: error.message
    });
  }
}

async function handleScenarioStudioRun(req, res) {
  let payload = {};
  let building = null;
  let validation = null;
  let siteContext = null;
  try {
    payload = await readJsonRequest(req, 1_500_000);
    const postcodeValue = payload.postcode || payload.building?.postcode || "";
    const suppliedLocation = payload.building?.location || payload.location;
    const resolvedPostcode = payload.resolvedPostcode || payload.postcodeResolution || (postcodeValue ? scenarioStudio.resolvePostcode(postcodeValue, rootDir) : null);
    const useResolvedPostcode = Boolean(resolvedPostcode?.canPlace);
    if (!useResolvedPostcode && !suppliedLocation) {
      sendJson(res, 422, {
        ok: false,
        geminiRequired: false,
        error: "A full Belfast postcode or a valid map point is required before placing a building",
        postcode: resolvedPostcode,
        warnings: resolvedPostcode?.warnings || []
      });
      return;
    }
    building = scenarioStudio.createBuildingIntervention({
      ...(payload.building || payload),
      postcode: useResolvedPostcode ? resolvedPostcode.postcode : null,
      resolvedPostcode: useResolvedPostcode ? resolvedPostcode : null,
      location: suppliedLocation || resolvedPostcode.location,
      startYear: payload.startYear || 2026,
      completionYear: payload.horizonYear || 2036,
      requireResolvedPostcode: useResolvedPostcode
    }, rootDir);
    const isRemovalScenario = building.type === "building_removal" || building.removal === true;
    validation = scenarioStudio.validatePlacement({
      location: building.location,
      geometry: building.geometry,
      config: building.config,
      postcode: useResolvedPostcode ? resolvedPostcode.postcode : null,
      resolvedPostcode: useResolvedPostcode ? resolvedPostcode : null,
      requireResolvedPostcode: useResolvedPostcode,
      allowExistingBuildingOverlap: isRemovalScenario,
      allowRoadProximity: isRemovalScenario
    }, rootDir);
    siteContext = scenarioStudio.getSiteContext({ location: building.location, geometry: building.geometry, config: building.config, validation }, rootDir);

    if (validation.status === "invalid") {
      sendJson(res, 422, {
        ok: false,
        geminiRequired: true,
        error: "Placement is invalid",
        validation,
        siteContext
      });
      return;
    }

    const useGemini = Boolean(geminiKey());
    if (!useGemini) {
      const forecast = scenarioStudio.runForecastScenario({
        ...payload,
        postcode: useResolvedPostcode ? resolvedPostcode.postcode : null,
        resolvedPostcode: useResolvedPostcode ? resolvedPostcode : null,
        building
      }, rootDir);
      const critic = scenarioStudio.critiqueSimulation({
        branches: forecast.branches,
        siteContext,
        recommendedBranch: forecast.recommendedBranch
      });
      const report = scenarioStudio.reportSimulation({
        branches: forecast.branches,
        criticNotes: critic
      });
      sendJson(res, 200, {
        ...forecast,
        ok: true,
        geminiRequired: false,
        fallback: true,
        fallbackReason: "No Gemini key configured; deterministic local scenario workflow used.",
        coordinator: scenarioStudio.buildCoordinatorPlan(payload),
        siteAgent: {
          site_status: validation.status,
          site_label: validation.siteLabel || validation.site_label,
          warnings: validation.warnings || [],
          positive_factors: validation.positiveFactors || validation.positive_factors || [],
          confidence: validation.confidence || "medium"
        },
        specialistAgents: scenarioStudio.buildSpecialistRecommendations({ building, siteContext }),
        variants: scenarioStudio.generateFallbackVariants({ building, siteContext }, rootDir).scenarioVariants,
        critic,
        report
      });
      return;
    }

    const coordinatorGemini = await callGeminiJson({
      agentName: "Scenario Coordinator Agent",
      temperature: 0.15,
      maxOutputTokens: 1200,
      responseJsonSchema: COORDINATOR_SCHEMA,
      prompt: coordinatorPrompt(payload, building)
    });
    const coordinator = requireKeys(coordinatorGemini.json, ["next_steps", "required_agents"], "Coordinator Agent response");

    const siteGemini = await callGeminiJson({
      agentName: "Site Agent",
      temperature: 0.2,
      maxOutputTokens: 900,
      responseJsonSchema: SITE_AGENT_SCHEMA,
      prompt: siteAgentPrompt(building, siteContext)
    });
    const siteAgent = requireKeys(siteGemini.json, ["site_status", "site_label", "warnings", "positive_factors", "confidence"], "Site Agent response");

    const specialistGemini = await callGeminiJson({
      agentName: "Specialist Impact Agents",
      temperature: 0.25,
      maxOutputTokens: 3500,
      responseJsonSchema: SPECIALIST_RECOMMENDATIONS_SCHEMA,
      prompt: specialistPrompt(building, siteContext)
    });
    const specialistAgents = Array.isArray(specialistGemini.json.agents) ? specialistGemini.json.agents : null;
    if (!specialistAgents?.length) throw new Error("Specialist agents response must include an agents array.");

    const variantGemini = isRemovalScenario ? null : await callGeminiJson({
      agentName: "Scenario Variant Agent",
      temperature: 0.35,
      maxOutputTokens: 4000,
      responseJsonSchema: SCENARIO_VARIANTS_SCHEMA,
      prompt: variantPrompt(building, siteContext, specialistAgents)
    });
    const variants = scenarioStudio.sanitizeScenarioVariants(isRemovalScenario ? (payload.branches || payload.variants) : variantGemini.json, building, rootDir, { strict: !isRemovalScenario });
    const forecast = scenarioStudio.runForecastScenario({
      ...payload,
      scenarioId: payload.scenarioId || payload.scenario_id || "housing_growth",
      postcode: useResolvedPostcode ? resolvedPostcode.postcode : null,
      resolvedPostcode: useResolvedPostcode ? resolvedPostcode : null,
      building,
      variants
    }, rootDir);
    const simulation = forecast.simulation;

    const criticGemini = await callGeminiJson({
      agentName: "Simulation Critic Agent",
      temperature: 0.2,
      maxOutputTokens: 2500,
      responseJsonSchema: CRITIC_SCHEMA,
      prompt: criticPrompt(simulation, siteContext)
    });
    const critic = requireKeys(criticGemini.json, ["confidenceLabel", "humanReviewRequired", "warnings", "unsupportedClaims", "recommendedBranch", "recommendations"], "Critic Agent response");

    const reporterGemini = await callGeminiJson({
      agentName: "Reporter Agent",
      temperature: 0.3,
      maxOutputTokens: 2500,
      responseJsonSchema: REPORTER_SCHEMA,
      prompt: reporterPrompt(simulation, critic)
    });
    const report = requireKeys(reporterGemini.json, ["headline", "summary", "city_commits", "recommendations"], "Reporter Agent response");

    sendJson(res, 200, {
      ...forecast,
      ok: true,
      geminiRequired: true,
      models: {
        coordinator: coordinatorGemini.model,
        site: siteGemini.model,
        specialists: specialistGemini.model,
        variants: variantGemini.model,
        critic: criticGemini.model,
        reporter: reporterGemini.model
      },
      coordinator,
      building,
      validation,
      siteContext,
      siteAgent,
      specialistAgents,
      variants,
      simulation,
      critic,
      report
    });
  } catch (error) {
    if (building && validation && siteContext && validation.status !== "invalid") {
      sendJson(res, 200, fallbackScenarioStudioResponse(payload, building, validation, siteContext, error.message));
      return;
    }
    sendJson(res, error.statusCode || 502, {
      ok: false,
      geminiRequired: Boolean(geminiKey()),
      error: "Scenario workflow failed",
      detail: error.message,
      postcode: error.postcode,
      validation: error.validation
    });
  }
}

function loadManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function currentBranch() {
  try {
    return childProcess.execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch (_error) {
    return process.env.RENDER_GIT_BRANCH || process.env.BRANCH || "unknown";
  }
}

function safeResolve(baseDir, requestPath) {
  const cleanPath = decodeURIComponent(requestPath.split("?")[0]);
  const resolved = path.resolve(baseDir, cleanPath.replace(/^\/+/, ""));
  if (!resolved.startsWith(path.resolve(baseDir))) {
    return null;
  }
  return resolved;
}

function streamFile(res, filePath) {
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": mimeTypes[ext] || "application/octet-stream",
      "content-length": stat.size,
      "cache-control": "no-store"
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function findLayer(manifest, year, layerId) {
  return manifest.layers.find((layer) => String(layer.year) === String(year) && layer.id === layerId);
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname || "/";

  if (req.method === "POST" && pathname === "/api/gemini/commit-explanation") {
    handleGeminiCommitExplanation(req, res);
    return;
  }

  if (req.method === "GET" && pathname === "/api/postcode/resolve") {
    handleResolvePostcode(req, res, requestUrl);
    return;
  }

  if (req.method === "POST" && pathname === "/api/agents/parse-building-intent") {
    handleParseBuildingIntent(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/building/validate-placement") {
    handleValidatePlacement(req, res);
    return;
  }

  if ((req.method === "POST" || req.method === "GET") && pathname === "/api/building/buildable-areas") {
    handleBuildableAreas(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/agents/generate-building-variants") {
    handleGenerateBuildingVariants(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/simulation/run-multiple") {
    handleRunMultipleSimulations(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/agents/explain-simulation") {
    handleExplainSimulation(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/export/branch-report") {
    handleBranchReportExport(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/scenario-studio/run") {
    handleScenarioStudioRun(req, res);
    return;
  }

  if (pathname === "/api/manifest" || pathname === "/api/replay-manifest.json") {
    try {
      sendJson(res, 200, loadManifest());
    } catch (error) {
      sendJson(res, 500, { error: "Could not load manifest", detail: error.message });
    }
    return;
  }

  if (pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      branch: currentBranch(),
      manifest: fs.existsSync(manifestPath),
      scenarioStudio: true,
      forecastModel: fs.existsSync(path.join(webDir, "data", "mode-a", "forecast_model.json")),
      baseline2025Forecast: fs.existsSync(path.join(webDir, "data", "mode-a", "baseline_2025_forecast.json")),
      geminiConfigured: Boolean(geminiKey())
    });
    return;
  }

  if (pathname === "/api/events") {
    try {
      loadEventsCatalog();
      if (!eventsByYearSignal) {
        sendJson(res, 500, { error: "Events catalog unavailable" });
        return;
      }
      const params = requestUrl.searchParams;
      const year = params.get("year");
      const signal = params.get("signal");
      const limit = Math.max(0, Math.min(5000, parseInt(params.get("limit") || "0", 10) || 0));
      let arr;
      if (year && signal) {
        arr = eventsByYearSignal[year + "|" + signal] || [];
      } else if (year) {
        arr = [];
        ["traffic", "jobs", "electricity", "buildings", "services"].forEach((s) => {
          const k = year + "|" + s;
          if (eventsByYearSignal[k]) arr = arr.concat(eventsByYearSignal[k]);
        });
      } else if (signal) {
        arr = [];
        Object.keys(eventsByYearSignal).forEach((k) => {
          if (k.endsWith("|" + signal)) arr = arr.concat(eventsByYearSignal[k]);
        });
      } else {
        sendJson(res, 400, { error: "year or signal query required" });
        return;
      }
      const total = arr.length;
      const events = limit > 0 ? arr.slice(0, limit) : arr;
      sendJson(res, 200, { year: year || null, signal: signal || null, total: total, count: events.length, events: events });
    } catch (error) {
      sendJson(res, 500, { error: "Could not load events", detail: error.message });
    }
    return;
  }

  const layerMatch = pathname.match(/^\/api\/layers\/(\d{4})\/([a-z0-9_-]+)$/i);
  if (layerMatch) {
    try {
      const [, year, layerId] = layerMatch;
      const manifest = loadManifest();
      const layer = findLayer(manifest, year, layerId);
      if (!layer || !layer.path) {
        sendJson(res, 404, { error: "Layer not found", year, layerId });
        return;
      }
      const layerPath = safeResolve(rootDir, layer.path);
      if (!layerPath) {
        sendJson(res, 400, { error: "Invalid layer path" });
        return;
      }
      streamFile(res, layerPath);
    } catch (error) {
      sendJson(res, 500, { error: "Could not load layer", detail: error.message });
    }
    return;
  }

  if (pathname.startsWith("/data/mode-a/")) {
    const modeAPath = safeResolve(webDir, pathname);
    if (!modeAPath) {
      sendJson(res, 400, { error: "Invalid Mode A data path" });
      return;
    }
    streamFile(res, modeAPath);
    return;
  }

  if (pathname.startsWith("/data/")) {
    const dataPath = safeResolve(rootDir, pathname);
    if (!dataPath) {
      sendJson(res, 400, { error: "Invalid data path" });
      return;
    }
    streamFile(res, dataPath);
    return;
  }

  let filePath;
  if (pathname === "/") {
    filePath = path.join(webDir, "index.html");
  } else {
    filePath = safeResolve(webDir, pathname);
  }

  if (!filePath) {
    sendJson(res, 400, { error: "Invalid path" });
    return;
  }
  streamFile(res, filePath);
});

server.listen(port, () => {
  console.log(`Belfast replay UI/API running at http://localhost:${port}`);
});
