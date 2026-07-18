export function buildCatalogReconcilePlan(input: {
  activeEbayItemIds: string[];
  activeScanComplete: boolean;
  batchSize: number;
  mappedEbayItemIds: string[];
}) {
  if (!Number.isInteger(input.batchSize) || input.batchSize <= 0) {
    throw new Error("batchSize deve essere un intero positivo.");
  }

  const activeEbayItemIds = uniqueNonEmptyStrings(input.activeEbayItemIds);
  const mappedEbayItemIds = uniqueNonEmptyStrings(input.mappedEbayItemIds);
  const activeSet = new Set(activeEbayItemIds);

  return {
    inactiveEbayItemIds: input.activeScanComplete
      ? mappedEbayItemIds.filter((itemId) => !activeSet.has(itemId))
      : [],
    syncBatches: chunkArray(activeEbayItemIds, input.batchSize),
  };
}

export function isCatalogReconcileScanComplete(input: {
  itemIds: string[];
  maxProducts: number;
  readCount: number;
  totalAvailable: number | null;
}) {
  if (!Number.isInteger(input.maxProducts) || input.maxProducts <= 0) {
    return false;
  }
  if (input.totalAvailable === null) {
    return input.itemIds.length > 0 && input.readCount < input.maxProducts;
  }

  return (
    input.totalAvailable <= input.maxProducts &&
    input.readCount >= input.totalAvailable
  );
}

function uniqueNonEmptyStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

import { chunkArray } from "./chunk-array";
