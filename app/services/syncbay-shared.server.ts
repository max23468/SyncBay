import { Prisma, SyncJobStatus } from "@prisma/client";
import prisma from "../db.server";
import {
  getImportProductStatusLabelCapitalized,
  type ImportProductStatus,
} from "../lib/import-product-status";
import { getCompletedCatalogVerificationJobWhere } from "../lib/syncbay-catalog-verification-job";
import {
  DEFAULT_DESCRIPTION_RULE,
  getDescriptionRuleSummary,
  normalizeDescriptionRule,
  type DescriptionRuleMode,
} from "../lib/syncbay-description-rules";
import { getEbayMarketplaceId } from "./ebay-environment.server";

export interface ShopifySessionLike {
  shop: string;
  scope?: string | null;
}

export interface ShopifyAdminGraphqlClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

export const CATALOG_IMPORT_BATCH_MAX_ATTEMPTS = 4;

export async function getExistingDescriptionRuleForSettings(shopId: string) {
  const descriptionRule = await prisma.descriptionRule.findUnique({
    select: { mode: true },
    where: { shopId },
  });

  return normalizeDescriptionRule(descriptionRule ?? DEFAULT_DESCRIPTION_RULE);
}

export function getOnboardingReadiness(input: {
  descriptionRuleMode: DescriptionRuleMode;
  defaultProductStatus: ImportProductStatus;
}) {
  return {
    defaults: {
      descriptionMode: getDescriptionRuleSummary(input.descriptionRuleMode),
      imageImport: "Tutte le immagini",
      productStatus: getImportProductStatusLabelCapitalized(input.defaultProductStatus),
    },
    steps: [
      "Collega Shopify",
      "Collega eBay.it",
      "Scegli location Shopify",
      "Conferma default import",
      "Genera preview",
    ],
  };
}

export function getImportPreviewReadiness(input: {
  descriptionRuleMode: DescriptionRuleMode;
  defaultProductStatus: ImportProductStatus;
  ebayConnected: boolean;
  hasDefaultLocation: boolean;
  listingReaderError?: string | null;
  listingReaderAvailable?: boolean;
  listingReaderPending?: boolean;
}) {
  const blockers = [
    !input.ebayConnected ? "account eBay non collegato" : null,
    !input.hasDefaultLocation ? "location Shopify predefinita non confermata" : null,
    input.listingReaderPending ? "preview live non ancora aggiornata" : null,
    input.listingReaderError
      ? `lettura listing eBay non riuscita: ${input.listingReaderError}`
      : null,
    input.listingReaderAvailable === false ? "lettura listing eBay non ancora implementata" : null,
  ].filter((blocker): blocker is string => Boolean(blocker));

  return {
    blockers,
    defaults: {
      descriptionMode: getDescriptionRuleSummary(input.descriptionRuleMode),
      imageImport: "Tutte le immagini",
      productStatus: getImportProductStatusLabelCapitalized(input.defaultProductStatus),
    },
    summary: {
      detail:
        blockers.length === 0
          ? "Preview import pronta sui dati eBay disponibili."
          : `Preview bloccata: ${blockers.join(", ")}.`,
      label: "Import preview",
      status: blockers.length === 0 ? "pronto" : "bloccato",
    },
  };
}

