import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ReportPayload, ReportTemplateSummary } from "./types";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const PAGE_MARGIN = 52;
const BODY_SIZE = 11;
const LINE_GAP = 15;

function formatDate(value: string | undefined): string {
  if (!value) return "Unavailable";
  return new Date(value).toLocaleString();
}

function formatTemplateLine(items: ReportTemplateSummary[], emptyLabel: string): string[] {
  if (items.length === 0) return [emptyLabel];
  return items.slice(0, 8).map((item) => `${item.label}: ${item.count}`);
}

function wrapText(text: string, maxChars = 88): string[] {
  if (text.length <= maxChars) return [text];

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function sanitizeFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "report";
}

export async function renderReportPdf(payload: ReportPayload): Promise<{ bytes: Uint8Array; fileName: string }> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const titlePage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  titlePage.drawText("BIMS 5", {
    x: PAGE_MARGIN,
    y: PAGE_HEIGHT - 150,
    size: 30,
    font: bold,
    color: rgb(0.1, 0.45, 0.91),
  });
  titlePage.drawText("Consulting Simulation Report", {
    x: PAGE_MARGIN,
    y: PAGE_HEIGHT - 190,
    size: 18,
    font: regular,
    color: rgb(0.13, 0.14, 0.16),
  });
  titlePage.drawText(`Scenario: ${payload.scenario.name}`, {
    x: PAGE_MARGIN,
    y: PAGE_HEIGHT - 250,
    size: 14,
    font: regular,
  });
  titlePage.drawText(`Run ID: ${payload.run.id}`, {
    x: PAGE_MARGIN,
    y: PAGE_HEIGHT - 276,
    size: 12,
    font: regular,
  });
  titlePage.drawText(`Generated: ${formatDate(payload.generatedAt)}`, {
    x: PAGE_MARGIN,
    y: PAGE_HEIGHT - 298,
    size: 12,
    font: regular,
  });
  titlePage.drawText(`Overall Grade: ${payload.grade.letter}`, {
    x: PAGE_MARGIN,
    y: PAGE_HEIGHT - 344,
    size: 20,
    font: bold,
    color: rgb(0.1, 0.45, 0.91),
  });

  const sections = [
    {
      title: "Executive Summary",
      lines: payload.executiveSummary,
    },
    {
      title: "Current Data Snapshot",
      lines: payload.currentData
        ? [
            `Nodes: ${payload.currentData.networkSnapshot.nodes.toLocaleString()}`,
            `Links: ${payload.currentData.networkSnapshot.links.toLocaleString()}`,
            `Buildings: ${payload.currentData.networkSnapshot.buildings.toLocaleString()}`,
            `Transport routes: ${payload.currentData.networkSnapshot.transportRoutes.toLocaleString()}`,
            `Iterations: ${payload.currentData.iterations}`,
            `Random seed: ${payload.currentData.randomSeed ?? "Random"}`,
            `Run note: ${payload.currentData.note || "None supplied"}`,
          ]
        : ["No captured current-state launch snapshot is available for this run."],
    },
    {
      title: "Template for Roads",
      lines: [
        ...formatTemplateLine(payload.currentData?.templates.roads ?? [], "No road template snapshot was captured for this run."),
        "Potential consulting lens: decreasing congestion time, faster transport times, access to hard-to-reach places, delivery support, emergency access, public transport routing, modern infrastructure, and pedestrian walkability.",
      ],
    },
    {
      title: "Template for Buildings",
      lines: [
        ...formatTemplateLine(payload.currentData?.templates.buildings ?? [], "No building template snapshot was captured for this run."),
        "Potential consulting lens: new homes and services, population growth support, local economic uplift, regeneration of underused land, public-service improvements, and sustainability outcomes.",
      ],
    },
    {
      title: "Template for Transport",
      lines: [
        ...formatTemplateLine(payload.currentData?.templates.transport ?? [], "No transport template snapshot was captured for this run."),
        "Potential consulting lens: public-service coverage, pollution reduction, fare revenue, and fleet modernization such as electric buses.",
      ],
    },
    {
      title: "Metric-by-Metric Analysis",
      lines: payload.metrics.flatMap((metric) => [`${metric.title}: ${metric.value}`, metric.analysis]),
    },
    {
      title: "Risk Assessment",
      lines: payload.risks.length > 0
        ? payload.risks.flatMap((risk) => [`${risk.severity.toUpperCase()} — ${risk.title}`, risk.detail])
        : ["No material prototype risks were flagged from the available outputs."],
    },
    {
      title: "Recommendations",
      lines: payload.recommendations,
    },
    {
      title: "Historical Context",
      lines: [payload.historicalContext],
    },
    {
      title: "Overall Conclusion",
      lines: [payload.conclusion, `Prototype consulting grade: ${payload.grade.letter}`, ...payload.grade.rationale],
    },
    {
      title: "Limitations",
      lines: payload.limitations.length > 0 ? payload.limitations : ["No additional limitations were recorded at export time."],
    },
  ];

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = PAGE_HEIGHT - PAGE_MARGIN;

  const ensureSpace = (requiredHeight: number) => {
    if (cursorY - requiredHeight >= PAGE_MARGIN) return;
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    cursorY = PAGE_HEIGHT - PAGE_MARGIN;
  };

  const drawLine = (text: string, font = regular, size = BODY_SIZE) => {
    ensureSpace(size + 6);
    page.drawText(text, {
      x: PAGE_MARGIN,
      y: cursorY,
      size,
      font,
      color: rgb(0.13, 0.14, 0.16),
    });
    cursorY -= size + 4;
  };

  for (const section of sections) {
    ensureSpace(38);
    drawLine(section.title, bold, 16);
    cursorY -= 4;

    for (const entry of section.lines) {
      for (const wrapped of wrapText(`• ${entry}`)) {
        drawLine(wrapped, regular, BODY_SIZE);
      }
      cursorY -= 2;
    }

    cursorY -= LINE_GAP;
  }

  return {
    bytes: await pdf.save(),
    fileName: `${sanitizeFileName(payload.scenario.name)}-${payload.run.id.slice(0, 8)}-consulting-report.pdf`,
  };
}
