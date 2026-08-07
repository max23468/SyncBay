import { Prisma, ProductMappingStatus, SyncConflictStatus } from "@prisma/client";
import prisma from "../db.server";
import { chunkArray } from "../lib/chunk-array";
import {
  CATALOG_PAGE_SIZE,
  catalogRowMatchesSearch,
  getCatalogPageWindow,
  getCatalogQueryPlan,
  isCatalogRowNeedingCheck,
  type CatalogPageFilter,
  type CatalogSortDir,
  type CatalogSortKey,
} from "../lib/syncbay-catalog-page";
import { getCompletedCatalogVerificationJobWhere } from "../lib/syncbay-catalog-verification-job";
import { summarizeConflictDecisionModes } from "../lib/syncbay-conflict-actions";
import { formatConflictValueForDisplay } from "../lib/syncbay-conflict-display";
import {
  CONFLICT_PAGE_SIZE,
  getConflictStatusFilter,
  type ConflictFilter,
} from "../lib/syncbay-conflicts-page";
import {
  measureSyncBayPerformanceStage,
  type SyncBayLoaderPerformanceTrace,
} from "../lib/syncbay-loader-performance";
import { getPageWindow } from "../lib/syncbay-pagination";
import { mergeProductDisplayBaselineWithSnapshot } from "../lib/syncbay-product-baseline";
import { getShopifyProductThumbnailUrl } from "../lib/syncbay-shopify-product-thumbnail";
import {
  readFreshThumbnailCacheEntries,
  writeThumbnailCacheEntries,
  type ThumbnailCacheEntry,
} from "../lib/syncbay-thumbnail-cache";
import {
  getCatalogRowStatus,
  isCatalogMappingStale,
  type CatalogAvailabilityKind,
  type CatalogStatusKind,
} from "../lib/syncbay-ui-state";
import { getEbayMarketplaceId } from "./ebay-environment.server";
import { getShopifyAdminGraphqlClient } from "./shopify-admin-session.server";

import { CATALOG_IMPORT_MAX_PRODUCTS } from "./syncbay-import.server";
import { ensureShopForSession } from "./syncbay-operations.server";
import { ShopifySessionLike, getCatalogSummaryCounts } from "./syncbay-shared.server";

type LatestProductSnapshotForDisplay = {
  capturedAt: Date;
  currency: string | null;
  mappingId: string | null;
  priceAmount: Prisma.Decimal | null;
  productStatus: string | null;
  quantity: number | null;
  sku: string | null;
  title: string | null;
};

const SHOPIFY_THUMBNAIL_CACHE_TTL_MS = 5 * 60 * 1000;

const shopifyThumbnailCache = new Map<string, ThumbnailCacheEntry>();

/**
 * Aggrega l'affidabilità del servizio sugli ultimi 7 giorni a partire dai job
 * realmente registrati: totale, riusciti, tasso e serie giornaliera per la
 * sparkline. Nessun dato sintetico: se non ci sono job, la finestra è vuota.
 */