export async function getCatalogSummaryCounts(input: {
  now: Date;
  shopId: string;
  syncTargetSeconds: number;
}) {
  const latestIncrementalJob = await prisma.syncJob.findFirst({
    orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
    select: { finishedAt: true },
    where: getCompletedCatalogVerificationJobWhere(input.shopId),
  });
  const catalogVerifiedAtMs = latestIncrementalJob?.finishedAt?.getTime() ?? 0;
  const freshnessThresholdMs =
    input.now.getTime() - Math.max(input.syncTargetSeconds, 60) * 1000 * 2;
  const marketplaceId = getEbayMarketplaceId();
  const [summary] = await prisma.$queryRaw<
    Array<{
      archivedCount: number;
      conflictCount: number;
      freshCount: number;
      needsCheckCount: number;
      staleActiveCount: number;
      unknownAvailabilityCount: number;
    }>
  >`
    WITH open_conflicts AS (
      SELECT
        "mappingId",
        COUNT(*)::integer AS "openConflictCount",
        BOOL_OR("field" = 'quantity') AS "hasQuantityConflict"
      FROM "SyncConflict"
      WHERE
        "shopId" = ${input.shopId}
        AND "status"::text = 'OPEN'
        AND "mappingId" IS NOT NULL
      GROUP BY "mappingId"
    ),
    catalog_rows AS (
      SELECT
        CASE
          WHEN m."status"::text = 'OUT_OF_STOCK' THEN 'archived'
          WHEN m."status"::text = 'ERROR' OR m."lastErrorCode" IS NOT NULL THEN 'mapping_error'
          WHEN COALESCE(oc."openConflictCount", 0) > 0 THEN 'open_conflict'
          WHEN
            m."status"::text = 'PAUSED'
            OR m."lastSyncedAt" IS NULL
            OR GREATEST(EXTRACT(EPOCH FROM m."lastSyncedAt") * 1000, ${catalogVerifiedAtMs}) < ${freshnessThresholdMs}
          THEN 'stale_sync'
          ELSE 'active_fresh'
        END AS "status",
        CASE
          WHEN m."status"::text = 'ERROR' OR m."lastErrorCode" IS NOT NULL THEN 'blocked'
          WHEN COALESCE(oc."hasQuantityConflict", false) THEN 'needs_check'
          WHEN ls."quantity" IS NULL THEN 'unknown'
          ELSE 'aligned'
        END AS "availability"
      FROM "ProductMapping" m
      LEFT JOIN LATERAL (
        SELECT ps."quantity"
        FROM "ProductSnapshot" ps
        WHERE
          ps."mappingId" = m."id"
          AND ps."shopId" = ${input.shopId}
          AND ps."quantity" IS NOT NULL
          AND ps."currency" IS NOT NULL
        ORDER BY ps."capturedAt" DESC
        LIMIT 1
      ) ls ON true
      LEFT JOIN open_conflicts oc ON oc."mappingId" = m."id"
      WHERE
        m."shopId" = ${input.shopId}
        AND m."marketplaceId" = ${marketplaceId}
    )
    SELECT
      COUNT(*) FILTER (WHERE "status" = 'archived')::integer AS "archivedCount",
      COUNT(*) FILTER (WHERE "status" = 'open_conflict')::integer AS "conflictCount",
      COUNT(*) FILTER (WHERE "status" = 'active_fresh')::integer AS "freshCount",
      COUNT(*) FILTER (WHERE "status" = 'stale_sync')::integer AS "staleActiveCount",
      COUNT(*) FILTER (
        WHERE "status" <> 'archived' AND "availability" = 'unknown'
      )::integer AS "unknownAvailabilityCount",
      COUNT(*) FILTER (
        WHERE
          "status" IN ('mapping_error', 'stale_sync')
          OR ("status" <> 'archived' AND "availability" <> 'aligned')
      )::integer AS "needsCheckCount"
    FROM catalog_rows
  `;

  return {
    ...(summary ?? {
      archivedCount: 0,
      conflictCount: 0,
      freshCount: 0,
      needsCheckCount: 0,
      staleActiveCount: 0,
      unknownAvailabilityCount: 0,
    }),
    latestIncrementalFinishedAt: latestIncrementalJob?.finishedAt ?? null,
  };
}

export function canRequestRetry(status: SyncJobStatus) {
  const retryableStatuses: SyncJobStatus[] = [SyncJobStatus.FAILED, SyncJobStatus.RETRYING];

  return retryableStatuses.includes(status);
}

export function hasRuntimeValue(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

export function getJsonObject(value: Prisma.JsonValue | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  return value as Record<string, Prisma.JsonValue>;
}

export function getJsonNumber(value: Prisma.JsonValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getJsonString(value: Prisma.JsonValue | undefined) {
  return typeof value === "string" ? value : null;
}
