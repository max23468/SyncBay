export type ShopifyOrderStockAction = "decrement" | "restore";

export function getShopifyOrderStockAction(value: unknown) {
  return value === "restore" ? "restore" : "decrement";
}

export function getOrderLineMappingLookup(input: {
  shopifyProductGid: string | null;
  shopifyVariantGid: string | null;
}) {
  if (input.shopifyVariantGid) {
    return { shopifyVariantGid: input.shopifyVariantGid };
  }
  if (input.shopifyProductGid) {
    return {
      shopifyProductGid: input.shopifyProductGid,
      shopifyVariantGid: null,
    };
  }

  return null;
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
