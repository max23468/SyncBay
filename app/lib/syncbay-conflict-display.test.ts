import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as conflictDisplay from "./syncbay-conflict-display.ts";

const { formatConflictValueForDisplay } = conflictDisplay;

test("formats ordinary conflict values for decisions", () => {
  assert.equal(
    formatConflictValueForDisplay({ field: "quantity", value: 3 }),
    "3",
  );
  assert.equal(
    formatConflictValueForDisplay({ field: "images", value: 2 }),
    "2 immagini",
  );
  assert.equal(
    formatConflictValueForDisplay({ field: "title", value: "Titolo Shopify" }),
    "Titolo Shopify",
  );
});

test("does not expose description hashes as merchant-facing values", () => {
  assert.equal(
    formatConflictValueForDisplay({
      field: "description",
      value: "9ee766a5385ce09ada37023699d0928a43ac9b13878fdd4b61762a77443266d0",
    }),
    "Descrizione modificata: apri i dettagli tecnici per confrontare gli hash.",
  );
});

test("keeps missing values explicit", () => {
  assert.equal(
    formatConflictValueForDisplay({ field: "description", value: null }),
    "Non disponibile",
  );
});
