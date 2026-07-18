import assert from "node:assert/strict";
import { test } from "vitest";

import { parsePositiveLimitOption } from "./syncbay-cli-args.ts";

test("parses positive --limit values", () => {
  assert.equal(parsePositiveLimitOption("25", "--limit"), 25);
});

test("rejects invalid --limit values instead of silently ignoring them", () => {
  assert.throws(
    () => parsePositiveLimitOption("0", "--limit"),
    /--limit deve essere un intero positivo/,
  );
  assert.throws(
    () => parsePositiveLimitOption("abc", "--limit"),
    /--limit deve essere un intero positivo/,
  );
  assert.throws(
    () => parsePositiveLimitOption(undefined, "--limit"),
    /--limit richiede un valore/,
  );
});
