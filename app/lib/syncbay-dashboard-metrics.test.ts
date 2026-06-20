import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as metrics from "./syncbay-dashboard-metrics.ts";

const { summarizeReliability } = metrics;

function dayBefore(now: Date, offset: number, hour = 10) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - offset);
  date.setHours(hour);

  return date;
}

test("summarizes reliability over the 7-day window", () => {
  const now = new Date("2026-06-19T12:00:00");
  const jobs = [
    { createdAt: dayBefore(now, 0), status: "SUCCEEDED" },
    { createdAt: dayBefore(now, 0), status: "FAILED" },
    { createdAt: dayBefore(now, 1), status: "SUCCEEDED" },
    { createdAt: dayBefore(now, 6), status: "SUCCEEDED" },
  ];

  const result = summarizeReliability(jobs, now);

  assert.equal(result.windowDays, 7);
  assert.equal(result.totalJobs, 4);
  assert.equal(result.succeededJobs, 3);
  assert.equal(result.successRate, 75);
  assert.equal(result.daily.length, 7);
  assert.equal(result.daily[0], 1); // 6 giorni fa
  assert.equal(result.daily[5], 1); // ieri
  assert.equal(result.daily[6], 2); // oggi
  assert.equal(
    result.daily.reduce((total, value) => total + value, 0),
    4,
  );
});

test("reliability with no jobs is empty at 100%", () => {
  const result = summarizeReliability([], new Date("2026-06-19T12:00:00"));

  assert.equal(result.totalJobs, 0);
  assert.equal(result.succeededJobs, 0);
  assert.equal(result.successRate, 100);
  assert.deepEqual(result.daily, [0, 0, 0, 0, 0, 0, 0]);
});
