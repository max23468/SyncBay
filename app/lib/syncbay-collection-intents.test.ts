import assert from "node:assert/strict";
import test from "node:test";

import { parseCollectionIntents } from "./syncbay-collection-intents.ts";

test("parses valid collection intents", () => {
  const intents = parseCollectionIntents({
    collectionIntents: [
      {
        generic: true,
        handle: "negozio-online",
        requirePositiveInventory: true,
        title: "Negozio Online",
      },
      {
        handle: "banconote",
        productTypeContains: ["Banconote"],
        requirePositiveInventory: true,
        title: "Banconote",
      },
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
          {
            handle: "banconote",
            requirePositiveInventory: true,
            title: "Banconote",
          },
          {
            handle: "banconote",
            requirePositiveInventory: true,
            title: "Banconote duplicate",
          },
        ],
      }),
    /duplicato/i,
  );
});

test("parses a title-based intent", () => {
  const intents = parseCollectionIntents({
    collectionIntents: [
      {
        handle: "accessori-numismatici",
        titleContains: ["capsul", "masterphil", "raccoglitore"],
        requirePositiveInventory: true,
        title: "Accessori numismatici",
      },
    ],
  });

  assert.deepEqual(intents[0]?.titleContains, [
    "capsul",
    "masterphil",
    "raccoglitore",
  ]);
});

test("rejects intents that mix product type and title selectors", () => {
  assert.throws(
    () =>
      parseCollectionIntents({
        collectionIntents: [
          {
            handle: "misto",
            productTypeContains: ["Banconote"],
            titleContains: ["capsul"],
            requirePositiveInventory: true,
            title: "Misto",
          },
        ],
      }),
    /un solo selettore/i,
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
