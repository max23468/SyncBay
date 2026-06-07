/**
 * Parse the `Storefront` block returned by eBay Trading API `GetItem` and
 * `GetMyeBaySelling` (ActiveList with `DetailLevel=ReturnAll`).
 *
 * eBay uses `0` and `-999` as placeholder ids when a listing is NOT assigned
 * to any store category (legacy convention). We normalise those to `null` so
 * the rest of SyncBay can rely on "id present = listing is in the public
 * storefront vetrina, id null = visible only in Seller Hub".
 */
export interface EbayStorefrontMetadata {
  storeCategoryId: string | null;
  storeCategoryName: string | null;
}

export function getEbayStorefrontMetadata(
  storefront: unknown,
): EbayStorefrontMetadata {
  const record = getObject(storefront);

  if (!record) {
    return { storeCategoryId: null, storeCategoryName: null };
  }

  const rawId = getStringField(record, "StoreCategoryID");
  const normalizedId =
    rawId && rawId !== "0" && rawId !== "-999" ? rawId : null;
  const name = getStringField(record, "StoreCategoryName");

  return {
    storeCategoryId: normalizedId,
    storeCategoryName: name && name.length > 0 ? name : null,
  };
}

function getObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  return value as Record<string, unknown>;
}

function getStringField(record: Record<string, unknown>, field: string) {
  const value = record[field];

  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);

  return null;
}
