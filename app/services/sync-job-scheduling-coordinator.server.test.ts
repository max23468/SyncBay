import assert from "node:assert/strict";
import { Prisma, SyncJobStatus, SyncJobType } from "@prisma/client";
import { test, vi } from "vitest";

const stockJobs = ["stock-1", "stock-2"].map((id) => ({
  id,
  shopId: "shop-1",
  status: SyncJobStatus.PENDING,
  type: SyncJobType.UPDATE_EBAY_STOCK,
}));
const fakes = vi.hoisted(() => ({
  findMany: vi.fn(async (input: { take: number; where: { id: { notIn: string[] } } }) =>
    stockJobs.filter((job) => !input.where.id.notIn.includes(job.id)).slice(0, input.take),
  ),
  queryRaw: vi.fn(async (_query: Prisma.Sql) => []),
}));

vi.mock("../db.server", () => ({
  default: {
    $queryRaw: fakes.queryRaw,
    syncJob: { findMany: fakes.findMany },
  },
}));

import { findDueSyncJobsByPriority } from "./sync-job-scheduling.server";

test("riassegna allo stock gli slot lasciati vuoti da batch bloccati", async () => {
  const jobs = await findDueSyncJobsByPriority({
    lanePlan: [SyncJobType.SYNC_INCREMENTAL, SyncJobType.UPDATE_EBAY_STOCK],
    now: new Date("2026-08-09T10:00:00.000Z"),
  });

  assert.deepEqual(
    jobs.map((job) => job.id),
    ["stock-1", "stock-2"],
  );
  assert(fakes.queryRaw.mock.calls[0]?.[0]?.values.includes(SyncJobStatus.FAILED));
});
