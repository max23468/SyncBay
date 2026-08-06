import {
  AuditEventType,
  Prisma,
  ProductMappingStatus,
  ProductSnapshotSource,
  type EbayConnection,
} from "@prisma/client";

import prisma from "../db.server";
import { chunkArray } from "../lib/chunk-array";
import { normalizeImportProductStatus } from "../lib/import-product-status";
import { SYNCBAY_AUDIT_LOG_CREATE_SELECT } from "../lib/syncbay-audit-log-write";
import { hashNullableText } from "../lib/syncbay-description-hash";
import {
  buildExistingCatalogTakeoverApplyPlan,
  buildExistingCatalogTakeoverReport,
  type ExistingCatalogTakeoverApplyRow,
} from "../lib/syncbay-existing-catalog-takeover";
import { buildShopifyProductFacetMetafields } from "../lib/syncbay-product-facets";
import { buildSyncBayProductMetafields } from "../lib/syncbay-shopify-product-metafields";
import { getEbayMarketplaceId } from "./ebay-environment.server";
import { recordProductSnapshotsInTransaction } from "./product-history.server";
import { getDraftImportLimit } from "./shopify-draft-import.server";
import {
  CATALOG_IMPORT_MAX_PRODUCTS,
  buildCatalogImportRunId,
  ensureShopForSession,
  getCatalogImportBlockers,
  getImportWizardState,
  upsertCatalogImportBatchJob,
  type ShopifyAdminGraphqlClient,
  type ShopifySessionLike,
} from "./syncbay.server";

const TAKEOVER_METAFIELDS_SET_BATCH_SIZE = 20;

interface ExistingCatalogTakeoverProductNode {
  descriptionHtml?: string | null;
  handle?: string | null;
  id: string;
  metafields?: {
    nodes?: Array<{
      key?: string | null;
      namespace?: string | null;
      value?: string | null;
    }> | null;
  } | null;
  status?: string | null;
  tags?: string[] | null;
  title?: string | null;
  variants?: {
    nodes?: Array<{
      compareAtPrice?: string | null;
      id?: string | null;
      price?: string | null;
      sku?: string | null;
    }> | null;
  } | null;
}

interface ExistingCatalogTakeoverProductsResponse {
  data?: {
    nodes?: Array<ExistingCatalogTakeoverProductNode | null> | null;
  };
  errors?: Array<{ message: string }>;
}

interface ShopifyMetafieldsSetResponse {
  data?: {
    metafieldsSet?: {
      userErrors?: Array<{
        field?: string[] | null;
        message: string;
      }> | null;
    } | null;
  };
  errors?: Array<{ message: string }>;
}

export interface ExistingCatalogTakeoverStartInput {
  admin: ShopifyAdminGraphqlClient;
  confirmation: string;
  legacyTagsToRemove?: string[];
  session: ShopifySessionLike;
}

type TakeoverWizard = Awaited<ReturnType<typeof getImportWizardState>>;
type TakeoverShop = Awaited<ReturnType<typeof ensureShopForSession>>;
type CatalogBatchResult = Awaited<ReturnType<typeof upsertCatalogImportBatchJob>>;

interface ExistingCatalogTakeoverStartPorts {
  applyClaims: typeof applyExistingCatalogTakeoverClaims;
  createRunId: typeof buildCatalogImportRunId;
  enableSync: (shopId: string) => Promise<void>;
  enqueueBatch: typeof upsertCatalogImportBatchJob;
  getDraftLimit: () => number;
  loadWizard: () => Promise<TakeoverWizard>;
  now: () => Date;
  writeAudit: (input: { details: Prisma.JsonObject; shopId: string }) => Promise<void>;
}

