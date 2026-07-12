import { Prisma } from "@prisma/client";

import prisma from "../db.server";
import {
  buildProductHistoryRetentionPlan,
  getOperationalMaintenanceKey,
} from "../lib/syncbay-product-history-retention";
import { getProductFacetBaselineFromSnapshotPayload } from "../lib/syncbay-product-snapshot-payload";
import { runRetentionCleanup } from "./retention-cleanup.server";

export interface ProductBaselineWrite {
  mappingId: string;
  shopId: string;
  shopifyProductGid?: string | null;
  shopifyVariantGid?: string | null;
  shopifyInventoryItemGid?: string | null;
  title?: string | null;
  descriptionHash?: string | null;
  priceAmount?: string | null;
  compareAtPriceAmount?: string | null;
  currency?: string | null;
  quantity?: number | null;
  productStatus?: string | null;
  imageCount?: number | null;
  productFacets?: Record<string, string[]> | null;
  lastWriterJobId?: string | null;
}

export interface ProductSyncBaselineRecord extends Required<ProductBaselineWrite> {
  createdAt: Date;
  updatedAt: Date;
}

interface ProductHistoryTransactionPort {
  upsertBaseline(input: ProductBaselineWrite): Promise<void>;
  createSnapshots(rows: Prisma.ProductSnapshotCreateManyInput[]): Promise<void>;
}

export interface ProductHistoryPorts {
  transaction(run: (tx: ProductHistoryTransactionPort) => Promise<void>): Promise<void>;
}

type ProductHistoryTransactionClient = Pick<
  Prisma.TransactionClient,
  "productSnapshot" | "productSyncBaseline"
>;

function compactUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

function createPrismaPorts(): ProductHistoryPorts {
  return {
    async transaction(run) {
      await prisma.$transaction(async (tx) => {
        await run({
          async createSnapshots(rows) {
            await tx.productSnapshot.createMany({ data: rows });
          },
          async upsertBaseline(input) {
            const update = compactUndefined({
              shopId: input.shopId,
              shopifyProductGid: input.shopifyProductGid,
              shopifyVariantGid: input.shopifyVariantGid,
              shopifyInventoryItemGid: input.shopifyInventoryItemGid,
              title: input.title,
              descriptionHash: input.descriptionHash,
              priceAmount: input.priceAmount,
              compareAtPriceAmount: input.compareAtPriceAmount,
              currency: input.currency,
              quantity: input.quantity,
              productStatus: input.productStatus,
              imageCount: input.imageCount,
              productFacets: input.productFacets,
              lastWriterJobId: input.lastWriterJobId,
            });
            await tx.productSyncBaseline.upsert({
              where: { mappingId: input.mappingId },
              create: {
                mappingId: input.mappingId,
                shopId: input.shopId,
                shopifyProductGid: input.shopifyProductGid ?? null,
                shopifyVariantGid: input.shopifyVariantGid ?? null,
                shopifyInventoryItemGid: input.shopifyInventoryItemGid ?? null,
                title: input.title ?? null,
                descriptionHash: input.descriptionHash ?? null,
                priceAmount: input.priceAmount ?? null,
                compareAtPriceAmount: input.compareAtPriceAmount ?? null,
                currency: input.currency ?? null,
                quantity: input.quantity ?? null,
                productStatus: input.productStatus ?? null,
                imageCount: input.imageCount ?? null,
                productFacets: input.productFacets ?? undefined,
                lastWriterJobId: input.lastWriterJobId ?? null,
              },
              update,
            });
          },
        });
      });
    },
  };
}

function getJsonObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Prisma.JsonObject
    : null;
}

function getPayloadString(payload: unknown, ...path: string[]) {
  let current: unknown = payload;
  for (const key of path) current = getJsonObject(current)?.[key];
  return typeof current === "string" && current.trim() ? current.trim() : undefined;
}

function getProductFacets(payload: unknown) {
  const facets = getProductFacetBaselineFromSnapshotPayload(payload);
  if (facets === null) return undefined;
  const result: Record<string, string[]> = {};
  for (const facet of facets) {
    result[facet.key] = [...new Set([...(result[facet.key] ?? []), facet.value])];
  }
  return result;
}

