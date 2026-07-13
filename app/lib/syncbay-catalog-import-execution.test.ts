import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildCatalogImportExecutionResult } from "./syncbay-catalog-import-execution.ts";

test("returns a declarative success result without job transitions", () => {
  assert.deepEqual(
    buildCatalogImportExecutionResult({
      status: "succeeded",
      summary: { managedCount: 2, failedResults: [] },
      warnings: ["warning", "warning"],
    }),
    {
      status: "succeeded",
      summary: { managedCount: 2, failedResults: [] },
      warnings: ["warning"],
    },
  );
});

test("keeps partial product failures in a failed result summary", () => {
  assert.deepEqual(
    buildCatalogImportExecutionResult({
      errorCode: "SHOPIFY_DRAFT_IMPORT_FAILED",
      errorMessage: "Un prodotto non e stato importato.",
      status: "failed",
      summary: {
        managedCount: 1,
        failedResults: [{ ebayItemId: "synthetic-item", errorMessage: "test" }],
      },
    }),
    {
      errorCode: "SHOPIFY_DRAFT_IMPORT_FAILED",
      errorMessage: "Un prodotto non e stato importato.",
      status: "failed",
      summary: {
        managedCount: 1,
        failedResults: [{ ebayItemId: "synthetic-item", errorMessage: "test" }],
      },
      warnings: [],
    },
  );
});
