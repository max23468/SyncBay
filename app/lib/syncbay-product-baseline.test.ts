import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { mergeProductBaseline } from "./syncbay-product-baseline.ts";

test("merges partial baseline patches without clearing absent fields", () => {
  assert.deepEqual(
    mergeProductBaseline(
      { title: "Titolo", quantity: 3, imageCount: 2 },
      { title: undefined, quantity: 2, imageCount: null },
    ),
    { title: "Titolo", quantity: 2, imageCount: null },
  );
});

test("adds fields supplied by a patch and preserves explicit null", () => {
  assert.deepEqual(
    mergeProductBaseline(
      { title: null, quantity: null },
      { title: "Nuovo", quantity: undefined, currency: "EUR" },
    ),
    { title: "Nuovo", quantity: null, currency: "EUR" },
  );
});
