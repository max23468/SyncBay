import type { EbayConnection } from "@prisma/client";

import { fetchTradingXml } from "./ebay-trading-preview.server";

export async function reviseEbayTradingInventoryQuantity(input: {
  accessToken: string;
  connection: EbayConnection;
  itemId: string;
  quantity: number;
  sku?: string | null;
}) {
  await fetchTradingXml({
    accessToken: input.accessToken,
    callName: "ReviseInventoryStatus",
    connection: input.connection,
    requestXml: buildReviseInventoryStatusRequest(input),
  });

  return {
    itemId: input.itemId,
    quantity: input.quantity,
    sku: input.sku ?? null,
    status: "updated" as const,
  };
}

function buildReviseInventoryStatusRequest(input: {
  itemId: string;
  quantity: number;
  sku?: string | null;
}) {
  const sku = input.sku?.trim();

  return `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>it_IT</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <InventoryStatus>
    <ItemID>${escapeXml(input.itemId)}</ItemID>
    ${sku ? `<SKU>${escapeXml(sku)}</SKU>` : ""}
    <Quantity>${Math.max(0, Math.floor(input.quantity))}</Quantity>
  </InventoryStatus>
</ReviseInventoryStatusRequest>`;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
