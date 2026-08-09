import assert from "node:assert/strict";
import { test } from "vitest";
import type { EbayConnection } from "@prisma/client";

import { escapeEbayTradingXml } from "../lib/syncbay-ebay-trading.ts";
import * as ebayTradingPreview from "./ebay-trading-preview.server.ts";

const { getEbayTradingCatalogImportPreview, getEbayTradingSellerEventsDelta } = ebayTradingPreview;

test("escapes every XML metacharacter used in eBay requests", () => {
  assert.equal(escapeEbayTradingXml(`A&B<C>D"E'F`), "A&amp;B&lt;C&gt;D&quot;E&apos;F");
});

test("builds existing catalog previews without fetching every item detail", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const requestBodies: string[] = [];

  globalThis.fetch = async (_url, init) => {
    const callName = String(
      (init?.headers as Record<string, string>)?.["X-EBAY-API-CALL-NAME"] ?? "",
    );
    calls.push(callName);
    requestBodies.push(String(init?.body ?? ""));

    if (callName === "GetMyeBaySelling") {
      return xmlResponse(buildGetMyeBaySellingResponse(12));
    }

    if (callName === "GetItem") {
      const itemId = String(init?.body ?? "").match(/<ItemID>([^<]+)<\/ItemID>/)?.[1];
      return xmlResponse(buildGetItemResponse(itemId ?? "missing"));
    }

    return xmlResponse("<UnsupportedResponse><Ack>Failure</Ack></UnsupportedResponse>");
  };

  try {
    const preview = await getEbayTradingCatalogImportPreview({
      accessToken: "test-token",
      connection: {
        environment: "sandbox",
        marketplaceId: "EBAY_IT",
      } as EbayConnection,
      maxProducts: 12,
    });

    assert.equal(preview.previewResult.items.length, 12);
    assert.equal(calls.filter((callName) => callName === "GetMyeBaySelling").length, 1);
    assert.equal(calls.filter((callName) => callName === "GetItem").length, 10);
    assert.match(requestBodies[0] ?? "", /<Sort>StartTime<\/Sort>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("orders seller-event candidates by their eBay listing start time", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    xmlResponse(`<GetSellerEventsResponse>
      <Ack>Success</Ack>
      <ItemArray>
        ${buildActiveListItem("newer", "2026-08-09T10:00:00.000Z")}
        ${buildActiveListItem("older", "2026-08-08T10:00:00.000Z")}
      </ItemArray>
    </GetSellerEventsResponse>`);

  try {
    const delta = await getEbayTradingSellerEventsDelta({
      accessToken: "test-token",
      connection: {
        environment: "sandbox",
        marketplaceId: "EBAY_IT",
      } as EbayConnection,
      maxEvents: 10,
      modTimeFrom: new Date("2026-08-08T00:00:00.000Z"),
      modTimeTo: new Date("2026-08-10T00:00:00.000Z"),
    });

    assert.deepEqual(
      delta.candidates.map((candidate) => candidate.itemId),
      ["older", "newer"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function buildGetMyeBaySellingResponse(count: number) {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingResponse>
  <Ack>Success</Ack>
  <ActiveList>
    <ItemArray>
      ${Array.from({ length: count }, (_, index) => buildActiveListItem(String(1000 + index))).join(
        "\n",
      )}
    </ItemArray>
    <PaginationResult>
      <TotalNumberOfEntries>${count}</TotalNumberOfEntries>
      <TotalNumberOfPages>1</TotalNumberOfPages>
    </PaginationResult>
  </ActiveList>
</GetMyeBaySellingResponse>`;
}

function buildActiveListItem(itemId: string, startTime?: string) {
  return `<Item>
  <ItemID>${itemId}</ItemID>
  ${startTime ? `<ListingDetails><StartTime>${startTime}</StartTime></ListingDetails>` : ""}
  <Title>Prodotto ${itemId}</Title>
  <SKU>SKU-${itemId}</SKU>
  <Quantity>3</Quantity>
  <SellingStatus>
    <CurrentPrice currencyID="EUR">12.00</CurrentPrice>
    <QuantitySold>1</QuantitySold>
    <ListingStatus>Active</ListingStatus>
  </SellingStatus>
  <PictureDetails>
    <PictureURL>https://example.invalid/syncbay/${itemId}.jpg</PictureURL>
  </PictureDetails>
  <PrimaryCategory>
    <CategoryID>111</CategoryID>
    <CategoryName>Monete</CategoryName>
  </PrimaryCategory>
</Item>`;
}

function buildGetItemResponse(itemId: string) {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetItemResponse>
  <Ack>Success</Ack>
  ${buildActiveListItem(itemId)}
</GetItemResponse>`;
}

function xmlResponse(body: string) {
  return new Response(body, {
    headers: { "Content-Type": "text/xml" },
    status: 200,
  });
}