export async function startExistingCatalogTakeoverJobs(input: ExistingCatalogTakeoverStartInput) {
  const shop = await ensureShopForSession(input.session);
  const connection = await prisma.ebayConnection.findUnique({
    where: {
      shopId_marketplaceId: {
        marketplaceId: getEbayMarketplaceId(),
        shopId: shop.id,
      },
    },
  });

  return runExistingCatalogTakeoverStart(
    {
      admin: input.admin,
      confirmation: input.confirmation,
      connection,
      legacyTagsToRemove: input.legacyTagsToRemove ?? [],
      shop,
    },
    {
      applyClaims: applyExistingCatalogTakeoverClaims,
      createRunId: buildCatalogImportRunId,
      enableSync: async (shopId) => {
        await prisma.shop.update({
          data: { syncEnabled: true },
          where: { id: shopId },
        });
      },
      enqueueBatch: upsertCatalogImportBatchJob,
      getDraftLimit: getDraftImportLimit,
      loadWizard: () =>
        getImportWizardState(input.session, input.admin, undefined, {
          catalogMode: "existing_catalog",
          previewLoadMode: "live",
        }),
      now: () => new Date(),
      writeAudit: async ({ details, shopId }) => {
        await prisma.auditLog.create({
          select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
          data: {
            details,
            message: "Takeover catalogo esistente pianificato in batch reuse-only.",
            shopId,
            type: AuditEventType.SYNC_JOB_CREATED,
          },
        });
      },
    },
  );
}

export async function runExistingCatalogTakeoverStart(
  input: {
    admin: ShopifyAdminGraphqlClient;
    confirmation: string;
    connection: EbayConnection | null;
    legacyTagsToRemove: string[];
    shop: TakeoverShop;
  },
  ports: ExistingCatalogTakeoverStartPorts,
) {
  const blockers = [
    input.confirmation !== "COLLEGA"
      ? "Conferma takeover mancante: digita COLLEGA prima di scrivere sul catalogo esistente."
      : null,
    ...getCatalogImportBlockers({
      connection: input.connection,
      hasDefaultLocation: Boolean(input.shop.defaultLocationGid),
    }),
  ].filter((blocker): blocker is string => Boolean(blocker));

  if (blockers.length > 0) return { blockers, status: "blocked" as const };

  const wizard = await ports.loadWizard();
  const report = wizard.previewResult.existingCatalogTakeover
    ? buildExistingCatalogTakeoverReport({
        items: wizard.previewResult.items,
        legacyTagsToRemove: input.legacyTagsToRemove,
        shopDomain: wizard.previewResult.existingCatalogTakeover.shopDomain,
      })
    : null;
  const dryRunBlockers = [
    wizard.previewSource.errorMessage
      ? `Dry-run catalogo esistente non completato: ${wizard.previewSource.errorMessage}`
      : null,
    report ? null : "Dry-run catalogo esistente non disponibile.",
  ].filter((blocker): blocker is string => Boolean(blocker));

  if (dryRunBlockers.length > 0 || !report) {
    return { blockers: dryRunBlockers, status: "blocked" as const };
  }

  const applyPlan = buildExistingCatalogTakeoverApplyPlan(report);
  if (applyPlan.blockers.length > 0) {
    return { blockers: applyPlan.blockers, status: "blocked" as const };
  }

  const previewItemsByItemId = new Map(
    wizard.previewResult.items.map((item) => [item.itemId, item]),
  );
  const missingPreviewItemIds: string[] = [];
  for (const row of applyPlan.rows) {
    if (!previewItemsByItemId.has(row.itemId)) {
      missingPreviewItemIds.push(row.itemId);
    }
  }

  if (missingPreviewItemIds.length > 0) {
    return {
      blockers: [
        `${missingPreviewItemIds.length} righe applicabili non hanno più il dettaglio preview necessario all'apply.`,
      ],
      status: "blocked" as const,
    };
  }

  try {
    await ports.applyClaims({
      admin: input.admin,
      now: ports.now(),
      previewItemsByItemId,
      rows: applyPlan.rows,
      shopId: input.shop.id,
    });
  } catch (error) {
    return {
      blockers: [
        error instanceof Error
          ? error.message
          : "Takeover catalogo esistente non completato prima della coda import.",
      ],
      status: "blocked" as const,
    };
  }

  const draftLimit = ports.getDraftLimit();
  const importProductStatus = normalizeImportProductStatus(input.shop.defaultProductStatus);
  const batches = chunkArray(applyPlan.ebayItemIds, draftLimit);
  const applyRowsByItemId = new Map(applyPlan.rows.map((row) => [row.itemId, row]));
  const now = ports.now();
  const catalogImportRunId = ports.createRunId({
    now,
    shopId: input.shop.id,
  });
  const counts: Record<CatalogBatchResult, number> = {
    created: 0,
    existing: 0,
    requeued: 0,
    resumed: 0,
  };

  for (const [batchIndex, ebayItemIds] of batches.entries()) {
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- enqueue batch in serie: preserva l'ordine dei batchIndex e limita il burst di scritture job (egress).
    const result = await ports.enqueueBatch({
      batchCount: batches.length,
      batchIndex,
      catalogImportRunId,
      draftLimit,
      ebayItemIds,
      fieldPoliciesByItemId: buildExistingCatalogFieldPoliciesByItemId({
        ebayItemIds,
        rowsByItemId: applyRowsByItemId,
      }),
      importProductStatus,
      now,
      reuseOnly: true,
      shopId: input.shop.id,
      source: "existing_catalog_takeover",
      totalAvailable: wizard.previewSource.totalAvailable,
      totalPlanned: applyPlan.ebayItemIds.length,
    });
    counts[result] += 1;
  }

  await ports.enableSync(input.shop.id);

  const resultPayload = {
    batchCount: batches.length,
    catalogImportMaxProducts: CATALOG_IMPORT_MAX_PRODUCTS,
    claimedMappingCount: applyPlan.rows.length,
    createdJobCount: counts.created,
    draftLimit,
    existingJobCount: counts.existing,
    importProductStatus,
    plannedListingCount: applyPlan.ebayItemIds.length,
    readCount: wizard.previewSource.readCount,
    requeuedJobCount: counts.requeued,
    resumedJobCount: counts.resumed,
    reuseOnly: true,
    source: "existing_catalog_takeover",
    totalAvailable: wizard.previewSource.totalAvailable,
    truncatedAtMaxProducts:
      wizard.previewSource.totalAvailable !== null
        ? wizard.previewSource.totalAvailable > wizard.previewResult.items.length
        : wizard.previewResult.items.length >= CATALOG_IMPORT_MAX_PRODUCTS,
  } satisfies Prisma.JsonObject;

  await ports.writeAudit({ details: resultPayload, shopId: input.shop.id });

  return { ...resultPayload, blockers: [], status: "queued" as const };
}

