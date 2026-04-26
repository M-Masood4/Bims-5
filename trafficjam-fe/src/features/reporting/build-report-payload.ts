import { gradeReport } from "./grade-report";
import type {
  ReportCurrentData,
  ReportMetric,
  ReportPayload,
  ReportRisk,
  ReportRunDataInput,
  ReportTemplateBuckets,
  ReportTemplateSummary,
} from "./types";

type ReportTemplatesInput = NonNullable<NonNullable<ReportRunDataInput["currentData"]>["templates"]>;

function normalizeTemplates(templates?: ReportTemplatesInput): ReportTemplateBuckets {
  const toBucket = (items: { label: string; count: number }[] | undefined): ReportTemplateSummary[] =>
    (items ?? []).map((item) => ({ label: item.label, count: item.count }));

  return {
    roads: toBucket(templates?.roads),
    buildings: toBucket(templates?.buildings),
    transport: toBucket(templates?.transport),
  };
}

function buildCurrentData(input: ReportRunDataInput): ReportCurrentData | undefined {
  if (!input.currentData) return undefined;

  return {
    networkSnapshot: {
      nodes: input.currentData.nodes,
      links: input.currentData.links,
      buildings: input.currentData.buildings,
      transportRoutes: input.currentData.transportRoutes,
    },
    iterations: input.currentData.iterations,
    randomSeed: input.currentData.randomSeed,
    note: input.currentData.note,
    templates: normalizeTemplates(input.currentData.templates),
  };
}

function buildExecutiveSummary(input: ReportRunDataInput): string[] {
  if (input.executiveSummary?.length) return input.executiveSummary;

  const lines = [
    `Scenario ${input.scenario.name} was exported from run ${input.run.id}.`,
  ];

  if (input.currentData) {
    lines.push(`The run captured ${input.currentData.iterations} iterations and a live network snapshot.`);
  } else {
    lines.push("No current-state snapshot was available at export time.");
  }

  return lines;
}

function buildMetrics(input: ReportRunDataInput, currentData?: ReportCurrentData): ReportMetric[] {
  if (input.metrics?.length) return input.metrics;

  if (!currentData) {
    return [
      {
        title: "Snapshot availability",
        value: "Unavailable",
        analysis: "The report was generated without a captured current-state snapshot.",
      },
    ];
  }

  return [
    {
      title: "Network nodes",
      value: currentData.networkSnapshot.nodes.toLocaleString(),
      analysis: "Node coverage reflects the base network used for the simulation.",
    },
    {
      title: "Network links",
      value: currentData.networkSnapshot.links.toLocaleString(),
      analysis: "Link count indicates how much road connectivity was available to the model.",
    },
  ];
}

function buildRisks(input: ReportRunDataInput): ReportRisk[] {
  if (input.risks?.length) return input.risks;

  if (!input.currentData) {
    return [
      {
        severity: "medium",
        title: "Missing snapshot data",
        detail: "The exported report has no detailed launch snapshot, so some conclusions are approximate.",
      },
    ];
  }

  return [];
}

export function buildReportPayload(input: ReportRunDataInput): ReportPayload {
  const currentData = buildCurrentData(input);
  const metrics = buildMetrics(input, currentData);
  const risks = buildRisks(input);
  const limitations = input.limitations ?? (currentData ? [] : ["No current-state snapshot was captured."]);

  const grade = gradeReport({
    completeness: currentData ? 88 : 58,
    hasCurrentData: Boolean(currentData),
    riskCount: risks.length,
    limitationCount: limitations.length,
  });

  return {
    scenario: input.scenario,
    run: input.run,
    generatedAt: input.generatedAt,
    grade,
    executiveSummary: buildExecutiveSummary(input),
    currentData,
    metrics,
    risks,
    recommendations:
      input.recommendations ?? ["Review the risk items and capture a full snapshot for the next export."],
    historicalContext:
      input.historicalContext ?? "Historical context was not supplied for this export.",
    conclusion:
      input.conclusion ?? `The run ${input.run.id} completed with an overall ${grade.letter} grade.`,
    limitations,
  };
}
