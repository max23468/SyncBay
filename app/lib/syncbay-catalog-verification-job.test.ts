import assert from "node:assert/strict";
import { test } from "vitest";

import * as catalogVerificationJob from "./syncbay-catalog-verification-job.ts";

const {
  getCompletedCatalogVerificationJobWhere,
  getCompletedIncrementalWorkJobWhere,
} = catalogVerificationJob;

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
          {
            OR: [
              { result: { path: ["noWork"], equals: true } },
              { result: { path: ["watermarkAdvanced"], equals: true } },
            ],
          },
        ],
      },
    ],
    shopId: "shop-1",
    status: "SUCCEEDED",
    type: "SYNC_INCREMENTAL",
  });
});

test("selects completed incremental work jobs without watermark markers", () => {
  assert.deepEqual(getCompletedIncrementalWorkJobWhere("shop-1"), {
    NOT: [
      { payload: { path: ["watermarkAdvanced"], equals: true } },
      { result: { path: ["noWork"], equals: true } },
      { result: { path: ["watermarkAdvanced"], equals: true } },
    ],
    shopId: "shop-1",
    status: "SUCCEEDED",
    type: "SYNC_INCREMENTAL",
  });
});
