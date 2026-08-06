import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import {
  buildCatalogImportExecutionResult,
  runCatalogImportJobLifecycle,
  type CatalogImportExecutionResult,
} from "../lib/syncbay-catalog-import-execution";
import { hashNullableText } from "../lib/syncbay-description-hash";
import { buildEbayProductSnapshotPayload } from "../lib/syncbay-product-snapshot-payload";
import {
  downloadImageForStaging,
  isDraftProductUnchangedSinceLastEbaySnapshot,
} from "./shopify-draft-import.server";

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

  assert.deepEqual(harness.executedJobIds, ["outer-job-retry", "outer-job-retry"]);
  assert.equal(harness.failedTransitions.length, 1);
  assert.equal(harness.succeededTransitions.length, 1);
});

test("partial product failures are summarized without an internal job", async () => {
  const failedResults = [{ ebayItemId: "synthetic-item", errorMessage: "Errore sintetico" }];
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

  assert.doesNotMatch(importSource, /prisma\.syncJob\.(?:create|update|upsert)/);
  assert.doesNotMatch(importSource, /startDraftImportJob|finishDraftImportJob/);
});

test("image staging rejects private destinations and oversized streams", async () => {
  const fetchCalls: string[] = [];
  const privateResult = await downloadImageForStaging("https://127.0.0.1/image.jpg", {
    requestImpl: async ({ url }) => {
      fetchCalls.push(String(url));
      return new Response();
    },
  });

  assert.equal(privateResult.status, "failed");
  assert.equal(fetchCalls.length, 0);

  const redirectResult = await downloadImageForStaging("https://images.example/image.jpg", {
    requestImpl: async ({ url }) => {
      fetchCalls.push(String(url));
      return new Response(null, {
        headers: { location: "https://127.0.0.1/internal" },
        status: 302,
      });
    },
    lookupHost: async () => [{ address: "93.184.216.34", family: 4 }],
  });

  assert.equal(redirectResult.status, "failed");
  assert.equal(fetchCalls.length, 1);

  const oversizedResult = await downloadImageForStaging("https://images.example/image.jpg", {
    requestImpl: async () =>
      new Response("12345", {
        headers: { "content-type": "image/jpeg" },
      }),
    lookupHost: async () => [{ address: "93.184.216.34", family: 4 }],
    maxBytes: 4,
  });

  assert.equal(oversizedResult.status, "failed");
});

test("image staging connects to the public address validated by DNS", async () => {
  let lookupCalls = 0;
  const result = await downloadImageForStaging("https://images.example/image.jpg", {
    lookupHost: async () => {
      lookupCalls += 1;
      return [
        lookupCalls === 1
          ? { address: "93.184.216.34", family: 4 }
          : { address: "127.0.0.1", family: 4 },
      ];
    },
    requestImpl: async ({ address }) => {
      assert.equal(address, "93.184.216.34");
      return new Response("image", {
        headers: { "content-type": "image/jpeg" },
      });
    },
  });

  assert.equal(result.status, "synced");
  assert.equal(lookupCalls, 1);
});

test("image staging supports all-address lookups for its pinned DNS resolution", () => {
  const importSource = readFileSync(
    new URL("./shopify-draft-import.server.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    importSource,
    /if \(options\.all\)[\s\S]*callback\(null, \[\{ address, family \}\]\)/,
  );
});

type UnchangedCheckInput = Parameters<typeof isDraftProductUnchangedSinceLastEbaySnapshot>[0];

function createSyntheticDraftProduct(overrides?: { quantity?: number }) {
  const normalized = {
    categoryProposal: null,
    currency: "EUR",
    descriptionHtml: "<p>Moneta sintetica di test</p>",
    descriptionMode: "ebay",
    ebayPrimaryCategoryId: "11116",
    ebayPrimaryCategoryName: "Monete",
    ebayPrimaryCategoryPath: "Monete e banconote > Monete",
    imageCount: 2,
    imageUrls: ["https://img.example/1.jpg", "https://img.example/2.jpg"],
    priceAmount: 8,
    productFacets: [],
    quantity: overrides?.quantity ?? 2,
    sku: "EBAY-000000000001",
    skuGenerated: true,
    storeCategoryId: null,
    storeCategoryName: null,
    title: "Moneta sintetica 2 Lire",
  };

  return {
    previewItem: {
      issues: [],
      itemId: "000000000001",
      normalized,
      status: "ready",
    },
    source: { ebayItemId: "000000000001" },
  } as unknown as UnchangedCheckInput["draftProduct"];
}

// Riga snapshot come la restituirebbe Prisma dopo la persistenza dell'import:
// payload JSON già serializzato e priceAmount in forma decimale-stringa.
function createStoredEbaySnapshotRow() {
  const draftProduct = createSyntheticDraftProduct();
  const item = (draftProduct as { previewItem: { normalized: Record<string, unknown> } })
    .previewItem;

  return {
    currency: "EUR",
    descriptionHash: hashNullableText("<p>Moneta sintetica di test</p>"),
    ebayItemId: "000000000001",
    imageCount: 2,
    payload: JSON.parse(
      JSON.stringify(
        buildEbayProductSnapshotPayload({
          categoryProposal: null,
          descriptionMode: "ebay",
          ebayPrimaryCategoryId: "11116",
          ebayPrimaryCategoryName: "Monete",
          ebayPrimaryCategoryPath: "Monete e banconote > Monete",
          imageUrls: item.normalized.imageUrls as string[],
          issueCodes: [],
          productFacets: [],
          skuGenerated: true,
          status: "ready",
          storeCategoryId: null,
          storeCategoryName: null,
        }),
      ),
    ),
    priceAmount: "8.00",
    productStatus: null,
    quantity: 2,
    shopifyProductGid: null,
    shopifyVariantGid: null,
    sku: "EBAY-000000000001",
    source: "EBAY",
    title: "Moneta sintetica 2 Lire",
  };
}

test("un draft identico all'ultimo snapshot EBAY viene riconosciuto invariato", () => {
  assert.equal(
    isDraftProductUnchangedSinceLastEbaySnapshot({
      draftProduct: createSyntheticDraftProduct(),
      previousEbaySnapshot: createStoredEbaySnapshotRow(),
      shopId: "shop-1",
    }),
    true,
  );
});

test("una quantità eBay diversa impedisce lo skip del sync", () => {
  assert.equal(
    isDraftProductUnchangedSinceLastEbaySnapshot({
      draftProduct: createSyntheticDraftProduct({ quantity: 1 }),
      previousEbaySnapshot: createStoredEbaySnapshotRow(),
      shopId: "shop-1",
    }),
    false,
  );
});

test("senza snapshot EBAY precedente il sync non viene mai saltato", () => {
  assert.equal(
    isDraftProductUnchangedSinceLastEbaySnapshot({
      draftProduct: createSyntheticDraftProduct(),
      previousEbaySnapshot: null,
      shopId: "shop-1",
    }),
    false,
  );
});
