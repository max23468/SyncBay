import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { formatExistingCatalogOperation, formatExistingCatalogReason, formatExistingCatalogTakeoverStatus } from "./syncbay-existing-catalog-copy.ts";

test("formats every existing catalog takeover status", () => {
  assert.deepEqual(
    (["applicabile", "bloccante", "da_rivedere", "gia_collegato"] as const).map(formatExistingCatalogTakeoverStatus),
    ["applicabile", "bloccante", "da rivedere", "già collegato"],
  );
});

test("formats catalog operations and reasons in Italian", () => {
  assert.equal(formatExistingCatalogOperation("claim_mapping"), "creare mapping");
  assert.equal(formatExistingCatalogReason("match_ambiguo"), "match ambiguo");
});
