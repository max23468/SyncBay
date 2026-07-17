import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildCatalogImportExecutionResult,
  runCatalogImportJobLifecycle,
  type CatalogImportExecutionResult,
} from "../lib/syncbay-catalog-import-execution";

function createLifecycleHarness(results: CatalogImportExecutionResult[]) {
  const executedJobIds: string[] = [];
  const failedTransitions: Array<Record<string, unknown>> = [];
  const succeededTransitions: Array<Record<string, unknown>> = [];

  return {
    executedJobIds,
    failedTransitions,
    ports: {
      execute: async (input: { jobId: string }) => {
        executedJobIds.push(input.jobId);
        const result = results.shift();
        assert.ok(result, "Risultato fake mancante per il tentativo import.");
        return result;
      },
      markFailed: async (input: Record<string, unknown>) => {
        failedTransitions.push(input);
      },
      markSucceeded: async (input: Record<string, unknown>) => {
        succeededTransitions.push(input);
      },
    },
    succeededTransitions,
  };
}

test("one outer import job produces one terminal transition", async () => {
  const harness = createLifecycleHarness([
    buildCatalogImportExecutionResult({
      status: "succeeded",
      summary: { managedCount: 2 },
      warnings: ["Avviso sintetico"],
    }),
  ]);

  await runCatalogImportJobLifecycle({
    executionInput: { jobId: "outer-job-1" },
    job: { id: "outer-job-1" },
    ports: harness.ports,
  });

  assert.deepEqual(harness.executedJobIds, ["outer-job-1"]);
  assert.equal(harness.failedTransitions.length, 0);
  assert.equal(harness.succeededTransitions.length, 1);
  assert.deepEqual(harness.succeededTransitions[0], {
    job: { id: "outer-job-1" },
    result: { managedCount: 2 },
    warnings: ["Avviso sintetico"],
  });
});

test("a retry reuses the outer job id for Shopify idempotency", async () => {
  const harness = createLifecycleHarness([
    buildCatalogImportExecutionResult({
      errorCode: "SHOPIFY_THROTTLED",
      errorMessage: "Retry sintetico",
      status: "failed",
    }),
    buildCatalogImportExecutionResult({ status: "succeeded" }),
  ]);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await runCatalogImportJobLifecycle({
      executionInput: { jobId: "outer-job-retry" },
      job: { id: "outer-job-retry" },
      ports: harness.ports,
    });
  }

  assert.deepEqual(harness.executedJobIds, [
    "outer-job-retry",
    "outer-job-retry",
  ]);
  assert.equal(harness.failedTransitions.length, 1);
  assert.equal(harness.succeededTransitions.length, 1);
});

test("partial product failures are summarized without an internal job", async () => {
  const failedResults = [
    { ebayItemId: "synthetic-item", errorMessage: "Errore sintetico" },
  ];
  const harness = createLifecycleHarness([
    buildCatalogImportExecutionResult({
      errorCode: "SHOPIFY_DRAFT_IMPORT_FAILED",
      errorMessage: "Un prodotto non è stato importato.",
      status: "failed",
      summary: { failedResults, managedCount: 1 },
      warnings: ["Warning prodotto sintetico"],
    }),
  ]);

  await runCatalogImportJobLifecycle({
    executionInput: { jobId: "outer-job-partial" },
    job: { id: "outer-job-partial" },
    ports: harness.ports,
  });

  assert.equal(harness.succeededTransitions.length, 0);
  assert.equal(harness.failedTransitions.length, 1);
  assert.deepEqual(harness.failedTransitions[0], {
    errorCode: "SHOPIFY_DRAFT_IMPORT_FAILED",
    errorMessage: "Un prodotto non è stato importato.",
    job: { id: "outer-job-partial" },
    result: {
      failedResults,
      managedCount: 1,
      warnings: ["Warning prodotto sintetico"],
    },
  });
});

test("the real catalog executor cannot create or finalize an internal job", () => {
  const importSource = readFileSync(
    new URL("./shopify-draft-import.server.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    importSource,
    /prisma\.syncJob\.(?:create|update|upsert)/,
  );
  assert.doesNotMatch(importSource, /startDraftImportJob|finishDraftImportJob/);
});
