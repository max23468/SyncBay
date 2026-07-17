import assert from "node:assert/strict";
import test from "node:test";

import { selectLatestStockBaselineSnapshot } from "./syncbay-stock-baseline.ts";

test("selects the latest snapshot that carries stock quantity and currency", () => {
  const baseline = selectLatestStockBaselineSnapshot([
    {
      capturedAt: new Date("2026-06-18T12:00:00Z"),
      currency: "EUR",
      quantity: null,
    },
    {
      capturedAt: new Date("2026-06-17T12:00:00Z"),
      currency: "EUR",
      quantity: 19,
    },
  ]);

  assert.deepEqual(baseline, {
    capturedAt: new Date("2026-06-17T12:00:00Z"),
    currency: "EUR",
    quantity: 19,
  });
});

test("ignores snapshots without currency when choosing stock baselines", () => {
  assert.equal(
    selectLatestStockBaselineSnapshot([
      {
        capturedAt: new Date("2026-06-18T12:00:00Z"),
        currency: null,
        quantity: 19,
      },
    ]),
    null,
  );
});
