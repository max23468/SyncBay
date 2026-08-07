import {
  AuditEventType,
  EbayConnection,
  EbayConnectionStatus,
  Prisma,
  ProductSnapshotSource,
  SyncJobStatus,
  SyncJobType,
} from "@prisma/client";
import prisma from "../db.server";
import { normalizeImportProductStatus } from "../lib/import-product-status";
import { SYNCBAY_AUDIT_LOG_CREATE_SELECT } from "../lib/syncbay-audit-log-write";
import {
  buildEbayItemJobSplitIdempotencyKey,
  buildEbayItemJobSplitPayloads,
} from "../lib/syncbay-job-scheduling";
import { type SyncBayProductFacet } from "../lib/syncbay-product-facets";
import { getProductFacetBaselineFromSnapshotPayload } from "../lib/syncbay-product-snapshot-payload";
import { mergePreferredShopifyVariantForSync } from "../lib/syncbay-shopify-variant-selection";
import { DEFAULT_EBAY_MARKETPLACE_ID as DEFAULT_MARKETPLACE_ID } from "./ebay-environment.server";
import { getUsableEbayAccessToken } from "./ebay-token.server";
import { getEbayTradingCandidatesByItemIds } from "./ebay-trading-preview.server";
import {
  buildImportPreview,
  summarizePreviewItems,
  type ImportPreviewResult,
} from "./import-preview.server";

export const dueSyncJobSelect = {
  attempts: true,
  createdAt: true,
  finishedAt: true,
  id: true,
  idempotencyKey: true,
  maxAttempts: true,
  payload: true,
  result: true,
  shop: {
    select: {
      defaultLocationGid: true,
      shopDomain: true,
    },
  },
  shopId: true,
  startedAt: true,
  status: true,
  type: true,
} satisfies Prisma.SyncJobSelect;

export type DueSyncJob = Prisma.SyncJobGetPayload<{ select: typeof dueSyncJobSelect }>;

export type DueSyncJobRunResult = {
  errorMessage?: string;
  jobId: string;
  status: "failed" | "skipped" | "succeeded";
  type: SyncJobType;
};

export type ShopifyProductForConflict = {
  descriptionHtml?: string | null;
  id: string;
  media?: {
    nodes?: Array<{
      mediaContentType?: string | null;
      preview?: { status?: string | null } | null;
    }>;
  } | null;
  status?: string | null;
  title?: string | null;
  variants?: {
    nodes?: Array<{
      compareAtPrice?: string | null;
      inventoryItem?: {
        inventoryLevel?: {
          quantities?: Array<{
            name?: string | null;
            quantity?: number | null;
          }> | null;
        } | null;
        tracked?: boolean | null;
      } | null;
      id?: string | null;
      inventoryQuantity?: number | null;
      price?: string | null;
    }>;
  } | null;
};

export type ShopifyProductForConflictVariant = NonNullable<
  NonNullable<ShopifyProductForConflict["variants"]>["nodes"]
>[number];

export type ShopifyProductForConflictMappedVariant = ShopifyProductForConflictVariant & {
  product?: {
    id?: string | null;
  } | null;
};

export type ShopifyProductForConflictResponse = {
  data?: {
    productNode?: ShopifyProductForConflict | null;
    variantNode?: ShopifyProductForConflictMappedVariant | null;
  };
  errors?: Array<{ message: string }>;
};

export const RUNNER_EBAY_ITEM_BATCH_SIZE = 10;

export async function getLatestFacetBaselinesByItemId(input: {
  ebayItemIds: string[];
  shopId: string;
}): Promise<Record<string, SyncBayProductFacet[]>> {
  if (input.ebayItemIds.length === 0) return {};

  const snapshots = await prisma.productSnapshot.findMany({
    orderBy: { capturedAt: "desc" },
    select: {
      ebayItemId: true,
      payload: true,
    },
    where: {
      ebayItemId: { in: input.ebayItemIds },
      shopId: input.shopId,
      source: {
        in: [ProductSnapshotSource.SYNCBAY, ProductSnapshotSource.EBAY],
      },
    },
  });
  const baselines: Record<string, SyncBayProductFacet[]> = {};

  for (const snapshot of snapshots) {
    if (!snapshot.ebayItemId || Object.hasOwn(baselines, snapshot.ebayItemId)) {
      continue;
    }

    const baseline = getProductFacetBaselineFromSnapshotPayload(snapshot.payload);
    if (baseline === null) continue;

    baselines[snapshot.ebayItemId] = baseline;
  }

  return baselines;
}

export async function getImportPreviewResultByItemIds(
  connection: EbayConnection,
  ebayItemIds: string[],
) {
  const { accessToken } = await getUsableEbayAccessToken(connection);
  const candidates = await getEbayTradingCandidatesByItemIds({
    accessToken,
    connection,
    itemIds: ebayItemIds,
  });

  return buildImportPreview(candidates, "live");
}

