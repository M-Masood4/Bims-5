import type { ReportGrade, ReportGradeInput } from "./types";

function clampScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function scoreToLetter(score: number): ReportGrade["letter"] {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function gradeReport(input: ReportGradeInput = {}): ReportGrade {
  const completeness = input.completeness ?? 0;
  const riskPenalty = (input.riskCount ?? 0) * 6;
  const limitationPenalty = (input.limitationCount ?? 0) * 3;
  const currentDataBonus = input.hasCurrentData ? 8 : -12;

  const score = clampScore(completeness + currentDataBonus - riskPenalty - limitationPenalty);
  const letter = scoreToLetter(score);

  const rationale = [
    `Completeness score: ${score}/100.`,
    input.hasCurrentData
      ? "Current-state snapshot was available for the run."
      : "No current-state snapshot was available, which reduced confidence.",
  ];

  if ((input.riskCount ?? 0) > 0) {
    rationale.push(`Risk count applied a ${riskPenalty}-point penalty.`);
  }

  if ((input.limitationCount ?? 0) > 0) {
    rationale.push(`Limitations applied a ${limitationPenalty}-point penalty.`);
  }

  return { letter, rationale };
}
