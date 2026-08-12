import assert from "node:assert/strict";
import { SyncJobStatus, SyncJobType } from "@prisma/client";
import { afterEach, test, vi } from "vitest";

const stockJobs = ["stock-1", "stock-2"].map((id) => ({
  id,
  shopId: "shop-1",
  status: SyncJobStatus.PENDING,
  type: SyncJobType.UPDATE_EBAY_STOCK,
}));
const fakes = vi.hoisted(() => ({
  archiveShops: [] as Array<{ shopId: string }>,
  findFirst: vi.fn(
    async (_input: { where: unknown }) =>
      null as { finishedAt: Date | null; updatedAt: Date } | null,
  ),
  findMany: vi.fn(
    async (input: { distinct?: string[]; take?: number; where?: { id?: { notIn: string[] } } }) => {
      if (input.distinct) return fakes.archiveShops;

      const excludedIds = input.where?.id?.notIn ?? [];

      return stockJobs
        .filter((job) => !excludedIds.includes(job.id))
        .slice(0, input.take ?? stockJobs.length);
    },
  ),
  queryRaw: vi.fn(async () => []),
  updateMany: vi.fn(async (_input: { data: unknown; where: unknown }) => ({ count: 0 })),
}));

vi.mock("../db.server", () => ({
  default: {
    $queryRaw: fakes.queryRaw,
    syncJob: {
      findFirst: fakes.findFirst,
      findMany: fakes.findMany,
      updateMany: fakes.updateMany,
    },
  },
}));

import {
  archiveSupersededFailedIncrementalSyncJobs,
  findDueSyncJobsByPriority,
} from "./sync-job-scheduling.server";

afterEach(() => {
  fakes.archiveShops = [];
  vi.clearAllMocks();
});

test("riassegna allo stock gli slot lasciati vuoti da batch bloccati", async () => {
  const jobs = await findDueSyncJobsByPriority({
    lanePlan: [SyncJobType.SYNC_INCREMENTAL, SyncJobType.UPDATE_EBAY_STOCK],
    now: new Date("2026-08-09T10:00:00.000Z"),
  });

  assert.deepEqual(
    jobs.map((job) => job.id),
    ["stock-1", "stock-2"],
  );
});

test("chiude subito i marker enqueue superati ma conserva l'attesa dei blocchi legacy", async () => {
  const latestSuccessAt = new Date("2026-08-12T09:05:00.000Z");
  const archiveCutoff = new Date("2026-08-11T10:00:00.000Z");
  fakes.archiveShops = [{ shopId: "shop-1" }];
  fakes.findFirst.mockResolvedValueOnce({
    finishedAt: latestSuccessAt,
    updatedAt: latestSuccessAt,
  });
  fakes.updateMany.mockResolvedValueOnce({ count: 2 });

  assert.equal(
    await archiveSupersededFailedIncrementalSyncJobs({
      now: new Date("2026-08-12T10:00:00.000Z"),
    }),
    2,
  );
  assert.deepEqual(fakes.findFirst.mock.calls.at(-1)?.[0]?.where, {
    OR: [
      { payload: { path: ["source"], equals: "seller_events_delta" } },
      { payload: { path: ["source"], equals: "catalog_reconcile" } },
    ],
    shopId: "shop-1",
    status: SyncJobStatus.SUCCEEDED,
    type: SyncJobType.SYNC_INCREMENTAL,
  });
  assert.deepEqual(fakes.updateMany.mock.calls.at(-1)?.[0]?.where, {
    OR: [
      {
        errorCode: "SYNCBAY_INCREMENTAL_ENQUEUE_FAILED",
        updatedAt: { lt: latestSuccessAt },
      },
      {
        errorCode: "SYNCBAY_INCREMENTAL_BLOCKED",
        updatedAt: { lt: latestSuccessAt, lte: archiveCutoff },
      },
    ],
    shopId: "shop-1",
    status: SyncJobStatus.FAILED,
    type: SyncJobType.SYNC_INCREMENTAL,
  });
});
