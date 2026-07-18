import assert from "node:assert/strict";
import { test } from "vitest";

import { getFullReconcilePolicyState } from "./syncbay-full-reconcile-policy.ts";

test("marks full reconcile missing when no complete job exists", () => {
  assert.deepEqual(
    getFullReconcilePolicyState({
      intervalHours: 24,
      latestFinishedAt: null,
      now: new Date("2026-06-20T10:00:00.000Z"),
    }),
    {
      intervalHours: 24,
      latestFinishedAt: null,
      nextDueAt: null,
      status: "missing",
    },
  );
});

test("marks full reconcile due only after the policy interval", () => {
  assert.deepEqual(
    getFullReconcilePolicyState({
      intervalHours: 24,
      latestFinishedAt: new Date("2026-06-19T09:00:00.000Z"),
      now: new Date("2026-06-20T10:00:00.000Z"),
    }),
    {
      intervalHours: 24,
      latestFinishedAt: "2026-06-19T09:00:00.000Z",
      nextDueAt: "2026-06-20T09:00:00.000Z",
      status: "overdue",
    },
  );
});
