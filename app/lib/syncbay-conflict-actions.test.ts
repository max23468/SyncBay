import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as conflictActions from "./syncbay-conflict-actions.ts";

const {
  getConflictFieldDecisionMode,
  getConflictResolutionSafety,
  getSafeBatchConflictResolutions,
  isStaleConflictResolutionError,
  summarizeConflictDecisionModes,
} = conflictActions;

test("keeps stock, price, product status and SKU conflicts manual-only", () => {
  for (const field of ["quantity", "price", "status", "sku"]) {
    assert.equal(getConflictFieldDecisionMode(field), "manual_only");
    assert.deepEqual(getSafeBatchConflictResolutions(field), []);
    assert.equal(
      getConflictResolutionSafety(field, "KEEP_SHOPIFY").mode,
      "manual_only",
    );
    assert.equal(
      getConflictResolutionSafety(field, "REALIGN_FROM_EBAY").mode,
      "manual_only",
    );
  }
});

test("allows only keep-shopify description conflicts as batch-safe", () => {
  assert.equal(getConflictFieldDecisionMode("description"), "batch_safe");
  assert.deepEqual(getSafeBatchConflictResolutions("description"), [
    "KEEP_SHOPIFY",
  ]);
  assert.equal(
    getConflictResolutionSafety("description", "KEEP_SHOPIFY").mode,
    "batch_safe",
  );
  assert.equal(
    getConflictResolutionSafety("description", "REALIGN_FROM_EBAY").mode,
    "guarded",
  );
  assert.equal(
    getConflictResolutionSafety("description", "IGNORE_FIELD").mode,
    "manual_only",
  );
});

test("treats title and image conflict actions as guarded decisions", () => {
  for (const field of ["title", "images"]) {
    assert.equal(getConflictFieldDecisionMode(field), "guarded");
    assert.deepEqual(getSafeBatchConflictResolutions(field), []);
    assert.equal(
      getConflictResolutionSafety(field, "KEEP_SHOPIFY").mode,
      "guarded",
    );
    assert.equal(
      getConflictResolutionSafety(field, "REALIGN_FROM_EBAY").mode,
      "guarded",
    );
  }
});

test("treats unknown conflict fields as manual-only", () => {
  assert.equal(getConflictFieldDecisionMode("custom_field"), "manual_only");
  assert.deepEqual(getSafeBatchConflictResolutions("custom_field"), []);
  assert.match(
    getConflictResolutionSafety("custom_field", "KEEP_SHOPIFY").detail,
    /manuale/i,
  );
});

test("treats only missing conflicts as stale batch resolution errors", () => {
  assert.equal(
    isStaleConflictResolutionError(new Response("missing", { status: 404 })),
    true,
  );
  assert.equal(
    isStaleConflictResolutionError(new Response("failed", { status: 500 })),
    false,
  );
  assert.equal(isStaleConflictResolutionError(new Error("failed")), false);
});

test("summarizes decision modes from grouped open conflicts", () => {
  assert.deepEqual(
    summarizeConflictDecisionModes([
      { count: 3, field: "description" },
      { count: 2, field: "title" },
      { count: 1, field: "images" },
      { count: 4, field: "quantity" },
      { count: 1, field: "sku" },
    ]),
    {
      batchSafeCount: 3,
      guardedCount: 3,
      manualOnlyCount: 5,
    },
  );
});