export async function applyExistingCatalogTakeoverClaims(
  input: {
    admin: ShopifyAdminGraphqlClient;
    now: Date;
    previewItemsByItemId: Map<string, TakeoverWizard["previewResult"]["items"][number]>;
    rows: ExistingCatalogTakeoverApplyRow[];
    shopId: string;
  },
  ports: ExistingCatalogTakeoverClaimPorts = defaultClaimPorts,
) {
  const productGids = [...new Set(input.rows.map((row) => row.productGid))];
  const productsById = await ports.loadProducts(input.admin, productGids);
  const missingProductGids = productGids.filter((productGid) => !productsById.has(productGid));

  if (missingProductGids.length > 0) {
    throw new Error(
      `${missingProductGids.length} prodotti Shopify applicabili non sono più leggibili prima del takeover.`,
    );
  }

  const snapshots = input.rows.map((row) =>
    buildExistingCatalogTakeoverShopifySnapshot({
      now: input.now,
      product: productsById.get(row.productGid)!,
      row,
      shopId: input.shopId,
    }),
  );

  if (snapshots.length > 0) {
    await ports.recordSnapshots(snapshots);
    await ports.writeSnapshotAudit({
      claimedRows: input.rows.length,
      shopId: input.shopId,
    });
  }

  await ports.writeMetafields(input.admin, {
    previewItemsByItemId: input.previewItemsByItemId,
    rows: input.rows,
  });
  await ports.upsertMappings({
    previewItemsByItemId: input.previewItemsByItemId,
    rows: input.rows,
    shopId: input.shopId,
  });
}

interface ExistingCatalogTakeoverClaimPorts {
  loadProducts: typeof loadExistingCatalogTakeoverProducts;
  recordSnapshots: (snapshots: Prisma.ProductSnapshotCreateManyInput[]) => Promise<void>;
  upsertMappings: typeof upsertExistingCatalogTakeoverMappings;
  writeMetafields: typeof applyExistingCatalogTakeoverMetafields;
  writeSnapshotAudit: (input: { claimedRows: number; shopId: string }) => Promise<void>;
}

