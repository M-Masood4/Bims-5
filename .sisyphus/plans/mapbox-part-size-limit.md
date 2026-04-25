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

### Metis Review (gaps addressed)
- Treat the issue as a **frontend/backend multipart contract** problem, not a simengine upload-limit issue.
- Validate and decode the buildings payload **before** `run_repo.create_run()` so payload failures do not create orphan failed runs.
- Use **byte-accurate UTF-8 measurement** with headroom; do not rely on string length.
- Do not make chunking or compression the first move if a smaller, simulation-equivalent payload works.
- Do not treat simengine’s `20MB` config as the fix for the 1 MB failure.

## Work Objectives
### Core Objective
Guarantee that every multipart part created for the simulation launch request stays below the effective 1 MB ceiling while keeping simulation behavior unchanged.

### Deliverables
- A run-specific building payload serializer that omits unused geometry from the simulation launch request.
- A deterministic chunking strategy that keeps each `buildingsFiles` part at or below `921600` bytes (900 KiB operational budget) to leave margin below the `1048576` byte ceiling.
- Backend acceptance of the new `buildingsFiles` transport, with strict validation and reassembly before plan generation.
- Explicit FE/BE regression tests proving chunk sizing, transport shape, decode behavior, and oversize handling.

### Definition of Done (verifiable conditions with commands)
- `pnpm --dir trafficjam-fe exec vitest run src/api/index.test.tsx` passes with coverage for byte budgeting, chunking, and `api.startRun` multipart construction.
- `pnpm --dir trafficjam-fe build` succeeds.
- `python -m pytest trafficjam-be -q -k start_run` passes with coverage for the new multipart file-part transport, malformed payload rejection, and validation-before-run-creation.

### Must Have
- Keep every frontend-generated buildings multipart part `<= 921600` bytes.
- Use a run-specific payload that includes only fields required by current plan generation: `id`, `position`, `type`, `tags`, and `hotspot`.
- Preserve current backend plan-generation behavior by reconstructing backend `Building` models with `osm_id=0` and `geometry=[position]` when reading the run payload.
- Stop the frontend from sending the legacy oversized `buildings` text field.
- Validate payload transport and parseability before creating a run record.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- Must NOT change `simengine` multipart limits as the primary fix.
- Must NOT widen the backend multipart parser limit just to keep the legacy `buildings` text field alive.
- Must NOT add browser e2e tooling in this plan.
- Must NOT add gzip/compression as the primary path; the requirement is to stay under the part ceiling, not rely on encoded-body workarounds.
- Must NOT chunk `networkFile`; existing geometry sampling in the MATSim serializer stays unchanged.
- Must NOT silently simplify buildings beyond dropping `geometry` from the run payload; current repo evidence shows the backend does not read building geometry during plan generation.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: **tests-after** using Vitest for frontend request-shaping logic and pytest for backend route validation.
- QA policy: Every task includes command-driven happy-path and failure-path scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: FE payload contract foundations
- Task 1: payload schema + byte budgeting
- Task 2: multipart file-part construction
- Task 3: launch-flow error surfacing + FE regressions

Wave 2: BE contract + parsing + docs/tests
- Task 4: route contract and pre-run validation
- Task 5: file-part reassembly + legacy compatibility path
- Task 6: backend regression suite + route documentation refresh

