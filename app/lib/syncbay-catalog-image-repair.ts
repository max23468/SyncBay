export type CatalogImageRepairMapping = {
  ebayItemId: string | null;
  hasThumbnailUrl: boolean;
  hasOpenConflicts?: boolean;
  shopifyProductGid: string | null;
};

export function getCatalogImageRepairCandidateWhere<
  TActiveStatus extends string,
  TOpenConflictStatus extends string,
>(input: {
  activeStatus: TActiveStatus;
  marketplaceId: string;
  openConflictStatus: TOpenConflictStatus;
  shopId: string;
}) {
  return {
    conflicts: { none: { status: input.openConflictStatus } },
    marketplaceId: input.marketplaceId,
    shopId: input.shopId,
    shopifyProductGid: { not: null },
    status: input.activeStatus,
    thumbnailUrl: null,
  };
}

export function getCatalogImageRepairItemIds(input: {
  limit: number;
  mappings: CatalogImageRepairMapping[];
}) {
  if (!Number.isInteger(input.limit) || input.limit <= 0) return [];

  const seen = new Set<string>();
  const itemIds: string[] = [];

  for (const mapping of input.mappings) {
    if (itemIds.length >= input.limit) break;
    if (mapping.hasOpenConflicts) continue;
    if (mapping.hasThumbnailUrl) continue;
    if (!mapping.shopifyProductGid?.trim()) continue;

    const ebayItemId = mapping.ebayItemId?.trim();

    if (!ebayItemId || seen.has(ebayItemId)) continue;

    seen.add(ebayItemId);
    itemIds.push(ebayItemId);
  }

  return itemIds;
}

export function getCatalogImageRepairRunKey(now: Date) {
  return now.toISOString().slice(0, 10);
}
