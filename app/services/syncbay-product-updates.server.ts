import {
  AuditEventType,
  EbayConnectionStatus,
  Prisma,
  ProductPublicationMode as PrismaProductPublicationMode,
  ProductMappingStatus,
  ProductSnapshotSource,
  SyncConflictResolution,
  SyncConflictStatus,
  SyncJobStatus,
  SyncJobType,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import prisma from "../db.server";
import {
  IMPORT_PRODUCT_STATUS_VALUES,
  getImportProductStatusLabelCapitalized,
  normalizeImportProductStatus,
  type ImportProductStatus,
} from "../lib/import-product-status";
import { SYNCBAY_AUDIT_LOG_CREATE_SELECT } from "../lib/syncbay-audit-log-write";
import {
  getSafeBatchConflictResolutions,
  isStaleConflictResolutionError,
} from "../lib/syncbay-conflict-actions";
import { SYNCBAY_DESCRIPTION_BASELINE_PAYLOAD_SQL } from "../lib/syncbay-conflict-detection";
import {
  getDescriptionRuleSummary,
  normalizeDescriptionRule,
  normalizeDescriptionRuleFormInput,
} from "../lib/syncbay-description-rules";
import { getManualRetryState } from "../lib/syncbay-job-diagnostics";
import { getKeepShopifyDescriptionHash } from "../lib/syncbay-keep-shopify-baseline";
import { buildPricingRuleSyncPlan } from "../lib/syncbay-pricing-rule-sync";
import { normalizePricingRuleFormInput } from "../lib/syncbay-pricing-rules";
import { type ShopifyProductPublication } from "../lib/syncbay-product-publication";
import {
  normalizeProductPublicationMode,
  serializeProductPublicationGids,
  type ProductPublicationMode,
} from "../lib/syncbay-product-publication-settings";
import { getSyncTargetLabel, normalizeSyncTargetSeconds } from "../lib/syncbay-sync-interval";
import { getSyncEnablementBlockers } from "../lib/syncbay-sync-settings";
import { getEbayMarketplaceId } from "./ebay-environment.server";
import { DEFAULT_PRICING_RULE, normalizePricingRule } from "./pricing-rules.server";
import { recordProductSnapshotsInTransaction } from "./product-history.server";

import { ensureShopForSession } from "./syncbay-operations.server";
import {
  CATALOG_IMPORT_BATCH_MAX_ATTEMPTS,
  ShopifySessionLike,
  canRequestRetry,
  getExistingDescriptionRuleForSettings,
  getJsonNumber,
  getJsonObject,
} from "./syncbay-shared.server";

interface ShopifyLocationInput {
  fulfillsOnlineOrders: boolean;
  id: string;
  isActive: boolean;
  name: string;
}

const PRICING_RULE_SYNC_BATCH_SIZE = 10;

const RETRIED_SYNC_JOB_MIN_MAX_ATTEMPTS = 4;

export async function requestSyncJobRetry(session: ShopifySessionLike, jobId: string) {
  const shop = await ensureShopForSession(session);
  const job = await prisma.syncJob.findFirst({
    where: {
      id: jobId,
      shopId: shop.id,
    },
  });

  if (!job) {
    throw new Response("Job SyncBay non trovato per questo shop.", {
      status: 404,
    });
  }

  if (!canRequestRetry(job.status)) {
    throw new Response("Questo job non è in uno stato riprogrammabile.", {
      status: 400,
    });
  }

  const now = new Date();
  const retryState = getManualRetryState(
    {
      attempts: job.attempts,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      maxAttempts: job.maxAttempts,
      runAfter: job.runAfter,
      status: job.status,
      type: job.type,
    },
    now,
  );

  if (!retryState.canRetry) {
    throw new Response(retryState.reason, { status: 400 });
  }

  const details = {
    jobId: job.id,
    previousAttempts: job.attempts,
    previousMaxAttempts: job.maxAttempts,
    previousRunAfter: job.runAfter.toISOString(),
    previousStatus: job.status,
    requestedAt: now.toISOString(),
    type: job.type,
  } satisfies Prisma.JsonObject;

  await prisma.$transaction([
    prisma.syncJob.update({
      data: {
        errorCode: null,
        errorMessage: null,
        finishedAt: null,
        attempts: 0,
        maxAttempts: Math.max(job.maxAttempts, RETRIED_SYNC_JOB_MIN_MAX_ATTEMPTS),
        result: Prisma.DbNull,
        runAfter: now,
        startedAt: null,
        status: SyncJobStatus.PENDING,
      },
      where: { id: job.id },
    }),
    prisma.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
      data: {
        details,
        message: "Retry job richiesto dalla dashboard.",
        shopId: shop.id,
        type: AuditEventType.SYNC_JOB_CREATED,
      },
    }),
  ]);

  return {
    message:
      "Job rimesso in coda. Il runner automatico lo prenderà in carico quando sarà collegato; per l'import puoi rieseguire subito dalla preview.",
    status: "queued" as const,
  };
}

