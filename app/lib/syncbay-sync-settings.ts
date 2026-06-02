export function getSyncEnablementBlockers(input: {
  activeMappingCount: number;
  ebayConnected: boolean;
  hasDefaultLocation: boolean;
  requestedSyncEnabled: boolean;
}) {
  if (!input.requestedSyncEnabled) return [];

  return [
    input.ebayConnected ? null : "account eBay non collegato",
    input.hasDefaultLocation ? null : "location Shopify predefinita mancante",
    input.activeMappingCount > 0 ? null : "nessun prodotto importato",
  ].filter((blocker): blocker is string => Boolean(blocker));
}
