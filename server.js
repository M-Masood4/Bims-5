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
    const resolvedPostcode = payload.resolvedPostcode || payload.postcodeResolution || scenarioStudio.resolvePostcode(payload.postcode || payload.building?.postcode || "", rootDir);
    if (!resolvedPostcode.canPlace) {
      sendJson(res, 422, {
        ok: false,
        geminiRequired: false,
        error: "A full Belfast postcode is required before placing a building",
        postcode: resolvedPostcode,
        warnings: resolvedPostcode.warnings || []
      });
      return;
    }
    building = scenarioStudio.createBuildingIntervention({
      ...(payload.building || payload),
      postcode: resolvedPostcode.postcode,
      resolvedPostcode,
      location: payload.building?.location || resolvedPostcode.location,
      startYear: payload.startYear || 2026,
      completionYear: payload.horizonYear || 2036,
      requireResolvedPostcode: true
    }, rootDir);
    validation = scenarioStudio.validatePlacement({
      location: building.location,
      geometry: building.geometry,
      config: building.config,
      postcode: resolvedPostcode.postcode,
      resolvedPostcode,
      requireResolvedPostcode: true
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
        postcode: resolvedPostcode.postcode,
        resolvedPostcode,
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

    const variantGemini = await callGeminiJson({
      agentName: "Scenario Variant Agent",
      temperature: 0.35,
      maxOutputTokens: 4000,
      responseJsonSchema: SCENARIO_VARIANTS_SCHEMA,
      prompt: variantPrompt(building, siteContext, specialistAgents)
    });
    const variants = scenarioStudio.sanitizeScenarioVariants(variantGemini.json, building, rootDir, { strict: true });
    const forecast = scenarioStudio.runForecastScenario({
      ...payload,
      scenarioId: payload.scenarioId || payload.scenario_id || "housing_growth",
      postcode: resolvedPostcode.postcode,
      resolvedPostcode,
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