export async function resolveSyncConflict(
  session: ShopifySessionLike,
  input: {
    conflictId: string;
    resolution: string;
  },
) {
  const shop = await ensureShopForSession(session);
  const resolution = normalizeConflictResolution(input.resolution);
  const conflict = await prisma.syncConflict.findFirst({
    include: { mapping: true },
    where: {
      id: input.conflictId,
      shopId: shop.id,
      status: SyncConflictStatus.OPEN,
    },
  });
  let baselineSnapshot: Prisma.ProductSnapshotGetPayload<Record<string, never>> | null = null;
  let descriptionBaselineSnapshot: { descriptionHash: string | null } | null = null;
  if (resolution === SyncConflictResolution.KEEP_SHOPIFY && conflict?.mappingId) {
    [baselineSnapshot, descriptionBaselineSnapshot] = await Promise.all([
      prisma.productSnapshot.findFirst({
        orderBy: { capturedAt: "desc" },
        where: {
          mappingId: conflict.mappingId,
          source: ProductSnapshotSource.SYNCBAY,
        },
      }),
      findLatestKeepShopifyDescriptionBaseline(conflict.mappingId),
    ]);
  }

  if (!conflict) {
    throw new Response("Conflitto SyncBay non trovato.", { status: 404 });
  }

  const now = new Date();
  const keepShopifySnapshot = baselineSnapshot
    ? buildKeepShopifyBaselineSnapshot({
        conflict,
        latestDescriptionBaselineHash: descriptionBaselineSnapshot?.descriptionHash ?? null,
        snapshot: baselineSnapshot,
      })
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.syncConflict.update({
      data: {
        resolution,
        resolvedAt: now,
        status:
          resolution === SyncConflictResolution.IGNORE_FIELD
            ? SyncConflictStatus.IGNORED
            : SyncConflictStatus.RESOLVED,
      },
      where: { id: conflict.id },
    });
    await tx.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
      data: {
        details: {
          conflictId: conflict.id,
          field: conflict.field,
          resolution,
        },
        message: "Conflitto Shopify gestito dalla dashboard.",
        shopId: shop.id,
        type: AuditEventType.CONNECTION_CHECK,
      },
    });
    if (keepShopifySnapshot) {
      await recordProductSnapshotsInTransaction(tx, [keepShopifySnapshot]);
    }

    if (resolution === SyncConflictResolution.REALIGN_FROM_EBAY && conflict.mapping?.ebayItemId) {
      await tx.syncJob.create({
        data: {
          payload: {
            ebayItemIds: [conflict.mapping.ebayItemId],
            marketplaceId: conflict.mapping.marketplaceId,
            source: "conflict_resolution",
          } satisfies Prisma.JsonObject,
          runAfter: now,
          shopId: shop.id,
          status: SyncJobStatus.PENDING,
          type: SyncJobType.SYNC_INCREMENTAL,
        },
      });
    }
  });

  return {
    message: "Conflitto aggiornato.",
    status: "resolved" as const,
  };
}

/**
 * Risolve in blocco i soli conflitti "sicuri" aperti applicando, per ogni
 * campo, la risoluzione sicura prevista (oggi: descrizione -> mantieni la
 * versione di Shopify, senza toccare eBay). Riusa `resolveSyncConflict` per
 * ogni conflitto, così la logica resta una sola. Copre tutti i conflitti
 * aperti, non solo la pagina visibile. I conflitti delicati restano manuali.
 */