export function buildProductBaselineWriteFromSnapshot(
  snapshot: Prisma.ProductSnapshotCreateManyInput,
): ProductBaselineWrite | null {
  if (!snapshot.mappingId) return null;
  return {
    mappingId: snapshot.mappingId,
    shopId: snapshot.shopId,
    shopifyProductGid: snapshot.shopifyProductGid,
    shopifyVariantGid: snapshot.shopifyVariantGid,
    shopifyInventoryItemGid: getPayloadString(snapshot.payload, "inventorySync", "inventoryItemGid"),
    title: snapshot.title,
    descriptionHash: snapshot.descriptionHash,
    priceAmount: snapshot.priceAmount === undefined || snapshot.priceAmount === null
      ? snapshot.priceAmount
      : String(snapshot.priceAmount),
    compareAtPriceAmount: getPayloadString(snapshot.payload, "pricing", "compareAtPriceAmount"),
    currency: snapshot.currency,
    quantity: snapshot.quantity,
    productStatus: snapshot.productStatus,
    imageCount: snapshot.imageCount,
    productFacets: getProductFacets(snapshot.payload),
    lastWriterJobId: getPayloadString(snapshot.payload, "syncJobId"),
  };
}

export async function recordProductSnapshotsInTransaction(
  tx: ProductHistoryTransactionClient,
  snapshots: Prisma.ProductSnapshotCreateManyInput[],
) {
  for (const snapshot of snapshots) {
    const baseline = buildProductBaselineWriteFromSnapshot(snapshot);
    if (!baseline) continue;
    const update = compactUndefined({
      shopId: baseline.shopId,
      shopifyProductGid: baseline.shopifyProductGid,
      shopifyVariantGid: baseline.shopifyVariantGid,
      shopifyInventoryItemGid: baseline.shopifyInventoryItemGid,
      title: baseline.title,
      descriptionHash: baseline.descriptionHash,
      priceAmount: baseline.priceAmount,
      compareAtPriceAmount: baseline.compareAtPriceAmount,
      currency: baseline.currency,
      quantity: baseline.quantity,
      productStatus: baseline.productStatus,
      imageCount: baseline.imageCount,
      productFacets: baseline.productFacets,
      lastWriterJobId: baseline.lastWriterJobId,
    });
    await tx.productSyncBaseline.upsert({
      where: { mappingId: baseline.mappingId },
      create: {
        mappingId: baseline.mappingId,
        shopId: baseline.shopId,
        shopifyProductGid: baseline.shopifyProductGid ?? null,
        shopifyVariantGid: baseline.shopifyVariantGid ?? null,
        shopifyInventoryItemGid: baseline.shopifyInventoryItemGid ?? null,
        title: baseline.title ?? null,
        descriptionHash: baseline.descriptionHash ?? null,
        priceAmount: baseline.priceAmount ?? null,
        compareAtPriceAmount: baseline.compareAtPriceAmount ?? null,
        currency: baseline.currency ?? null,
        quantity: baseline.quantity ?? null,
        productStatus: baseline.productStatus ?? null,
        imageCount: baseline.imageCount ?? null,
        productFacets: baseline.productFacets ?? undefined,
        lastWriterJobId: baseline.lastWriterJobId ?? null,
      },
      update,
    });
  }
  if (snapshots.length > 0) await tx.productSnapshot.createMany({ data: snapshots });
}

export async function upsertProductSyncBaseline(input: ProductBaselineWrite) {
  return recordProductHistory({ baseline: input, snapshots: [] });
}

export async function loadProductSyncBaselines(mappingIds: string[]) {
  if (mappingIds.length === 0) return new Map<string, ProductSyncBaselineRecord>();
  const rows = await prisma.productSyncBaseline.findMany({
    where: { mappingId: { in: [...new Set(mappingIds)] } },
  });
  return new Map(rows.map((row) => [row.mappingId, row as ProductSyncBaselineRecord]));
}

