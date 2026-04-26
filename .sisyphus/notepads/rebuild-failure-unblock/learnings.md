2026-04-26: Reporting PDF renderer only needs a small payload surface: scenario name, run id, summary arrays, metrics, risks, recommendations, historical context, conclusion, and limitations.
2026-04-26: Template summaries are label/count pairs grouped under roads, buildings, and transport.
2026-04-26: Reporting feature files in `trafficjam-fe/src/features/reporting/` are type-safe and compile cleanly under `bunx tsc --noEmit`; `types.ts` exports the payload/grade/template types consumed by the renderer and payload builder.
2026-04-26: `pdf-lib` belongs in `trafficjam-fe` runtime dependencies; `bun install --frozen-lockfile`, `bunx tsc --noEmit`, `bun run test`, and `bun run build` all passed after the dependency was added.