export async function resolveBatchSafeConflicts(session: ShopifySessionLike) {
  const shop = await ensureShopForSession(session);
  const openConflicts = await prisma.syncConflict.findMany({
    select: { field: true, id: true },
    where: { shopId: shop.id, status: SyncConflictStatus.OPEN },
  });

  let resolvedCount = 0;
  for (const conflict of openConflicts) {
    const safeResolution = getSafeBatchConflictResolutions(conflict.field)[0];

    if (!safeResolution) continue;

    try {
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- risoluzione conflitti in serie: ogni resolveSyncConflict può scrivere sul provider, seriale per rispettarne i limiti.
      await resolveSyncConflict(session, {
        conflictId: conflict.id,
        resolution: safeResolution,
      });
      resolvedCount += 1;
    } catch (error) {
      if (!isStaleConflictResolutionError(error)) throw error;
      // Conflitto già risolto o non più valido: salta senza fermare il blocco.
    }
  }

  return {
    message:
      resolvedCount === 0
        ? "Nessun conflitto sicuro da risolvere."
        : resolvedCount === 1
          ? "1 conflitto sicuro risolto: descrizione di Shopify mantenuta."
          : `${resolvedCount} conflitti sicuri risolti: descrizioni di Shopify mantenute.`,
    resolvedCount,
  };
}

function buildKeepShopifyBaselineSnapshot(input: {
  conflict: Prisma.SyncConflictGetPayload<Record<string, never>>;
  latestDescriptionBaselineHash: string | null;
  snapshot: Prisma.ProductSnapshotGetPayload<Record<string, never>>;
}) {
  const shopifyValue = input.conflict.shopifyValue;
  const snapshotPayload = getKeepShopifyBaselinePayload(input.snapshot.payload);
  const keptShopifyPriceAmount =
    input.conflict.field === "price"
      ? getConflictPriceAmount(shopifyValue)
      : input.snapshot.priceAmount;
  const keptShopifyCompareAtPrice =
    input.conflict.field === "price"
      ? getConflictCompareAtPrice(shopifyValue)
      : getPricingPayloadValue(snapshotPayload, "compareAtPriceAmount");

  return {
    currency: input.snapshot.currency,
    descriptionHash: getKeepShopifyDescriptionHash({
      conflictField: input.conflict.field,
      latestDescriptionBaselineHash: input.latestDescriptionBaselineHash,
      shopifyValue,
      snapshotDescriptionHash: input.snapshot.descriptionHash,
    }),
    ebayItemId: input.snapshot.ebayItemId,
    imageCount:
      input.conflict.field === "images"
        ? getJsonIntegerValue(shopifyValue)
        : input.snapshot.imageCount,
    mappingId: input.snapshot.mappingId,
    payload: {
      ...snapshotPayload,
      ...(input.conflict.field === "price"
        ? {
            pricing: {
              ...getJsonObject(snapshotPayload.pricing),
              compareAtPriceAmount: keptShopifyCompareAtPrice,
              priceAmount: keptShopifyPriceAmount?.toString() ?? null,
            },
          }
        : {}),
      conflictResolution: {
        conflictId: input.conflict.id,
        field: input.conflict.field,
        resolution: SyncConflictResolution.KEEP_SHOPIFY,
      },
    } satisfies Prisma.JsonObject,
    priceAmount:
      input.conflict.field === "price" ? keptShopifyPriceAmount : input.snapshot.priceAmount,
    productStatus:
      input.conflict.field === "status"
        ? getJsonStringValue(shopifyValue)
        : input.snapshot.productStatus,
    quantity:
      input.conflict.field === "quantity"
        ? getJsonIntegerValue(shopifyValue)
        : input.snapshot.quantity,
    shopId: input.snapshot.shopId,
    shopifyProductGid: input.snapshot.shopifyProductGid,
    shopifyVariantGid: input.snapshot.shopifyVariantGid,
    sku: input.snapshot.sku,
    source: ProductSnapshotSource.SYNCBAY,
    title:
      input.conflict.field === "title" ? getJsonStringValue(shopifyValue) : input.snapshot.title,
  };
}

function getKeepShopifyBaselinePayload(value: Prisma.JsonValue | undefined) {
  const payload = { ...(getJsonObject(value) ?? {}) };

  delete payload.updatedEbayFromShopifyOrder;
  delete payload.restoredEbayAfterTest;

  return payload;
}

