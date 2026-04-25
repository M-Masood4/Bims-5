# Keep Simulation Multipart Parts Under 1 MB

## TL;DR
> **Summary**: Replace the single oversized `buildings` text form field with a run-specific, geometry-light payload that is deterministically split into JSON file parts below the multipart ceiling, then validate and reassemble those parts server-side before creating a run.
> **Deliverables**:
> - Frontend payload-budget and chunking utilities for simulation launch
> - New multipart transport contract using `buildingsFiles` file parts plus manifest metadata
> - Backend pre-run validation, file-part reassembly, and explicit oversized-payload errors for the new transport
> - Regression coverage in Vitest and pytest proving parts stay below budget
> **Effort**: Medium
> **Parallel**: YES - 2 waves
> **Critical Path**: Task 1 → Task 2 → Task 4 → Task 5 → Task 6

## Context
### Original Request
The simulation launch fails with `Part exceeded maximum size of 1024KB`, and the goal is to ensure multipart parts stay under 1 MB so simulation can run reliably.

### Interview Summary
- Optimize for a **durable safeguard**, not a one-off unblock.
- **Preserve fidelity first**; only reduce data if simulation behavior is unchanged.
- Use **tests-after** verification.
- External Mapbox docs lookup failed due workspace billing, so this plan is grounded in repo evidence.

### Metis/Momus Review
- Momus returned **OKAY** on this plan.
- Treat the issue as a **frontend/backend multipart contract** problem, not a simengine upload-limit issue.
- Validate and decode the buildings payload **before** `run_repo.create_run()` so payload failures do not create orphan failed runs.
- Use **byte-accurate UTF-8 measurement** with headroom; do not rely on string length.
- Do not treat simengine’s `20MB` config as the fix for the 1 MB failure.

## Work Objectives
### Core Objective
Guarantee that every multipart part created for the simulation launch request stays below the effective 1 MB ceiling while keeping simulation behavior unchanged.

### Deliverables
- A run-specific building payload serializer that omits unused geometry from the simulation launch request.
- A deterministic chunking strategy that keeps each `buildingsFiles` part at or below `921600` bytes (900 KiB operational budget) to leave margin below the `1048576` byte ceiling.
- Backend acceptance of the new `buildingsFiles` transport, with strict validation and reassembly before plan generation.
- Explicit FE/BE regression tests proving chunk sizing, transport shape, decode behavior, and oversize handling.

### Definition of Done
- `pnpm --dir trafficjam-fe exec vitest run src/api/index.test.tsx` passes.
- `pnpm --dir trafficjam-fe build` succeeds.
- `python -m pytest trafficjam-be -q -k start_run` passes.

### Must Have
- Keep every frontend-generated buildings multipart part `<= 921600` bytes.
- Use a run-specific payload with only `id`, `position`, `type`, `tags`, and `hotspot`.
- Preserve current backend plan-generation behavior by reconstructing backend `Building` models with `osm_id=0` and `geometry=[position]`.
- Stop the frontend from sending the legacy oversized `buildings` text field.
- Validate payload transport and parseability before creating a run record.

### Must NOT Have
- Must NOT change `simengine` multipart limits as the primary fix.
- Must NOT widen the backend multipart parser limit just to keep the legacy `buildings` text field alive.
- Must NOT add browser e2e tooling in this plan.
- Must NOT add gzip/compression as the primary path.
- Must NOT chunk `networkFile`; existing geometry sampling in the MATSim serializer stays unchanged.
- Must NOT silently simplify buildings beyond dropping `geometry` from the run payload; current repo evidence shows the backend does not read building geometry during plan generation.

## Execution Strategy
Wave 1: FE payload contract foundations
- Task 1: payload schema + byte budgeting
- Task 2: multipart file-part construction
- Task 3: launch-flow error surfacing + FE regressions

Wave 2: BE contract + parsing + docs/tests
- Task 4: route contract and pre-run validation
- Task 5: file-part reassembly + legacy compatibility path
- Task 6: backend regression suite + route documentation refresh

