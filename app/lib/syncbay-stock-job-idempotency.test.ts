import assert from "node:assert/strict";
import { test } from "vitest";

import { hasProcessedStockLineInJobResults } from "./syncbay-stock-job-idempotency.ts";

test("detects duplicate stock lines already updated by an earlier job", () => {
  assert.equal(
    hasProcessedStockLineInJobResults({
      ebayItemId: "168056372240",
      lineItemKey: "line-1",
      results: [
        {
          updated: [
            {
              ebayItemId: "168056372240",
              lineItemKey: "line-1",
            },
          ],
        },
      ],
    }),
    true,
  );
});

test("detects duplicate stock lines already planned by a dry-run job", () => {
  assert.equal(
    hasProcessedStockLineInJobResults({
      ebayItemId: "168056372240",
      includeDryRunPlans: true,
      lineItemKey: "line-1",
      results: [
        {
          planned: [
            {
              ebayItemId: "168056372240",
              lineItemKey: "line-1",
            },
          ],
        },
      ],
    }),
    true,
  );
});

test("does not dedupe real stock writes against dry-run plans", () => {
  assert.equal(
    hasProcessedStockLineInJobResults({
      ebayItemId: "168056372240",
      includeDryRunPlans: false,
      lineItemKey: "line-1",
      results: [
        {
          planned: [
            {
              ebayItemId: "168056372240",
              lineItemKey: "line-1",
            },
          ],
        },
      ],
    }),
    false,
  );
});

test("ignores different line items and listings", () => {
  assert.equal(
    hasProcessedStockLineInJobResults({
      ebayItemId: "168056372240",
      includeDryRunPlans: true,
      lineItemKey: "line-1",
      results: [
        {
          planned: [
            {
              ebayItemId: "168056372240",
              lineItemKey: "line-2",
            },
            {
              ebayItemId: "999999999999",
              lineItemKey: "line-1",
            },
          ],
        },
      ],
    }),
    false,
  );
});

test("does not match lines without a stable line item key", () => {
  assert.equal(
    hasProcessedStockLineInJobResults({
      ebayItemId: "168056372240",
      lineItemKey: null,
      results: [
        {
          planned: [
            {
              ebayItemId: "168056372240",
              lineItemKey: "line-1",
            },
          ],
        },
      ],
    }),
    false,
  );
});
