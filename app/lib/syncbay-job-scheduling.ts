import { createHash } from "node:crypto";

export const FACET_BACKFILL_INCREMENTAL_JOB_SOURCE = "facet_backfill";
const DEFAULT_RUN_DUE_LIMIT = 5;
const MAX_RUN_DUE_LIMIT = 20;
export const UNINSTALLED_SHOP_SYNC_JOB_CANCELLATION_STATUSES = [
  "PENDING",
  "RETRYING",
  "RUNNING",
] as const;
export type EbayItemJobPayload = Record<string, unknown> & {
  ebayItemIds?: unknown;
};

export function isSchedulableSyncJob(input: { idempotencyKey?: string | null; payload: unknown }) {
  return Boolean(input);
}

export function shouldCancelSyncJobAfterShopUninstall(status: string | null) {
  return UNINSTALLED_SHOP_SYNC_JOB_CANCELLATION_STATUSES.includes(
    status as (typeof UNINSTALLED_SHOP_SYNC_JOB_CANCELLATION_STATUSES)[number],
  );
}

export function normalizeRunDueLimit(limit?: number) {
  if (!Number.isInteger(limit)) return DEFAULT_RUN_DUE_LIMIT;

  return Math.min(Math.max(Number(limit), 1), MAX_RUN_DUE_LIMIT);
}

export function isFacetOnlyIncrementalJobPayload(payload: unknown) {
  return (
    getBooleanField(payload, "facetOnly") === true ||
    getStringField(payload, "source") === FACET_BACKFILL_INCREMENTAL_JOB_SOURCE
  );
}

export function isRegularIncrementalJobPayload(payload: unknown) {
  return !isFacetOnlyIncrementalJobPayload(payload);
}

export function prioritizeIncrementalJobsByFacetMode<T extends { payload: unknown }>(jobs: T[]) {
  const regularJobs: T[] = [];
  const facetOnlyJobs: T[] = [];

  for (const job of jobs) {
    if (isFacetOnlyIncrementalJobPayload(job.payload)) {
      facetOnlyJobs.push(job);
    } else {
      regularJobs.push(job);
    }
  }

  return [...regularJobs, ...facetOnlyJobs];
}

export function getDuplicateShopifyChangeJobIdsToCancel(
  jobs: Array<{
    createdAt: Date;
    id: string;
    payload: unknown;
    shopId: string;
  }>,
) {
  const newestJobByKey = new Map<string, { createdAt: Date; id: string }>();
  const duplicateIds: string[] = [];

  for (const job of jobs) {
    const key = getShopifyChangeJobDedupeKey(job);

    if (!key) continue;

    const current = newestJobByKey.get(key);

    if (!current) {
      newestJobByKey.set(key, { createdAt: job.createdAt, id: job.id });
      continue;
    }

    if (job.createdAt > current.createdAt) {
      duplicateIds.push(current.id);
      newestJobByKey.set(key, { createdAt: job.createdAt, id: job.id });
    } else {
      duplicateIds.push(job.id);
    }
  }

  return duplicateIds;
}

export const CATALOG_RECONCILE_JOB_SOURCE = "catalog_reconcile";

export function getCatalogReconcileJobIdsToCancelBeforeNewRun(input: {
  jobs: Array<{ id: string; payload: unknown }>;
}) {
  return input.jobs.flatMap((job) =>
    getStringField(job.payload, "source") === CATALOG_RECONCILE_JOB_SOURCE &&
    getStringField(job.payload, "runId")
      ? [job.id]
      : [],
  );
}

// Ogni giro di reconcile catalogo ripete la stessa scansione full-catalog:
// tenere aperti più giri contemporaneamente è ridondante. Dato l'insieme dei
// job reconcile ancora aperti, mantiene solo il giro più recente (il job con
// `createdAt` massimo, cioè la scansione catalogo più fresca) e restituisce gli
// id degli altri da annullare. Girando a ogni tick prima della guardia di
// enqueue, impedisce che un blackout auth/API accumuli decine di giri incompleti
// mentre il runner ne drena uno alla volta. I job senza `runId` sono ignorati.
export function getSupersededCatalogReconcileJobIds(input: {
  jobs: Array<{ createdAt: Date; id: string; payload: unknown }>;
}) {
  const reconcileJobs = input.jobs.filter(
    (job) =>
      getStringField(job.payload, "source") === CATALOG_RECONCILE_JOB_SOURCE &&
      getStringField(job.payload, "runId"),
  );

  if (reconcileJobs.length === 0) return [];

  let keepRunId: string | null = null;
  let keepAt = Number.NEGATIVE_INFINITY;

  for (const job of reconcileJobs) {
    const createdAt = job.createdAt.getTime();

    if (createdAt > keepAt) {
      keepAt = createdAt;
      keepRunId = getStringField(job.payload, "runId");
    }
  }

  return reconcileJobs.flatMap((job) =>
    getStringField(job.payload, "runId") === keepRunId ? [] : [job.id],
  );
}

