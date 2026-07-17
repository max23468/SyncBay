import assert from "node:assert/strict";
import test from "node:test";

import { shouldContinueRunningSyncJob } from "./syncbay-runner-cancellation.ts";

test("continues provider work only while the sync job is still running", () => {
  assert.equal(shouldContinueRunningSyncJob("RUNNING"), true);
  assert.equal(shouldContinueRunningSyncJob("CANCELLED"), false);
  assert.equal(shouldContinueRunningSyncJob("FAILED"), false);
  assert.equal(shouldContinueRunningSyncJob("SUCCEEDED"), false);
  assert.equal(shouldContinueRunningSyncJob(null), false);
});