export async function getCatalogPageState(
  session: ShopifySessionLike,
  input: {
    filter?: CatalogPageFilter;
    page?: number;
    search?: string;
    sort?: CatalogSortKey | null;
    sortDir?: CatalogSortDir;
  } = {},
  trace?: SyncBayLoaderPerformanceTrace,
) {
  const shop = await measureSyncBayPerformanceStage(trace, "catalog.shop.ensure", () =>
    ensureShopForSession(session),
  );
  const activeFilter = input.filter ?? "all";
  const activePage = input.page ?? 1;
  const activeSearch = input.search ?? "";
  const activeSort = input.sort ?? null;
  const activeSortDir = input.sortDir ?? "asc";
  const where = {
    marketplaceId: getEbayMarketplaceId(),
    shopId: shop.id,
  };
  const totalAvailableCount = await measureSyncBayPerformanceStage(
    trace,
    "catalog.db.totalAvailableCount",
    () => prisma.productMapping.count({ where }),
  );
  const databasePageWhere =
    !activeSearch.trim() && !activeSort ? getCatalogDatabasePageWhere(where, activeFilter) : null;
  const databasePageTotalCount = databasePageWhere
    ? databasePageWhere === where
      ? totalAvailableCount
      : await measureSyncBayPerformanceStage(trace, "catalog.db.databasePageTotalCount", () =>
          prisma.productMapping.count({ where: databasePageWhere }),
        )
    : totalAvailableCount;
  const queryPlan = getCatalogQueryPlan({
    filter: activeFilter,
    page: activePage,
    search: activeSearch,
    sort: activeSort,
    sortDir: activeSortDir,
    totalRows: databasePageTotalCount,
  });

  if (queryPlan.mode === "database-page" && databasePageWhere) {
    const [[mappings, linkedCount], summary] = await Promise.all([
      measureSyncBayPerformanceStage(trace, "catalog.db.databasePageTransaction", () =>
        prisma.$transaction([
          prisma.productMapping.findMany({
            include: {
              conflicts: {
                select: {
                  field: true,
                  id: true,
                },
                where: { status: SyncConflictStatus.OPEN },
              },
            },
            orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
            skip: queryPlan.pagination.offset,
            take: queryPlan.take,
            where: databasePageWhere,
          }),
          prisma.productMapping.count({
            where: {
              ...where,
              shopifyProductGid: { not: null },
            },
          }),
        ]),
      ),
      measureSyncBayPerformanceStage(trace, "catalog.db.summaryCounts", () =>
        getCatalogSummaryCounts({
          now: new Date(),
          shopId: shop.id,
          syncTargetSeconds: shop.syncTargetSeconds,
        }),
      ),
    ]);
    const { latestIncrementalFinishedAt, ...summaryCounts } = summary;
    const catalogVerifiedAt = latestIncrementalFinishedAt;
    const latestSnapshotByMappingId = await measureSyncBayPerformanceStage(
      trace,
      "catalog.db.latestSnapshots",
      () => getLatestProductSnapshotByMappingId(mappings.map((mapping) => mapping.id)),
    );
    const now = new Date();
    const pageRows = mappings.map((mapping) =>
      formatCatalogPageRow({
        catalogVerifiedAt,
        latestSnapshot: latestSnapshotByMappingId.get(mapping.id) ?? null,
        mapping,
        now,
        syncTargetSeconds: shop.syncTargetSeconds,
        thumbnailUrl: mapping.thumbnailUrl,
      }),
    );

    return {
      filters: [
        "all",
        "linked",
        "fresh",
        "needs_check",
        "conflicts",
        "not_updated",
        "archived",
      ] as const,
      pagination: {
        ...queryPlan.pagination,
        cappedAtMaxProducts: totalAvailableCount > CATALOG_IMPORT_MAX_PRODUCTS,
        maxLoadedRows: pageRows.length,
        maxProducts: CATALOG_IMPORT_MAX_PRODUCTS,
        totalAvailableCount,
      },
      rows: await getCatalogRowsWithThumbnails({
        rows: pageRows,
        shopDomain: shop.shopDomain,
        trace,
      }),
      shop: {
        domain: shop.shopDomain,
        syncTargetSeconds: shop.syncTargetSeconds,
      },
      summary: {
        ...summaryCounts,
        linkedCount,
        totalCount: totalAvailableCount,
      },
    };
  }

  const [mappings, linkedCount, latestIncrementalJob] = await measureSyncBayPerformanceStage(
    trace,
    "catalog.db.fullCatalogTransaction",
    () =>
      prisma.$transaction([
        prisma.productMapping.findMany({
          include: {
            conflicts: {
              select: {
                field: true,
                id: true,
              },
              where: { status: SyncConflictStatus.OPEN },
            },
          },
          orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
          take: CATALOG_IMPORT_MAX_PRODUCTS,
          where,
        }),
        prisma.productMapping.count({
          where: {
            ...where,
            shopifyProductGid: { not: null },
          },
        }),
        // Watermark a livello shop: ultimo ciclo di sync incrementale riuscito
        // (delta eventi venditore o reconcile). Stesso segnale della salute sync
        // in dashboard, così catalogo e dashboard restano coerenti.
        prisma.syncJob.findFirst({
          orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
          select: { finishedAt: true },
          where: getCompletedCatalogVerificationJobWhere(shop.id),
        }),
      ]),
  );
  const catalogVerifiedAt = latestIncrementalJob?.finishedAt ?? null;
  const latestSnapshotByMappingId = await measureSyncBayPerformanceStage(
    trace,
    "catalog.db.latestSnapshots",
    () => getLatestProductSnapshotByMappingId(mappings.map((mapping) => mapping.id)),
  );

  // Le miniature non influenzano filtro/ordinamento: si risolvono dopo la
  // paginazione, solo per le righe mostrate, per tenere veloci filtri e sort.
  const now = new Date();
  const allRows = mappings.map((mapping) =>
    formatCatalogPageRow({
      catalogVerifiedAt,
      latestSnapshot: latestSnapshotByMappingId.get(mapping.id) ?? null,
      mapping,
      now,
      syncTargetSeconds: shop.syncTargetSeconds,
      thumbnailUrl: mapping.thumbnailUrl,
    }),
  );
  const filteredRows = filterCatalogPageRows(
    searchCatalogPageRows(allRows, activeSearch),
    activeFilter,
  );
  const sortedRows = sortCatalogPageRows(filteredRows, activeSort, activeSortDir);
  const pagination = getCatalogPageWindow({
    page: activePage,
    pageSize: CATALOG_PAGE_SIZE,
    totalRows: sortedRows.length,
  });
  const pageRows = sortedRows.slice(pagination.offset, pagination.offset + pagination.pageSize);
  const rowsWithThumbnails = await getCatalogRowsWithThumbnails({
    rows: pageRows,
    shopDomain: shop.shopDomain,
    trace,
  });

  return {
    filters: [
      "all",
      "linked",
      "fresh",
      "needs_check",
      "conflicts",
      "not_updated",
      "archived",
    ] as const,
    pagination: {
      ...pagination,
      cappedAtMaxProducts: totalAvailableCount > mappings.length,
      maxLoadedRows: mappings.length,
      maxProducts: CATALOG_IMPORT_MAX_PRODUCTS,
      totalAvailableCount,
    },
    rows: rowsWithThumbnails,
    shop: {
      domain: shop.shopDomain,
      syncTargetSeconds: shop.syncTargetSeconds,
    },
    summary: {
      archivedCount: allRows.filter((row) => row.status === "archived").length,
      conflictCount: allRows.filter((row) => row.status === "open_conflict").length,
      freshCount: allRows.filter((row) => row.status === "active_fresh").length,
      linkedCount,
      needsCheckCount: allRows.filter(isCatalogRowNeedingCheck).length,
      totalCount: totalAvailableCount,
    },
  };
}

