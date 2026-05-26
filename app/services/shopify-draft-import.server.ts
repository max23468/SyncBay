import { createHash } from "node:crypto";

import {
  AuditEventType,
  Prisma,
  ProductMappingStatus,
  ProductSnapshotSource,
  SyncJobStatus,
  SyncJobType,
} from "@prisma/client";

import prisma from "../db.server";
import type {
  ImportPreviewItem,
  ImportPreviewResult,
} from "./import-preview.server";

interface ShopifyAdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

interface ShopifyProductCreateResponse {
  data?: {
    productCreate?: {
      product?: {
        id: string;
        title: string;
      } | null;
      userErrors?: Array<{
        field?: string[] | null;
        message: string;
      }>;
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

interface ShopifyProductLookupResponse {
  data?: {
    productByHandle?: ShopifyDraftProductLookupNode | null;
    products?: {
      nodes?: ShopifyDraftProductLookupNode[];
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

interface ShopifyDraftProductLookupNode {
  id: string;
  title: string;
  metafield?: {
    value: string;
  } | null;
}

export type ShopifyDraftImportStatus = "blocked" | "created" | "failed";

type ShopifyDraftProductInput = ReturnType<
  typeof buildShopifyDraftProductInputs
>[number];
type ShopifyCreatedProduct = NonNullable<
  NonNullable<ShopifyProductCreateResponse["data"]>["productCreate"]
>["product"];
type DraftImportPersistenceResult = {
  createdCount: number;
  managedCount: number;
  reusedCount: number;
};
const DRAFT_PRODUCT_CREATE_CONCURRENCY = 2;
const DEFAULT_DRAFT_IMPORT_LIMIT = 3;
const MAX_DRAFT_IMPORT_LIMIT = 50;
const MAX_DRAFT_MEDIA_PER_PRODUCT = 3;
const DRAFT_IMPORT_MAX_ATTEMPTS = 3;
const DEFAULT_MARKETPLACE_ID = "EBAY_IT";

type ShopifyDraftProductResult =
  | {
      product: NonNullable<ShopifyCreatedProduct>;
      resultType: "created" | "reused";
      status: "created";
      warnings?: string[];
    }
  | {
      errorMessage: string;
      status: "failed";
    };

export function getDraftImportReadiness(input: {
  hasDefaultLocation: boolean;
  previewResult: ImportPreviewResult;
}) {
  const enabled = process.env.SYNCBAY_DRAFT_IMPORT_ENABLED === "true";
  const draftLimit = getDraftImportLimit();
  const importableItems = getImportablePreviewItems(input.previewResult);
  const plannedCreateCount = Math.min(importableItems.length, draftLimit);
  const blockers = [
    !enabled ? "import Shopify draft non abilitato" : null,
    !input.hasDefaultLocation
      ? "location Shopify predefinita non confermata"
      : null,
    importableItems.length === 0
      ? "nessun prodotto importabile nella preview"
      : null,
  ].filter((blocker): blocker is string => Boolean(blocker));

  return {
    blockers,
    draftLimit,
    enabled,
    importableCount: importableItems.length,
    plannedCreateCount,
    nextAction:
      blockers.length > 0
        ? "Completa i blocchi prima di creare bozze Shopify."
        : `Pronto per creare o riusare fino a ${plannedCreateCount} bozze Shopify dietro conferma esplicita.`,
  };
}

export function buildShopifyDraftProductInputs(
  previewResult: ImportPreviewResult,
) {
  return getImportablePreviewItems(previewResult)
    .slice(0, getDraftImportLimit())
    .map((item) => ({
      media: item.normalized.imageUrls
        .slice(0, MAX_DRAFT_MEDIA_PER_PRODUCT)
        .map((imageUrl) => ({
          alt: item.normalized.title,
          mediaContentType: "IMAGE",
          originalSource: imageUrl,
        })),
      product: {
        descriptionHtml: item.normalized.descriptionHtml ?? undefined,
        handle: buildSyncBayProductHandle(item.itemId),
        metafields: buildSyncBayProductMetafields(item),
        status: "DRAFT",
        tags: ["SyncBay", "Import preview", "eBay import pilot"],
        title: item.normalized.title,
      },
      source: {
        ebayItemId: item.itemId,
      },
      previewItem: item,
    }));
}

export async function createShopifyDraftProductsIfEnabled(input: {
  admin: ShopifyAdminGraphqlClient;
  hasDefaultLocation: boolean;
  previewResult: ImportPreviewResult;
  shopDomain: string;
}) {
  const readiness = getDraftImportReadiness({
    hasDefaultLocation: input.hasDefaultLocation,
    previewResult: input.previewResult,
  });

  if (readiness.blockers.length > 0) {
    return {
      createdProducts: [],
      jobId: null,
      readiness,
      status: "blocked" as const,
    };
  }

  const shop = await ensureDraftImportShop(input.shopDomain);
  const draftProducts = buildShopifyDraftProductInputs(input.previewResult);
  const job = await startDraftImportJob({
    draftLimit: readiness.draftLimit,
    previewMode: input.previewResult.mode,
    products: draftProducts,
    shopId: shop.id,
  });
  const results = await mapWithConcurrency(
    draftProducts,
    DRAFT_PRODUCT_CREATE_CONCURRENCY,
    (product) => createShopifyDraftProductSafely(input.admin, product),
  );
  const createdProducts = results.flatMap((result) =>
    result.status === "created" ? [result.product] : [],
  );
  const warnings = results.flatMap((result) =>
    result.status === "created" ? (result.warnings ?? []) : [],
  );
  const failedResult = results.find(
    (
      result,
    ): result is Extract<ShopifyDraftProductResult, { status: "failed" }> =>
      result.status === "failed",
  );
  const persistenceResult = await recordDraftImportPersistence({
    jobId: job.id,
    products: draftProducts,
    results,
    shopId: shop.id,
  });

  if (failedResult) {
    await finishDraftImportJob({
      errorMessage: failedResult.errorMessage,
      jobId: job.id,
      persistenceResult,
      products: draftProducts,
      results,
      shopId: shop.id,
      status: "failed",
      warnings,
    });

    return {
      createdProducts,
      errorMessage: failedResult.errorMessage,
      jobId: job.id,
      readiness,
      status: "failed" as const,
      warnings,
    };
  }

  await finishDraftImportJob({
    jobId: job.id,
    persistenceResult,
    products: draftProducts,
    results,
    shopId: shop.id,
    status: "created",
    warnings,
  });

  return {
    createdProducts,
    jobId: job.id,
    readiness,
    status: "created" as const,
    warnings,
  };
}

async function createShopifyDraftProduct(
  admin: ShopifyAdminGraphqlClient,
  draftProduct: ShopifyDraftProductInput,
): Promise<ShopifyDraftProductResult> {
  const existingProduct = await findExistingSyncBayDraftProduct(
    admin,
    draftProduct,
  );

  if (existingProduct) {
    return {
      product: existingProduct,
      resultType: "reused",
      status: "created",
      warnings: [
        "SyncBay ha riusato bozze Shopify già presenti per lo stesso eBay ItemID e non ha creato duplicati.",
      ],
    };
  }

  const resultWithMedia = await createShopifyDraftProductRequest(
    admin,
    draftProduct,
  );

  if (resultWithMedia.status === "created" || draftProduct.media.length === 0) {
    return resultWithMedia;
  }

  const resultWithoutMedia = await createShopifyDraftProductRequest(admin, {
    ...draftProduct,
    media: [],
  });

  if (resultWithoutMedia.status === "created") {
    return {
      ...resultWithoutMedia,
      warnings: [
        "Shopify ha creato alcune bozze senza immagini perché le URL media esterne sono state rifiutate.",
      ],
    };
  }

  return resultWithMedia;
}

async function createShopifyDraftProductSafely(
  admin: ShopifyAdminGraphqlClient,
  draftProduct: ShopifyDraftProductInput,
): Promise<ShopifyDraftProductResult> {
  try {
    return await createShopifyDraftProduct(admin, draftProduct);
  } catch (error) {
    return {
      errorMessage: getErrorMessage(error),
      status: "failed",
    };
  }
}

async function createShopifyDraftProductRequest(
  admin: ShopifyAdminGraphqlClient,
  draftProduct: ShopifyDraftProductInput,
): Promise<ShopifyDraftProductResult> {
  const response = await admin.graphql(
    `#graphql
    mutation SyncBayCreateDraftProduct($media: [CreateMediaInput!], $product: ProductCreateInput!) {
      productCreate(product: $product, media: $media) {
        product {
          id
          title
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        media: draftProduct.media,
        product: draftProduct.product,
      },
    },
  );
  const json = (await response.json()) as ShopifyProductCreateResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: json.errors.map((error) => error.message).join("; "),
      status: "failed",
    };
  }

  const userErrors = json.data?.productCreate?.userErrors ?? [];
  const createdProduct = json.data?.productCreate?.product;

  if (userErrors.length > 0) {
    if (createdProduct) {
      return {
        product: createdProduct,
        resultType: "created",
        status: "created",
        warnings: [
          `Shopify ha creato la bozza con avvisi: ${userErrors
            .map((error) => error.message)
            .join("; ")}`,
        ],
      };
    }

    return {
      errorMessage: userErrors.map((error) => error.message).join("; "),
      status: "failed",
    };
  }

  if (!createdProduct) {
    return {
      errorMessage: "Shopify non ha restituito il prodotto draft creato.",
      status: "failed",
    };
  }

  return {
    product: createdProduct,
    resultType: "created",
    status: "created",
  };
}

async function findExistingSyncBayDraftProduct(
  admin: ShopifyAdminGraphqlClient,
  draftProduct: ShopifyDraftProductInput,
) {
  const response = await admin.graphql(
    `#graphql
    query SyncBayFindDraftProduct($handle: String!, $query: String!) {
      productByHandle(handle: $handle) {
        id
        title
        metafield(namespace: "syncbay", key: "ebay_item_id") {
          value
        }
      }
      products(first: 250, query: $query) {
        nodes {
          id
          title
          metafield(namespace: "syncbay", key: "ebay_item_id") {
            value
          }
        }
      }
    }`,
    {
      variables: {
        handle: draftProduct.product.handle,
        query: "tag:SyncBay",
      },
    },
  );

  if (!response.ok) return null;

  const json = (await response.json()) as ShopifyProductLookupResponse;

  if (json.errors?.length) return null;

  const products = [
    json.data?.productByHandle ?? null,
    ...(json.data?.products?.nodes ?? []),
  ].filter((product): product is ShopifyDraftProductLookupNode =>
    Boolean(product),
  );

  return (
    products.find(
      (product) =>
        product.metafield?.value === draftProduct.source.ebayItemId ||
        product.id === json.data?.productByHandle?.id,
    ) ?? null
  );
}

async function ensureDraftImportShop(shopDomain: string) {
  return prisma.shop.upsert({
    where: { shopDomain },
    create: {
      shopDomain,
    },
    update: {},
  });
}

async function startDraftImportJob(input: {
  draftLimit: number;
  previewMode: ImportPreviewResult["mode"];
  products: ShopifyDraftProductInput[];
  shopId: string;
}) {
  const now = new Date();
  const payload = buildDraftImportJobPayload(input);
  const idempotencyKey = buildDraftImportJobIdempotencyKey(input);
  const job = await prisma.syncJob.upsert({
    where: { idempotencyKey },
    create: {
      attempts: 1,
      idempotencyKey,
      maxAttempts: DRAFT_IMPORT_MAX_ATTEMPTS,
      payload,
      runAfter: now,
      shopId: input.shopId,
      startedAt: now,
      status: SyncJobStatus.RUNNING,
      type: SyncJobType.IMPORT_CATALOG,
    },
    update: {
      attempts: { increment: 1 },
      errorCode: null,
      errorMessage: null,
      finishedAt: null,
      maxAttempts: DRAFT_IMPORT_MAX_ATTEMPTS,
      payload,
      result: Prisma.DbNull,
      runAfter: now,
      startedAt: now,
      status: SyncJobStatus.RUNNING,
    },
  });

  await prisma.auditLog.create({
    data: {
      details: payload,
      message: "Import draft Shopify avviato.",
      shopId: input.shopId,
      type: AuditEventType.SYNC_JOB_CREATED,
    },
  });

  return job;
}

async function recordDraftImportPersistence(input: {
  jobId: string;
  products: ShopifyDraftProductInput[];
  results: ShopifyDraftProductResult[];
  shopId: string;
}): Promise<DraftImportPersistenceResult> {
  const successfulPairs = input.results.flatMap((result, index) =>
    result.status === "created"
      ? [
          {
            draftProduct: input.products[index],
            result,
          },
        ]
      : [],
  );

  await prisma.$transaction(async (tx) => {
    for (const pair of successfulPairs) {
      const now = new Date();
      const mapping = await tx.productMapping.upsert({
        where: {
          shopId_marketplaceId_ebayItemId: {
            ebayItemId: pair.draftProduct.source.ebayItemId,
            marketplaceId: getEbayMarketplaceId(),
            shopId: input.shopId,
          },
        },
        create: {
          ebayItemId: pair.draftProduct.source.ebayItemId,
          lastSyncedAt: now,
          marketplaceId: getEbayMarketplaceId(),
          shopId: input.shopId,
          shopifyProductGid: pair.result.product.id,
          sku: pair.draftProduct.previewItem.normalized.sku,
          status: ProductMappingStatus.ACTIVE,
        },
        update: {
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncedAt: now,
          shopifyProductGid: pair.result.product.id,
          sku: pair.draftProduct.previewItem.normalized.sku,
          status: ProductMappingStatus.ACTIVE,
        },
      });

      await tx.productSnapshot.createMany({
        data: [
          buildEbayProductSnapshot({
            draftProduct: pair.draftProduct,
            mappingId: mapping.id,
            shopId: input.shopId,
          }),
          buildSyncBayProductSnapshot({
            draftProduct: pair.draftProduct,
            jobId: input.jobId,
            mappingId: mapping.id,
            result: pair.result,
            shopId: input.shopId,
          }),
        ],
      });
    }
  });

  return {
    createdCount: successfulPairs.filter(
      (pair) => pair.result.resultType === "created",
    ).length,
    managedCount: successfulPairs.length,
    reusedCount: successfulPairs.filter(
      (pair) => pair.result.resultType === "reused",
    ).length,
  };
}

async function finishDraftImportJob(input: {
  errorMessage?: string;
  jobId: string;
  persistenceResult: DraftImportPersistenceResult;
  products: ShopifyDraftProductInput[];
  results: ShopifyDraftProductResult[];
  shopId: string;
  status: "created" | "failed";
  warnings: string[];
}) {
  const failedResults = input.results.flatMap((result, index) =>
    result.status === "failed"
      ? [
          {
            ebayItemId: input.products[index]?.source.ebayItemId ?? null,
            errorMessage: result.errorMessage,
          },
        ]
      : [],
  );
  const resultPayload = {
    createdCount: input.persistenceResult.createdCount,
    failedResults,
    managedCount: input.persistenceResult.managedCount,
    requestedCount: input.products.length,
    reusedCount: input.persistenceResult.reusedCount,
    warnings: [...new Set(input.warnings)],
  } satisfies Prisma.JsonObject;
  const success = input.status === "created";
  const job = await prisma.syncJob.findUnique({
    where: { id: input.jobId },
  });
  const retryAt =
    !success && job && job.attempts < job.maxAttempts
      ? getDraftImportRetryAfter(job.attempts)
      : null;
  const finalResultPayload = {
    ...resultPayload,
    retryScheduledAt: retryAt?.toISOString() ?? null,
    willRetry: Boolean(retryAt),
  } satisfies Prisma.JsonObject;

  await prisma.$transaction([
    prisma.syncJob.update({
      data: {
        errorCode: success ? null : "SHOPIFY_DRAFT_IMPORT_FAILED",
        errorMessage: success ? null : input.errorMessage,
        finishedAt: new Date(),
        result: finalResultPayload,
        runAfter: retryAt ?? undefined,
        status: success
          ? SyncJobStatus.SUCCEEDED
          : retryAt
            ? SyncJobStatus.RETRYING
            : SyncJobStatus.FAILED,
      },
      where: { id: input.jobId },
    }),
    prisma.auditLog.create({
      data: {
        details: finalResultPayload,
        message: success
          ? "Import draft Shopify completato."
          : retryAt
            ? "Import draft Shopify non completato; retry pianificato."
            : "Import draft Shopify non completato.",
        shopId: input.shopId,
        type: success
          ? AuditEventType.SYNC_JOB_SUCCEEDED
          : AuditEventType.SYNC_JOB_FAILED,
      },
    }),
  ]);
}

function getDraftImportRetryAfter(attempts: number) {
  const retryDelaySeconds = attempts <= 1 ? 60 : attempts === 2 ? 300 : 900;

  return new Date(Date.now() + retryDelaySeconds * 1000);
}

function buildEbayProductSnapshot(input: {
  draftProduct: ShopifyDraftProductInput;
  mappingId: string;
  shopId: string;
}) {
  const item = input.draftProduct.previewItem;

  return {
    descriptionHash: hashNullableText(item.normalized.descriptionHtml),
    ebayItemId: item.itemId,
    imageCount: item.normalized.imageCount,
    mappingId: input.mappingId,
    payload: buildEbaySnapshotPayload(item),
    priceAmount: item.normalized.priceAmount,
    quantity: item.normalized.quantity,
    shopId: input.shopId,
    sku: item.normalized.sku,
    source: ProductSnapshotSource.EBAY,
    title: item.normalized.title,
  };
}

function buildSyncBayProductSnapshot(input: {
  draftProduct: ShopifyDraftProductInput;
  jobId: string;
  mappingId: string;
  result: Extract<ShopifyDraftProductResult, { status: "created" }>;
  shopId: string;
}) {
  const item = input.draftProduct.previewItem;

  return {
    descriptionHash: hashNullableText(item.normalized.descriptionHtml),
    ebayItemId: item.itemId,
    imageCount: input.draftProduct.media.length,
    mappingId: input.mappingId,
    payload: {
      handle: input.draftProduct.product.handle,
      importJobId: input.jobId,
      resultType: input.result.resultType,
      tags: input.draftProduct.product.tags,
    } satisfies Prisma.JsonObject,
    priceAmount: item.normalized.priceAmount,
    productStatus: "DRAFT",
    quantity: item.normalized.quantity,
    shopId: input.shopId,
    shopifyProductGid: input.result.product.id,
    sku: item.normalized.sku,
    source: ProductSnapshotSource.SYNCBAY,
    title: input.result.product.title,
  };
}

function buildEbaySnapshotPayload(item: ImportPreviewItem) {
  return {
    descriptionMode: item.normalized.descriptionMode,
    issueCodes: item.issues.map((issue) => issue.code),
    skuGenerated: item.normalized.skuGenerated,
    status: item.status,
  } satisfies Prisma.JsonObject;
}

function buildDraftImportJobPayload(input: {
  draftLimit: number;
  previewMode: ImportPreviewResult["mode"];
  products: ShopifyDraftProductInput[];
  shopId: string;
}) {
  return {
    draftLimit: input.draftLimit,
    ebayItemIds: input.products.map((product) => product.source.ebayItemId),
    marketplaceId: getEbayMarketplaceId(),
    previewMode: input.previewMode,
    requestedCount: input.products.length,
    shopId: input.shopId,
  } satisfies Prisma.JsonObject;
}

function buildDraftImportJobIdempotencyKey(input: {
  previewMode: ImportPreviewResult["mode"];
  products: ShopifyDraftProductInput[];
  shopId: string;
}) {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        ebayItemIds: input.products.map((product) => product.source.ebayItemId),
        marketplaceId: getEbayMarketplaceId(),
        previewMode: input.previewMode,
        shopId: input.shopId,
      }),
    )
    .digest("hex")
    .slice(0, 20);

  return `draft-import:${input.shopId}:${hash}`;
}

function hashNullableText(value: string | null) {
  if (!value) return null;

  return createHash("sha256").update(value).digest("hex");
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;

  return "Errore inatteso durante l'import draft Shopify.";
}

function getEbayMarketplaceId() {
  return process.env.EBAY_MARKETPLACE_ID ?? DEFAULT_MARKETPLACE_ID;
}

async function mapWithConcurrency<Input, Output>(
  items: Input[],
  concurrency: number,
  mapper: (item: Input) => Promise<Output>,
) {
  const results = new Array<Output>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  const runNext = (): Promise<void> => {
    const currentIndex = nextIndex;
    nextIndex += 1;

    if (currentIndex >= items.length) {
      return Promise.resolve();
    }

    return mapper(items[currentIndex]).then((result) => {
      results[currentIndex] = result;
      return runNext();
    });
  };

  await Promise.all(Array.from({ length: workerCount }, () => runNext()));

  return results;
}

function getImportablePreviewItems(previewResult: ImportPreviewResult) {
  return previewResult.items.filter(isImportablePreviewItem);
}

function isImportablePreviewItem(item: ImportPreviewItem) {
  return item.status === "importable";
}

function buildSyncBayProductMetafields(item: ImportPreviewItem) {
  return [
    {
      key: "ebay_item_id",
      namespace: "syncbay",
      type: "single_line_text_field",
      value: item.itemId,
    },
    item.normalized.sku
      ? {
          key: "ebay_sku",
          namespace: "syncbay",
          type: "single_line_text_field",
          value: item.normalized.sku,
        }
      : null,
    item.normalized.priceAmount !== null
      ? {
          key: "ebay_price",
          namespace: "syncbay",
          type: "single_line_text_field",
          value: String(item.normalized.priceAmount),
        }
      : null,
    item.normalized.quantity !== null
      ? {
          key: "ebay_quantity",
          namespace: "syncbay",
          type: "single_line_text_field",
          value: String(item.normalized.quantity),
        }
      : null,
    item.normalized.skuGenerated
      ? {
          key: "sku_policy",
          namespace: "syncbay",
          type: "single_line_text_field",
          value: "generated_from_ebay_item_id",
        }
      : null,
  ].filter((metafield): metafield is NonNullable<typeof metafield> =>
    Boolean(metafield),
  );
}

function buildSyncBayProductHandle(ebayItemId: string) {
  return `syncbay-ebay-${ebayItemId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

function getDraftImportLimit() {
  const parsed = Number.parseInt(
    process.env.SYNCBAY_DRAFT_IMPORT_LIMIT ?? "",
    10,
  );

  if (!Number.isInteger(parsed)) return DEFAULT_DRAFT_IMPORT_LIMIT;

  return Math.min(Math.max(parsed, 1), MAX_DRAFT_IMPORT_LIMIT);
}