async function findLatestKeepShopifyDescriptionBaseline(mappingId: string) {
  const rows = await prisma.$queryRaw<{ descriptionHash: string | null }[]>`
    SELECT "descriptionHash"
    FROM "ProductSnapshot"
    WHERE
      "mappingId" = ${mappingId}
      AND "source" = 'SYNCBAY'::"ProductSnapshotSource"
      AND "descriptionHash" IS NOT NULL
      AND ${SYNCBAY_DESCRIPTION_BASELINE_PAYLOAD_SQL}
    ORDER BY "capturedAt" DESC
    LIMIT 1
  `;

  return rows[0] ?? null;
}

export async function updateDescriptionRuleSettings(
  session: ShopifySessionLike,
  input: { mode: string },
) {
  const normalized = normalizeDescriptionRuleFormInput(input);
  const shop = await ensureShopForSession(session);

  if (normalized.status === "invalid") {
    return {
      descriptionRule: await getExistingDescriptionRuleForSettings(shop.id),
      message: normalized.message,
      status: "blocked" as const,
    };
  }

  const savedRule = await prisma.$transaction(async (tx) => {
    const rule = await tx.descriptionRule.upsert({
      create: {
        mode: normalized.mode,
        shopId: shop.id,
      },
      select: { mode: true },
      update: { mode: normalized.mode },
      where: { shopId: shop.id },
    });

    await tx.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
      data: {
        details: {
          descriptionMode: normalized.mode,
        },
        message: `Regola descrizione aggiornata: ${getDescriptionRuleSummary(normalized.mode)}.`,
        shopId: shop.id,
        type: AuditEventType.CONNECTION_CHECK,
      },
    });

    return rule;
  });

  return {
    descriptionRule: normalizeDescriptionRule(savedRule),
    message: `Regola descrizione salvata: ${getDescriptionRuleSummary(savedRule.mode)}. Verrà usata dai prossimi import e dalle prossime anteprime di pulizia.`,
    status: "saved" as const,
  };
}