### Dependency Matrix (full, all tasks)
| Task | Depends On | Blocks |
|---|---|---|
| 1 | none | 2, 3, 4, 5 |
| 2 | 1 | 3, 4, 5, 6 |
| 3 | 1, 2 | 6 |
| 4 | 1, 2 | 5, 6 |
| 5 | 4 | 6 |
| 6 | 2, 3, 4, 5 | F1-F4 |

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 3 tasks → quick, quick, unspecified-low
- Wave 2 → 3 tasks → unspecified-high, unspecified-high, quick

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. Add a run-specific building payload serializer and byte-budget utility

  **What to do**: Introduce a simulation-launch serializer in the frontend API layer that converts map buildings into a run payload containing only `id`, `position`, `type`, `tags`, and `hotspot`. Measure payload size with `TextEncoder().encode(...)` and compute chunk boundaries with a hard operational budget of `921600` bytes per JSON file part. Preserve order deterministically. If a single serialized building record cannot fit within `921600` bytes by itself, throw the exact error `Simulation payload exceeds 1048576-byte multipart part limit for buildings` before any network request.

  **Must NOT do**: Do not use `string.length`. Do not include `geometry` in the run payload. Do not change `networkToMatsim()` sampling or any map rendering models.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: bounded frontend utility work across a small set of files
  - Skills: `[]` - No extra skill required
  - Omitted: `[playwright]` - No browser automation exists in-repo and this task is logic-only

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2, 3, 4, 5 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `trafficjam-fe/src/api/http.ts:95-116` - current `FormData` builder serializes all buildings into one `JSON.stringify(...)` text field
  - Pattern: `trafficjam-fe/src/api/raw-types.ts:72-80` - current run payload type sent from frontend
  - Pattern: `trafficjam-fe/src/presentation/editor/components/run-simulation/launch-dialog/launch-dialog.tsx:67-75` - source of the buildings array used for simulation launch
  - Pattern: `trafficjam-fe/src/utils/matsim-serializer.ts:39-53` - existing size-conscious sampling pattern for `network.xml`; use as precedent that launch payloads may be shaped for transport
  - API/Type: `trafficjam-be/agents/models.py:15-22` - backend `Building` model currently includes `geometry`
  - API/Type: `trafficjam-be/agents/plans/population.py:11-22` - backend parse path currently only JSON-loads buildings and bounds; no geometry-specific logic here
  - Test: `trafficjam-fe/src/api/index.test.tsx:98-118` - existing `api.startRun` form-data tests to extend

  **Acceptance Criteria** (agent-executable only):
  - [ ] `pnpm --dir trafficjam-fe exec vitest run src/api/index.test.tsx` passes with assertions that serialized run-building objects omit `geometry`, preserve count/order, and are chunked so every chunk’s UTF-8 byte length is `<= 921600`.
  - [ ] `pnpm --dir trafficjam-fe exec vitest run src/api/index.test.tsx` passes with a failing fixture for a single impossible-to-fit building record that throws `Simulation payload exceeds 1048576-byte multipart part limit for buildings` before `fetch` is called.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Budgeted chunk planning succeeds
    Tool: Bash
    Steps: Run `pnpm --dir trafficjam-fe exec vitest run src/api/index.test.tsx` after adding a fixture with enough buildings to require multiple chunks.
    Expected: Test output shows passing assertions that each planned chunk is <= 921600 bytes and building order is unchanged.
    Evidence: .sisyphus/evidence/task-1-payload-budget.txt

  Scenario: Single building record is too large
    Tool: Bash
    Steps: Run `pnpm --dir trafficjam-fe exec vitest run src/api/index.test.tsx` with a fixture whose serialized tags/hotspot make one building exceed the chunk ceiling.
    Expected: Test passes only if the serializer throws `Simulation payload exceeds 1048576-byte multipart part limit for buildings` and no request is attempted.
    Evidence: .sisyphus/evidence/task-1-payload-budget-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `n/a`

