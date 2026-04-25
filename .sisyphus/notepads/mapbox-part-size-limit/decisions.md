# Decisions

## 2026-04-25 Task: planning
- Use a durable frontend/backend multipart contract: `buildingsFiles` JSON file parts plus `buildingsTransport=file-parts-v1`, `buildingsSchemaVersion=1`, and `buildingsPartCount` metadata.
- Use `921600` bytes as the FE operational budget per part and `1048576` bytes as the BE hard ceiling.
- Do not widen parser limits for the legacy `buildings` text field.
