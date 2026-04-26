export const ENDPOINTS = {
  network: "/network",
  futureLayers: "/future-layers",
  listScenarios: "/scenarios",
  createScenario: "/scenarios",
  getScenario: "/scenarios/:id",
  updateScenario: "/scenarios/:id",
  deleteScenario: "/scenarios/:id",
  saveNetwork: "/scenarios/:id/network",
  listRuns: "/scenarios/:id/runs",
  createRun: "/scenarios/:id/runs",
  startRun: "/scenarios/:id/runs/start",
  streamEvents: "/scenarios/:id/runs/:runId/events/stream",
  simwrapperFile: "/scenarios/:id/runs/:runId/simwrapper/:filename",
  scorecard: "/scenarios/:id/runs/:runId/scorecard",
} satisfies Record<string, string>

export type EndpointKey = keyof typeof ENDPOINTS