- [ ] 2. Replace the legacy `buildings` text field with deterministic JSON file parts

  **What to do**: Update the frontend request builder so `api.startRun()` sends multipart metadata fields `buildingsTransport=file-parts-v1`, `buildingsSchemaVersion=1`, and `buildingsPartCount=<N>`, plus one repeated file field named `buildingsFiles` per chunk. Each part must use filename `buildings-part-<index>.json` and content type `application/json`. Keep `bounds` as the existing small JSON text field. Stop appending the legacy `buildings` form field entirely from the frontend.

  **Must NOT do**: Do not send both `buildings` and `buildingsFiles` from the frontend. Do not make filenames or field names dynamic beyond the exact pattern above. Do not change the `networkFile` field name.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: focused FE API contract update across `http.ts`, `client.ts`, and types
  - Skills: `[]` - No extra skill required
  - Omitted: `[playwright]` - API/form-data verification is fully covered by Vitest fetch mocks

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 3, 4, 5, 6 | Blocked By: 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `trafficjam-fe/src/api/http.ts:95-116` - current multipart field assembly to replace
  - Pattern: `trafficjam-fe/src/api/client.ts:111-116` - `api.startRun()` caller path that must continue using `postForm`
  - API/Type: `trafficjam-fe/src/api/raw-types.ts:72-80` - extend the run param type only as needed for internal serializer output, not for UI consumers
  - Pattern: `trafficjam-fe/src/api/index.test.tsx:98-118` - fetch-mock form-data verification pattern

  **Acceptance Criteria** (agent-executable only):
  - [ ] `pnpm --dir trafficjam-fe exec vitest run src/api/index.test.tsx` passes with assertions that `FormData` contains `networkFile`, `bounds`, `buildingsTransport`, `buildingsSchemaVersion`, `buildingsPartCount`, and one or more `buildingsFiles` entries.
  - [ ] `pnpm --dir trafficjam-fe exec vitest run src/api/index.test.tsx` passes with assertions that `FormData` does **not** contain a `buildings` text field anymore.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Multipart request uses file parts
    Tool: Bash
    Steps: Run `pnpm --dir trafficjam-fe exec vitest run src/api/index.test.tsx` after extending the mocked `api.startRun` request inspection.
    Expected: Tests prove `fetch` is called once with `FormData` containing `buildingsFiles` and manifest metadata, and lacking the legacy `buildings` text field.
    Evidence: .sisyphus/evidence/task-2-file-parts.txt

  Scenario: Multipart metadata stays consistent with chunk count
    Tool: Bash
    Steps: Run `pnpm --dir trafficjam-fe exec vitest run src/api/index.test.tsx` with a multi-chunk fixture.
    Expected: Tests prove `buildingsPartCount` matches the number of `buildingsFiles` entries and filenames follow `buildings-part-<index>.json`.
    Evidence: .sisyphus/evidence/task-2-file-parts-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `n/a`

- [ ] 3. Surface launch-time payload errors cleanly in the simulation dialog

  **What to do**: Keep the current `LaunchDialog` submission flow, but ensure serializer/chunking errors are surfaced through the existing `error` state with exact actionable text. The dialog must show the thrown payload-limit message unchanged, and must not enter a pending network state when pre-submit serialization fails.

  **Must NOT do**: Do not add new UI controls, warnings, or background retries. Do not swallow payload errors behind the generic `Failed to start simulation` message.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: light UI integration with existing error plumbing
  - Skills: `[]` - No extra skill required
  - Omitted: `[frontend-ui-ux]` - this is behavior hardening, not a visual redesign

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 6 | Blocked By: 1, 2

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `trafficjam-fe/src/presentation/editor/components/run-simulation/launch-dialog/launch-dialog.tsx:97-130` - current submission try/catch and error display path
  - Pattern: `trafficjam-fe/src/presentation/editor/components/run-simulation/launch-dialog/launch-dialog.tsx:209-216` - existing inline error rendering
  - Pattern: `trafficjam-fe/src/api/client.ts:111-116` - where request construction is invoked from the FE API layer

  **Acceptance Criteria** (agent-executable only):
  - [ ] `pnpm --dir trafficjam-fe exec vitest run` passes with coverage showing a payload-budget error reaches the dialog error state verbatim and no request mutation function is called.
  - [ ] `pnpm --dir trafficjam-fe build` succeeds after the launch dialog changes.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Dialog shows payload-limit error without network request
    Tool: Bash
    Steps: Run `pnpm --dir trafficjam-fe exec vitest run` with a component/unit test that triggers launch submission using an impossible-to-fit building payload.
    Expected: Test proves the dialog renders `Simulation payload exceeds 1048576-byte multipart part limit for buildings` and the mocked submit path is never called.
    Evidence: .sisyphus/evidence/task-3-dialog-error.txt

  Scenario: Normal launch path still builds successfully
    Tool: Bash
    Steps: Run `pnpm --dir trafficjam-fe build` after the dialog changes.
    Expected: TypeScript and Vite build complete with no type or bundling errors.
    Evidence: .sisyphus/evidence/task-3-dialog-build.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `n/a`