export async function getConflictsPageState(
  session: ShopifySessionLike,
  input: { filter?: ConflictFilter; page?: number } = {},
  trace?: SyncBayLoaderPerformanceTrace,
) {
  const shop = await measureSyncBayPerformanceStage(trace, "conflicts.shop.ensure", () =>
    ensureShopForSession(session),
  );
  const activeFilter = input.filter ?? "open";
  const statusFilter = [...getConflictStatusFilter(activeFilter)] as SyncConflictStatus[];
  const allStatuses = [...getConflictStatusFilter("all")] as SyncConflictStatus[];
  const resolvedStatuses = [...getConflictStatusFilter("resolved")] as SyncConflictStatus[];
  const [summaryCounts, openConflictFields] = await measureSyncBayPerformanceStage(
    trace,
    "conflicts.db.summaryTransaction",
    () =>
      getConflictSummaryCounts({
        allStatuses,
        resolvedStatuses,
        shopId: shop.id,
        statusFilter,
      }),
  );
  const decisionModeCounts = summarizeConflictDecisionModes(
    openConflictFields.map((conflict) => ({
      count: conflict.count,
      field: conflict.field,
    })),
  );
  const pagination = getPageWindow({
    page: input.page ?? 1,
    pageSize: CONFLICT_PAGE_SIZE,
    totalRows: summaryCounts.filteredCount,
  });
  const conflicts = await measureSyncBayPerformanceStage(trace, "conflicts.db.pageRows", () =>
    prisma.syncConflict.findMany({
      include: {
        mapping: true,
      },
      orderBy: [{ status: "asc" }, { detectedAt: "desc" }],
      skip: pagination.offset,
      take: pagination.pageSize,
      where: {
        shopId: shop.id,
        status: { in: statusFilter },
      },
    }),
  );
  const latestSnapshotByMappingId = await measureSyncBayPerformanceStage(
    trace,
    "conflicts.db.latestSnapshots",
    () =>
      getLatestProductSnapshotByMappingId(
        conflicts.flatMap((conflict) => (conflict.mapping?.id ? [conflict.mapping.id] : [])),
      ),
  );
  const rows = conflicts.map((conflict) =>
    formatConflictPageRow(conflict, {
      latestSnapshot: conflict.mapping?.id
        ? (latestSnapshotByMappingId.get(conflict.mapping.id) ?? null)
        : null,
      thumbnailUrl: conflict.mapping?.thumbnailUrl ?? null,
    }),
  );
  const shopifyThumbnailUrlByProductGid = await measureSyncBayPerformanceStage(
    trace,
    "conflicts.shopify.thumbnails",
    () =>
      getShopifyThumbnailUrlByProductGid({
        productGids: rows.flatMap((row) =>
          !row.product.thumbnailUrl && row.product.shopifyProductGid
            ? [row.product.shopifyProductGid as string]
            : [],
        ),
        shopDomain: shop.shopDomain,
      }),
  );
  const rowsWithThumbnails = rows.map((row) =>
    row.product.thumbnailUrl
      ? row
      : {
          ...row,
          product: {
            ...row.product,
            thumbnailUrl:
              (row.product.shopifyProductGid
                ? shopifyThumbnailUrlByProductGid.get(row.product.shopifyProductGid)
                : null) ?? null,
          },
        },
  );

  return {
    filters: ["open", "resolved", "all"] as const,
    pagination,
    rows: rowsWithThumbnails,
    shop: {
      domain: shop.shopDomain,
    },
    summary: {
      ...decisionModeCounts,
      filteredCount: summaryCounts.filteredCount,
      openCount: summaryCounts.openCount,
      resolvedCount: summaryCounts.resolvedCount,
      totalCount: summaryCounts.totalCount,
    },
  };
}

