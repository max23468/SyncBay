import assert from "node:assert/strict";
import { test } from "vitest";

import * as quarantine from "./syncbay-job-quarantine.ts";

const {
  classifySyncJobQuarantine,
  hasExhaustedSyncJobAttempts,
  isSyncJobQuarantined,
  summarizeSyncJobQuarantine,
} = quarantine;

test("treats failed jobs with remaining attempts as retrying", () => {
  assert.equal(
    classifySyncJobQuarantine({
      attempts: 2,
      maxAttempts: 5,
      status: "FAILED",
    }),
    "retrying",
  );
  assert.equal(
    isSyncJobQuarantined({ attempts: 2, maxAttempts: 5, status: "FAILED" }),
    false,
  );
});

test("quarantines failed jobs that exhausted their attempts", () => {
  assert.equal(
    classifySyncJobQuarantine({
      attempts: 5,
      maxAttempts: 5,
      status: "FAILED",
    }),
    "actionable",
  );
  assert.equal(
    isSyncJobQuarantined({ attempts: 6, maxAttempts: 5, status: "failed" }),
    true,
  );
});

test("never quarantines settled or in-flight jobs", () => {
  for (const status of ["SUCCEEDED", "CANCELLED"]) {
    assert.equal(
      classifySyncJobQuarantine({ attempts: 9, maxAttempts: 5, status }),
      "settled",
    );
  }

  for (const status of ["PENDING", "RETRYING", "RUNNING"]) {
    assert.equal(
      classifySyncJobQuarantine({ attempts: 9, maxAttempts: 5, status }),
      "retrying",
    );
  }
});

test("normalizes invalid attempt bounds", () => {
  // maxAttempts 0 is invalid and normalizes to 1, so 0 attempts is not exhausted.
  assert.equal(
    hasExhaustedSyncJobAttempts({ attempts: 0, maxAttempts: 0 }),
    false,
  );
  assert.equal(
    hasExhaustedSyncJobAttempts({ attempts: 1, maxAttempts: 0 }),
    true,
  );
  assert.equal(
    hasExhaustedSyncJobAttempts({ attempts: Number.NaN, maxAttempts: 3 }),
    false,
  );
});

test("summarizes a mixed queue", () => {
  assert.deepEqual(
    summarizeSyncJobQuarantine([
      { attempts: 5, maxAttempts: 5, status: "FAILED" },
      { attempts: 1, maxAttempts: 5, status: "FAILED" },
      { attempts: 0, maxAttempts: 5, status: "PENDING" },
      { attempts: 3, maxAttempts: 5, status: "SUCCEEDED" },
    ]),
    { actionableCount: 1, retryingCount: 2, settledCount: 1, total: 4 },
  );
});
