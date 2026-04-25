# Learnings

## 2026-04-25 Task: planning
- The likely oversized multipart part is the frontend `buildings` JSON form field in `trafficjam-fe/src/api/http.ts`, not the Java simengine upload.
- `simengine/src/main/resources/application.properties` already allows 20MB multipart files; do not use simengine limit changes as the fix.
- Backend plan-generation code does not appear to read building `geometry`; preserving simulation behavior can be achieved by using `position` and reconstructing `geometry=[position]` for backend model validation.
## 2026-04-25
- Run-building payloads should serialize only `id`, `position`, `type`, `tags`, and `hotspot`; `geometry`/`osm_id` stay out of the launch payload.
- Chunk planning is stable when it measures `JSON.stringify(chunk)` with `TextEncoder().encode(...).byteLength`.
- The 921600-byte operational budget keeps chunks safely below the 1048576-byte multipart ceiling.

## Task 2 — file parts
- `buildStartRunForm()` now reuses `chunkRunBuildings()` and emits repeated `buildingsFiles` parts with deterministic `buildings-part-<index>.json` names.
- `FormData.getAll("buildingsFiles")` works in Vitest/jsdom with `File` parts, so multipart contract tests can validate both filenames and JSON payload text.

## Task 3 — dialog error surfacing
- LaunchDialog already had a correct catch block: `setError(e instanceof Error ? e.message : "Failed to start simulation")`. No production code change was needed.
- vitest.config.ts lacked the `@` alias and `@vitejs/plugin-react` plugin; added both so component tests can resolve `@/` imports.
- `@testing-library/react` cleanup() must be called in afterEach when there is no global setup file; otherwise DOM accumulates across tests causing "multiple elements" errors.
- Radix UI Dialog uses portals; mocking `@/components` with a plain div stub avoids portal/overlay complexity in jsdom.
- `Scenario` type requires `agentConfig` and `updatedAt`; test fixtures must be complete.

## 2026-04-25 Task 4 — backend contract
- `start_run()` now branches on `buildingsTransport`. When `file-parts-v1`: validate schema version (==1), part count (==len(buildingsFiles)), and per-part byte size (<=1048576) BEFORE `run_repo.create_run`.
- Reassembly shim: sort validated parts by filename ascending, json.loads each, concat into a list, json.dumps into the local `buildings` variable. Existing `parse_buildings_and_bounds(buildings, bounds)` continues to work end-to-end. Task 5 will refactor this into a dedicated parser with proper Building reconstruction.
- Tests use a minimal FastAPI app + `app.include_router(runs_module.router)` + `app.dependency_overrides`, never `main.app`. TestClient (sync) is sufficient; async paths flow through AsyncMock.
- Locally run pytest via `trafficjam-be/.venv/bin/python -m pytest -q tests/test_start_run_contract.py`.
- `UploadFile` content is read once with `await f.read()` and stored in `validated_parts: list[tuple[str, bytes]]`; do not re-seek.
- Constants: `BUILDINGS_PART_HARD_LIMIT_BYTES = 1048576`, `BUILDINGS_TRANSPORT_FILE_PARTS_V1 = "file-parts-v1"`, `BUILDINGS_SCHEMA_VERSION = 1`.
- Exact error strings (case-sensitive): `buildingsFiles part exceeds 1048576 bytes` (413), `buildingsPartCount does not match buildingsFiles count` (400), `Unsupported buildingsSchemaVersion` (400), `Unsupported buildingsTransport` (400 — covers unknown transport values).
