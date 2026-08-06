import type { EbayConnection } from "@prisma/client";

import {
  asEbayTradingArray as asArray,
  asEbayTradingRecord as asRecord,
  buildGetItemRequest,
  buildReviseInventoryStatusRequest,
  getEbayTradingText as getText,
} from "../lib/syncbay-ebay-trading";
import { selectEbayTradingInventorySku } from "../lib/syncbay-stock-guard";
import { callEbayTradingApi } from "./ebay-trading-api.server";

export async function reviseEbayTradingInventoryQuantity(input: {
  accessToken: string;
  connection: EbayConnection;
  itemId: string;
  quantity: number;
  sku?: string | null;
  skuGenerated?: boolean | null;
}) {
  const sku = selectEbayTradingInventorySku(input);
  await callEbayTradingApi({
    accessToken: input.accessToken,
    callName: "ReviseInventoryStatus",
    connection: input.connection,
    requestXml: buildReviseInventoryStatusRequest({
      itemId: input.itemId,
      quantity: input.quantity,
      sku,
    }),
  });

  return {
    itemId: input.itemId,
    quantity: input.quantity,
    sku,
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
  const body = await callEbayTradingApi({
    accessToken: input.accessToken,
    callName: "GetItem",
    connection: input.connection,
    requestXml: buildGetItemRequest({ itemId: input.itemId }),
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