const defaultClaimPorts: ExistingCatalogTakeoverClaimPorts = {
  loadProducts: loadExistingCatalogTakeoverProducts,
  recordSnapshots: async (snapshots) => {
    await prisma.$transaction((tx) => recordProductSnapshotsInTransaction(tx, snapshots));
  },
  upsertMappings: upsertExistingCatalogTakeoverMappings,
  writeMetafields: applyExistingCatalogTakeoverMetafields,
  writeSnapshotAudit: async ({ claimedRows, shopId }) => {
    await prisma.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
      data: {
        details: { claimedRows, source: "existing_catalog_takeover" },
        message: "Snapshot Shopify pre-claim registrato per takeover catalogo esistente.",
        shopId,
        type: AuditEventType.SYNC_JOB_CREATED,
      },
    });
  },
};

async function upsertExistingCatalogTakeoverMappings(input: {
  previewItemsByItemId: Map<string, TakeoverWizard["previewResult"]["items"][number]>;
  rows: ExistingCatalogTakeoverApplyRow[];
  shopId: string;
}) {
  for (const rows of chunkArray(input.rows, 100)) {
    await prisma.$transaction(
      rows.map((row) => {
        const previewItem = input.previewItemsByItemId.get(row.itemId);
        return prisma.productMapping.upsert({
          where: {
            shopId_marketplaceId_ebayItemId: {
              ebayItemId: row.itemId,
              marketplaceId: getEbayMarketplaceId(),
              shopId: input.shopId,
            },
          },
          create: {
            ebayItemId: row.itemId,
            marketplaceId: getEbayMarketplaceId(),
            shopId: input.shopId,
            shopifyProductGid: row.productGid,
            shopifyVariantGid: row.variantGid,
            sku: row.sku,
            status: ProductMappingStatus.ACTIVE,
            thumbnailUrl: previewItem?.normalized.imageUrls[0] ?? null,
          },
          update: {
            lastErrorCode: null,
            lastErrorMessage: null,
            shopifyProductGid: row.productGid,
            shopifyVariantGid: row.variantGid,
            sku: row.sku,
            status: ProductMappingStatus.ACTIVE,
            ...(previewItem?.normalized.imageUrls[0]
              ? { thumbnailUrl: previewItem.normalized.imageUrls[0] }
              : {}),
          },
        });
      }),
    );
  }
}

async function loadExistingCatalogTakeoverProducts(
  admin: ShopifyAdminGraphqlClient,
  productGids: string[],
) {
  const productsById = new Map<string, ExistingCatalogTakeoverProductNode>();

  for (const ids of chunkArray([...new Set(productGids)], 100)) {
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- lettura Shopify Admin GraphQL rate-limited: in serie per rispettare i limiti di costo del provider.
    const response = await admin.graphql(
      `#graphql
      query SyncBayExistingCatalogTakeoverProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            descriptionHtml
            handle
            status
            tags
            title
            metafields(first: 20, namespace: "syncbay") {
              nodes { key namespace value }
            }
            variants(first: 100) {
              nodes { compareAtPrice id price sku }
            }
          }
        }
      }`,
      { variables: { ids } },
    );
    const json = (await response.json()) as ExistingCatalogTakeoverProductsResponse;

    if (!response.ok) {
      throw new Error(
        `Shopify lettura prodotti takeover ha risposto con stato HTTP ${response.status}.`,
      );
    }
    if (json.errors?.length) throw new Error(formatGraphqlErrors(json.errors));

    for (const product of json.data?.nodes ?? []) {
      if (product?.id) productsById.set(product.id, product);
    }
  }

  return productsById;
}

