import type { Run, Scenario } from "../../types";

export interface ReportTemplateSummary {
  label: string;
  count: number;
}

export interface ReportNetworkSnapshot {
  nodes: number;
  links: number;
  buildings: number;
  transportRoutes: number;
}

export interface ReportTemplateBuckets {
  roads: ReportTemplateSummary[];
  buildings: ReportTemplateSummary[];
  transport: ReportTemplateSummary[];
}

export interface ReportCurrentData {
  networkSnapshot: ReportNetworkSnapshot;
  iterations: number;
  randomSeed?: number;
  note?: string;
  templates: ReportTemplateBuckets;
}

export interface ReportMetric {
  title: string;
  value: string;
  analysis: string;
}

export interface ReportRisk {
  severity: string;
  title: string;
  detail: string;
}

export interface ReportGrade {
  letter: "A" | "B" | "C" | "D" | "F";
  rationale: string[];
  score?: number;
}

export interface ReportPayload {
  scenario: Pick<Scenario, "name">;
  run: Pick<Run, "id">;
  generatedAt?: string;
  grade: ReportGrade;
  executiveSummary: string[];
  currentData?: ReportCurrentData;
  metrics: ReportMetric[];
  risks: ReportRisk[];
  recommendations: string[];
  historicalContext: string;
  conclusion: string;
  limitations: string[];
}

export interface ReportRunTemplateInput {
  label: string;
  count: number;
}

export interface ReportRunCurrentDataInput {
  nodes: number;
  links: number;
  buildings: number;
  transportRoutes: number;
  iterations: number;
  randomSeed?: number;
  note?: string;
  templates?: {
    roads?: ReportRunTemplateInput[];
    buildings?: ReportRunTemplateInput[];
    transport?: ReportRunTemplateInput[];
  };
}

export interface ReportRunDataInput {
  scenario: Pick<Scenario, "name">;
  run: Pick<Run, "id" | "iterations" | "randomSeed" | "note">;
  generatedAt?: string;
  currentData?: ReportRunCurrentDataInput;
  metrics?: ReportMetric[];
  risks?: ReportRisk[];
  recommendations?: string[];
  historicalContext?: string;
  conclusion?: string;
  limitations?: string[];
  executiveSummary?: string[];
}

export interface ReportGradeInput {
  completeness?: number;
  riskCount?: number;
  limitationCount?: number;
  hasCurrentData?: boolean;
}
