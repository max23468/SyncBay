import { describe, expect, test } from "vitest";

import { DEFAULT_EBAY_MARKETPLACE_ID, getEbayMarketplaceId } from "./ebay-environment.server";

describe("getEbayMarketplaceId", () => {
  test("usa EBAY_IT come default e preserva l'override configurato", () => {
    expect(getEbayMarketplaceId(null)).toBe(DEFAULT_EBAY_MARKETPLACE_ID);
    expect(getEbayMarketplaceId("EBAY_DE")).toBe("EBAY_DE");
  });
});
