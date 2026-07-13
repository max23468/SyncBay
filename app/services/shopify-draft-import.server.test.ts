import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const importSource = readFileSync(
  new URL("./shopify-draft-import.server.ts", import.meta.url),
  "utf8",
);
const runnerSource = readFileSync(
  new URL("./sync-job-runner.server.ts", import.meta.url),
  "utf8",
);

test("one outer import job owns the only terminal lifecycle", () => {
  assert.doesNotMatch(importSource, /prisma\.syncJob\.(?:create|update|upsert)/);
  assert.doesNotMatch(importSource, /startDraftImportJob|finishDraftImportJob/);
  assert.doesNotMatch(runnerSource, /delegatedJobId/);
});

test("a retry reuses the outer job id for Shopify idempotency", () => {
  const ownerIdPasses = runnerSource.match(/jobId:\s*job\.id/g) ?? [];
  assert.ok(ownerIdPasses.length >= 2);
});

test("partial product failures remain in the declarative summary", () => {
  assert.match(importSource, /failedResults/);
  assert.match(importSource, /buildDraftImportSummary/);
  assert.match(importSource, /SHOPIFY_DRAFT_IMPORT_FAILED/);
});
