# Unblock Frontend `pdf-lib` Build Failure

## TL;DR
> **Summary**: The current `make rebuild` failure is caused by frontend reporting code importing `pdf-lib` without declaring it in the Bun-managed frontend dependency graph. Fix the dependency surface first, then prove the blocker is gone locally and in the Docker path that `make rebuild` uses.
> **Deliverables**:
> - `trafficjam-fe/package.json` updated with `pdf-lib` as a runtime dependency
> - `trafficjam-fe/bun.lock` refreshed by Bun
> - Verified removal of `TS2307` for `pdf-lib`
> - Verified frontend Docker build passes the former failing step
> **Effort**: Quick
> **Parallel**: NO
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4

## Context
### Original Request
Understand why `make rebuild` is failing and prepare the fix path.

### Interview Summary
- User-provided logs show `make rebuild` fails in the `frontend` image build.
- The failing command is `bun run build` inside `docker/Dockerfile.fe`.
- The exact error is `TS2307: Cannot find module 'pdf-lib'` from `trafficjam-fe/src/features/reporting/render-report-pdf.ts`.
- User selected **Unblock build only**, not package-manager cleanup.

### Metis Review (gaps addressed)
- Keep the change surface minimal: `trafficjam-fe/package.json` and `trafficjam-fe/bun.lock` only unless the root-cause hypothesis fails.
- Treat Bun as the effective package-manager convention because Docker, CI, README, and lockfile all use Bun.
- Verify in layers: dependency/lock consistency → TypeScript → tests/build → Docker path.
- Do **not** widen scope into pnpm/Bun normalization, Docker refactors, or unrelated reporting refactors.

## Work Objectives
### Core Objective
Remove the current frontend dependency blocker so the rebuild path no longer fails on `TS2307` for `pdf-lib`.

### Deliverables
- Runtime dependency declaration for `pdf-lib` in `trafficjam-fe/package.json`
- Matching Bun lockfile update in `trafficjam-fe/bun.lock`
- Passing frontend typecheck/build on the same Bun workflow used by CI and Docker
- Passing frontend Docker build for the local compose target
- A classified note if any later `make rebuild` failure is unrelated to the frontend `pdf-lib` issue

### Definition of Done (verifiable conditions with commands)
- `workdir=/Users/james/Documents/Hackathons/Bims-5/trafficjam-fe && bun install --frozen-lockfile` exits `0`
- `workdir=/Users/james/Documents/Hackathons/Bims-5/trafficjam-fe && bunx tsc --noEmit` exits `0` and does not report `TS2307` or `Cannot find module 'pdf-lib'`
- `workdir=/Users/james/Documents/Hackathons/Bims-5/trafficjam-fe && bun run build` exits `0`
- `workdir=/Users/james/Documents/Hackathons/Bims-5 && docker compose -f docker-compose.local.yml build frontend` exits `0`
- `workdir=/Users/james/Documents/Hackathons/Bims-5 && make rebuild` either exits `0` or, if a later unrelated failure appears after frontend completes successfully, the executor captures that new blocker as out-of-scope evidence without making extra fixes

