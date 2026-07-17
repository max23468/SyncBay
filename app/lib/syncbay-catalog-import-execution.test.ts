import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCatalogImportExecutionResult,
  runCatalogImportJobLifecycle,
} from "./syncbay-catalog-import-execution.ts";

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

test("rejects an execution id different from the outer owner job", async () => {
  let executed = false;

  await assert.rejects(
    runCatalogImportJobLifecycle({
      executionInput: { jobId: "internal-job" },
      job: { id: "outer-job" },
      ports: {
        execute: async () => {
          executed = true;
          return buildCatalogImportExecutionResult({ status: "succeeded" });
        },
        markFailed: async () => {},
        markSucceeded: async () => {},
      },
    }),
    /ID del job esterno proprietario/,
  );
  assert.equal(executed, false);
});
