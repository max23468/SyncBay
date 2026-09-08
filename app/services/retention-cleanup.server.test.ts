import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  auditDeleteMany: vi.fn(async () => ({ count: 0 })),
  deletionDeleteMany: vi.fn(async (_input: { where: { OR: Array<Record<string, unknown>> } }) => ({
    count: 0,
  })),
  oauthDeleteMany: vi.fn(async () => ({ count: 0 })),
  syncJobDeleteMany: vi.fn(async () => ({ count: 0 })),
}));

vi.mock("../db.server", () => ({
  default: {
    auditLog: { deleteMany: fakes.auditDeleteMany },
    ebayAccountDeletionRequest: { deleteMany: fakes.deletionDeleteMany },
    ebayOAuthState: { deleteMany: fakes.oauthDeleteMany },
    syncJob: { deleteMany: fakes.syncJobDeleteMany },
  },
}));

vi.mock("../lib/syncbay-runtime-log", () => ({
  logSyncBayRuntimeEvent: vi.fn(),
}));

import { runRetentionCleanup } from "./retention-cleanup.server.ts";

afterEach(() => {
  delete process.env.SYNCBAY_RETENTION_CLEANUP_ENABLED;
  vi.clearAllMocks();
});

test("la retention conserva le richieste account deletion con relay aperto", async () => {
  await runRetentionCleanup({ now: new Date("2026-09-08T08:00:00.000Z") });

  assert.equal(fakes.deletionDeleteMany.mock.calls.length, 2);
  for (const [input] of fakes.deletionDeleteMany.mock.calls) {
    assert.deepEqual(input.where.OR, [{ relayStatus: null }, { relayStatus: "DELIVERED" }]);
  }
});