export async function getInterruptedRunningSyncJobResult(
  job: DueSyncJob,
): Promise<DueSyncJobRunResult | null> {
  const currentJob = await prisma.syncJob.findUnique({
    select: { status: true },
    where: { id: job.id },
  });

  if (currentJob?.status === SyncJobStatus.RUNNING) return null;

  return {
    errorMessage: "Job SyncBay interrotto: lo stato non è più RUNNING prima del lavoro provider.",
    jobId: job.id,
    status: "skipped",
    type: job.type,
  };
}

export async function markJobFailedOrRetrying(input: {
  errorCode: string;
  errorMessage: string;
  job: DueSyncJob;
  result?: Prisma.JsonObject;
  retryAtOverride?: Date | null;
}) {
  const nextAttempts = input.job.attempts + 1;
  const retryAt =
    input.retryAtOverride ??
    (nextAttempts < input.job.maxAttempts ? getRetryAfter(nextAttempts) : null);
  const result = {
    ...(input.result ?? {}),
    runnerErrorCode: input.errorCode,
    runnerErrorMessage: input.errorMessage,
    retryScheduledAt: retryAt?.toISOString() ?? null,
    willRetry: Boolean(retryAt),
  } satisfies Prisma.JsonObject;

  await prisma.$transaction(async (tx) => {
    const updated = await tx.syncJob.updateMany({
      data: {
        attempts: { increment: 1 },
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        finishedAt: new Date(),
        result,
        runAfter: retryAt ?? undefined,
        status: retryAt ? SyncJobStatus.RETRYING : SyncJobStatus.FAILED,
      },
      where: { id: input.job.id, status: SyncJobStatus.RUNNING },
    });

    if (updated.count !== 1) return;

    await tx.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
      data: {
        details: result,
        message: retryAt
          ? "Job SyncBay non completato; retry pianificato dal runner."
          : "Job SyncBay non completato dal runner.",
        shopId: input.job.shopId,
        type: AuditEventType.SYNC_JOB_FAILED,
      },
    });
  });
}

export async function markJobSucceeded(input: {
  job: DueSyncJob;
  result?: Prisma.JsonObject;
  warnings: string[];
}) {
  const result = {
    ...(input.result ?? {}),
    warnings: [...new Set(input.warnings)],
  } satisfies Prisma.JsonObject;

  await prisma.$transaction(async (tx) => {
    const updated = await tx.syncJob.updateMany({
      data: {
        errorCode: null,
        errorMessage: null,
        finishedAt: new Date(),
        result,
        status: SyncJobStatus.SUCCEEDED,
      },
      where: { id: input.job.id, status: SyncJobStatus.RUNNING },
    });

    if (updated.count !== 1) return;

    await tx.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
      data: {
        details: result,
        message: "Job SyncBay completato dal runner.",
        shopId: input.job.shopId,
        type: AuditEventType.SYNC_JOB_SUCCEEDED,
      },
    });
  });
}

export async function splitOversizedEbayItemJobIfNeeded(job: DueSyncJob, ebayItemIds: string[]) {
  if (ebayItemIds.length <= RUNNER_EBAY_ITEM_BATCH_SIZE) return "not_needed";

  const payload = getJsonObject(job.payload);

  if (!payload) return "not_needed";

  const splitPayloads = buildEbayItemJobSplitPayloads({
    ebayItemIds,
    maxItems: RUNNER_EBAY_ITEM_BATCH_SIZE,
    parentJobId: job.id,
    payload,
  });
  const now = new Date();
  const result = {
    requestedCount: ebayItemIds.length,
    splitBatchSize: RUNNER_EBAY_ITEM_BATCH_SIZE,
    splitJobCount: splitPayloads.length,
  } satisfies Prisma.JsonObject;

  const split = await prisma.$transaction(async (tx) => {
    const updated = await tx.syncJob.updateMany({
      data: {
        errorCode: null,
        errorMessage: null,
        finishedAt: now,
        result,
        status: SyncJobStatus.SUCCEEDED,
      },
      where: { id: job.id, status: SyncJobStatus.RUNNING },
    });

    if (updated.count !== 1) return "not_running";

    await tx.syncJob.createMany({
      data: splitPayloads.map((splitPayload, index) => ({
        attempts: 0,
        idempotencyKey: buildEbayItemJobSplitIdempotencyKey({
          parentJobId: job.id,
          payload,
          splitIndex: index + 1,
        }),
        maxAttempts: job.maxAttempts,
        payload: splitPayload as Prisma.JsonObject,
        runAfter: now,
        shopId: job.shopId,
        status: SyncJobStatus.PENDING,
        type: job.type,
      })),
      skipDuplicates: true,
    });

    await tx.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
      data: {
        details: result,
        message: "Job SyncBay spezzato in batch più piccoli per il runner automatico.",
        shopId: job.shopId,
        type: AuditEventType.SYNC_JOB_SUCCEEDED,
      },
    });

    return "split";
  });

  return split;
}

