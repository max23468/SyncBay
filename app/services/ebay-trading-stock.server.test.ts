import assert from "node:assert/strict";
import { test } from "vitest";

import { getEbayTradingAvailableQuantityFromItem } from "./ebay-trading-stock.server.ts";

test("reads current eBay availability from QuantityAvailable", () => {
  assert.equal(
    getEbayTradingAvailableQuantityFromItem({ Quantity: "8", QuantityAvailable: "3" }, null),
    3,
  );
});

test("falls back to total quantity minus sold quantity", () => {
  assert.equal(
    getEbayTradingAvailableQuantityFromItem(
      { Quantity: "8", SellingStatus: { QuantitySold: "5" } },
      null,
    ),
    3,
  );
});

test("selects the mapped eBay variation by real SKU", () => {
  assert.equal(
    getEbayTradingAvailableQuantityFromItem(
      {
        Variations: {
          Variation: [
            { QuantityAvailable: "2", SKU: "SKU-A" },
            { QuantityAvailable: "7", SKU: "SKU-B" },
          ],
        },
      },
      "SKU-B",
    ),
    7,
  );
});

test("refuses an unverifiable eBay variation", () => {
  assert.equal(
    getEbayTradingAvailableQuantityFromItem(
      {
        Variations: {
          Variation: [{ QuantityAvailable: "2", SKU: "SKU-A" }],
        },
      },
      "SKU-B",
    ),
    null,
  );
});