export async function updatePricingRuleSettings(
  session: ShopifySessionLike,
  input: {
    discountPercent: string;
    roundingMode: string;
  },
) {
  const normalized = normalizePricingRuleFormInput(input);
  const shop = await ensureShopForSession(session);

  if (normalized.status === "invalid") {
    return {
      message: normalized.message,
      pricingRule: await getExistingPricingRuleForSettings(shop.id),
      status: "blocked" as const,
    };
  }

  const pricingUpdate = await prisma.$transaction(async (tx) => {
    // react-doctor-disable-next-line react-doctor/async-parallel -- dentro prisma.$transaction interattiva: query concorrenti sullo stesso tx non supportate da Prisma.
    const savedRule = await tx.pricingRule.upsert({
      create: {
        discountPercent: normalized.discountPercent,
        roundingMode: normalized.roundingMode,
        shopId: shop.id,
      },
      select: {
        discountPercent: true,
        roundingMode: true,
      },
      update: {
        discountPercent: normalized.discountPercent,
        roundingMode: normalized.roundingMode,
      },
      where: { shopId: shop.id },
    });
    // react-doctor-disable-next-line react-doctor/server-sequential-independent-await -- dentro prisma.$transaction interattiva: query concorrenti sullo stesso tx non supportate da Prisma.
    const activeMappings = await tx.productMapping.findMany({
      orderBy: { updatedAt: "asc" },
      select: { ebayItemId: true },
      where: {
        marketplaceId: getEbayMarketplaceId(),
        shopId: shop.id,
        status: ProductMappingStatus.ACTIVE,
      },
    });
    const ebayConnection = await tx.ebayConnection.findUnique({
      select: { status: true },
      where: {
        shopId_marketplaceId: {
          marketplaceId: getEbayMarketplaceId(),
          shopId: shop.id,
        },
      },
    });
    const syncPlan = buildPricingRuleSyncPlan({
      activeEbayItemIds: activeMappings.map((mapping) => mapping.ebayItemId),
      batchSize: PRICING_RULE_SYNC_BATCH_SIZE,
      ebayConnected: ebayConnection?.status === EbayConnectionStatus.CONNECTED,
      hasDefaultLocation: Boolean(shop.defaultLocationGid),
    });
    const now = new Date();
    const runId = `pricing-rule:${shop.id}:${now.toISOString()}:${randomUUID()}`;

    if (syncPlan.batches.length > 0) {
      await tx.syncJob.createMany({
        data: syncPlan.batches.map((ebayItemIds, index) => ({
          attempts: 0,
          idempotencyKey: `pricing-rule-sync:${shop.id}:${index + 1}:${runId}`,
          maxAttempts: CATALOG_IMPORT_BATCH_MAX_ATTEMPTS,
          payload: {
            batchCount: syncPlan.batches.length,
            batchIndex: index + 1,
            discountPercent: normalized.discountPercent,
            ebayItemIds,
            importProductStatus: normalizeImportProductStatus(shop.defaultProductStatus),
            marketplaceId: getEbayMarketplaceId(),
            pricingOnly: syncPlan.pricingOnly,
            requestedCount: ebayItemIds.length,
            roundingMode: normalized.roundingMode,
            runId,
            source: "pricing_rule_update",
          } satisfies Prisma.JsonObject,
          runAfter: now,
          shopId: shop.id,
          status: SyncJobStatus.PENDING,
          type: SyncJobType.SYNC_INCREMENTAL,
        })),
      });
    }

    await tx.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
      data: {
        details: {
          discountPercent: normalized.discountPercent,
          queuedPricingRuleSyncJobCount: syncPlan.batches.length,
          queuedPricingRuleSyncProductCount: syncPlan.queuedProductCount,
          queuedPricingRuleSyncSkippedReason: syncPlan.skippedReason,
          roundingMode: normalized.roundingMode,
        },
        message: `Regola prezzo Shopify aggiornata: sconto ${normalized.discountPercent}% con arrotondamento ${getPricingRoundingModeLabel(normalized.roundingMode)}.`,
        shopId: shop.id,
        type: AuditEventType.CONNECTION_CHECK,
      },
    });

    return {
      pricingRule: savedRule,
      syncSkippedReason: syncPlan.skippedReason,
      queuedProductCount: syncPlan.queuedProductCount,
      queuedSyncJobCount: syncPlan.batches.length,
    };
  });
  const syncMessage = pricingUpdate.syncSkippedReason
    ? ` Riallineamento non pianificato: ${pricingUpdate.syncSkippedReason}.`
    : pricingUpdate.queuedProductCount > 0
      ? ` Riallineamento pianificato per ${pricingUpdate.queuedProductCount} prodotti.`
      : " Nessun prodotto attivo da riallineare.";

  return {
    message: `Regola prezzo salvata: ${formatPricingRuleSummary(pricingUpdate.pricingRule)}.${syncMessage}`,
    pricingRule: normalizePricingRule(pricingUpdate.pricingRule),
    status: "saved" as const,
  };
}

async function getExistingPricingRuleForSettings(shopId: string) {
  const pricingRule = await prisma.pricingRule.findUnique({
    select: {
      discountPercent: true,
      roundingMode: true,
    },
    where: { shopId },
  });

  return normalizePricingRule(pricingRule ?? DEFAULT_PRICING_RULE);
}

export async function updateSyncTargetSeconds(session: ShopifySessionLike, value: string) {
  const shop = await ensureShopForSession(session);
  const seconds = normalizeSyncTargetSeconds(value);

  if (seconds === null) {
    return {
      message: "Intervallo non valido. Scegli tra 5, 10, 15, 20 o 30 minuti.",
      status: "blocked" as const,
      syncTargetSeconds: shop.syncTargetSeconds,
    };
  }

  await prisma.$transaction([
    prisma.shop.update({
      data: { syncTargetSeconds: seconds },
      where: { id: shop.id },
    }),
    prisma.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
      data: {
        details: { syncTargetSeconds: seconds },
        message: `Intervallo target di aggiornamento impostato a ${seconds} secondi dalle impostazioni.`,
        shopId: shop.id,
        type: AuditEventType.CONNECTION_CHECK,
      },
    }),
  ]);

  return {
    message: `Intervallo target salvato: ${getSyncTargetLabel(seconds)}.`,
    status: "saved" as const,
    syncTargetSeconds: seconds,
  };
}

