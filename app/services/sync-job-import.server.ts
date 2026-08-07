import { EbayConnectionStatus, Prisma } from "@prisma/client";
import prisma from "../db.server";
import { runCatalogImportJobLifecycle } from "../lib/syncbay-catalog-import-execution";
import { parseExistingCatalogFieldPoliciesByItemId } from "../lib/syncbay-existing-catalog-field-policy";
import { getShopifyAdminGraphqlClient } from "./shopify-admin-session.server";
import { executeShopifyCatalogImport } from "./shopify-draft-import.server";

import {
  DueSyncJob,
  filterPreviewResultByItemIds,
  getBooleanFromPayload,
  getEbayItemIds,
  getEbayMarketplaceId,
  getImportPreviewResultByItemIds,
  getImportProductStatus,
  getInterruptedRunningSyncJobResult,
  getJsonObject,
  getLatestFacetBaselinesByItemId,
  markJobFailedOrRetrying,
  markJobSucceeded,
  splitOversizedEbayItemJobIfNeeded,
} from "./sync-job-shared.server";

export async function runImportCatalogJob(job: DueSyncJob) {
  const ebayItemIds = getEbayItemIds(job.payload);

  if (ebayItemIds.length === 0) {
    throw new Error("Job import senza eBay ItemID da riprendere.");
  }

  const splitResult = await splitOversizedEbayItemJobIfNeeded(job, ebayItemIds);

  if (splitResult !== "not_needed") {
    return {
      jobId: job.id,
      status: "succeeded" as const,
      type: job.type,
    };
  }

  const interruptedJob = await getInterruptedRunningSyncJobResult(job);
  if (interruptedJob) return interruptedJob;

  const connection = await prisma.ebayConnection.findUnique({
    where: {
      shopId_marketplaceId: {
        marketplaceId: getEbayMarketplaceId(job.payload),
        shopId: job.shopId,
      },
    },
  });

  if (!connection || connection.status !== EbayConnectionStatus.CONNECTED) {
    throw new Error("Connessione eBay non collegata per il job import.");
  }

  const interruptedJobBeforeProvider = await getInterruptedRunningSyncJobResult(job);
  if (interruptedJobBeforeProvider) return interruptedJobBeforeProvider;

  const [admin, previewResult, facetBaselinesByItemId] = await Promise.all([
    getShopifyAdminGraphqlClient(job.shop.shopDomain),
    getImportPreviewResultByItemIds(connection, ebayItemIds),
    getLatestFacetBaselinesByItemId({
      ebayItemIds,
      shopId: job.shopId,
    }),
  ]);
  const filteredPreviewResult = filterPreviewResultByItemIds(previewResult, ebayItemIds);
  const foundItemIds = new Set(filteredPreviewResult.items.map((item) => item.itemId));
  const missingItemIds = ebayItemIds.filter((itemId) => !foundItemIds.has(itemId));

  if (missingItemIds.length > 0) {
    throw new Error(
      `${missingItemIds.length} listing eBay del job non sono più recuperabili via ItemID.`,
    );
  }

  const executionInput = {
    admin,
    defaultLocationGid: job.shop.defaultLocationGid,
    existingCatalogFieldPoliciesByItemId: getExistingCatalogFieldPoliciesByItemId(job.payload),
    facetBaselinesByItemId,
    hasDefaultLocation: Boolean(job.shop.defaultLocationGid),
    importProductStatusOverride: getImportProductStatus(job.payload),
    jobId: job.id,
    previewResult: filteredPreviewResult,
    reuseOnly: getBooleanFromPayload(job.payload, "reuseOnly"),
    shopId: job.shopId,
    shopDomain: job.shop.shopDomain,
  };
  const result = await runCatalogImportJobLifecycle({
    executionInput,
    job,
    ports: {
      execute: executeShopifyCatalogImport,
      markFailed: async (transition) =>
        markJobFailedOrRetrying({
          ...transition,
          result: toPrismaJsonObject(transition.result),
        }),
      markSucceeded: async (transition) =>
        markJobSucceeded({
          ...transition,
          result: toPrismaJsonObject(transition.result),
        }),
    },
  });

  if (result.status !== "succeeded") {
    return {
      errorMessage: result.errorMessage,
      jobId: job.id,
      status: "failed" as const,
      type: job.type,
    };
  }

  return {
    jobId: job.id,
    status: "succeeded" as const,
    type: job.type,
  };
}

function toPrismaJsonObject(value: Record<string, unknown>): Prisma.JsonObject {
  return structuredClone(value) as Prisma.JsonObject;
}

function getExistingCatalogFieldPoliciesByItemId(payload: Prisma.JsonValue | null) {
  return parseExistingCatalogFieldPoliciesByItemId(
    getJsonObject(payload)?.existingCatalogFieldPoliciesByItemId,
  );
}
