import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { getSellerEventsDeltaWindow, isFullCatalogReconcileDue } from "./syncbay-ebay-delta-sync.ts";

test("uses a seller-events window with documented overlap and current-time buffer", () => {
  assert.deepEqual(
    getSellerEventsDeltaWindow({
      latestSuccessfulSyncAt: new Date("2026-06-03T10:00:00.000Z"),
      now: new Date("2026-06-03T10:05:00.000Z"),
    }),
    {
      modTimeFrom: new Date("2026-06-03T09:58:00.000Z"),
      modTimeTo: new Date("2026-06-03T10:03:00.000Z"),
    },
  );
});

test("skips seller-events delta when the buffered window is empty", () => {
  assert.equal(
    getSellerEventsDeltaWindow({
      latestSuccessfulSyncAt: new Date("2026-06-03T10:06:00.000Z"),
      now: new Date("2026-06-03T10:05:00.000Z"),
    }),
    null,
  );
});

test("skips seller-events delta when lookback exceeds eBay's 48 hour guidance", () => {
  assert.equal(
    getSellerEventsDeltaWindow({
      latestSuccessfulSyncAt: new Date("2026-06-01T09:00:00.000Z"),
      now: new Date("2026-06-03T10:05:00.000Z"),
    }),
    null,
  );
});

test("runs a full catalog reconcile when no previous full reconcile exists", () => {
  assert.equal(
    isFullCatalogReconcileDue({
      latestFullReconcileAt: null,
      now: new Date("2026-06-03T10:05:00.000Z"),
    }),
    true,
  );
});

test("runs a full catalog reconcile after the configured interval", () => {
  assert.equal(
    isFullCatalogReconcileDue({
      intervalSecondsValue: "3600",
      latestFullReconcileAt: new Date("2026-06-03T09:00:00.000Z"),
      now: new Date("2026-06-03T10:05:00.000Z"),
    }),
    true,
  );
});

test("uses seller-events delta while the full reconcile interval is still fresh", () => {
  assert.equal(
    isFullCatalogReconcileDue({
      intervalSecondsValue: "3600",
      latestFullReconcileAt: new Date("2026-06-03T09:30:00.000Z"),
      now: new Date("2026-06-03T10:05:00.000Z"),
    }),
    false,
  );
});