- [ ] 4. Add the new backend multipart contract and validate it before run creation

  **What to do**: Update `start_run()` to accept the new FE contract: repeated `buildingsFiles: list[UploadFile]`, plus `buildingsTransport`, `buildingsSchemaVersion`, and `buildingsPartCount` form fields. Validate transport shape, part count, schema version, and per-part byte size before `run_repo.create_run()`. Enforce the hard ceiling `1048576` bytes per uploaded building part and return HTTP `413` with exact detail `buildingsFiles part exceeds 1048576 bytes` when a new-transport file part exceeds the ceiling. Keep `bounds` required. Leave the legacy `buildings: Optional[str] = Form(None)` parameter in place for compatibility, but do not use it from the frontend anymore; if a legacy oversized text field is rejected by framework parsing before route execution, keep that default behavior instead of widening parser limits.

  **Must NOT do**: Do not create a run record before payload validation. Do not raise the simengine or backend parser limit as the primary fix. Do not make the new transport optional when `buildingsTransport=file-parts-v1` is declared.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: route contract, validation order, and backend error semantics change together
  - Skills: `[]` - No extra skill required
  - Omitted: `[git-master]` - no git work belongs inside this task

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 5, 6 | Blocked By: 1, 2

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `trafficjam-be/api/runs.py:71-175` - current `start_run()` route; update signature and move run creation below transport validation
  - Pattern: `trafficjam-be/main.py:41-70` - app setup; only touch if a route-level error helper or exception mapping is needed for the new transport path
  - Pattern: `trafficjam-fe/src/api/http.ts:95-116` - FE field names and metadata that backend must match exactly
  - Pattern: `simengine/src/main/resources/application.properties:10-12` - evidence that simengine’s 20MB limits are not the 1MB hot path to fix

  **Acceptance Criteria** (agent-executable only):
  - [ ] `python -m pytest trafficjam-be -q -k start_run` passes with tests proving that a valid `buildingsFiles` request reaches payload validation before `run_repo.create_run()` is called.
  - [ ] `python -m pytest trafficjam-be -q -k start_run` passes with tests proving an oversized `buildingsFiles` part returns `413` and detail `buildingsFiles part exceeds 1048576 bytes`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Valid file-part transport is accepted pre-run
    Tool: Bash
    Steps: Run `python -m pytest trafficjam-be -q -k start_run` with a route test that posts `buildingsTransport=file-parts-v1`, matching `buildingsPartCount`, and two small `buildingsFiles` JSON parts.
    Expected: Test proves validation succeeds and the run repository create method is invoked only after payload decode eligibility is confirmed.
    Evidence: .sisyphus/evidence/task-4-start-run-validation.txt

  Scenario: Oversized file part is rejected
    Tool: Bash
    Steps: Run `python -m pytest trafficjam-be -q -k start_run` with a route test whose second `buildingsFiles` entry is >1048576 bytes.
    Expected: Test proves the response is `413` with detail `buildingsFiles part exceeds 1048576 bytes`, and no run record is created.
    Evidence: .sisyphus/evidence/task-4-start-run-validation-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `n/a`

- [ ] 5. Reassemble file parts into backend `Building` models without changing plan-generation behavior

  **What to do**: Implement a dedicated parser path for `file-parts-v1` that reads `buildingsFiles` in filename order, JSON-loads each array, concatenates them, and reconstructs backend `Building` models by supplying `osm_id=0` and `geometry=[position]` before validation. Keep the existing legacy `buildings` string parse path available as a compatibility fallback when present and under framework limits. Feed the resulting `buildings_list` into the existing `generate_plans_xml()` flow unchanged.

  **Must NOT do**: Do not let chunk boundaries reorder buildings. Do not change `generate_plans_xml()` semantics. Do not reintroduce full geometry into the run payload. Do not route building payloads onward to simengine.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: backend parsing and domain-model adaptation must stay behaviorally exact
  - Skills: `[]` - No extra skill required
  - Omitted: `[refactor]` - this is contract-preserving behavior work, not broad refactoring

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 6 | Blocked By: 4

  **References** (executor has NO interview context - be exhaustive):
  - API/Type: `trafficjam-be/agents/models.py:15-22` - backend `Building` model fields that must be reconstructed
  - API/Type: `trafficjam-be/agents/plans/population.py:11-22` - current parse helper to extend or replace for the new transport
  - Pattern: `trafficjam-be/agents/plans/population.py:25-50` - downstream plan generation path that must receive the same logical building list
  - Pattern: `trafficjam-be/adapters/simengine.py:41-57` - confirms only `networkFile` and generated `plansFile` are forwarded to simengine

  **Acceptance Criteria** (agent-executable only):
  - [ ] `python -m pytest trafficjam-be -q -k start_run` passes with tests proving multi-part payloads are reassembled in order and produce a `RUNNING` response when the simengine adapter is mocked successfully.
  - [ ] `python -m pytest trafficjam-be -q -k start_run` passes with tests proving malformed JSON, mismatched part counts, or unsupported schema versions return `400` with explicit transport-specific detail.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Reassembled payload starts a run successfully
    Tool: Bash
    Steps: Run `python -m pytest trafficjam-be -q -k start_run` with a mocked simengine adapter and a multi-part JSON buildings payload representing the same logical building list across two files.
    Expected: Test proves the route returns JSON containing `"status": "RUNNING"` and the parser reconstructs `Building` objects with synthesized `geometry=[position]`.
    Evidence: .sisyphus/evidence/task-5-reassembly.txt

  Scenario: Manifest mismatch is rejected
    Tool: Bash
    Steps: Run `python -m pytest trafficjam-be -q -k start_run` with `buildingsPartCount=3` but only two `buildingsFiles` entries.
    Expected: Test proves the route returns `400` with an explicit transport mismatch message and no run is created.
    Evidence: .sisyphus/evidence/task-5-reassembly-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `n/a`

