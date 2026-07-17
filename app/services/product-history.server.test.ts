import assert from "node:assert/strict";
import test from "node:test";

import { recordProductHistory } from "./product-history.server";

test("writes baseline and snapshots in one transaction", async () => {
  const events: string[] = [];
  const baselines: unknown[] = [];
  const snapshots: unknown[] = [];

  await recordProductHistory(
    {
      baseline: { mappingId: "mapping-1", shopId: "shop-1", quantity: 2 },
      snapshots: [{ id: "snapshot-1", shopId: "shop-1", source: "SYNCBAY" }],
    },
    {
      async transaction(run) {
        events.push("transaction:start");
        await run({
          async createSnapshots(rows) {
            events.push("snapshots:create");
            snapshots.push(...rows);
          },
          async upsertBaseline(input) {
            events.push("baseline:upsert");
            baselines.push(input);
          },
        });
        events.push("transaction:commit");
      },
    },
  );

  assert.deepEqual(events, [
    "transaction:start",
    "baseline:upsert",
    "snapshots:create",
    "transaction:commit",
  ]);
  assert.equal(baselines.length, 1);
  assert.equal(snapshots.length, 1);
});

test("does not create an empty snapshot batch", async () => {
  let createCalls = 0;
  await recordProductHistory(
    { baseline: { mappingId: "mapping-1", shopId: "shop-1" }, snapshots: [] },
    {
      async transaction(run) {
        await run({
          async createSnapshots() {
            createCalls += 1;
          },
          async upsertBaseline() {},
        });
      },
    },
  );
  assert.equal(createCalls, 0);
});
