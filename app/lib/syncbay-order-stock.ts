export const SHOPIFY_ORDER_STOCK_ACTIONS = ["decrement", "restore"] as const;

export type ShopifyOrderStockAction =
  (typeof SHOPIFY_ORDER_STOCK_ACTIONS)[number];

export function getShopifyOrderStockAction(value: unknown) {
  return value === "restore" ? "restore" : "decrement";
}

export function getShopifyOrderStockTarget(input: {
  action: ShopifyOrderStockAction;
  ebayAvailableQuantity?: number | null;
  orderQuantity: number;
  previousQuantity: number;
  shopifyAvailableQuantity?: number | null;
}) {
  if (input.action === "decrement") {
    return Math.max(0, input.previousQuantity - input.orderQuantity);
  }

  if (
    input.ebayAvailableQuantity === null ||
    typeof input.ebayAvailableQuantity === "undefined" ||
    input.shopifyAvailableQuantity === null ||
    typeof input.shopifyAvailableQuantity === "undefined"
  ) {
    return null;
  }

  return Math.max(
    0,
    Math.min(
      input.previousQuantity,
      input.shopifyAvailableQuantity,
      input.ebayAvailableQuantity + input.orderQuantity,
    ),
  );
}
