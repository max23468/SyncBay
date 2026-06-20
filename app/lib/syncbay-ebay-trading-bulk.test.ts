import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as bulkModule from "./syncbay-ebay-trading-bulk.ts";

const { buildGetSellerListRequest, buildTradingItemCache } = bulkModule;

test("builds a paginated GetSellerList request for active listing descriptions", () => {
  const request = buildGetSellerListRequest({
    entriesPerPage: 200,
    pageNumber: 2,
    windowEnd: new Date("2026-10-18T00:00:00.000Z"),
    windowStart: new Date("2026-06-20T00:00:00.000Z"),
  });

  assert.match(request, /<GetSellerListRequest/);
  assert.match(request, /<DetailLevel>ReturnAll<\/DetailLevel>/);
  assert.match(request, /<EntriesPerPage>200<\/EntriesPerPage>/);
  assert.match(request, /<PageNumber>2<\/PageNumber>/);
  assert.match(request, /<EndTimeFrom>2026-06-20T00:00:00.000Z<\/EndTimeFrom>/);
  assert.match(request, /<EndTimeTo>2026-10-18T00:00:00.000Z<\/EndTimeTo>/);
});

test("indexes seller-list items with descriptions by legacy item id", () => {
  const cache = buildTradingItemCache([
    {
      Description: "<p>Descrizione eBay</p>",
      ItemID: "1001",
      Title: "Moneta",
    },
    {
      ItemID: "1002",
      Title: "Senza descrizione",
    },
    {
      Description: "<p>Duplicato piu recente</p>",
      ItemID: "1001",
      Title: "Moneta duplicata",
    },
  ]);

  assert.deepEqual(cache.get("1001"), {
    descriptionHtml: "<p>Descrizione eBay</p>",
    itemId: "1001",
    title: "Moneta",
  });
  assert.deepEqual(cache.get("1002"), {
    descriptionHtml: null,
    itemId: "1002",
    title: "Senza descrizione",
  });
});