export function buildEbayItemJobSplitPayloads(input: {
  ebayItemIds: string[];
  maxItems: number;
  parentJobId: string;
  payload: EbayItemJobPayload;
}) {
  const maxItems = normalizeMaxItems(input.maxItems);
  const chunks = chunkArray(input.ebayItemIds, maxItems);

  return chunks.map((ebayItemIds, index) => ({
    ...input.payload,
    ebayItemIds,
    parentJobId: input.parentJobId,
    requestedCount: ebayItemIds.length,
    splitCount: chunks.length,
    splitIndex: index + 1,
  }));
}

export function buildEbayItemJobSplitIdempotencyKey(input: {
  parentJobId: string;
  payload: EbayItemJobPayload;
  splitIndex: number;
}) {
  const runIdentity =
    getStringField(input.payload, "catalogImportRunId") ??
    getStringField(input.payload, "runId") ??
    stableStringify(input.payload);
  const hash = createHash("sha256").update(runIdentity).digest("hex").slice(0, 20);

  return `split:${input.parentJobId}:${hash}:${input.splitIndex}`;
}

export function buildSellerEventsNoopMarker(input: {
  eventReadCount: number;
  imageRepairJobCount?: number;
  marketplaceId: string;
  modTimeFrom: string;
  modTimeTo: string;
}) {
  const imageRepairJobCount = Math.max(
    Number.isInteger(input.imageRepairJobCount) ? Number(input.imageRepairJobCount) : 0,
    0,
  );
  const payload = {
    eventReadCount: input.eventReadCount,
    ...(imageRepairJobCount > 0 ? { imageRepairJobCount } : {}),
    marketplaceId: input.marketplaceId,
    modTimeFrom: input.modTimeFrom,
    modTimeTo: input.modTimeTo,
    source: "seller_events_delta",
    watermarkAdvanced: true,
  };

  return {
    payload,
    result: {
      eventReadCount: input.eventReadCount,
      ...(imageRepairJobCount > 0 ? { imageRepairJobCount } : {}),
      noWork: true,
      source: "seller_events_delta",
      watermarkAdvanced: true,
    },
  };
}

function normalizeMaxItems(maxItems: number) {
  if (!Number.isInteger(maxItems) || maxItems < 1) return 1;

  return maxItems;
}

function getStringField(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const field = (value as Record<string, unknown>)[key];

  return typeof field === "string" ? field : null;
}

function getBooleanField(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const field = (value as Record<string, unknown>)[key];

  return typeof field === "boolean" ? field : null;
}

function getShopifyChangeJobDedupeKey(input: { payload: unknown; shopId: string }) {
  const topic = getStringField(input.payload, "topic");
  const resourceId = getShopifyChangeJobResourceKey(input.payload);

  if (!topic || !resourceId) return null;

  return `${input.shopId}:${topic}:${resourceId}`;
}

export function getShopifyChangeJobResourceKey(payload: unknown) {
  return getShopifyChangeJobResourceKeys(payload)[0] ?? null;
}

export function getShopifyChangeJobResourceKeys(payload: unknown) {
  const keys = [
    getStringField(payload, "resourceId"),
    getStringField(payload, "inventoryItemGid"),
    getStringField(payload, "adminGraphqlApiId"),
    getStringField(payload, "admin_graphql_api_id"),
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(keys));
}

export function shouldSkipRecentShopifyProductChangeJob(input: {
  cooldownMs?: number;
  now: Date;
  payload: unknown;
  recentJob: {
    finishedAt?: Date | null;
    payload: unknown;
    startedAt?: Date | null;
    status: string;
    updatedAt?: Date | null;
  } | null;
}) {
  // A running or completed detection job cannot prove it observed a later
  // merchant edit, so webhook bursts are coalesced only while still queued.
  void input;
  return false;
}

function stableStringify(value: unknown) {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, field]) => [key, sortJsonValue(field)]),
  );
}
import { chunkArray } from "./chunk-array";
