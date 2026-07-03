import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "syncbay-repair-price-conflicts.mjs"),
  "utf8",
);

test("applies price repair baselines only after resolving matching open conflicts", () => {
  const updatedConflictsPosition = scriptSource.indexOf("updated_conflicts as (");
  const insertedSnapshotsPosition = scriptSource.indexOf("inserted_snapshots as (");

  assert.notEqual(updatedConflictsPosition, -1);
  assert.notEqual(insertedSnapshotsPosition, -1);
  assert.ok(
    updatedConflictsPosition < insertedSnapshotsPosition,
    "updated_conflicts must run before inserted_snapshots",
  );
  assert.match(
    scriptSource,
    /from repair_rows r\s+join updated_conflicts uc\s+on uc\.id = r\."conflictId"/s,
  );
});