export async function recordProductHistory(
  input: {
    baseline: ProductBaselineWrite;
    snapshots: Prisma.ProductSnapshotCreateManyInput[];
  },
  ports: ProductHistoryPorts = createPrismaPorts(),
) {
  await ports.transaction(async (tx) => {
    await tx.upsertBaseline(input.baseline);
    if (input.snapshots.length > 0) await tx.createSnapshots(input.snapshots);
  });
}

export interface OperationalMaintenanceResult {
  checkpointDeletedCount: number;
  checkpointUpsertedCount: number;
  cronRunDeletedCount: number;
  enabled: boolean;
  eventDeletedCount: number;
  key: string;
  skipped: boolean;
  uncompactedOversizeCount: number;
}

function isMaintenanceEnabled() {
  return process.env.SYNCBAY_RETENTION_CLEANUP_ENABLED?.trim() !== "false" &&
    process.env.SYNCBAY_PRODUCT_HISTORY_COMPACTION_ENABLED?.trim() === "true";
}

export async function runDailyOperationalMaintenance(input: {
  now?: Date;
  dryRun?: boolean;
} = {}): Promise<OperationalMaintenanceResult> {
  const now = input.now ?? new Date();
  const key = getOperationalMaintenanceKey(now);
  const enabled = isMaintenanceEnabled() && !input.dryRun;
  const plan = buildProductHistoryRetentionPlan(now);
  const base = {
    checkpointDeletedCount: 0,
    checkpointUpsertedCount: 0,
    cronRunDeletedCount: 0,
    enabled,
    eventDeletedCount: 0,
    key,
    skipped: false,
    uncompactedOversizeCount: 0,
  };

  if (!enabled) {
    const [events, checkpoints, oversize] = await Promise.all([
      prisma.productSnapshot.count({ where: { capturedAt: { lt: plan.eventCutoff } } }),
      prisma.productSnapshotCheckpoint.count({ where: { checkpointWeek: { lt: plan.checkpointCutoff } } }),
      prisma.productSnapshot.count({
        where: {
          capturedAt: { gte: plan.checkpointCutoff, lt: plan.eventCutoff },
          mappingId: { not: null },
          payload: { not: Prisma.DbNull },
        },
      }),
    ]);
    return { ...base, checkpointDeletedCount: checkpoints, eventDeletedCount: events, uncompactedOversizeCount: oversize };
  }

  const existing = await prisma.maintenanceRun.findUnique({ where: { key } });
  if (existing?.status === "SUCCEEDED") return { ...base, skipped: true };
  if (existing?.status === "RUNNING" && existing.startedAt > new Date(now.getTime() - 30 * 60 * 1_000)) {
    return { ...base, skipped: true };
  }

  await prisma.maintenanceRun.upsert({
    where: { key },
    create: { key, status: "RUNNING" },
    update: { attempt: { increment: 1 }, completedAt: null, errorCode: null, startedAt: now, status: "RUNNING" },
  });

  try {
    const inserted = await prisma.$executeRaw`
      WITH candidates AS (
        SELECT DISTINCT ON (s."mappingId", s.source, date_trunc('week', s."capturedAt"))
          s.*, date_trunc('week', s."capturedAt")::date AS checkpoint_week,
          jsonb_strip_nulls(jsonb_build_object(
            'pricing', s.payload->'pricing',
            'productFacets', s.payload->'productFacets',
            'inventorySync', s.payload->'inventorySync',
            'syncJobId', s.payload->'syncJobId'
          )) AS checkpoint_payload
        FROM "ProductSnapshot" s
        WHERE s."mappingId" IS NOT NULL
          AND s."capturedAt" < ${plan.eventCutoff}
          AND s."capturedAt" >= ${plan.checkpointCutoff}
        ORDER BY s."mappingId", s.source, date_trunc('week', s."capturedAt"), s."capturedAt" DESC
      )
      INSERT INTO "ProductSnapshotCheckpoint" (
        id, "mappingId", "shopId", source, "checkpointWeek", "sourceSnapshotId",
        "isComplete", "payloadBytes", title, "descriptionHash", "priceAmount",
        quantity, "productStatus", "imageCount", payload, "createdAt"
      )
      SELECT gen_random_uuid()::text, "mappingId", "shopId", source, checkpoint_week,
        id, octet_length(checkpoint_payload::text) <= 65536,
        octet_length(checkpoint_payload::text), title, "descriptionHash",
        "priceAmount", quantity, "productStatus", "imageCount",
        CASE WHEN octet_length(checkpoint_payload::text) <= 65536 THEN checkpoint_payload ELSE NULL END, ${now}
      FROM candidates candidate
      WHERE NOT EXISTS (
        SELECT 1 FROM LATERAL (
          SELECT * FROM "ProductSnapshotCheckpoint" prior
          WHERE prior."mappingId"=candidate."mappingId"
            AND prior.source=candidate.source
            AND prior."checkpointWeek" < candidate.checkpoint_week
          ORDER BY prior."checkpointWeek" DESC LIMIT 1
        ) previous
        WHERE ROW(previous.title, previous."descriptionHash", previous."priceAmount",
            previous.quantity, previous."productStatus", previous."imageCount", previous.payload)
            IS NOT DISTINCT FROM
            ROW(candidate.title, candidate."descriptionHash", candidate."priceAmount",
              candidate.quantity, candidate."productStatus", candidate."imageCount", candidate.checkpoint_payload)
      )
      ON CONFLICT ("mappingId", source, "checkpointWeek") DO UPDATE SET
        "sourceSnapshotId"=excluded."sourceSnapshotId",
        "isComplete"=excluded."isComplete", "payloadBytes"=excluded."payloadBytes",
        title=excluded.title, "descriptionHash"=excluded."descriptionHash",
        "priceAmount"=excluded."priceAmount", quantity=excluded.quantity,
        "productStatus"=excluded."productStatus", "imageCount"=excluded."imageCount",
        payload=excluded.payload
    `;

    let eventDeletedCount = 0;
    for (;;) {
      const deleted = await prisma.$executeRaw`
        WITH removable AS (
          SELECT s.id FROM "ProductSnapshot" s
          WHERE s."capturedAt" < ${plan.eventCutoff}
            AND (
              s."mappingId" IS NULL OR EXISTS (
                SELECT 1 FROM "ProductSnapshotCheckpoint" c
                WHERE c."mappingId"=s."mappingId" AND c.source=s.source
                  AND c."checkpointWeek"=date_trunc('week', s."capturedAt")::date
                  AND c."isComplete"=true
              ) OR s."capturedAt" < ${plan.checkpointCutoff}
            )
          ORDER BY s."capturedAt" LIMIT 1000
        )
        DELETE FROM "ProductSnapshot" WHERE id IN (SELECT id FROM removable)
      `;
      eventDeletedCount += deleted;
      if (deleted < 1000) break;
    }

    const checkpointDeleted = await prisma.productSnapshotCheckpoint.deleteMany({
      where: { checkpointWeek: { lt: plan.checkpointCutoff } },
    });
    const cronRunDeletedCount = await prisma.$executeRaw`
      DELETE FROM cron.job_run_details
      WHERE end_time IS NOT NULL AND end_time < ${new Date(now.getTime() - 14 * 24 * 60 * 60 * 1_000)}
    `;
    await runRetentionCleanup({ now });
    const uncompactedOversizeCount = await prisma.productSnapshotCheckpoint.count({
      where: { isComplete: false },
    });
    const result: OperationalMaintenanceResult = {
      ...base,
      checkpointDeletedCount: checkpointDeleted.count,
      checkpointUpsertedCount: inserted,
      cronRunDeletedCount,
      eventDeletedCount,
      uncompactedOversizeCount,
    };
    await prisma.maintenanceRun.update({
      where: { key },
      data: { completedAt: new Date(), result: result as unknown as Prisma.JsonObject, status: "SUCCEEDED" },
    });
    return result;
  } catch (error) {
    await prisma.maintenanceRun.update({
      where: { key },
      data: { completedAt: new Date(), errorCode: error instanceof Error ? error.name : "UNKNOWN", status: "FAILED" },
    });
    throw error;
  }
}
