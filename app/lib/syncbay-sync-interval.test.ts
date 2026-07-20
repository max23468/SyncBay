import assert from "node:assert/strict";
import { test } from "vitest";

import * as syncInterval from "./syncbay-sync-interval.ts";

const { SYNC_TARGET_OPTIONS, getSyncTargetLabel, normalizeSyncTargetSeconds } = syncInterval;

test("accepts only the allowed sync target values", () => {
  for (const option of SYNC_TARGET_OPTIONS) {
    assert.equal(normalizeSyncTargetSeconds(option.value), option.value);
    assert.equal(normalizeSyncTargetSeconds(String(option.value)), option.value);
  }
});

test("accepts the conservative 5-30 minute sync target set", () => {
  assert.deepEqual(
    SYNC_TARGET_OPTIONS.map((option) => option.value),
    [300, 600, 900, 1200, 1800],
  );
});

test("rejects values outside the 5-30 minute set", () => {
  for (const invalid of [
    0,
    30,
    60,
    90,
    120,
    180,
    240,
    301,
    599,
    1801,
    -60,
    "abc",
    "",
    null,
    undefined,
  ]) {
    assert.equal(normalizeSyncTargetSeconds(invalid), null);
  }
});

test("labels known options and falls back for env-set values", () => {
  assert.equal(getSyncTargetLabel(300), "5 minuti");
  assert.equal(getSyncTargetLabel(1800), "30 minuti");
  assert.equal(getSyncTargetLabel(60), "1 minuto");
  assert.equal(getSyncTargetLabel(240), "4 minuti");
  assert.equal(getSyncTargetLabel(45), "45 s");
});