async function getConflictSummaryCounts(input: {
  allStatuses: SyncConflictStatus[];
  resolvedStatuses: SyncConflictStatus[];
  shopId: string;
  statusFilter: SyncConflictStatus[];
}) {
  const [summaryRows, openConflictFields] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        filteredCount: number;
        openCount: number;
        resolvedCount: number;
        totalCount: number;
      }>
    >`
      SELECT
        COUNT(*) FILTER (WHERE "status"::text = 'OPEN')::integer AS "openCount",
        COUNT(*) FILTER (
          WHERE "status"::text IN (${Prisma.join(input.resolvedStatuses)})
        )::integer AS "resolvedCount",
        COUNT(*) FILTER (
          WHERE "status"::text IN (${Prisma.join(input.allStatuses)})
        )::integer AS "totalCount",
        COUNT(*) FILTER (
          WHERE "status"::text IN (${Prisma.join(input.statusFilter)})
        )::integer AS "filteredCount"
      FROM "SyncConflict"
      WHERE "shopId" = ${input.shopId}
    `,
    prisma.$queryRaw<Array<{ count: number; field: string }>>`
      SELECT "field", COUNT(*)::integer AS "count"
      FROM "SyncConflict"
      WHERE
        "shopId" = ${input.shopId}
        AND "status"::text = 'OPEN'
      GROUP BY "field"
    `,
  ]);
  const summary = summaryRows[0];

  return [
    summary ?? {
      filteredCount: 0,
      openCount: 0,
      resolvedCount: 0,
      totalCount: 0,
    },
    openConflictFields,
  ] as const;
}

