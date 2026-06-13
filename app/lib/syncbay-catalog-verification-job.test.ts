import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { getCompletedCatalogVerificationJobWhere } from "./syncbay-catalog-verification-job.ts";

test("selects only completed catalog verification watermarks", () => {
  assert.deepEqual(getCompletedCatalogVerificationJobWhere("shop-1"), {
    OR: [
      {
        AND: [
          { payload: { path: ["source"], equals: "seller_events_delta" } },
          { payload: { path: ["watermarkAdvanced"], equals: true } },
        ],
      },
      {
        AND: [
          { payload: { path: ["source"], equals: "catalog_reconcile" } },
          { result: { path: ["noWork"], equals: true } },
        ],
      },
    ],
    shopId: "shop-1",
    status: "SUCCEEDED",
    type: "SYNC_INCREMENTAL",
  });
});
