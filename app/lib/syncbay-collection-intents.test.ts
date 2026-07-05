import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { parseCollectionIntents } from "./syncbay-collection-intents.ts";

test("parses valid collection intents", () => {
  const intents = parseCollectionIntents({
    collectionIntents: [
      { generic: true, handle: "negozio-online", requirePositiveInventory: true, title: "Negozio Online" },
      { handle: "banconote", productTypeContains: ["Banconote"], requirePositiveInventory: true, title: "Banconote" },
    ],
  });

  assert.equal(intents.length, 2);
  assert.deepEqual(intents[1]?.productTypeContains, ["Banconote"]);
});

test("rejects duplicated handles", () => {
  assert.throws(
    () =>
      parseCollectionIntents({
        collectionIntents: [
          { handle: "banconote", requirePositiveInventory: true, title: "Banconote" },
          { handle: "banconote", requirePositiveInventory: true, title: "Banconote duplicate" },
        ],
      }),
    /duplicato/i,
  );
});

test("rejects intents without a safe selector", () => {
  assert.throws(
    () =>
      parseCollectionIntents({
        collectionIntents: [
          { handle: "regno", requirePositiveInventory: true, title: "Regno" },
        ],
      }),
    /productTypeContains/i,
  );
});
