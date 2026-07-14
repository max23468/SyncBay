import assert from "node:assert/strict";
import test from "node:test";

import {
  getSyncBayRequestId,
  getSyncBayRunnerCompletionLevel,
  logSyncBayRuntimeEvent,
  shouldLogSyncBayRuntimeEvent,
  // @ts-expect-error node strip-types resolves TypeScript test imports with extensions.
} from "./syncbay-runtime-log.ts";

test("runner ticks with partial failures bypass healthy-event sampling", () => {
  assert.equal(getSyncBayRunnerCompletionLevel(0), "info");
  assert.equal(getSyncBayRunnerCompletionLevel(1), "warn");
});

test("uses the Vercel request id without reading request payloads", () => {
  assert.equal(
    getSyncBayRequestId(new Request("https://example.test", { headers: { "x-vercel-id": "fra1::safe-id" } })),
    "fra1::safe-id",
  );
  assert.match(getSyncBayRequestId(new Request("https://example.test", { headers: { "x-vercel-id": "unsafe value" } })), /^[0-9a-f-]{36}$/u);
});

test("production samples healthy events but always keeps warnings and slow events", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const base = { event: "loader", level: "info" as const, requestId: "id", route: "overview" };
    assert.equal(shouldLogSyncBayRuntimeEvent(base, () => 0.9), false);
    assert.equal(shouldLogSyncBayRuntimeEvent({ ...base, durationMs: 1_001 }, () => 0.9), true);
    assert.equal(shouldLogSyncBayRuntimeEvent({ ...base, level: "warn" }, () => 0.9), true);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test("writes one allowlisted JSON line", () => {
  const original = console.info;
  const calls: string[] = [];
  console.info = (line) => calls.push(String(line));
  try {
    assert.equal(logSyncBayRuntimeEvent({ event: "runner", level: "info", requestId: "id", route: "jobs", processedCount: 2, token: "must-not-log" } as never), true);
  } finally {
    console.info = original;
  }
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0]).processedCount, 2);
  assert.doesNotMatch(calls[0], /token|shopDomain|sku/i);
});