async function getLatestProductSnapshotByMappingId(mappingIds: string[]) {
  const uniqueMappingIds = [...new Set(mappingIds)];
  const snapshotByMappingId = new Map<string, LatestProductSnapshotForDisplay>();

  if (uniqueMappingIds.length === 0) return snapshotByMappingId;

  const baselines = await prisma.productSyncBaseline.findMany({
    include: { mapping: { select: { sku: true } } },
    where: { mappingId: { in: uniqueMappingIds } },
  });
  for (const baseline of baselines) {
    snapshotByMappingId.set(baseline.mappingId, {
      capturedAt: baseline.updatedAt,
      currency: baseline.currency,
      mappingId: baseline.mappingId,
      priceAmount: baseline.priceAmount,
      productStatus: baseline.productStatus,
      quantity: baseline.quantity,
      sku: baseline.mapping.sku,
      title: baseline.title,
    });
  }

  const fallbackMappingIds = uniqueMappingIds.filter((mappingId) => {
    const baseline = snapshotByMappingId.get(mappingId);
    return (
      !baseline ||
      baseline.currency === null ||
      baseline.priceAmount === null ||
      baseline.productStatus === null ||
      baseline.quantity === null ||
      baseline.sku === null ||
      baseline.title === null
    );
  });
  if (fallbackMappingIds.length === 0) return snapshotByMappingId;

  const snapshots = await prisma.$queryRaw<LatestProductSnapshotForDisplay[]>`
    WITH latest_display AS (
      SELECT DISTINCT ON ("mappingId")
        "mappingId",
        "capturedAt",
        "currency",
        "priceAmount",
        "productStatus",
        "quantity",
        "sku",
        "title"
      FROM "ProductSnapshot"
      WHERE "mappingId" IN (${Prisma.join(fallbackMappingIds)})
      ORDER BY "mappingId", "capturedAt" DESC
    )
    SELECT
      latest_display."mappingId",
      latest_display."capturedAt",
      COALESCE(latest_display."currency", latest_stock."currency") AS "currency",
      COALESCE(latest_display."priceAmount", latest_price."priceAmount") AS "priceAmount",
      COALESCE(latest_display."productStatus", latest_status."productStatus") AS "productStatus",
      CASE
        WHEN latest_display."currency" IS NOT NULL
          AND latest_display."quantity" IS NOT NULL
          THEN latest_display."quantity"
        ELSE latest_stock."quantity"
      END AS "quantity",
      COALESCE(latest_display."sku", latest_sku."sku") AS "sku",
      COALESCE(latest_display."title", latest_title."title") AS "title"
    FROM latest_display
    LEFT JOIN LATERAL (
      SELECT "currency", "quantity"
      FROM "ProductSnapshot"
      WHERE
        "mappingId" = latest_display."mappingId"
        AND "quantity" IS NOT NULL
        AND "currency" IS NOT NULL
      ORDER BY "capturedAt" DESC
      LIMIT 1
    ) latest_stock ON true
    LEFT JOIN LATERAL (
      SELECT "priceAmount"
      FROM "ProductSnapshot"
      WHERE "mappingId" = latest_display."mappingId" AND "priceAmount" IS NOT NULL
      ORDER BY "capturedAt" DESC LIMIT 1
    ) latest_price ON true
    LEFT JOIN LATERAL (
      SELECT "productStatus"
      FROM "ProductSnapshot"
      WHERE "mappingId" = latest_display."mappingId" AND "productStatus" IS NOT NULL
      ORDER BY "capturedAt" DESC LIMIT 1
    ) latest_status ON true
    LEFT JOIN LATERAL (
      SELECT "sku"
      FROM "ProductSnapshot"
      WHERE "mappingId" = latest_display."mappingId" AND "sku" IS NOT NULL
      ORDER BY "capturedAt" DESC LIMIT 1
    ) latest_sku ON true
    LEFT JOIN LATERAL (
      SELECT "title"
      FROM "ProductSnapshot"
      WHERE "mappingId" = latest_display."mappingId" AND "title" IS NOT NULL
      ORDER BY "capturedAt" DESC LIMIT 1
    ) latest_title ON true
  `;

  for (const snapshot of snapshots) {
    if (!snapshot.mappingId) continue;

    const baseline = snapshotByMappingId.get(snapshot.mappingId);
    snapshotByMappingId.set(
      snapshot.mappingId,
      baseline ? mergeProductDisplayBaselineWithSnapshot(baseline, snapshot) : snapshot,
    );
  }

  return snapshotByMappingId;
}

