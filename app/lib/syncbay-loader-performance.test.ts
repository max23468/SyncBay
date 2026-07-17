import assert from "node:assert/strict";
import test from "node:test";

import {
  createSyncBayLoaderPerformanceTrace,
  assertSyncBayLoaderPayloadBudget,
  logSyncBayLoaderPerformance,
  // @ts-expect-error node --experimental-strip-types resolves TypeScript test imports with extensions.
} from "./syncbay-loader-performance.ts";

test("records measured loader performance stages", async () => {
  const trace = createSyncBayLoaderPerformanceTrace();
  const result = await trace.measure("catalog.db.pageRows", async () => 42);

  assert.equal(result, 42);
  assert.deepEqual(
    trace.metrics().map((metric) => metric.label),
    ["catalog.db.pageRows"],
  );
  assert.equal(typeof trace.metrics()[0].durationMs, "number");
});

test("logs redacted loader performance without payload contents", () => {
  const trace = createSyncBayLoaderPerformanceTrace();
  const originalInfo = console.info;
  const originalFlag = process.env.SYNCBAY_LOADER_PERFORMANCE_LOGS;
  const calls: unknown[][] = [];

  console.info = (...args: unknown[]) => {
    calls.push(args);
  };

  try {
    delete process.env.SYNCBAY_LOADER_PERFORMANCE_LOGS;

    logSyncBayLoaderPerformance({
      details: {
        filter: "all",
        rows: 1,
      },
      payload: {
        rows: [{ title: "Dato prodotto da non stampare nel log" }],
      },
      route: "catalog",
      trace,
    });
  } finally {
    console.info = originalInfo;
    if (originalFlag === undefined) {
      delete process.env.SYNCBAY_LOADER_PERFORMANCE_LOGS;
    } else {
      process.env.SYNCBAY_LOADER_PERFORMANCE_LOGS = originalFlag;
    }
  }

  assert.equal(calls.length, 1);
  const logged = String(calls[0][0]);

  assert.match(logged, /"route":"catalog"/);
  assert.match(logged, /"payloadBytes":/);
  assert.doesNotMatch(logged, /Dato prodotto/);
});

test("enforces route-specific payload budgets", () => {
  assert.doesNotThrow(() =>
    assertSyncBayLoaderPayloadBudget("overview", { value: "ok" }),
  );
  assert.throws(
    () =>
      assertSyncBayLoaderPayloadBudget("overview", {
        value: "x".repeat(132 * 1024),
      }),
    /oltre budget/,
  );
});