export async function updateDefaultShopifyLocation(
  session: ShopifySessionLike,
  locationGid: string,
  availableLocations: ShopifyLocationInput[],
) {
  const selectedLocation = availableLocations.find(
    (location) => location.id === locationGid && location.isActive && location.fulfillsOnlineOrders,
  );

  if (!selectedLocation) {
    throw new Response("Scegli una location Shopify attiva e abilitata agli ordini online.", {
      status: 400,
    });
  }

  const shop = await ensureShopForSession(session);
  await prisma.$transaction([
    prisma.shop.update({
      data: { defaultLocationGid: selectedLocation.id },
      where: { id: shop.id },
    }),
    prisma.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
      data: {
        details: {
          locationGid: selectedLocation.id,
          locationName: selectedLocation.name,
        },
        message: `Location Shopify predefinita impostata: ${selectedLocation.name}.`,
        shopId: shop.id,
        type: AuditEventType.CONNECTION_CHECK,
      },
    }),
  ]);

  return selectedLocation;
}

export async function recordShopifyLocationRenamed(
  session: ShopifySessionLike,
  input: {
    locationGid: string;
    locationName: string;
    previousLocationName: string;
  },
) {
  const shop = await ensureShopForSession(session);

  await prisma.auditLog.create({
    select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
    data: {
      details: {
        locationGid: input.locationGid,
        locationName: input.locationName,
        previousLocationName: input.previousLocationName,
      },
      message: `Location Shopify rinominata: ${input.locationName}.`,
      shopId: shop.id,
      type: AuditEventType.CONNECTION_CHECK,
    },
  });
}

export async function updateDefaultImportProductStatus(
  session: ShopifySessionLike,
  defaultProductStatus: string,
) {
  if (!IMPORT_PRODUCT_STATUS_VALUES.includes(defaultProductStatus as ImportProductStatus)) {
    throw new Response("Stato prodotti non supportato.", { status: 400 });
  }

  const shop = await ensureShopForSession(session);
  const normalizedStatus = normalizeImportProductStatus(defaultProductStatus);

  await prisma.$transaction([
    prisma.shop.update({
      data: { defaultProductStatus: normalizedStatus },
      where: { id: shop.id },
    }),
    prisma.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
      data: {
        details: {
          defaultProductStatus: normalizedStatus,
        },
        message: `Default stato prodotti aggiornato: ${getImportProductStatusLabelCapitalized(normalizedStatus)}.`,
        shopId: shop.id,
        type: AuditEventType.CONNECTION_CHECK,
      },
    }),
  ]);

  return normalizedStatus;
}

export async function updateProductPublicationSettings(
  session: ShopifySessionLike,
  input: {
    availablePublications: ShopifyProductPublication[];
    mode: string;
    selectedPublicationIds: string[];
  },
) {
  const mode = normalizeProductPublicationMode(input.mode);
  const availablePublicationIds = new Set(
    input.availablePublications.map((publication) => publication.id),
  );
  const selectedPublicationIds = input.selectedPublicationIds.filter((publicationId) =>
    availablePublicationIds.has(publicationId),
  );

  if (mode === "SELECTED" && selectedPublicationIds.length === 0) {
    return {
      blockers: ["seleziona almeno un canale Shopify disponibile"],
      mode,
      selectedPublicationIds,
      status: "blocked" as const,
    };
  }

  const shop = await ensureShopForSession(session);
  const serializedPublicationIds =
    mode === "SELECTED" ? serializeProductPublicationGids(selectedPublicationIds) : null;

  await prisma.$transaction([
    prisma.shop.update({
      data: {
        productPublicationGids: serializedPublicationIds,
        productPublicationMode: mode as PrismaProductPublicationMode,
      },
      where: { id: shop.id },
    }),
    prisma.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
      data: {
        details: {
          productPublicationGids: serializedPublicationIds,
          productPublicationMode: mode,
        },
        message: `Policy pubblicazione canali Shopify aggiornata: ${getProductPublicationModeLabel(mode)}.`,
        shopId: shop.id,
        type: AuditEventType.CONNECTION_CHECK,
      },
    }),
  ]);

  return {
    blockers: [],
    mode,
    selectedPublicationIds,
    status: "saved" as const,
  };
}

