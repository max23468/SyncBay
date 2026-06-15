import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { shouldRefreshCategoryFromTrading } from "./syncbay-category-trading-refresh.ts";

test("refreshes category data from Trading when the primary eBay category is missing", () => {
  assert.equal(
    shouldRefreshCategoryFromTrading({
      ebayPrimaryCategoryName: null,
      ebayStoreCategoryName: "Varie",
    }),
    true,
  );
});

test("keeps existing category data when the primary eBay category is already present", () => {
  assert.equal(
    shouldRefreshCategoryFromTrading({
      ebayPrimaryCategoryName: "Monete italiane",
      ebayStoreCategoryName: null,
    }),
    false,
  );
});
