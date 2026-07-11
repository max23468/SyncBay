export function getPersistableInventoryItemGid(input: {
  inventoryItemGid?: string;
  status: "synced" | "failed" | "skipped";
}) {
  const value = input.inventoryItemGid?.trim();

  return value || null;
}
