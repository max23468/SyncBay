import { selectShopifyOrderCurrency } from "./syncbay-stock-guard";

export const SHOPIFY_WEBHOOK_TOPICS = [
  "app/uninstalled",
  "app/scopes_update",
  "orders/paid",
  "products/update",
  "inventory_levels/update",
] as const;

export function normalizeShopifyWebhookTopic(topic: string) {
  const normalized = topic.toLowerCase();

  return (
    SHOPIFY_WEBHOOK_TOPICS.find(
      (candidate) =>
        candidate === normalized || candidate.replace("/", "_") === normalized,
    ) ?? normalized
  );
}

export function getShopifyWebhookJobPayload(topic: string, payload: unknown) {
  if (topic === "orders/paid") {
    return {
      orderCurrency: extractShopifyOrderCurrency(payload),
      lineItems: extractShopifyOrderLineItems(payload),
    };
  }

  if (topic === "inventory_levels/update") {
    return {
      inventoryItemGid: extractShopifyInventoryItemGid(payload),
    };
  }

  return {};
}

function extractShopifyOrderLineItems(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];

  const record = payload as Record<string, unknown>;
  const rawLineItems = Array.isArray(record.line_items)
    ? record.line_items
    : [];

  return rawLineItems.flatMap((lineItem, index) => {
    if (!lineItem || typeof lineItem !== "object") return [];

    const lineItemRecord = lineItem as Record<string, unknown>;
    const lineItemId = getStringField(lineItemRecord, "id");
    const quantity = getNumberField(lineItemRecord, "quantity");
    const productId = getStringField(lineItemRecord, "product_id");
    const variantId = getStringField(lineItemRecord, "variant_id");

    if (!quantity || !isPositiveOrderQuantity(quantity)) return [];

    return [
      {
        lineItemKey:
          lineItemId ??
          `${productId ?? "no-product"}:${variantId ?? "no-variant"}:${index}`,
        quantity,
        shopifyProductGid: productId
          ? `gid://shopify/Product/${productId}`
          : null,
        shopifyVariantGid: variantId
          ? `gid://shopify/ProductVariant/${variantId}`
          : null,
      },
    ];
  });
}

function extractShopifyOrderCurrency(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  const moneySet = getRecordField(record, "current_total_price_set");
  const presentmentMoney = getRecordField(moneySet, "presentment_money");
  const shopMoney = getRecordField(moneySet, "shop_money");

  return selectShopifyOrderCurrency({
    currency: getStringField(record, "currency"),
    presentmentCurrency: getStringField(record, "presentment_currency"),
    presentmentMoneyCurrency: getStringField(presentmentMoney, "currency_code"),
    shopMoneyCurrency: getStringField(shopMoney, "currency_code"),
  });
}

function extractShopifyInventoryItemGid(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  const inventoryItemId = getStringField(record, "inventory_item_id");

  return inventoryItemId
    ? `gid://shopify/InventoryItem/${inventoryItemId}`
    : null;
}

function getRecordField(
  record: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = record?.[key];

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getStringField(
  record: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = record?.[key];

  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);

  return null;
}

function getNumberField(record: Record<string, unknown>, key: string) {
  const value = record[key];

  if (typeof value === "number" && Number.isFinite(value)) return value;

  return null;
}

function isPositiveOrderQuantity(value: number) {
  return Number.isInteger(value) && value > 0;
}