async function getShopifyThumbnailUrlByProductGid(input: {
  productGids: string[];
  shopDomain: string;
}) {
  const uniqueProductGids = [...new Set(input.productGids)];
  const thumbnailUrlByProductGid = new Map<string, string>();

  if (uniqueProductGids.length === 0) return thumbnailUrlByProductGid;

  const cacheKeyByProductGid = new Map(
    uniqueProductGids.map((productGid) => [productGid, `${input.shopDomain}:${productGid}`]),
  );
  const productGidByCacheKey = new Map(
    [...cacheKeyByProductGid].map(([productGid, cacheKey]) => [cacheKey, productGid]),
  );
  const cached = readFreshThumbnailCacheEntries({
    cache: shopifyThumbnailCache,
    keys: [...cacheKeyByProductGid.values()],
    nowMs: Date.now(),
  });

  for (const [cacheKey, thumbnailUrl] of cached.hits) {
    const productGid = productGidByCacheKey.get(cacheKey);
    if (productGid) thumbnailUrlByProductGid.set(productGid, thumbnailUrl);
  }

  const missingProductGids = cached.misses.flatMap((cacheKey) => {
    const productGid = productGidByCacheKey.get(cacheKey);
    return productGid ? [productGid] : [];
  });

  if (missingProductGids.length === 0) return thumbnailUrlByProductGid;

  try {
    const admin = await getShopifyAdminGraphqlClient(input.shopDomain);

    for (const productGidBatch of chunkArray(missingProductGids, 50)) {
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- lettura Shopify Admin GraphQL rate-limited: in serie per rispettare i limiti di costo del provider.
      const response = await admin.graphql(
        `#graphql
        query SyncBayCatalogProductThumbnails($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              media(first: 10) {
                nodes {
                  mediaContentType
                  preview {
                    status
                    image {
                      url
                    }
                  }
                  ... on MediaImage {
                    image {
                      url
                    }
                  }
                }
              }
            }
          }
        }`,
        { variables: { ids: productGidBatch } },
      );
      const json = (await response
        .json()
        .catch(() => null)) as ShopifyProductThumbnailsResponse | null;

      if (!response.ok || json?.errors?.length) continue;

      for (const node of json?.data?.nodes ?? []) {
        if (!node?.id) continue;

        const thumbnailUrl = getShopifyProductThumbnailUrl(node);

        if (thumbnailUrl) thumbnailUrlByProductGid.set(node.id, thumbnailUrl);
      }
    }
  } catch {
    return thumbnailUrlByProductGid;
  }

  writeThumbnailCacheEntries({
    cache: shopifyThumbnailCache,
    keys: missingProductGids.flatMap((productGid) => {
      const cacheKey = cacheKeyByProductGid.get(productGid);
      return cacheKey ? [cacheKey] : [];
    }),
    nowMs: Date.now(),
    ttlMs: SHOPIFY_THUMBNAIL_CACHE_TTL_MS,
    values: new Map(
      missingProductGids.flatMap((productGid) => {
        const cacheKey = cacheKeyByProductGid.get(productGid);
        const thumbnailUrl = thumbnailUrlByProductGid.get(productGid);
        return cacheKey && thumbnailUrl ? [[cacheKey, thumbnailUrl]] : [];
      }),
    ),
  });

  return thumbnailUrlByProductGid;
}

type ShopifyProductThumbnailsResponse = {
  data?: {
    nodes?: Array<{
      id?: string | null;
      media?: {
        nodes?: unknown[];
      } | null;
    } | null>;
  };
  errors?: Array<unknown>;
};

type CatalogPageRow = ReturnType<typeof formatCatalogPageRow>;

