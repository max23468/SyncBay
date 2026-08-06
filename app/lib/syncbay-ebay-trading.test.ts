import assert from "node:assert/strict";
import { test } from "vitest";

import * as trading from "./syncbay-ebay-trading.ts";

test("keeps every Trading request on the latest compatibility level", () => {
  const requests = [
    trading.buildGetItemRequest({ itemId: "1001" }),
    trading.buildGetMyeBaySellingRequest({ entriesPerPage: 10, pageNumber: 1 }),
    trading.buildGetSellerEventsRequest({
      modTimeFrom: new Date("2026-08-06T10:00:00.000Z"),
      modTimeTo: new Date("2026-08-06T10:05:00.000Z"),
    }),
    trading.buildReviseInventoryStatusRequest({ itemId: "1001", quantity: 3 }),
  ];

  for (const request of requests) {
    assert.match(request, /<Version>1455<\/Version>/);
  }
});

test("reports every eBay error returned by the shared parser", () => {
  assert.throws(
    () =>
      trading.parseEbayTradingResponse(
        "GetItem",
        `<GetItemResponse>
          <Ack>Failure</Ack>
          <Errors><ShortMessage>Primo errore</ShortMessage></Errors>
          <Errors><LongMessage>Secondo errore</LongMessage></Errors>
        </GetItemResponse>`,
      ),
    /Primo errore; Secondo errore/,
  );
});
