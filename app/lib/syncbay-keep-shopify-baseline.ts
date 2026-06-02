export function getKeepShopifyDescriptionHash(input: {
  conflictField: string;
  latestDescriptionBaselineHash: string | null;
  shopifyValue: unknown;
  snapshotDescriptionHash: string | null;
}) {
  if (input.conflictField === "description") {
    return typeof input.shopifyValue === "string" ? input.shopifyValue : null;
  }

  return input.snapshotDescriptionHash ?? input.latestDescriptionBaselineHash;
}
