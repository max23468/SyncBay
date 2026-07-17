import assert from "node:assert/strict";
import test from "node:test";

import * as existingCatalogPreview from "./syncbay-existing-catalog-preview.ts";

const { buildExistingCatalogPreviewMetadata } = existingCatalogPreview;

test("reports complete existing catalog previews without truncation", () => {
  assert.deepEqual(
    buildExistingCatalogPreviewMetadata({
      maxProducts: 2000,
      readCount: 856,
      totalAvailable: 856,
      totalPlanned: 856,
    }),
    {
      readCount: 856,
      totalAvailable: 856,
      totalPlanned: 856,
      truncatedAtMaxProducts: false,
    },
  );
});

test("marks existing catalog previews truncated when eBay exceeds the 1.0 cap", () => {
  assert.deepEqual(
    buildExistingCatalogPreviewMetadata({
      maxProducts: 2000,
      readCount: 2000,
      totalAvailable: 2400,
      totalPlanned: 2000,
    }),
    {
      readCount: 2000,
      totalAvailable: 2400,
      totalPlanned: 2000,
      truncatedAtMaxProducts: true,
    },
  );
});

test("marks unknown totals truncated when the plan reaches the requested cap", () => {
  assert.equal(
    buildExistingCatalogPreviewMetadata({
      maxProducts: 300,
      readCount: 300,
      totalAvailable: null,
      totalPlanned: 300,
    }).truncatedAtMaxProducts,
    true,
  );
});
