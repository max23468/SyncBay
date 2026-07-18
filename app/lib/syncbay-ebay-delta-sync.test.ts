import assert from "node:assert/strict";
import { test } from "vitest";

import * as deltaSync from "./syncbay-ebay-delta-sync.ts";

const {
  getSellerEventsDeltaWindow,
  getSellerEventsWatermarkAt,
  isFullCatalogReconcileDue,
  shouldAdvanceCatalogReconcileRunWatermark,
  shouldAdvanceSellerEventsRunWatermark,
} = deltaSync;

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

test("advances seller-events delta from the processed ModTimeTo watermark", () => {
  assert.deepEqual(
    getSellerEventsWatermarkAt({
      latestFullReconcileWatermarkAt: new Date("2026-06-03T10:00:00.000Z"),
      latestSellerEventsCompletedAt: new Date("2026-06-03T10:10:00.000Z"),
      latestSellerEventsModTimeToValue: "2026-06-03T10:03:00.000Z",
    }),
    new Date("2026-06-03T10:03:00.000Z"),
  );
});

test("falls back to the full reconcile when seller-events watermark is absent", () => {
  assert.deepEqual(
    getSellerEventsWatermarkAt({
      latestFullReconcileWatermarkAt: new Date("2026-06-03T10:00:00.000Z"),
      latestSellerEventsCompletedAt: null,
    }),
    new Date("2026-06-03T10:00:00.000Z"),
  );
});

test("prefers a newer full reconcile over an older seller-events watermark", () => {
  assert.deepEqual(
    getSellerEventsWatermarkAt({
      latestFullReconcileWatermarkAt: new Date("2026-06-03T11:00:00.000Z"),
      latestSellerEventsCompletedAt: new Date("2026-06-03T10:20:00.000Z"),
      latestSellerEventsModTimeToValue: "2026-06-03T10:03:00.000Z",
    }),
    new Date("2026-06-03T11:00:00.000Z"),
  );
});

test("does not use full reconcile finish time as the seller-events watermark", () => {
  assert.deepEqual(
    getSellerEventsWatermarkAt({
      latestFullReconcileCompletedAt: new Date("2026-06-03T11:00:00.000Z"),
      latestFullReconcileWatermarkAt: new Date("2026-06-03T10:04:00.000Z"),
      latestSellerEventsCompletedAt: new Date("2026-06-03T10:20:00.000Z"),
      latestSellerEventsModTimeToValue: "2026-06-03T10:03:00.000Z",
    }),
    new Date("2026-06-03T10:04:00.000Z"),
  );
});

test("advances seller-events watermark only after every run job succeeds", () => {
  assert.equal(
    shouldAdvanceSellerEventsRunWatermark({
      statuses: ["SUCCEEDED", "SUCCEEDED"],
    }),
    true,
  );
  assert.equal(
    shouldAdvanceSellerEventsRunWatermark({
      statuses: ["SUCCEEDED", "PENDING"],
    }),
    false,
  );
  assert.equal(
    shouldAdvanceSellerEventsRunWatermark({
      statuses: ["SUCCEEDED", "FAILED"],
    }),
    false,
  );
  assert.equal(
    shouldAdvanceSellerEventsRunWatermark({
      statuses: [],
    }),
    false,
  );
});

test("advances catalog reconcile watermark only after every run job succeeds", () => {
  assert.equal(
    shouldAdvanceCatalogReconcileRunWatermark({
      statuses: ["SUCCEEDED", "SUCCEEDED"],
    }),
    true,
  );
  assert.equal(
    shouldAdvanceCatalogReconcileRunWatermark({
      statuses: ["SUCCEEDED", "PENDING"],
    }),
    false,
  );
  assert.equal(
    shouldAdvanceCatalogReconcileRunWatermark({
      statuses: ["SUCCEEDED", "FAILED"],
    }),
    false,
  );
  assert.equal(
    shouldAdvanceCatalogReconcileRunWatermark({
      statuses: [],
    }),
    false,
  );
});
