const MARKETPLACE_CURRENCIES: Record<string, string> = {
  EBAY_IT: "EUR",
};

export function getExpectedMarketplaceCurrency(marketplaceId: string) {
  return MARKETPLACE_CURRENCIES[marketplaceId] ?? null;
}

export function isEbayStockDryRunEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function isPositiveShopifyOrderQuantity(value: number) {
  return Number.isInteger(value) && value > 0;
}

export function shouldDryRunEbayStockLine(input: {
  allowlist?: string | null;
  ebayItemId: string;
  shopDomain?: string | null;
  shopifyVariantGid?: string | null;
  stockDryRunEnabled: boolean;
}) {
  if (!input.stockDryRunEnabled) return false;

  return !isEbayStockRealWriteAllowed(input);
}

export function isEbayStockRealWriteAllowed(input: {
  allowlist?: string | null;
  ebayItemId: string;
  shopDomain?: string | null;
  shopifyVariantGid?: string | null;
}) {
  const tokens = getStockRealWriteAllowlistTokens(input.allowlist);
  if (tokens.length === 0) return false;

  const shopDomain = input.shopDomain?.trim().toLowerCase() ?? "";
  const ebayItemId = input.ebayItemId.trim().toLowerCase();
  const variantGid = input.shopifyVariantGid?.trim().toLowerCase() ?? "";
  const variantId = variantGid.split("/").filter(Boolean).at(-1) ?? "";
  const candidates = new Set(
    [
      ebayItemId,
      `ebay:${ebayItemId}`,
      shopDomain ? `shop:${shopDomain}` : null,
      shopDomain ? `${shopDomain}:${ebayItemId}` : null,
      variantGid ? `variant:${variantGid}` : null,
      variantId ? `variant:${variantId}` : null,
      shopDomain && variantId ? `${shopDomain}:variant:${variantId}` : null,
    ].filter((value): value is string => Boolean(value)),
  );

  return tokens.some((token) => candidates.has(token));
}

function getStockRealWriteAllowlistTokens(value: string | null | undefined) {
  return (
    value?.split(/[\s,]+/).flatMap((token) => {
      const normalized = token.trim().toLowerCase();

      return normalized ? [normalized] : [];
    }) ?? []
  );
}

export function selectEbayTradingInventorySku(input: {
  itemId: string;
  sku?: string | null;
  skuGenerated?: boolean | null;
}) {
  const sku = input.sku?.trim();
  if (!sku) return null;

  const fallbackSku = `EBAY-${input.itemId}`;

  return input.skuGenerated === true &&
    sku.toUpperCase() === fallbackSku.toUpperCase()
    ? null
    : sku;
}

function normalizeCurrency(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase();

  return normalized || null;
}

export function validateEbayStockCurrency(input: {
  marketplaceId: string;
  snapshotCurrency: string | null | undefined;
}):
  | {
      expectedCurrency: string | null;
      ok: true;
      reason: null;
      snapshotCurrency: string | null;
    }
  | {
      expectedCurrency: string | null;
      ok: false;
      reason: "currency_mismatch" | "missing_snapshot_currency";
      snapshotCurrency: string | null;
    } {
  const expectedCurrency = getExpectedMarketplaceCurrency(input.marketplaceId);
  const snapshotCurrency = normalizeCurrency(input.snapshotCurrency);

  if (!expectedCurrency) {
    return {
      expectedCurrency,
      ok: true,
      reason: null,
      snapshotCurrency,
    };
  }

  if (!snapshotCurrency) {
    return {
      expectedCurrency,
      ok: false,
      reason: "missing_snapshot_currency",
      snapshotCurrency,
    };
  }

  if (snapshotCurrency !== expectedCurrency) {
    return {
      expectedCurrency,
      ok: false,
      reason: "currency_mismatch",
      snapshotCurrency,
    };
  }

  return {
    expectedCurrency,
    ok: true,
    reason: null,
    snapshotCurrency,
  };
}

export function validateEbayStockOrderCurrency(input: {
  marketplaceId: string;
  orderCurrency: string | null | undefined;
}):
  | {
      expectedCurrency: string | null;
      ok: true;
      orderCurrency: string | null;
      reason: null;
    }
  | {
      expectedCurrency: string | null;
      ok: false;
      orderCurrency: string | null;
      reason: "currency_mismatch" | "missing_order_currency";
    } {
  const expectedCurrency = getExpectedMarketplaceCurrency(input.marketplaceId);
  const orderCurrency = normalizeCurrency(input.orderCurrency);

  if (!expectedCurrency) {
    return {
      expectedCurrency,
      ok: true,
      orderCurrency,
      reason: null,
    };
  }

  if (!orderCurrency) {
    return {
      expectedCurrency,
      ok: false,
      orderCurrency,
      reason: "missing_order_currency",
    };
  }

  if (orderCurrency !== expectedCurrency) {
    return {
      expectedCurrency,
      ok: false,
      orderCurrency,
      reason: "currency_mismatch",
    };
  }

  return {
    expectedCurrency,
    ok: true,
    orderCurrency,
    reason: null,
  };
}

export function selectShopifyOrderCurrency(input: {
  currency?: string | null;
  presentmentCurrency?: string | null;
  presentmentMoneyCurrency?: string | null;
  shopMoneyCurrency?: string | null;
}) {
  return (
    normalizeCurrency(input.presentmentCurrency) ??
    normalizeCurrency(input.presentmentMoneyCurrency) ??
    normalizeCurrency(input.currency) ??
    normalizeCurrency(input.shopMoneyCurrency)
  );
}