function getCatalogDatabasePageWhere(
  baseWhere: { marketplaceId: string; shopId: string },
  filter: CatalogPageFilter,
): Prisma.ProductMappingWhereInput | null {
  if (filter === "all") return baseWhere;
  if (filter === "linked") {
    return {
      ...baseWhere,
      shopifyProductGid: { not: null },
    };
  }
  if (filter === "conflicts") {
    return {
      ...baseWhere,
      conflicts: { some: { status: SyncConflictStatus.OPEN } },
    };
  }
  if (filter === "not_updated") {
    return {
      ...baseWhere,
      lastSyncedAt: null,
    };
  }
  if (filter === "archived") {
    return {
      ...baseWhere,
      status: ProductMappingStatus.OUT_OF_STOCK,
    };
  }

  return null;
}

async function getCatalogRowsWithThumbnails(input: {
  rows: CatalogPageRow[];
  shopDomain: string;
  trace?: SyncBayLoaderPerformanceTrace;
}) {
  const shopifyThumbnailUrlByProductGid = await measureSyncBayPerformanceStage(
    input.trace,
    "catalog.shopify.thumbnails",
    () =>
      getShopifyThumbnailUrlByProductGid({
        productGids: input.rows.flatMap((row) =>
          !row.thumbnailUrl && row.shopifyProductGid ? [row.shopifyProductGid as string] : [],
        ),
        shopDomain: input.shopDomain,
      }),
  );

  return input.rows.map((row) =>
    row.thumbnailUrl
      ? row
      : {
          ...row,
          thumbnailUrl:
            (row.shopifyProductGid
              ? shopifyThumbnailUrlByProductGid.get(row.shopifyProductGid)
              : null) ?? null,
        },
  );
}

function searchCatalogPageRows(rows: CatalogPageRow[], query: string) {
  if (!query.trim()) return rows;

  return rows.filter((row) => catalogRowMatchesSearch(row, query));
}

function filterCatalogPageRows(rows: CatalogPageRow[], filter: CatalogPageFilter) {
  if (filter === "linked") {
    return rows.filter((row) => row.shopifyProductGid);
  }
  if (filter === "fresh") {
    return rows.filter((row) => row.status === "active_fresh");
  }
  if (filter === "needs_check") {
    return rows.filter(isCatalogRowNeedingCheck);
  }
  if (filter === "conflicts") {
    return rows.filter((row) => row.status === "open_conflict");
  }
  if (filter === "not_updated") {
    return rows.filter((row) => !row.lastSyncedAt);
  }
  if (filter === "archived") {
    return rows.filter((row) => row.status === "archived");
  }

  return rows;
}

const CATALOG_STATUS_SORT_ORDER: Record<string, number> = {
  mapping_error: 0,
  open_conflict: 1,
  stale_sync: 2,
  active_fresh: 3,
  archived: 4,
};

function sortCatalogPageRows(
  rows: CatalogPageRow[],
  sort: CatalogSortKey | null,
  dir: CatalogSortDir,
) {
  if (!sort) return rows;

  const factor = dir === "desc" ? -1 : 1;
  const byText = (a: string, b: string) =>
    factor * a.localeCompare(b, "it", { sensitivity: "base" });
  const byNumber = (a: number, b: number) => factor * (a - b);

  return [...rows].sort((a, b) => {
    if (sort === "product") return byText(a.title, b.title);
    if (sort === "link") {
      return byNumber(a.shopifyProductGid ? 0 : 1, b.shopifyProductGid ? 0 : 1);
    }
    if (sort === "availability") {
      return byNumber(a.quantity ?? -1, b.quantity ?? -1);
    }
    if (sort === "price") {
      return byNumber(
        a.price ? Number.parseFloat(a.price.amount) : -1,
        b.price ? Number.parseFloat(b.price.amount) : -1,
      );
    }
    if (sort === "updated") {
      return byNumber(
        a.lastSyncedAt ? Date.parse(a.lastSyncedAt) : 0,
        b.lastSyncedAt ? Date.parse(b.lastSyncedAt) : 0,
      );
    }

    return byNumber(
      CATALOG_STATUS_SORT_ORDER[a.status] ?? 9,
      CATALOG_STATUS_SORT_ORDER[b.status] ?? 9,
    );
  });
}

