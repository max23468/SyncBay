import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { computeSequentialStepStatuses } from "./syncbay-import-step-status.ts";

test("keeps later import steps pending after the active prerequisite", () => {
  assert.deepEqual(computeSequentialStepStatuses([false, true, true, true]), [
    "active",
    "pending",
    "pending",
    "pending",
  ]);
});

test("marks completed import steps only before the first incomplete step", () => {
  assert.deepEqual(computeSequentialStepStatuses([true, true, false, true]), [
    "completed",
    "completed",
    "active",
    "pending",
  ]);
});