export function filterPreviewResultByItemIds(
  previewResult: ImportPreviewResult,
  ebayItemIds: string[],
): ImportPreviewResult {
  const itemsById = new Map(previewResult.items.map((item) => [item.itemId, item]));
  const items = ebayItemIds.flatMap((itemId) => {
    const item = itemsById.get(itemId);

    return item ? [item] : [];
  });

  return {
    ...previewResult,
    items,
    summary: summarizePreviewItems(items),
  };
}

export function getEbayItemIds(payload: Prisma.JsonValue | null) {
  const object = getJsonObject(payload);
  const ebayItemIds = object?.ebayItemIds;

  return Array.isArray(ebayItemIds)
    ? ebayItemIds.filter((itemId): itemId is string => typeof itemId === "string")
    : [];
}

export function getEbayMarketplaceId(payload: Prisma.JsonValue | null) {
  const object = getJsonObject(payload);
  const marketplaceId = object?.marketplaceId;

  return typeof marketplaceId === "string" && marketplaceId.trim()
    ? marketplaceId
    : DEFAULT_MARKETPLACE_ID;
}

export function getImportProductStatus(payload: Prisma.JsonValue | null) {
  const object = getJsonObject(payload);
  const importProductStatus = object?.importProductStatus;

  return normalizeImportProductStatus(
    typeof importProductStatus === "string" ? importProductStatus : undefined,
  );
}

export async function getConnectedEbayConnection(job: DueSyncJob) {
  const connection = await prisma.ebayConnection.findUnique({
    where: {
      shopId_marketplaceId: {
        marketplaceId: getEbayMarketplaceId(job.payload),
        shopId: job.shopId,
      },
    },
  });

  if (!connection || connection.status !== EbayConnectionStatus.CONNECTED) {
    throw new Error("Connessione eBay non collegata per il job SyncBay.");
  }

  return connection;
}

export async function getShopifyProductForConflict(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  productGid: string,
  defaultLocationGid: string | null,
  options: { preferredVariantGid?: string | null } = {},
) {
  const preferredVariantGid = options.preferredVariantGid?.trim() ?? "";
  const locationVariable = defaultLocationGid ? ", $locationId: ID!" : "";
  const variantVariable = preferredVariantGid ? ", $variantId: ID!" : "";
  const inventoryLevelSelection = defaultLocationGid
    ? `inventoryLevel(locationId: $locationId) {
                  quantities(names: ["available"]) {
                    name
                    quantity
                  }
                }`
    : "";
  const variantSelection = `
              id
              inventoryQuantity
              price
              compareAtPrice
              inventoryItem {
                tracked
                ${inventoryLevelSelection}
              }`;
  const mappedVariantSelection = preferredVariantGid
    ? `
      variantNode: node(id: $variantId) {
        ... on ProductVariant {
          ${variantSelection}
          product {
            id
          }
        }
      }`
    : "";
  const query = `#graphql
    query SyncBayProductForConflict($id: ID!${locationVariable}${variantVariable}) {
      productNode: node(id: $id) {
        ... on Product {
          id
          descriptionHtml
          media(first: 50) {
            nodes {
              mediaContentType
              preview {
                status
              }
            }
          }
          status
          title
          variants(first: 1) {
            nodes {
          ${variantSelection}
            }
          }
        }
      }
      ${mappedVariantSelection}
    }`;
  const variables: Record<string, unknown> = { id: productGid };

  if (defaultLocationGid) variables.locationId = defaultLocationGid;
  if (preferredVariantGid) variables.variantId = preferredVariantGid;

  const response = await admin.graphql(query, { variables });

  if (!response.ok) return null;

  const json = (await response.json()) as ShopifyProductForConflictResponse;

  if (json.errors?.length) return null;

  const product = json.data?.productNode ?? null;

  if (!product) return null;

  const preferredVariant =
    json.data?.variantNode?.product?.id === product.id ? json.data.variantNode : null;

  return {
    ...product,
    variants: {
      ...(product.variants ?? {}),
      nodes: mergePreferredShopifyVariantForSync({
        preferredVariant,
        variants: product.variants?.nodes,
      }),
    },
  };
}

export function getJsonObject(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  return value as Record<string, Prisma.JsonValue>;
}

export function getJsonNumber(value: Prisma.JsonValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getJsonString(value: Prisma.JsonValue | undefined) {
  return typeof value === "string" ? value : null;
}

export function getStringFromPayload(payload: Prisma.JsonValue | null, key: string) {
  return getJsonString(getJsonObject(payload)?.[key]);
}

export function getBooleanFromPayload(payload: Prisma.JsonValue | null, key: string) {
  const value = getJsonObject(payload)?.[key];

  return typeof value === "boolean" ? value : false;
}

export function getRetryAfter(attempts: number, from = new Date()) {
  const retryDelaySeconds = attempts <= 1 ? 60 : attempts === 2 ? 300 : 900;

  return new Date(from.getTime() + retryDelaySeconds * 1000);
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;

  return "Errore inatteso durante l'esecuzione del job SyncBay.";
}
