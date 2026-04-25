import type { Building } from "../types";

export const RUN_BUILDINGS_PART_BYTE_BUDGET = 921600;
export const RUN_BUILDINGS_HARD_LIMIT_BYTES = 1048576;
export const RUN_BUILDINGS_LIMIT_ERROR =
  "Simulation payload exceeds 1048576-byte multipart part limit for buildings";

export interface RunBuildingRecord {
  id: string;
  position: Building["position"];
  type: Building["type"];
  tags: Building["tags"];
  hotspot?: Building["hotspot"];
}

function measureJsonUtf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function serializeRunBuilding(building: Building): RunBuildingRecord {
  const { id, position, type, tags, hotspot } = building;
  return hotspot === undefined
    ? { id, position, type, tags }
    : { id, position, type, tags, hotspot };
}

export function serializeRunBuildings(buildings: Building[]): RunBuildingRecord[] {
  return buildings.map(serializeRunBuilding);
}

export function chunkRunBuildingRecords(
  records: RunBuildingRecord[],
  budget = RUN_BUILDINGS_PART_BYTE_BUDGET,
): RunBuildingRecord[][] {
  const chunks: RunBuildingRecord[][] = [];
  let currentChunk: RunBuildingRecord[] = [];

  for (const record of records) {
    const candidate = [...currentChunk, record];
    if (measureJsonUtf8Bytes(candidate) <= budget) {
      currentChunk = candidate;
      continue;
    }

    if (currentChunk.length === 0) {
      throw new Error(RUN_BUILDINGS_LIMIT_ERROR);
    }

    chunks.push(currentChunk);
    currentChunk = [record];

    if (measureJsonUtf8Bytes(currentChunk) > budget) {
      throw new Error(RUN_BUILDINGS_LIMIT_ERROR);
    }
  }

  if (currentChunk.length > 0) chunks.push(currentChunk);
  return chunks;
}

export function chunkRunBuildings(
  buildings: Building[],
  budget = RUN_BUILDINGS_PART_BYTE_BUDGET,
): RunBuildingRecord[][] {
  return chunkRunBuildingRecords(serializeRunBuildings(buildings), budget);
}
