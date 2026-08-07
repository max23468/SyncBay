import assert from "node:assert/strict";
import { SyncJobType } from "@prisma/client";
import { test, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  archive: vi.fn(async () => 0),
  claim: vi.fn(async (job) => job),
  conflicts: vi.fn(async (job) => result(job)),
  count: vi.fn(async () => dueCounts()),
  enqueue: vi.fn(async () => {}),
  find: vi.fn(async () => []),
  import: vi.fn(async (job) => result(job)),
  incremental: vi.fn(async (job) => result(job)),
  inactive: vi.fn(async (job) => result(job)),
  maintenance: vi.fn(async () => ({ cleaned: 0 })),
  recover: vi.fn(async () => {}),
  stock: vi.fn(async (job) => result(job)),
}));

vi.mock("./sync-job-scheduling.server", () => ({
  archiveSupersededFailedIncrementalSyncJobs: fakes.archive,
  buildRunnerLaneCounts: (lanes: string[]) =>
    lanes.reduce(
      (counts, lane) => ({
        ...counts,
        [lane]: (counts[lane as SyncJobType] ?? 0) + 1,
      }),
      dueCounts(),
    ),
  claimDueSyncJob: fakes.claim,
  countDueSyncJobsByType: fakes.count,
  enqueueIncrementalSyncJobs: fakes.enqueue,
  findDueSyncJobsByPriority: fakes.find,
  getRunnableSyncJobTypes: () => Object.values(SyncJobType),
  recoverStaleRunningSyncJobsForDueShops: fakes.recover,
}));
vi.mock("./product-history.server", () => ({
  runDailyOperationalMaintenance: fakes.maintenance,
}));
vi.mock("./sync-job-import.server", () => ({ runImportCatalogJob: fakes.import }));
vi.mock("./sync-job-incremental.server", () => ({
  runIncrementalSyncJob: fakes.incremental,
  runMarkInactiveListingSoldOutJob: fakes.inactive,
}));
vi.mock("./sync-job-stock.server", () => ({ runUpdateEbayStockJob: fakes.stock }));
vi.mock("./sync-job-conflicts.server", () => ({
  runDetectShopifyChangesJob: fakes.conflicts,
}));

import type { DueSyncJob } from "./sync-job-shared.server";
import { runDueSyncJob, runDueSyncJobs } from "./sync-job-runner.server";

test("runDueSyncJobs coordina una coda vuota senza possedere famiglie di job", async () => {
  const now = new Date("2026-08-07T08:00:00.000Z");
  const summary = await runDueSyncJobs({ limit: 5, now });

  assert.equal(summary.processedCount, 0);
  assert.equal(summary.continuationNeeded, false);
  assert.deepEqual(summary.retentionCleanup, { cleaned: 0 });
  assert.deepEqual(fakes.enqueue.mock.calls.at(-1), [now]);
  assert.deepEqual(fakes.recover.mock.calls.at(-1), [{ limit: 5, now }]);
});

test("il dispatcher inoltra ogni tipo alla sua famiglia", async () => {
  const cases = [
    [SyncJobType.IMPORT_CATALOG, fakes.import],
    [SyncJobType.SYNC_INCREMENTAL, fakes.incremental],
    [SyncJobType.UPDATE_EBAY_STOCK, fakes.stock],
    [SyncJobType.ARCHIVE_INACTIVE_LISTING, fakes.inactive],
    [SyncJobType.DETECT_SHOPIFY_CHANGES, fakes.conflicts],
  ] as const;

  for (const [type, worker] of cases) {
    worker.mockClear();
    const job = makeJob(type);
    assert.equal((await runDueSyncJob(job)).status, "succeeded");
    assert.equal(worker.mock.calls.at(-1)?.[0], job);
  }
});

function makeJob(type: SyncJobType) {
  return { id: `job-${type}`, type } as DueSyncJob;
}

function result(job: DueSyncJob) {
  return { jobId: job.id, status: "succeeded" as const, type: job.type };
}

function dueCounts() {
  return Object.fromEntries(Object.values(SyncJobType).map((type) => [type, 0])) as Record<
    SyncJobType,
    number
  >;
}
