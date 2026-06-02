export function canPublishProductAfterInventorySync(input: {
  inventorySyncStatus: string;
  productStatus?: string | null;
}) {
  if (input.productStatus !== "ACTIVE") return true;

  return input.inventorySyncStatus === "synced";
}
