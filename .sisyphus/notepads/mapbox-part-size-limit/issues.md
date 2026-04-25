# Issues

## 2026-04-25 Task: planning
- A prior librarian background task failed due billing restriction, so official-doc research was supplemented with direct Context7 findings on Starlette `request.form(max_part_size=1024*1024)`.
## 2026-04-25
- The local environment did not have `pnpm`; `bun install` was needed before running the Vitest suite.

## Task 2 — file parts
- `pnpm` is unavailable in this shell, so verification used `bunx vitest run src/api/index.test.tsx` instead.
- The multipart contract must keep `networkFile`, bounds, iterations, randomSeed, and note untouched while replacing only the legacy buildings text field.
- Corrected a test fixture type in `trafficjam-fe/src/api/index.test.tsx`: `commercial` was not a valid `BuildingType`, so the multipart contract test now uses `supermarket`.

## Task 3 — gotchas
- vitest.config.ts did not include the vite `@` alias or react plugin; existing api tests passed because they don't use `@/` imports. Component tests need both.
- Without a global setup file, `@testing-library/react` does NOT auto-cleanup between tests. Must import and call `cleanup()` in `afterEach`.
- `beforeEach` imported but unused causes a TypeScript error (TS6133) that fails `tsc` in the build step.

## 2026-04-25 Task 4 — backend contract
- No `.venv` existed in `trafficjam-be/`; created one at `trafficjam-be/.venv` and installed `requirements.txt + pytest + pytest-asyncio`. Future BE pytest commands must use `trafficjam-be/.venv/bin/python -m pytest`.
- `pytest-asyncio` not needed for these tests — TestClient handles the async route synchronously, AsyncMock returns awaitables natively when awaited inside the route.
- `monkeypatch` of `parse_buildings_and_bounds`/`generate_plans_xml` in `runs_module` keeps Task 4 tests isolated from Task 5 reassembly concerns.
- Delegation via `task()` was repeatedly aborted by the environment in this session; Atlas executed Task 4 directly per explicit user instruction "agent isnt working, fix".
