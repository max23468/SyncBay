export interface ShopifyVariantSelectionCandidate {
  id?: string | null;
}

export interface ShopifyVariantSelectionProduct<
  Variant extends ShopifyVariantSelectionCandidate,
> {
  variants?: {
    nodes?: Variant[] | null;
  } | null;
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

export function mergePreferredShopifyVariantForSync<
  Variant extends ShopifyVariantSelectionCandidate,
>(input: {
  preferredVariant?: Variant | null;
  variants?: Variant[] | null;
}) {
  const variants = input.variants ?? [];
  const preferredVariant = input.preferredVariant ?? null;

  if (!preferredVariant?.id) return variants;

  return [
    preferredVariant,
    ...variants.filter((variant) => variant.id !== preferredVariant.id),
  ];
}

export function preserveSelectedShopifyVariantForSync<
  Variant extends ShopifyVariantSelectionCandidate,
  Product extends ShopifyVariantSelectionProduct<Variant>,
>(input: { previousProduct: Product; updatedProduct: Product }): Product {
  const previousVariant = selectShopifyVariantForSync({
    variants: input.previousProduct.variants?.nodes,
  });

  if (!previousVariant?.id) return input.updatedProduct;

  const updatedVariant = selectShopifyVariantForSync({
    preferredVariantGid: previousVariant.id,
    variants: input.updatedProduct.variants?.nodes,
  });

  return {
    ...input.updatedProduct,
    variants: {
      ...(input.updatedProduct.variants ?? {}),
      nodes: [updatedVariant ?? previousVariant],
    },
  } as Product;
}
