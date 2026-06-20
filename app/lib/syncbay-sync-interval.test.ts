import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as syncInterval from "./syncbay-sync-interval.ts";

const { SYNC_TARGET_OPTIONS, getSyncTargetLabel, normalizeSyncTargetSeconds } =
  syncInterval;

test("accepts only the allowed sync target values", () => {
  for (const option of SYNC_TARGET_OPTIONS) {
    assert.equal(normalizeSyncTargetSeconds(option.value), option.value);
    assert.equal(normalizeSyncTargetSeconds(String(option.value)), option.value);
  }
});

test("rejects values outside the 2-5 minute set", () => {
  for (const invalid of [0, 30, 60, 90, 301, 600, -60, "abc", "", null, undefined]) {
    assert.equal(normalizeSyncTargetSeconds(invalid), null);
  }
});

test("labels known options and falls back for env-set values", () => {
  assert.equal(getSyncTargetLabel(120), "2 minuti");
  assert.equal(getSyncTargetLabel(300), "5 minuti");
  assert.equal(getSyncTargetLabel(60), "1 minuto");
  assert.equal(getSyncTargetLabel(240), "4 minuti");
  assert.equal(getSyncTargetLabel(45), "45 s");
});
