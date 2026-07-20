import type { EbayConnection } from "@prisma/client";

import { selectEbayTradingInventorySku } from "../lib/syncbay-stock-guard";
import { escapeXml, fetchTradingXml } from "./ebay-trading-preview.server";

export async function reviseEbayTradingInventoryQuantity(input: {
  accessToken: string;
  connection: EbayConnection;
  itemId: string;
  quantity: number;
  sku?: string | null;
  skuGenerated?: boolean | null;
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
    sku: selectEbayTradingInventorySku(input),
    status: "updated" as const,
  };
}

export async function getEbayTradingAvailableQuantity(input: {
  accessToken: string;
  connection: EbayConnection;
  itemId: string;
  sku?: string | null;
  skuGenerated?: boolean | null;
}) {
  const body = await fetchTradingXml({
    accessToken: input.accessToken,
    callName: "GetItem",
    connection: input.connection,
    requestXml: buildGetItemRequest(input.itemId),
  });

  return getEbayTradingAvailableQuantityFromItem(
    asRecord(body.Item),
    selectEbayTradingInventorySku(input),
  );
}

export function getEbayTradingAvailableQuantityFromItem(
  item: Record<string, unknown> | null,
  sku?: string | null,
) {
  if (!item) return null;

  const variations = asArray(asRecord(item.Variations)?.Variation)
    .map(asRecord)
    .filter((variation): variation is Record<string, unknown> => Boolean(variation));
  if (variations.length > 0) {
    const normalizedSku = sku?.trim().toLowerCase() ?? "";
    const selected = normalizedSku
      ? variations.filter(
          (variation) => getText(variation.SKU)?.trim().toLowerCase() === normalizedSku,
        )
      : variations;
    const quantities = selected.flatMap((variation) => {
      const quantity = getAvailableQuantity(variation);
      return quantity === null ? [] : [quantity];
    });

    if (quantities.length === 0) return null;
    return quantities.reduce((total, quantity) => total + quantity, 0);
  }

  return getAvailableQuantity(item);
}

function buildReviseInventoryStatusRequest(input: {
  itemId: string;
  quantity: number;
  sku?: string | null;
  skuGenerated?: boolean | null;
}) {
  const sku = selectEbayTradingInventorySku(input);

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
function buildGetItemRequest(itemId: string) {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnAll</DetailLevel>
  <ErrorLanguage>it_IT</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <ItemID>${escapeXml(itemId)}</ItemID>
</GetItemRequest>`;
}

function getAvailableQuantity(record: Record<string, unknown>) {
  const direct = getInteger(record.QuantityAvailable);
  if (direct !== null) return direct;

  const quantity = getInteger(record.Quantity);
  if (quantity === null) return null;

  const sold = getInteger(asRecord(record.SellingStatus)?.QuantitySold) ?? 0;
  return Math.max(0, quantity - sold);
}

function getInteger(value: unknown) {
  const text = getText(value);
  if (!text) return null;

  const number = Number.parseInt(text, 10);
  return Number.isInteger(number) ? number : null;
}

function getText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  const text = asRecord(value)?.["#text"];
  if (typeof text === "string") return text;
  if (typeof text === "number") return String(text);
  return null;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown) {
  if (Array.isArray(value)) return value;
  return value === null || typeof value === "undefined" ? [] : [value];
}
