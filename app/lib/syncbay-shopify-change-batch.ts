export interface ShopifyChangeBatchJob {
  id: string;
  createdAt: Date;
  inventoryItemGid: string | null;
  productGid: string | null;
  shopId: string;
  topic: string;
}

export interface ShopifyChangeBatchGroup {
  duplicateJobIds: string[];
  jobs: ShopifyChangeBatchJob[];
}

export function buildShopifyChangeBatch(
  jobs: ShopifyChangeBatchJob[],
  maxItems = 25,
): ShopifyChangeBatchGroup {
  const newestByResource = new Map<string, ShopifyChangeBatchJob>();
  const duplicateJobIds: string[] = [];

  for (const candidate of [...jobs].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  )) {
    const resource = candidate.productGid
      ? `product:${candidate.topic}:${candidate.productGid}`
      : candidate.inventoryItemGid
        ? `inventory:${candidate.topic}:${candidate.inventoryItemGid}`
        : `missing:${candidate.id}`;

    if (newestByResource.has(resource)) {
      duplicateJobIds.push(candidate.id);
      continue;
    }
    if (newestByResource.size < maxItems) newestByResource.set(resource, candidate);
  }

  return { duplicateJobIds, jobs: [...newestByResource.values()] };
}

export function buildSeededShopifyChangeBatch(
  seed: ShopifyChangeBatchJob,
  queuedJobs: ShopifyChangeBatchJob[],
  maxItems = 25,
) {
  const boundedMaxItems = Math.max(1, maxItems);

  return buildShopifyChangeBatch(
    [seed, ...queuedJobs.slice(0, boundedMaxItems - 1)],
    boundedMaxItems,
  );
}