export function buildExistingCatalogTakeoverShopifySnapshot(input: {
  now: Date;
  product: ExistingCatalogTakeoverProductNode;
  row: ExistingCatalogTakeoverApplyRow;
  shopId: string;
}): Prisma.ProductSnapshotCreateManyInput {
  const variant = getExistingCatalogTakeoverVariant(input.product, input.row);
  const priceAmount = parseNullableMoneyAmount(variant?.price);

  return {
    capturedAt: input.now,
    currency: null,
    descriptionHash: hashNullableText(input.product.descriptionHtml),
    ebayItemId: input.row.itemId,
    imageCount: null,
    payload: {
      handle: input.product.handle ?? null,
      metafields: input.product.metafields?.nodes ?? [],
      source: "existing_catalog_takeover_pre_claim",
      tags: input.product.tags ?? [],
      variantGid: variant?.id ?? input.row.variantGid,
      variants: input.product.variants?.nodes ?? [],
    } satisfies Prisma.JsonObject,
    priceAmount,
    productStatus: input.product.status ?? null,
    quantity: null,
    shopId: input.shopId,
    shopifyProductGid: input.product.id,
    shopifyVariantGid: variant?.id ?? input.row.variantGid,
    sku: input.row.sku ?? variant?.sku ?? null,
    source: ProductSnapshotSource.SHOPIFY,
    title: input.product.title ?? null,
  };
}

function getExistingCatalogTakeoverVariant(
  product: ExistingCatalogTakeoverProductNode,
  row: ExistingCatalogTakeoverApplyRow,
) {
  const variants = product.variants?.nodes ?? [];
  return variants.find((variant) => variant.id === row.variantGid) ?? variants[0] ?? null;
}

async function applyExistingCatalogTakeoverMetafields(
  admin: ShopifyAdminGraphqlClient,
  input: {
    previewItemsByItemId: Map<string, TakeoverWizard["previewResult"]["items"][number]>;
    rows: ExistingCatalogTakeoverApplyRow[];
  },
) {
  const metafields = input.rows.flatMap((row) => {
    const item = input.previewItemsByItemId.get(row.itemId);
    if (!item) return [];
    return buildExistingCatalogTakeoverMetafields(item).map((metafield) => ({
      ...metafield,
      ownerId: row.productGid,
    }));
  });

  for (const metafieldBatch of chunkArray(metafields, TAKEOVER_METAFIELDS_SET_BATCH_SIZE)) {
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- mutation Shopify Admin GraphQL rate-limited: in serie per rispettare i limiti di costo del provider.
    const response = await admin.graphql(
      `#graphql
      mutation SyncBayExistingCatalogTakeoverMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      { variables: { metafields: metafieldBatch } },
    );
    const json = (await response.json()) as ShopifyMetafieldsSetResponse;

    if (!response.ok) {
      throw new Error(
        `Shopify metafieldsSet takeover ha risposto con stato HTTP ${response.status}.`,
      );
    }
    if (json.errors?.length) throw new Error(formatGraphqlErrors(json.errors));

    const userErrors = json.data?.metafieldsSet?.userErrors ?? [];
    if (userErrors.length > 0) {
      throw new Error(
        userErrors
          .map((error) =>
            error.field?.length ? `${error.field.join(".")}: ${error.message}` : error.message,
          )
          .join("; "),
      );
    }
  }
}

function buildExistingCatalogTakeoverMetafields(
  item: TakeoverWizard["previewResult"]["items"][number],
) {
  return [
    ...buildSyncBayProductMetafields({
      ebayItemId: item.itemId,
      ebayPrimaryCategoryId: item.normalized.ebayPrimaryCategoryId,
      ebayPrimaryCategoryName: item.normalized.ebayPrimaryCategoryName,
      ebayPrimaryCategoryPath: item.normalized.ebayPrimaryCategoryPath,
      priceAmount: item.normalized.priceAmount,
      quantity: item.normalized.quantity,
      sku: item.normalized.sku,
      skuGenerated: item.normalized.skuGenerated,
      storeCategoryId: item.normalized.storeCategoryId,
      storeCategoryName: item.normalized.storeCategoryName,
    }),
    ...buildShopifyProductFacetMetafields(item.normalized.productFacets),
  ];
}

export function buildExistingCatalogFieldPoliciesByItemId(input: {
  ebayItemIds: string[];
  rowsByItemId: Map<string, ExistingCatalogTakeoverApplyRow>;
}) {
  return Object.fromEntries(
    input.ebayItemIds.flatMap((itemId) => {
      const row = input.rowsByItemId.get(itemId);
      return row ? [[itemId, row.fieldPolicy]] : [];
    }),
  );
}

function parseNullableMoneyAmount(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatGraphqlErrors(errors: Array<{ message: string }>) {
  return errors.map((error) => error.message).join("; ");
}
