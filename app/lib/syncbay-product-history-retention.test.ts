import assert from "node:assert/strict";
import { test } from "vitest";

import * as retention from "./syncbay-product-history-retention.ts";

const {
  buildProductHistoryRetentionPlan,
  getCoveringProductCheckpoint,
  getOperationalMaintenanceKey,
  shouldCreateWeeklyCheckpoint,
} = retention;

test("keeps dense events for 30 days and checkpoints for 180", () => {
  assert.deepEqual(buildProductHistoryRetentionPlan(new Date("2026-07-10T00:00:00Z")), {
    eventCutoff: new Date("2026-06-10T00:00:00.000Z"),
    checkpointCutoff: new Date("2026-01-11T00:00:00.000Z"),
  });
});

test("uses one UTC maintenance key per day", () => {
  assert.equal(
    getOperationalMaintenanceKey(new Date("2026-07-10T23:59:59Z")),
    "operational-maintenance:2026-07-10",
  );
});

test("creates at most one changed checkpoint per mapping source and week", () => {
  assert.equal(shouldCreateWeeklyCheckpoint({ currentDigest: null, nextDigest: "a" }), true);
  assert.equal(shouldCreateWeeklyCheckpoint({ currentDigest: "a", nextDigest: "a" }), false);
  assert.equal(shouldCreateWeeklyCheckpoint({ currentDigest: "a", nextDigest: "b" }), true);
});

test("a complete prior checkpoint covers a stable week without a duplicate checkpoint", () => {
  assert.deepEqual(
    getCoveringProductCheckpoint({
      checkpoints: [
        { checkpointWeek: new Date("2026-05-04T00:00:00Z"), isComplete: true },
        { checkpointWeek: new Date("2026-05-18T00:00:00Z"), isComplete: true },
      ],
      snapshotWeek: new Date("2026-05-11T00:00:00Z"),
    }),
    { checkpointWeek: new Date("2026-05-04T00:00:00Z"), isComplete: true },
  );
});

test("an incomplete checkpoint for the current week blocks snapshot deletion", () => {
  assert.equal(
    getCoveringProductCheckpoint({
      checkpoints: [
        { checkpointWeek: new Date("2026-05-04T00:00:00Z"), isComplete: true },
        { checkpointWeek: new Date("2026-05-11T00:00:00Z"), isComplete: false },
      ],
      snapshotWeek: new Date("2026-05-11T00:00:00Z"),
    }),
    null,
  );
});