function formatCatalogPageRow(input: {
  catalogVerifiedAt: Date | null;
  latestSnapshot: LatestProductSnapshotForDisplay | null;
  mapping: Prisma.ProductMappingGetPayload<{
    include: {
      conflicts: {
        select: {
          field: true;
          id: true;
        };
      };
    };
  }>;
  now: Date;
  syncTargetSeconds: number;
  thumbnailUrl: string | null;
}) {
  const latestSnapshot = input.latestSnapshot;
  const lastSyncedAt = input.mapping.lastSyncedAt?.toISOString() ?? null;
  const status = getCatalogRowStatus({
    lastErrorCode: input.mapping.lastErrorCode,
    lastSyncedAt,
    mappingStatus: input.mapping.status,
    openConflictCount: input.mapping.conflicts.length,
    stale: isCatalogMappingStale({
      catalogVerifiedAt: input.catalogVerifiedAt,
      lastSyncedAt: input.mapping.lastSyncedAt,
      mappingStatus: input.mapping.status,
      now: input.now,
      syncTargetSeconds: input.syncTargetSeconds,
    }),
  });
  const availability = getCatalogAvailability({
    openConflictFields: input.mapping.conflicts.map((conflict) => conflict.field),
    quantity: latestSnapshot?.quantity ?? null,
    status,
  });

  return {
    availability,
    conflictIds: input.mapping.conflicts.map((conflict) => conflict.id),
    ebayItemId: input.mapping.ebayItemId,
    id: input.mapping.id,
    lastErrorCode: input.mapping.lastErrorCode,
    lastErrorMessage: input.mapping.lastErrorMessage,
    lastSyncedAt,
    mappingStatus: input.mapping.status,
    openConflictCount: input.mapping.conflicts.length,
    price: latestSnapshot?.priceAmount
      ? {
          amount: latestSnapshot.priceAmount.toString(),
          currency: latestSnapshot.currency ?? null,
        }
      : null,
    productStatus: latestSnapshot?.productStatus ?? null,
    quantity: latestSnapshot?.quantity ?? null,
    shopifyProductGid: input.mapping.shopifyProductGid,
    sku: latestSnapshot?.sku ?? input.mapping.sku,
    snapshotCapturedAt: latestSnapshot?.capturedAt.toISOString() ?? null,
    status,
    thumbnailUrl: input.thumbnailUrl,
    title:
      latestSnapshot?.title ?? input.mapping.sku ?? `Inserzione eBay ${input.mapping.ebayItemId}`,
  };
}

function formatConflictPageRow(
  conflict: Prisma.SyncConflictGetPayload<{
    include: {
      mapping: true;
    };
  }>,
  input: {
    latestSnapshot: LatestProductSnapshotForDisplay | null;
    thumbnailUrl: string | null;
  },
) {
  const latestSnapshot = input.latestSnapshot;

  return {
    detectedAt: conflict.detectedAt.toISOString(),
    ebayItemId: conflict.mapping?.ebayItemId ?? null,
    field: conflict.field,
    id: conflict.id,
    product: {
      shopifyProductGid: conflict.mapping?.shopifyProductGid ?? null,
      sku: latestSnapshot?.sku ?? conflict.mapping?.sku ?? null,
      thumbnailUrl: input.thumbnailUrl,
      title:
        latestSnapshot?.title ??
        conflict.mapping?.sku ??
        (conflict.mapping?.ebayItemId
          ? `Inserzione eBay ${conflict.mapping.ebayItemId}`
          : "Prodotto non collegato"),
    },
    resolution: conflict.resolution,
    resolvedAt: conflict.resolvedAt?.toISOString() ?? null,
    shopifyValue: formatConflictValueForDisplay({
      field: conflict.field,
      value: conflict.shopifyValue,
    }),
    sourceValue: formatConflictValueForDisplay({
      field: conflict.field,
      value: conflict.ebayValue ?? conflict.lastSyncBayValue,
    }),
    status: conflict.status,
  };
}

function getCatalogAvailability(input: {
  openConflictFields: string[];
  quantity: number | null;
  status: CatalogStatusKind;
}): CatalogAvailabilityKind {
  if (input.status === "mapping_error") return "blocked";
  if (input.openConflictFields.includes("quantity")) return "needs_check";
  if (input.quantity === null) return "unknown";

  return "aligned";
}
