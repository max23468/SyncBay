export function buildPricingRuleSyncPlan(input: {
  activeEbayItemIds: string[];
  batchSize: number;
  ebayConnected: boolean;
  hasDefaultLocation: boolean;
}) {
  const skippedReason = getPricingRuleSyncSkippedReason({
    activeMappingCount: input.activeEbayItemIds.length,
    ebayConnected: input.ebayConnected,
    hasDefaultLocation: input.hasDefaultLocation,
  });

  if (skippedReason) {
    return {
      batches: [] as string[][],
      pricingOnly: true,
      queuedProductCount: 0,
      skippedReason,
    };
  }

  return {
    batches: chunkArray(input.activeEbayItemIds, input.batchSize),
    pricingOnly: true,
    queuedProductCount: input.activeEbayItemIds.length,
    skippedReason: null,
  };
}

export function isPricingOnlySyncJobPayload(payload: unknown) {
  const object = getJsonObject(payload);

  return (
    object?.pricingOnly === true || object?.source === "pricing_rule_update"
  );
}

function getPricingRuleSyncSkippedReason(input: {
  activeMappingCount: number;
  ebayConnected: boolean;
  hasDefaultLocation: boolean;
}) {
  if (input.activeMappingCount === 0) return "nessun prodotto attivo";
  if (!input.ebayConnected) return "account eBay non collegato";
  if (!input.hasDefaultLocation) return "location Shopify predefinita assente";

  return null;
}

function chunkArray<T>(items: T[], size: number) {
  if (size <= 0) return [items];

  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function getJsonObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  return value as Record<string, unknown>;
}
