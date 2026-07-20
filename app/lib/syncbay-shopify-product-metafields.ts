export interface SyncBayProductMetafieldInput {
  ebayItemId: string;
  ebayPrimaryCategoryId?: string | null;
  ebayPrimaryCategoryName?: string | null;
  ebayPrimaryCategoryPath?: string | null;
  priceAmount?: number | null;
  quantity?: number | null;
  sku?: string | null;
  skuGenerated?: boolean | null;
  storeCategoryId?: string | null;
  storeCategoryName?: string | null;
  storeCategoryPath?: string | null;
}

export interface SyncBayProductMetafield {
  key: string;
  namespace: "syncbay";
  type: "single_line_text_field";
  value: string;
}

export interface SyncBayProductMetafieldNode {
  key?: string | null;
  value?: string | null;
}

export interface SyncBayCategorySourceFromMetafields {
  ebayPrimaryCategoryId: string | null;
  ebayPrimaryCategoryName: string | null;
  ebayPrimaryCategoryPath: string | null;
  storeCategoryId: string | null;
  storeCategoryName: string | null;
  storeCategoryPath: string | null;
}

export function buildSyncBayProductMetafields(
  input: SyncBayProductMetafieldInput,
): SyncBayProductMetafield[] {
  return [
    buildMetafield("ebay_item_id", input.ebayItemId),
    buildMetafield("ebay_sku", input.sku),
    input.priceAmount !== null && typeof input.priceAmount !== "undefined"
      ? buildMetafield("ebay_price", String(input.priceAmount))
      : null,
    input.quantity !== null && typeof input.quantity !== "undefined"
      ? buildMetafield("ebay_quantity", String(input.quantity))
      : null,
    input.skuGenerated ? buildMetafield("sku_policy", "generated_from_ebay_item_id") : null,
    buildMetafield("ebay_category_id", input.ebayPrimaryCategoryId),
    buildMetafield("ebay_category_name", input.ebayPrimaryCategoryName),
    buildMetafield("ebay_category_path", input.ebayPrimaryCategoryPath),
    buildMetafield("ebay_store_category_id", input.storeCategoryId),
    buildMetafield("ebay_store_category_name", input.storeCategoryName),
    buildMetafield("ebay_store_category_path", input.storeCategoryPath),
  ].filter((metafield): metafield is SyncBayProductMetafield => Boolean(metafield));
}

export function getSyncBayCategorySourceFromMetafields(
  metafields?: SyncBayProductMetafieldNode[] | null,
): SyncBayCategorySourceFromMetafields | null {
  const values = new Map(
    (metafields ?? [])
      .map((metafield) => [
        normalizeMetafieldText(metafield.key),
        normalizeMetafieldText(metafield.value),
      ])
      .filter((entry): entry is [string, string] => Boolean(entry[0]) && Boolean(entry[1])),
  );
  const source = {
    ebayPrimaryCategoryId: values.get("ebay_category_id") ?? null,
    ebayPrimaryCategoryName: values.get("ebay_category_name") ?? null,
    ebayPrimaryCategoryPath: values.get("ebay_category_path") ?? null,
    storeCategoryId: values.get("ebay_store_category_id") ?? null,
    storeCategoryName: values.get("ebay_store_category_name") ?? null,
    storeCategoryPath: values.get("ebay_store_category_path") ?? null,
  };

  return Object.values(source).some(Boolean) ? source : null;
}

function buildMetafield(key: string, value?: string | null): SyncBayProductMetafield | null {
  const normalized = normalizeMetafieldText(value);
  if (!normalized) return null;

  return {
    key,
    namespace: "syncbay",
    type: "single_line_text_field",
    value: normalized,
  };
}

function normalizeMetafieldText(value?: string | null) {
  const normalized = value?.trim();

  return normalized && normalized.length > 0 ? normalized : null;
}
