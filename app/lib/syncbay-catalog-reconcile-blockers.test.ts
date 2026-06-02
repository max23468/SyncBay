import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { getCatalogReconcileBlockingJobTypes } from "./syncbay-catalog-reconcile-blockers.ts";

test("blocks catalog reconcile while initial imports are still active", () => {
  assert.deepEqual(
    getCatalogReconcileBlockingJobTypes({
      archiveInactiveListing: "ARCHIVE_INACTIVE_LISTING",
      importCatalog: "IMPORT_CATALOG",
      syncIncremental: "SYNC_INCREMENTAL",
    }),
    ["IMPORT_CATALOG", "SYNC_INCREMENTAL", "ARCHIVE_INACTIVE_LISTING"],
  );
});
