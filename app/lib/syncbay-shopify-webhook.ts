import { selectShopifyOrderCurrency } from "./syncbay-stock-guard";
import { chunkArray } from "./chunk-array";

export const SHOPIFY_WEBHOOK_TOPICS = [
  "app/uninstalled",
  "app/scopes_update",
  "orders/create",
  "orders/paid",
  "orders/cancelled",
  "products/update",
  "inventory_levels/update",
] as const;
export const SHOPIFY_ORDER_STOCK_JOB_LINE_LIMIT = 25;

interface ShopifyWebhookJobPayload {
  inventoryItemGid?: string | null;
  lineItems?: Array<{
    lineItemKey: string;
    quantity: number;
    shopifyProductGid: string | null;
    shopifyVariantGid: string | null;
  }>;
  orderCurrency?: string | null;
  stockAction?: "decrement" | "restore";
  stockBatchCount?: number;
  stockBatchIndex?: number;
}

export function normalizeShopifyWebhookTopic(topic: string) {
  const normalized = topic.toLowerCase();

  return (
    SHOPIFY_WEBHOOK_TOPICS.find(
      (candidate) => candidate === normalized || candidate.replace("/", "_") === normalized,
    ) ?? normalized
  );
}

export function shouldRecordShopifyWebhook(installationStatus: string) {
  return installationStatus === "INSTALLED";
}

export function getShopifyWebhookJobPayload(
  topic: string,
  payload: unknown,
): ShopifyWebhookJobPayload {
  if (["orders/create", "orders/paid", "orders/cancelled"].includes(topic)) {
    return {
      orderCurrency: extractShopifyOrderCurrency(payload),
      lineItems: extractShopifyOrderLineItems(payload),
      stockAction: topic === "orders/cancelled" ? "restore" : "decrement",
    };
  }

  if (topic === "inventory_levels/update") {
    return {
      inventoryItemGid: extractShopifyInventoryItemGid(payload),
    };
  }

  return {};
}

export function getShopifyWebhookJobPayloads(
  topic: string,
  payload: unknown,
): ShopifyWebhookJobPayload[] {
  const jobPayload = getShopifyWebhookJobPayload(topic, payload);
  const lineItems = "lineItems" in jobPayload ? jobPayload.lineItems : null;

  if (!lineItems || lineItems.length <= SHOPIFY_ORDER_STOCK_JOB_LINE_LIMIT) {
    return [jobPayload];
  }

  const batches = chunkArray(lineItems, SHOPIFY_ORDER_STOCK_JOB_LINE_LIMIT);

  return batches.map((batch, index) => ({
    ...jobPayload,
    lineItems: batch,
    stockBatchCount: batches.length,
    stockBatchIndex: index + 1,
  }));
}

function extractShopifyOrderLineItems(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];

  const record = payload as Record<string, unknown>;
  const orderId = getStringField(record, "admin_graphql_api_id") ?? getStringField(record, "id");
  const rawLineItems = Array.isArray(record.line_items) ? record.line_items : [];

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
          `${orderId ?? "no-order"}:${productId ?? "no-product"}:${variantId ?? "no-variant"}:${index}`,
        quantity,
        shopifyProductGid: productId ? `gid://shopify/Product/${productId}` : null,
        shopifyVariantGid: variantId ? `gid://shopify/ProductVariant/${variantId}` : null,
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

  return inventoryItemId ? `gid://shopify/InventoryItem/${inventoryItemId}` : null;
}

function getRecordField(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getStringField(record: Record<string, unknown> | null | undefined, key: string) {
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