## TODOs
- [x] 1. Add a run-specific building payload serializer and byte-budget utility
  - Create or update FE API utilities near `trafficjam-fe/src/api/http.ts` so map buildings serialize to run-building records containing only `id`, `position`, `type`, `tags`, and `hotspot`.
  - Use `TextEncoder().encode(json).byteLength` for all size checks.
  - Chunk serialized building arrays into JSON arrays that are each `<= 921600` UTF-8 bytes.
  - Throw exactly `Simulation payload exceeds 1048576-byte multipart part limit for buildings` when one record cannot fit.
  - Extend `trafficjam-fe/src/api/index.test.tsx` with chunking, geometry omission, order preservation, and impossible-record tests.

- [x] 2. Replace the legacy `buildings` text field with deterministic JSON file parts
  - Update `buildStartRunForm()` in `trafficjam-fe/src/api/http.ts` to append `buildingsTransport=file-parts-v1`, `buildingsSchemaVersion=1`, `buildingsPartCount=<N>`, and repeated `buildingsFiles` file/blob parts named `buildings-part-<index>.json`.
  - Stop appending the legacy `buildings` text field from the frontend.
  - Keep `networkFile`, `bounds`, `iterations`, `randomSeed`, and `note` behavior unchanged.
  - Extend `trafficjam-fe/src/api/index.test.tsx` to inspect `FormData` and assert metadata, file count, filenames, and lack of `buildings` text field.

- [x] 3. Surface launch-time payload errors cleanly in the simulation dialog
  - Ensure serializer/chunking errors surface unchanged through `LaunchDialog` existing `error` state in `trafficjam-fe/src/presentation/editor/components/run-simulation/launch-dialog/launch-dialog.tsx`.
  - Add or extend FE tests so an impossible-to-fit building payload renders the exact payload-limit message and does not call the submit/network path.
  - Ensure `pnpm --dir trafficjam-fe build` succeeds.

- [x] 4. Add the new backend multipart contract and validate it before run creation
  - Update `trafficjam-be/api/runs.py` `start_run()` to accept repeated `buildingsFiles: list[UploadFile]`, `buildingsTransport`, `buildingsSchemaVersion`, and `buildingsPartCount` form fields.
  - Validate transport shape, schema version, part count, and per-file part size before `run_repo.create_run()`.
  - Enforce `1048576` bytes as the hard ceiling for each `buildingsFiles` part.
  - Return HTTP `413` with detail `buildingsFiles part exceeds 1048576 bytes` for oversized new-transport parts.
  - Keep legacy `buildings: Optional[str] = Form(None)` as compatibility fallback only; do not widen parser limits.
  - Add pytest route coverage for valid pre-run validation and oversized rejection.

- [ ] 5. Reassemble file parts into backend `Building` models without changing plan-generation behavior
  - Implement parser path for `file-parts-v1` that reads `buildingsFiles` in filename/index order, JSON-loads each array, concatenates records, and validates them.
  - Reconstruct backend `Building` models with `osm_id=0` and `geometry=[position]` before plan generation.
  - Keep `generate_plans_xml()` behavior unchanged.
  - Add pytest coverage for success, malformed JSON, mismatched part count, unsupported schema version, and no run creation on validation failure.

- [ ] 6. Lock the contract with regression tests and route documentation
  - Update `runs.py` route descriptions/field descriptions to document `buildingsFiles`, `buildingsTransport=file-parts-v1`, `buildingsSchemaVersion=1`, and the `1048576` byte hard ceiling.
  - Ensure FE Vitest and backend pytest contract tests are stable.
  - Ensure `pnpm --dir trafficjam-fe build` succeeds.

## Final Verification Wave
- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy
- Single implementation commit after Tasks 1-6 and before final verification if the user explicitly asks for a commit.
- Commit message: `fix(simulation): keep launch multipart parts below 1mb`

## Success Criteria
- The frontend no longer sends a monolithic `buildings` text field when launching a run.
- Every generated `buildingsFiles` multipart part is byte-budgeted below `921600` bytes.
- Backend validation happens before run creation and rejects malformed or oversized new-transport payloads with explicit, stable errors.
- Backend plan generation still receives the same logical buildings dataset and can start a run successfully.
- FE Vitest, FE build, and backend pytest verification all pass.