### Must Have
- Add `pdf-lib` to **`dependencies`**, not `devDependencies`
- Update `bun.lock` via Bun tooling, not manual edits
- Keep edits limited to the frontend dependency surface unless the `pdf-lib` hypothesis is disproven
- Preserve existing Bun-based CI/Docker workflow

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- No pnpm/Bun cleanup or package-manager standardization work
- No tsconfig changes as the first fix
- No Dockerfile changes as the first fix
- No reporting feature refactors unrelated to dependency resolution
- No manual lockfile surgery
- No changes outside `trafficjam-fe/package.json` and `trafficjam-fe/bun.lock` unless Task 2 proves the root-cause hypothesis false

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: **tests-after** using existing Bun/Vitest/TypeScript/Docker commands
- QA policy: Every task includes agent-executed happy-path and failure-path scenarios
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.log`

## Execution Strategy
### Parallel Execution Waves
> Sequential on purpose: each step depends on the previous one.

Wave 1: Task 1 (dependency declaration)
Wave 2: Task 2 (lock/typecheck validation)
Wave 3: Task 3 (frontend test/build validation)
Wave 4: Task 4 (Docker/rebuild verification and blocker classification)

### Dependency Matrix (full, all tasks)
- Task 1 blocks Tasks 2-4
- Task 2 blocks Tasks 3-4
- Task 3 blocks Task 4
- Task 4 precedes Final Verification Wave

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 1 task → `quick`
- Wave 2 → 1 task → `quick`
- Wave 3 → 1 task → `quick`
- Wave 4 → 1 task → `unspecified-low`

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Add `pdf-lib` as a Bun-managed runtime dependency

  **What to do**: In `trafficjam-fe`, add `pdf-lib` using Bun so both `package.json` and `bun.lock` update together. Place `pdf-lib` under `dependencies` because `trafficjam-fe/src/features/reporting/render-report-pdf.ts` imports it in application code.
  **Must NOT do**: Do not hand-edit `bun.lock`. Do not place `pdf-lib` in `devDependencies`. Do not touch Dockerfile, tsconfig, or other frontend source files in this task.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: narrow, low-risk dependency-surface change
  - Skills: `[]` - no extra skill required
  - Omitted: [`git-master`] - no git operation is required for execution

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2, 3, 4 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `trafficjam-fe/src/features/reporting/render-report-pdf.ts:1-2` - application code imports `pdf-lib`, proving this is a runtime dependency
  - API/Type: `trafficjam-fe/package.json:6-12` - frontend scripts show Bun-driven build/test entrypoints
  - Pattern: `trafficjam-fe/package.json:32-61` - existing runtime dependency section where `pdf-lib` belongs
  - External: `https://pdf-lib.js.org/` - official library site for package identity/reference

  **Acceptance Criteria** (agent-executable only):
  - [ ] `trafficjam-fe/package.json` contains `pdf-lib` under `dependencies`
  - [ ] `trafficjam-fe/bun.lock` contains a `pdf-lib` entry generated by Bun
  - [ ] No new package-manager files are created (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock` remain absent)

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Runtime dependency is added correctly
    Tool: Bash
    Steps: Run `bun add pdf-lib` in `/Users/james/Documents/Hackathons/Bims-5/trafficjam-fe`; inspect `package.json` and `bun.lock`
    Expected: `pdf-lib` appears in `dependencies` and the Bun lockfile updates successfully
    Evidence: .sisyphus/evidence/task-1-add-pdf-lib.log

  Scenario: Wrong dependency placement or lockfile drift
    Tool: Bash
    Steps: After adding, check for `pdf-lib` under `devDependencies` and check whether any non-Bun lockfile was created
    Expected: `pdf-lib` is NOT in `devDependencies`; no non-Bun lockfile exists; if drift appears, revert and re-run with Bun-only runtime dependency flow
    Evidence: .sisyphus/evidence/task-1-add-pdf-lib-error.log
  ```

  **Commit**: NO | Message: `fix(frontend): add missing pdf-lib dependency` | Files: `trafficjam-fe/package.json`, `trafficjam-fe/bun.lock`

- [x] 2. Prove Bun lock consistency and remove the TypeScript blocker

  **What to do**: Validate that the dependency surface now matches the Bun workflow used by CI and Docker. Run a frozen-lock install and a no-emit typecheck from `trafficjam-fe`. If `TS2307` for `pdf-lib` persists, inspect the exact manifest/lock files copied by `docker/Dockerfile.fe` before making any broader changes.
  **Must NOT do**: Do not widen scope into pnpm cleanup. Do not change tsconfig or module resolution unless the dependency hypothesis is disproven.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: targeted validation with one contingency branch
  - Skills: `[]` - no extra skill required
  - Omitted: [`playwright`] - no browser interaction is needed

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 3, 4 | Blocked By: 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `trafficjam-fe/tsconfig.json:12-13` - `moduleResolution: "bundler"` and bare-import resolution rules
  - Pattern: `trafficjam-fe/tsconfig.json:29` - `include: ["src"]` means the reporting file is always typechecked
  - Pattern: `.github/workflows/lint.yml:31-44` - CI-standard commands: frozen Bun install, TypeScript, tests
  - Pattern: `docker/Dockerfile.fe:6-14` - Docker copies frontend `package.json` and `bun.lock*`, then runs `bun install` and `bun run build`

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun install --frozen-lockfile` exits `0` in `trafficjam-fe`
  - [ ] `bunx tsc --noEmit` exits `0` in `trafficjam-fe`
  - [ ] TypeScript output no longer contains `TS2307` or `Cannot find module 'pdf-lib'`
  - [ ] If the same `pdf-lib` error persists, the executor captures manifest/lock/Docker copy-path evidence before any broader change

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Lockfile and typecheck align with CI
    Tool: Bash
    Steps: Run `bun install --frozen-lockfile` and `bunx tsc --noEmit` in `/Users/james/Documents/Hackathons/Bims-5/trafficjam-fe`
    Expected: Both commands exit `0`; no `pdf-lib` module-resolution error remains
    Evidence: .sisyphus/evidence/task-2-typecheck.log

  Scenario: TS2307 still appears after dependency update
    Tool: Bash
    Steps: Re-run `bunx tsc --noEmit`; if `pdf-lib` still fails, inspect `docker/Dockerfile.fe` copy lines and confirm the changed `package.json`/`bun.lock` are the files Docker consumes
    Expected: Either the error is gone, or a precise copy-path/lock-path blocker is documented without unrelated code changes
    Evidence: .sisyphus/evidence/task-2-typecheck-error.log
  ```

  **Commit**: NO | Message: `fix(frontend): align bun lock with pdf-lib import` | Files: `trafficjam-fe/package.json`, `trafficjam-fe/bun.lock`

- [x] 3. Validate the normal frontend quality gates

  **What to do**: Run the standard frontend checks used by the repo after the dependency fix: `bun run test` and `bun run build` from `trafficjam-fe`. Capture any new failures exactly; do not fix unrelated test or lint debt under this plan.
  **Must NOT do**: Do not refactor reporting logic or patch unrelated tests. Do not add PDF-specific tests in this unblock-only scope.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: straightforward verification against established scripts
  - Skills: `[]` - no extra skill required
  - Omitted: [`test-writer`] - adding tests is out of scope for this unblock-only plan

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 4 | Blocked By: 2

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `trafficjam-fe/package.json:6-12` - canonical frontend scripts for `build` and `test`
  - Test: `.github/workflows/lint.yml:39-44` - CI order and exact commands for TypeScript/test validation
  - Pattern: `docker/Dockerfile.fe:14` - build stage uses the same `bun run build` command being validated here

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun run test` exits `0` in `trafficjam-fe`
  - [ ] `bun run build` exits `0` in `trafficjam-fe`
  - [ ] No remaining frontend failure mentions `pdf-lib` resolution

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Frontend scripts pass after dependency fix
    Tool: Bash
    Steps: Run `bun run test` and `bun run build` in `/Users/james/Documents/Hackathons/Bims-5/trafficjam-fe`
    Expected: Both commands exit `0`; the previous `pdf-lib` blocker does not recur
    Evidence: .sisyphus/evidence/task-3-frontend-gates.log

  Scenario: A different frontend failure appears
    Tool: Bash
    Steps: Capture the first failing command and its exact output if `bun run test` or `bun run build` fails for a reason other than missing `pdf-lib`
    Expected: Failure is documented as a new blocker; no unrelated source changes are made under this plan
    Evidence: .sisyphus/evidence/task-3-frontend-gates-error.log
  ```

  **Commit**: NO | Message: `fix(frontend): verify pdf report dependency unblock` | Files: `trafficjam-fe/package.json`, `trafficjam-fe/bun.lock`

- [x] 4. Verify the Docker path used by `make rebuild` and classify any downstream blockers

  **What to do**: First run an isolated frontend Docker build using `docker compose -f docker-compose.local.yml build frontend`. Then run `make rebuild` from the repo root. If the former `pdf-lib` blocker is gone but `make rebuild` later fails elsewhere, stop and document that later failure as a separate blocker instead of expanding scope.
  **Must NOT do**: Do not fix backend, DB, NATS, or other service issues under this plan. Do not edit Dockerfiles unless Task 2 proved the dependency hypothesis false.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: cross-service verification, but still low-complexity execution
  - Skills: `[]` - no extra skill required
  - Omitted: [`devops`] - no infrastructure redesign is needed

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: F1-F4 | Blocked By: 3

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `docker/Dockerfile.fe:6-14` - exact frontend image build flow that previously failed
  - Pattern: `Makefile:135-140` - `rebuild` target sequence used by the user
  - Pattern: `.github/workflows/lint.yml:31-44` - matching Bun-based quality gates already validated before Docker

  **Acceptance Criteria** (agent-executable only):
  - [ ] `docker compose -f docker-compose.local.yml build frontend` exits `0`
  - [ ] The frontend Docker build completes past `RUN bun run build` without `TS2307`
  - [ ] `make rebuild` is attempted from repo root
  - [ ] If `make rebuild` fails after frontend succeeds, the new blocker is captured and explicitly marked out of scope for this plan

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Frontend Docker build is unblocked
    Tool: Bash
    Steps: Run `docker compose -f docker-compose.local.yml build frontend` in `/Users/james/Documents/Hackathons/Bims-5`; then run `make rebuild`
    Expected: The frontend image completes the former failing `bun run build` step without `pdf-lib` errors
    Evidence: .sisyphus/evidence/task-4-docker-rebuild.log

  Scenario: Rebuild reveals a later unrelated failure
    Tool: Bash
    Steps: Run `make rebuild`; if another service fails after frontend build success, capture the first later failure and stop
    Expected: The original frontend blocker is confirmed fixed; the later failure is documented as a separate blocker with no extra fixes applied
    Evidence: .sisyphus/evidence/task-4-docker-rebuild-error.log
  ```

  **Commit**: NO | Message: `fix(frontend): unblock docker rebuild by adding pdf-lib` | Files: `trafficjam-fe/package.json`, `trafficjam-fe/bun.lock`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy
- Do not commit during this plan by default.
- If the user later requests a commit, use one focused commit after Task 4 only.
- Recommended commit message if requested: `fix(frontend): add missing pdf-lib dependency for report build`

## Success Criteria
- The specific `TS2307` / `Cannot find module 'pdf-lib'` blocker is gone from frontend typecheck/build output.
- The frontend Docker build path used by local compose no longer fails at `RUN bun run build`.
- The executor does not widen scope into package-manager cleanup or unrelated service fixes.
- Any later non-frontend failure discovered by `make rebuild` is documented as a new blocker rather than silently absorbed into this task.
