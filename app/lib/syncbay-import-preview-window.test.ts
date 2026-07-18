import assert from "node:assert/strict";
import { test } from "vitest";

import { windowImportPreviewResult } from "./syncbay-import-preview-window.ts";

test("keeps preview summary complete while sending only the requested item page", () => {
  const preview = makePreview(["a", "b", "c", "d", "e"]);

  const windowed = windowImportPreviewResult(preview, {
    filter: "all",
    page: 2,
    pageSize: 2,
  });

  assert.deepEqual(
    windowed.items.map((item) => item.itemId),
    ["c", "d"],
  );
  assert.equal(windowed.summary.totalCount, 5);
  assert.deepEqual(
    windowed.existingCatalogTakeover?.rows.map((row) => row.itemId),
    ["c", "d"],
  );
  assert.deepEqual(windowed.window, {
    currentEnd: 4,
    currentStart: 3,
    filter: "all",
    page: 2,
    pageSize: 2,
    totalPages: 3,
    totalRows: 5,
  });
});

test("windows filtered preview rows and matching takeover rows together", () => {
  const preview = makePreview(["a", "b", "c", "d"], {
    b: "error",
    d: "error",
  });

  const windowed = windowImportPreviewResult(preview, {
    filter: "error",
    page: 1,
    pageSize: 1,
  });

  assert.deepEqual(
    windowed.items.map((item) => item.itemId),
    ["b"],
  );
  assert.deepEqual(
    windowed.existingCatalogTakeover?.rows.map((row) => row.itemId),
    ["b"],
  );
  assert.equal(windowed.window.totalRows, 2);
  assert.equal(windowed.window.totalPages, 2);
});

function makePreview(
  itemIds: string[],
  statusByItemId: Record<string, "error" | "importable" | "skipped"> = {},
) {
  return {
    existingCatalogTakeover: {
      rows: itemIds.map((itemId) => ({
        itemId,
        status: "applicabile",
      })),
      summary: {
        alreadyLinked: 0,
        applicable: itemIds.length,
        blocked: 0,
        review: 0,
        total: itemIds.length,
      },
    },
    items: itemIds.map((itemId) => ({
      itemId,
      status: statusByItemId[itemId] ?? "importable",
    })),
    mode: "live",
    summary: {
      errorCount: Object.values(statusByItemId).filter(
        (status) => status === "error",
      ).length,
      importableCount: itemIds.length,
      skippedCount: 0,
      totalCount: itemIds.length,
      warningCount: 0,
    },
  };
}
