export interface ShopifyVariantSelectionCandidate {
  id?: string | null;
}

export function selectShopifyVariantForSync<
  Variant extends ShopifyVariantSelectionCandidate,
>(input: {
  preferredVariantGid?: string | null;
  variants?: Variant[] | null;
}) {
  const variants = input.variants ?? [];
  const preferredVariantGid = input.preferredVariantGid?.trim() ?? "";

  if (preferredVariantGid) {
    return (
      variants.find((variant) => variant.id === preferredVariantGid) ?? null
    );
  }

  return variants[0] ?? null;
}
