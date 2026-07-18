import assert from "node:assert/strict";
import { test } from "vitest";

import { chunkArray } from "./chunk-array";

test("chunks values without losing order", () => {
  assert.deepEqual(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkArray([1, 2], 0), [[1, 2]]);
});
