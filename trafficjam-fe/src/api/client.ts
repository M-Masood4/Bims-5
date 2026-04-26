import {
  resolveUrl,
  assertOk,
  getJson,
  postJson,
  postForm,
  putJson,
  deleteReq,
  buildNetworkQuery,
  buildStartRunForm,
  parseSimwrapperResponse,
} from "./http";
import {
  mapNetworkResponse,
  toFullScenario,
  toScenarioList,
  decodeStartRun,
  decodeCreateRun,
  decodeEventStream,
} from "./decoders";
import { computeLinksDiff, computeBuildingsDiff } from "./network-serializer";
import type {
  ApiNetworkResponse,
  ApiScenario,
  ApiStartRunResponse,
  ApiCreateRunResponse,
  StreamedEvent,
  StartRunParams,
  StartRunResult,
  CreateRunResult,
} from "./raw-types";
import type { Scenario, AgentConfig, Run, Scorecard, FutureLayer } from "../types";
import type { Network, LngLatBounds } from "../types";

async function fetchNetwork(bounds: LngLatBounds): Promise<Network> {
  const url = `${resolveUrl("network")}?${buildNetworkQuery(bounds)}`;
  const raw = await getJson<ApiNetworkResponse>(url);
  return mapNetworkResponse(raw);
}

async function listScenarios(): Promise<Scenario[]> {
  const raw = await getJson<ApiScenario[]>(resolveUrl("listScenarios"));
  return toScenarioList(raw);
}

async function getScenario(
  id: string,
  signal?: AbortSignal,
): Promise<Scenario> {
  const raw = await getJson<ApiScenario>(resolveUrl("getScenario", { id }), {
    signal,
  });
  return toFullScenario(raw);
}

async function createScenario(
  name: string,
  config: AgentConfig,
  targetYear?: number,
): Promise<Scenario> {
  const raw = await postJson<ApiScenario>(resolveUrl("createScenario"), {
    name,
    plan_params: config,
    network_config: null,
    target_year: targetYear ?? 2026,
  });
  return toFullScenario(raw);
}

async function updateScenario(
  id: string,
  updates: Partial<Scenario>,
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (updates.name !== undefined) body.name = updates.name;
  if (updates.description !== undefined) body.description = updates.description;
  if (updates.agentConfig !== undefined) body.plan_params = updates.agentConfig;
  if (updates.targetYear !== undefined) body.target_year = updates.targetYear;
  await putJson(resolveUrl("updateScenario", { id }), body);
}

async function saveNetwork(
  id: string,
  base: Network,
  edited: Network,
): Promise<void> {
  const links = computeLinksDiff(base, edited);
  const buildings = computeBuildingsDiff(base, edited);
  await putJson(resolveUrl("saveNetwork", { id }), {
    links,
    buildings: Object.keys(buildings).length > 0 ? buildings : undefined,
  });
}

async function deleteScenario(id: string): Promise<void> {
  await deleteReq(resolveUrl("deleteScenario", { id }));
}

async function listRuns(scenarioId?: string): Promise<Run[]> {
  if (!scenarioId) return [];
  const res = await fetch(resolveUrl("listRuns", { id: scenarioId }));
  if (!res.ok) return [];
  return res.json();
}

async function createRun(scenarioId: string): Promise<CreateRunResult> {
  const raw = await postJson<ApiCreateRunResponse>(
    resolveUrl("createRun", { id: scenarioId }),
    {},
  );
  return decodeCreateRun(raw);
}

async function startRun(params: StartRunParams): Promise<StartRunResult> {
  const raw = await postForm<ApiStartRunResponse>(
    resolveUrl("startRun", { id: params.scenarioId }),
    buildStartRunForm(params),
  );
  return decodeStartRun(raw);
}

async function* streamEvents(
  scenarioId: string,
  runId: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamedEvent> {
  const res = await fetch(
    resolveUrl("streamEvents", { id: scenarioId, runId }),
    { headers: { Accept: "text/event-stream" }, signal },
  );
  await assertOk(res);
  yield* decodeEventStream(res);
}

async function getSimwrapperFile<T>(
  scenarioId: string,
  runId: string,
  filename: string,
): Promise<T> {
  const url = resolveUrl("simwrapperFile", { id: scenarioId, runId, filename });
  const res = await fetch(url);
  await assertOk(res);
  return parseSimwrapperResponse<T>(res, filename);
}

async function fetchScorecard(
  scenarioId: string,
  runId: string,
): Promise<Scorecard> {
  const url = resolveUrl("scorecard", { id: scenarioId, runId });
  return getJson<Scorecard>(url);
}

async function fetchFutureLayers(year?: number): Promise<FutureLayer[]> {
  const base = resolveUrl("futureLayers");
  const url = year ? `${base}?year=${year}` : base;
  return getJson<FutureLayer[]>(url);
}

export const api = {
  fetchNetwork,
  listScenarios,
  getScenario,
  createScenario,
  updateScenario,
  saveNetwork,
  deleteScenario,
  listRuns,
  createRun,
  startRun,
  streamEvents,
  getSimwrapperFile,
  fetchScorecard,
  fetchFutureLayers,
};

