import type { TrafficLink, Building } from "./network";

export interface AgentConfig {
  populationDensity: number;
  shoppingProbability: number;
  maxShoppingDistanceKm: number;
  healthcareChance: number;
  elderlyAgeThreshold: number;
  kindergartenAge: number;
  minIndependentSchoolAge: number;
  errandMinMinutes: number;
  errandMaxMinutes: number;
  childDropoffMinMinutes: number;
  childDropoffMaxMinutes: number;
}

export type EngineType = "MATSIM" | "WORLDMOVE";
export type RunStatus = "pending" | "running" | "completed" | "failed";

export interface Run {
  id: string;
  scenarioId: string;
  status: RunStatus;
  engineType?: EngineType;
  iterations: number;
  randomSeed?: number;
  note?: string;
  createdAt: string;
  completedAt?: string;
}

export interface Scenario {
  id: string;
  name: string;
  description?: string;
  agentConfig: AgentConfig;
  targetYear?: number;
  linksDiff?: Record<string, TrafficLink>;
  buildingsDiff?: Record<string, Building>;
  createdAt: string;
  updatedAt: string;
}

export interface ScorecardGrade {
  category: string;
  grade: string;
  score: number;
  target: string;
  finding: string;
}

export interface Scorecard {
  overall_grade: string;
  grades: ScorecardGrade[];
  actionable_advice: string[];
  future_layer_suggestions: Array<{
    name: string;
    type: string;
    area: string;
    rationale: string;
  }>;
}

export interface FutureLayer {
  id: string;
  name: string;
  year: number;
  layer_type: string;
  description: string;
  geojson: GeoJSON.Feature;
}