export async function updateShopSyncEnabled(
  session: ShopifySessionLike,
  requestedSyncEnabled: boolean,
) {
  const shop = await ensureShopForSession(session);
  const [ebayConnection, activeMappingCount] = await prisma.$transaction([
    prisma.ebayConnection.findUnique({
      where: {
        shopId_marketplaceId: {
          marketplaceId: getEbayMarketplaceId(),
          shopId: shop.id,
        },
      },
    }),
    prisma.productMapping.count({
      where: {
        marketplaceId: getEbayMarketplaceId(),
        shopId: shop.id,
        status: ProductMappingStatus.ACTIVE,
      },
    }),
  ]);
  const blockers = getSyncEnablementBlockers({
    activeMappingCount,
    ebayConnected: ebayConnection?.status === EbayConnectionStatus.CONNECTED,
    hasDefaultLocation: Boolean(shop.defaultLocationGid),
    requestedSyncEnabled,
  });

  if (blockers.length > 0) {
    return {
      blockers,
      status: "blocked" as const,
      syncEnabled: shop.syncEnabled,
    };
  }

  await prisma.$transaction([
    prisma.shop.update({
      data: { syncEnabled: requestedSyncEnabled },
      where: { id: shop.id },
    }),
    prisma.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
      data: {
        details: {
          activeMappingCount,
          syncEnabled: requestedSyncEnabled,
        },
        message: requestedSyncEnabled
          ? "Sync catalogo automatico attivato dalle impostazioni."
          : "Sync catalogo automatico disattivato dalle impostazioni.",
        shopId: shop.id,
        type: AuditEventType.CONNECTION_CHECK,
      },
    }),
  ]);

  return {
    blockers: [],
    status: "saved" as const,
    syncEnabled: requestedSyncEnabled,
  };
}

function getProductPublicationModeLabel(mode: ProductPublicationMode) {
  if (mode === "NONE") return "non pubblicare automaticamente";
  if (mode === "SELECTED") return "solo canali selezionati";

  return "tutti i canali disponibili";
}

function getPricingRoundingModeLabel(mode: string) {
  if (mode === "WHOLE_EURO") return "all'euro";

  return "a due decimali";
}

function formatPricingRuleSummary(input: { discountPercent: number; roundingMode: string }) {
  if (input.discountPercent === 0) {
    return "nessuno sconto applicato ai prezzi Shopify";
  }

  return `sconto ${input.discountPercent}%, arrotondamento ${getPricingRoundingModeLabel(input.roundingMode)}`;
}

function normalizeConflictResolution(value: string) {
  if (value === SyncConflictResolution.KEEP_SHOPIFY) {
    return SyncConflictResolution.KEEP_SHOPIFY;
  }
  if (value === SyncConflictResolution.REALIGN_FROM_EBAY) {
    return SyncConflictResolution.REALIGN_FROM_EBAY;
  }
  if (value === SyncConflictResolution.IGNORE_FIELD) {
    return SyncConflictResolution.IGNORE_FIELD;
  }

  throw new Response("Risoluzione conflitto non supportata.", { status: 400 });
}

function getJsonIntegerValue(value: Prisma.JsonValue | undefined) {
  const number = getJsonNumber(value);

  return Number.isInteger(number) ? number : null;
}

function getJsonStringValue(value: Prisma.JsonValue | undefined) {
  return typeof value === "string" ? value : null;
}

function getJsonDecimalValue(value: Prisma.JsonValue | undefined) {
  if (typeof value !== "number" && typeof value !== "string") return null;

  const number = Number(value);

  return Number.isFinite(number) ? new Prisma.Decimal(value) : null;
}

function getConflictPriceAmount(value: Prisma.JsonValue | undefined) {
  const object = getJsonObject(value);

  return getJsonDecimalValue(object?.amount) ?? getJsonDecimalValue(value);
}

function getConflictCompareAtPrice(value: Prisma.JsonValue | undefined) {
  const object = getJsonObject(value);

  return getPricingPayloadValue(object, "compareAtPrice");
}

function getPricingPayloadValue(
  payload: Record<string, Prisma.JsonValue> | null | undefined,
  key: "compareAtPrice" | "compareAtPriceAmount",
) {
  const value = payload?.[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }

  if (typeof value === "string" && value.trim()) {
    const number = Number(value);

    return Number.isFinite(number) ? number.toFixed(2) : value.trim();
  }

  return null;
}