- [ ] 6. Lock the contract with regression tests and route documentation

  **What to do**: Extend FE and BE tests so the new contract is explicit and stable. Update `runs.py` route descriptions and parameter descriptions so generated FastAPI docs describe `buildingsFiles`, `buildingsTransport=file-parts-v1`, `buildingsSchemaVersion=1`, the `1048576` byte hard ceiling, and the continued legacy fallback for `buildings` text input. Keep test focus on request shaping and route behavior; do not add full browser automation.

  **Must NOT do**: Do not leave the old docstrings claiming `buildings` is the normal transport. Do not rely on manual validation as the primary proof. Do not broaden this task into simengine OpenAPI cleanup.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: bounded documentation and regression-hardening sweep
  - Skills: `[]` - No extra skill required
  - Omitted: `[doc-writer]` - changes belong inline with the route contract and tests

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: F1-F4 | Blocked By: 2, 3, 4, 5

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `trafficjam-fe/src/api/index.test.tsx:98-118` - current FE request contract tests to strengthen
  - Pattern: `trafficjam-be/api/runs.py:71-95` - route summary and field descriptions that must describe the new transport
  - Pattern: `trafficjam-be/main.py:41-70` - app-level context if exception formatting for the new route is adjusted

  **Acceptance Criteria** (agent-executable only):
  - [ ] `pnpm --dir trafficjam-fe exec vitest run src/api/index.test.tsx` passes with stable assertions around the new multipart contract.
  - [ ] `python -m pytest trafficjam-be -q -k start_run` passes with route-level coverage for success, malformed payload, mismatched part count, and oversize part rejection.
  - [ ] Generated FastAPI route descriptions in `trafficjam-be/api/runs.py` match the implemented `buildingsFiles` transport and byte limit.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Frontend and backend contract tests both pass
    Tool: Bash
    Steps: Run `pnpm --dir trafficjam-fe exec vitest run src/api/index.test.tsx && python -m pytest trafficjam-be -q -k start_run`.
    Expected: Both suites pass without relaxing the 1048576-byte ceiling or reintroducing the legacy FE text field.
    Evidence: .sisyphus/evidence/task-6-contract-regressions.txt

  Scenario: Production build still succeeds after contract changes
    Tool: Bash
    Steps: Run `pnpm --dir trafficjam-fe build`.
    Expected: FE build completes successfully and no new type errors remain from the changed run payload contract.
    Evidence: .sisyphus/evidence/task-6-contract-regressions-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `n/a`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy
- Single implementation commit after Tasks 1-6 and before the final verification wave.
- Commit message: `fix(simulation): keep launch multipart parts below 1mb`
- Do not commit partial wave output unless recovery requires a checkpoint.

## Success Criteria
- The frontend no longer sends a monolithic `buildings` text field when launching a run.
- Every generated `buildingsFiles` multipart part is byte-budgeted below `921600` bytes, keeping it under the effective 1 MB ceiling with headroom.
- Backend validation happens before run creation and rejects malformed or oversized new-transport payloads with explicit, stable errors.
- Backend plan generation still receives the same logical buildings dataset and can start a run successfully.
- FE Vitest, FE build, and backend pytest verification all pass.
