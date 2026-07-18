import assert from "node:assert/strict";
import { test } from "vitest";

import { mapWithConcurrency } from "./map-with-concurrency.ts";

test("limits concurrency and preserves input order", async () => {
  let active = 0;
  let peak = 0;

  const results = await mapWithConcurrency([3, 1, 2], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, value));
    active -= 1;
    return value * 10;
  });

  assert.equal(peak, 2);
  assert.deepEqual(results, [30, 10, 20]);
});
