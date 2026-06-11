export function shouldUseMappedShopifyVariant(input: {
  mappedVariantGid?: string | null;
}) {
  return Boolean(input.mappedVariantGid?.trim());
}
