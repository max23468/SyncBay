import {
  Prisma,
  ProductMappingStatus,
  ProductSnapshotSource,
  SyncConflictResolution,
  SyncConflictStatus,
  SyncJobStatus,
  SyncJobType,
} from "@prisma/client";
import prisma from "../db.server";
import { shouldResolveOrderStockQuantityConflict } from "../lib/syncbay-conflict-detection";
import {
  getOrderLineMappingLookup,
  getOrderReservationSnapshotLookups,
  getShopifyOrderStockAction,
  getShopifyOrderStockTarget,
} from "../lib/syncbay-order-stock";
import { selectShopifyVariantForSync } from "../lib/syncbay-shopify-variant-selection";
import { selectLatestStockBaselineSnapshot } from "../lib/syncbay-stock-baseline";
import {
  isEbayStockDryRunEnabled,
  isPositiveShopifyOrderQuantity,
  shouldDryRunEbayStockLine,
  validateEbayStockCurrency,
} from "../lib/syncbay-stock-guard";
import { hasProcessedStockLineInJobResults } from "../lib/syncbay-stock-job-idempotency";
import { getUsableEbayAccessToken } from "./ebay-token.server";
import {
  getEbayTradingAvailableQuantity,
  reviseEbayTradingInventoryQuantity,
} from "./ebay-trading-stock.server";
import { recordProductSnapshotsInTransaction } from "./product-history.server";
import { getShopifyAdminGraphqlClient } from "./shopify-admin-session.server";

import {
  DueSyncJob,
  ShopifyProductForConflict,
  getConnectedEbayConnection,
  getErrorMessage,
  getInterruptedRunningSyncJobResult,
  getJsonNumber,
  getJsonObject,
  getJsonString,
  getShopifyProductForConflict,
  getStringFromPayload,
  markJobSucceeded,
} from "./sync-job-shared.server";

export async function runUpdateEbayStockJob(job: DueSyncJob) {
  const lineItems = getOrderLineItems(job.payload);
  const stockAction = getShopifyOrderStockAction(getJsonObject(job.payload)?.stockAction);

  if (lineItems.length === 0) {
    throw new Error("Job stock eBay senza righe ordine Shopify.");
  }

  const connection = await getConnectedEbayConnection(job);
  const stockDryRun = isEbayStockDryRunEnabled(process.env.SYNCBAY_EBAY_STOCK_DRY_RUN);
  const shopDomain = job.shop.shopDomain;
  let accessToken: string | null = null;
  const planned: Prisma.JsonObject[] = [];
  const updated: Prisma.JsonObject[] = [];
  const skipped: Prisma.JsonObject[] = [];
  let resolvedQuantityConflictCount = 0;
  const quantityConflictCleanupFailures: Prisma.JsonObject[] = [];
  const reservationSnapshotsByMappingId = new Map<
    string,
    ReturnType<typeof findOrderStockReservationSnapshots>
  >();
  // La disponibilità è un conteggio di unità: ReviseInventoryStatus invia solo
  // <Quantity>, mai il prezzo. La valuta con cui il compratore paga su Shopify
  // (presentment: HUF, USD, ...) è quindi irrilevante per il decremento eBay e
  // non deve bloccarlo, altrimenti gli ordini in valuta estera lasciano il
  // listing vendibile su eBay (rischio oversell) e generano falsi conflitti
  // quantity. La coerenza di valuta del listing eBay resta garantita per riga
  // da `validateEbayStockCurrency` (snapshot in EUR) più sotto.

  for (const lineItem of lineItems) {
    const mapping = await findProductMappingForOrderLine(job.shopId, lineItem);

    if (!mapping) {
      skipped.push({
        lineItemKey: lineItem.lineItemKey,
        quantity: lineItem.quantity,
        reason: "mapping_not_found",
        shopifyProductGid: lineItem.shopifyProductGid ?? null,
        shopifyVariantGid: lineItem.shopifyVariantGid ?? null,
      });
      continue;
    }

    const lineDryRun = shouldDryRunEbayStockLine({
      allowlist: process.env.SYNCBAY_EBAY_STOCK_REAL_WRITE_ALLOWLIST,
      ebayItemId: mapping.ebayItemId,
      shopDomain,
      shopifyVariantGid: mapping.shopifyVariantGid,
      stockDryRunEnabled: stockDryRun,
    });

    if (
      await hasCompletedStockUpdateForLine({
        action: stockAction,
        ebayItemId: mapping.ebayItemId,
        includeDryRunPlans: lineDryRun,
        job,
        lineItem,
        mappingId: mapping.id,
      })
    ) {
      skipped.push({
        ebayItemId: mapping.ebayItemId,
        lineItemKey: lineItem.lineItemKey,
        quantity: lineItem.quantity,
        reason: "already_processed",
      });
      continue;
    }

    const latestStockSnapshots = await prisma.productSnapshot.findMany({
      orderBy: { capturedAt: "desc" },
      take: 1,
      where: {
        currency: { not: null },
        mappingId: mapping.id,
        quantity: { not: null },
      },
    });
    const latestSnapshot = selectLatestStockBaselineSnapshot(latestStockSnapshots);
    // Tutte le righe dell'ordine sullo stesso mapping, non solo questa: il tetto
    // di ripristino è la quantità eBay precedente all'ordine, altrimenti la
    // seconda riga si fermerebbe al pre-decremento della prima.
    let reservationSnapshots: Awaited<ReturnType<typeof findOrderStockReservationSnapshots>> = [];
    if (stockAction === "restore") {
      let reservationSnapshotsPromise = reservationSnapshotsByMappingId.get(mapping.id);
      if (!reservationSnapshotsPromise) {
        reservationSnapshotsPromise = findOrderStockReservationSnapshots({
          lineItemKeys: lineItems.map((item) => item.lineItemKey),
          mappingId: mapping.id,
          orderResourceId: getStringFromPayload(job.payload, "resourceId"),
          shopId: job.shopId,
        });
        reservationSnapshotsByMappingId.set(mapping.id, reservationSnapshotsPromise);
      }
      reservationSnapshots = await reservationSnapshotsPromise;
    }
    const reservationSnapshot =
      reservationSnapshots.find(
        (snapshot) =>
          getStringFromPayload(snapshot.payload, "orderLineItemKey") === lineItem.lineItemKey,
      ) ?? null;
    const latestSkuPolicySnapshot = await prisma.productSnapshot.findFirst({
      orderBy: { capturedAt: "desc" },
      where: {
        mappingId: mapping.id,
        payload: {
          path: ["skuGenerated"],
          not: Prisma.JsonNull,
        },
      },
    });
    const currencyValidation = validateEbayStockCurrency({
      marketplaceId: mapping.marketplaceId,
      snapshotCurrency: latestSnapshot?.currency ?? null,
    });

    if (!currencyValidation.ok) {
      skipped.push({
        ebayItemId: mapping.ebayItemId,
        expectedCurrency: currencyValidation.expectedCurrency,
        lineItemKey: lineItem.lineItemKey,
        quantity: lineItem.quantity,
        reason: currencyValidation.reason,
        snapshotCurrency: currencyValidation.snapshotCurrency,
      });
      continue;
    }

    const ownPreviousQuantity = getJsonNumber(
      getJsonObject(reservationSnapshot?.payload)?.previousQuantity,
    );
    const previousQuantity =
      stockAction === "restore"
        ? ownPreviousQuantity === null
          ? null
          : Math.max(
              ownPreviousQuantity,
              ...reservationSnapshots.flatMap((snapshot) => {
                const quantity = getJsonNumber(getJsonObject(snapshot.payload)?.previousQuantity);

                return quantity === null ? [] : [quantity];
              }),
            )
        : (latestSnapshot?.quantity ?? 0);

    if (stockAction === "restore" && previousQuantity === null) {
      skipped.push({
        ebayItemId: mapping.ebayItemId,
        lineItemKey: lineItem.lineItemKey,
        quantity: lineItem.quantity,
        reason: "order_decrement_not_found",
        stockAction,
      });
      continue;
    }

    let ebayAvailableQuantity: number | null = null;
    let shopifyAvailableQuantity: number | null = null;
    if (stockAction === "restore") {
      accessToken ??= (await getUsableEbayAccessToken(connection)).accessToken;
      if (!accessToken) {
        throw new Error("Token eBay non disponibile per verificare lo stock.");
      }
      ebayAvailableQuantity = await getEbayTradingAvailableQuantity({
        accessToken,
        connection,
        itemId: mapping.ebayItemId,
        sku: mapping.sku,
        skuGenerated: getSnapshotSkuGenerated(latestSkuPolicySnapshot?.payload),
      });
      shopifyAvailableQuantity = await getLiveShopifyQuantityForMapping({
        defaultLocationGid: job.shop.defaultLocationGid,
        shopDomain,
        shopifyProductGid: mapping.shopifyProductGid,
        shopifyVariantGid: mapping.shopifyVariantGid,
      });
    }
    const nextQuantity = getShopifyOrderStockTarget({
      action: stockAction,
      ebayAvailableQuantity,
      orderQuantity: lineItem.quantity,
      previousQuantity: previousQuantity ?? 0,
      shopifyAvailableQuantity,
    });

    if (nextQuantity === null) {
      skipped.push({
        ebayAvailableQuantity,
        ebayItemId: mapping.ebayItemId,
        lineItemKey: lineItem.lineItemKey,
        quantity: lineItem.quantity,
        reason: "restore_quantity_not_verifiable",
        shopifyAvailableQuantity,
        stockAction,
      });
      continue;
    }

    if (
      stockAction === "restore" &&
      ebayAvailableQuantity !== null &&
      nextQuantity <= ebayAvailableQuantity
    ) {
      skipped.push({
        ebayAvailableQuantity,
        ebayItemId: mapping.ebayItemId,
        lineItemKey: lineItem.lineItemKey,
        quantity: lineItem.quantity,
        reason: "no_stock_returned_by_shopify",
        shopifyAvailableQuantity,
        stockAction,
      });
      continue;
    }

    if (lineDryRun) {
      planned.push({
        currency: currencyValidation.snapshotCurrency,
        dryRun: true,
        ebayItemId: mapping.ebayItemId,
        lineItemKey: lineItem.lineItemKey,
        nextQuantity,
        orderedQuantity: lineItem.quantity,
        previousQuantity,
        reason: "stock_dry_run_enabled",
        stockAction,
      });
      continue;
    }

    const interruptedJobBeforeTokenLookup = await getInterruptedRunningSyncJobResult(job);
    if (interruptedJobBeforeTokenLookup) return interruptedJobBeforeTokenLookup;

    accessToken ??= (await getUsableEbayAccessToken(connection)).accessToken;

    if (!accessToken) {
      throw new Error("Token eBay non disponibile per aggiornare lo stock.");
    }

    const interruptedJobBeforeEbayWrite = await getInterruptedRunningSyncJobResult(job);
    if (interruptedJobBeforeEbayWrite) return interruptedJobBeforeEbayWrite;

    await reviseEbayTradingInventoryQuantity({
      accessToken,
      connection,
      itemId: mapping.ebayItemId,
      quantity: nextQuantity,
      sku: mapping.sku,
      skuGenerated: getSnapshotSkuGenerated(latestSkuPolicySnapshot?.payload),
    });
    const stockSnapshot = {
      ebayItemId: mapping.ebayItemId,
      mappingId: mapping.id,
      payload: {
        previousQuantity: stockAction === "restore" ? ebayAvailableQuantity : previousQuantity,
        orderLineItemKey: lineItem.lineItemKey,
        shopifyOrderId: getStringFromPayload(job.payload, "resourceId"),
        ...(stockAction === "restore" ? { orderPreviousQuantity: previousQuantity } : {}),
        reason: getShopifyOrderStockReason(job.payload, stockAction),
        stockAction,
        syncJobId: job.id,
        updatedEbayFromShopifyOrder: true,
      } satisfies Prisma.JsonObject,
      currency: currencyValidation.snapshotCurrency,
      quantity: nextQuantity,
      shopId: job.shopId,
      shopifyProductGid: mapping.shopifyProductGid,
      shopifyVariantGid: mapping.shopifyVariantGid,
      sku: mapping.sku,
      source: ProductSnapshotSource.SYNCBAY,
    } satisfies Prisma.ProductSnapshotCreateManyInput;
    // Questo snapshot è anche il marker durevole di idempotenza dopo la write eBay.
    await prisma.$transaction((tx) => recordProductSnapshotsInTransaction(tx, [stockSnapshot]));
    let resolvedQuantityConflicts = 0;
    let resolvedQuantityConflictCleanupError: string | undefined;
    try {
      resolvedQuantityConflicts = await resolveOrderStockQuantityConflicts({
        defaultLocationGid: job.shop.defaultLocationGid,
        mappingId: mapping.id,
        mappingStatus: mapping.status,
        nextQuantity,
        shopDomain,
        shopId: job.shopId,
        shopifyProductGid: mapping.shopifyProductGid,
        shopifyVariantGid: mapping.shopifyVariantGid,
      });
    } catch (error) {
      resolvedQuantityConflictCleanupError = getErrorMessage(error);
      quantityConflictCleanupFailures.push({
        ebayItemId: mapping.ebayItemId,
        errorMessage: resolvedQuantityConflictCleanupError,
        lineItemKey: lineItem.lineItemKey,
      });
    }
    resolvedQuantityConflictCount += resolvedQuantityConflicts;
    updated.push({
      currency: currencyValidation.snapshotCurrency,
      ebayItemId: mapping.ebayItemId,
      lineItemKey: lineItem.lineItemKey,
      nextQuantity,
      orderedQuantity: lineItem.quantity,
      previousQuantity,
      reason: stockDryRun ? "stock_real_write_allowlisted" : "stock_dry_run_disabled",
      resolvedQuantityConflictCleanupError,
      resolvedQuantityConflicts,
      stockAction,
    });
  }

  await markJobSucceeded({
    job,
    result: {
      dryRun: stockDryRun,
      planned,
      plannedCount: planned.length,
      realWriteAllowlistEnabled: Boolean(
        process.env.SYNCBAY_EBAY_STOCK_REAL_WRITE_ALLOWLIST?.trim(),
      ),
      quantityConflictCleanupFailures,
      quantityConflictCleanupFailureCount: quantityConflictCleanupFailures.length,
      resolvedQuantityConflictCount,
      skipped,
      skippedCount: skipped.length,
      updated,
      updatedCount: updated.length,
    },
    warnings: [
      ...(skipped.length > 0 ? ["Alcune righe ordine non sono state applicate a eBay."] : []),
      ...(quantityConflictCleanupFailures.length > 0
        ? ["Alcune pulizie dei conflitti quantità non sono state completate dopo la write eBay."]
        : []),
    ],
  });

  return {
    jobId: job.id,
    status: "succeeded" as const,
    type: job.type,
  };
}

function getSnapshotSkuGenerated(payload: Prisma.JsonValue | null | undefined) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const value = payload.skuGenerated;

  return typeof value === "boolean" ? value : null;
}

function getOrderLineItems(payload: Prisma.JsonValue | null) {
  const object = getJsonObject(payload);
  const lineItems = object?.lineItems;

  if (!Array.isArray(lineItems)) return [];

  return lineItems.flatMap((lineItem) => {
    const lineItemObject = getJsonObject(lineItem);
    const quantity = getJsonNumber(lineItemObject?.quantity);

    if (!lineItemObject || !quantity || !isPositiveShopifyOrderQuantity(quantity)) {
      return [];
    }

    return [
      {
        lineItemKey: getJsonString(lineItemObject.lineItemKey),
        quantity,
        shopifyProductGid: getJsonString(lineItemObject.shopifyProductGid),
        shopifyVariantGid: getJsonString(lineItemObject.shopifyVariantGid),
      },
    ];
  });
}

async function findProductMappingForOrderLine(
  shopId: string,
  lineItem: {
    lineItemKey: string | null;
    shopifyProductGid: string | null;
    shopifyVariantGid: string | null;
  },
) {
  const lookup = getOrderLineMappingLookup(lineItem);
  if (!lookup) return null;

  return prisma.productMapping.findFirst({
    where: {
      ...lookup,
      shopId,
      status: ProductMappingStatus.ACTIVE,
    },
  });
}

async function hasCompletedStockUpdateForLine(input: {
  action: "decrement" | "restore";
  ebayItemId: string;
  includeDryRunPlans: boolean;
  job: DueSyncJob;
  lineItem: {
    lineItemKey: string | null;
  };
  mappingId: string;
}) {
  if (!input.lineItem.lineItemKey) return false;

  // Marker durevole, non legato al job corrente: un ordine può essere pagato
  // molto dopo la create e la finestra dei job recenti sotto non basta.
  const snapshot = await prisma.productSnapshot.findFirst({
    select: { id: true },
    where: {
      AND: [
        {
          payload: {
            path: ["orderLineItemKey"],
            equals: input.lineItem.lineItemKey,
          },
        },
        {
          payload: {
            path: ["updatedEbayFromShopifyOrder"],
            equals: true,
          },
        },
        getOrderStockActionSnapshotFilter(input.action),
      ],
      mappingId: input.mappingId,
      shopId: input.job.shopId,
      source: ProductSnapshotSource.SYNCBAY,
    },
  });

  if (snapshot) return true;

  const previousJobs = await prisma.syncJob.findMany({
    orderBy: { updatedAt: "desc" },
    select: { result: true },
    take: 50,
    where: {
      id: { not: input.job.id },
      shopId: input.job.shopId,
      status: SyncJobStatus.SUCCEEDED,
      type: SyncJobType.UPDATE_EBAY_STOCK,
    },
  });

  return hasProcessedStockLineInJobResults({
    action: input.action,
    ebayItemId: input.ebayItemId,
    includeDryRunPlans: input.includeDryRunPlans,
    lineItemKey: input.lineItem.lineItemKey,
    results: previousJobs.flatMap((job) => {
      const result = getJsonObject(job.result);

      return result ? [result] : [];
    }),
  });
}

// Gli snapshot storici precedono la chiave `stockAction`, quindi l'azione va
// riconosciuta anche dal `reason`.
function getOrderStockActionSnapshotFilter(action: "decrement" | "restore") {
  return action === "restore"
    ? {
        OR: [
          { payload: { path: ["stockAction"], equals: "restore" } },
          {
            payload: {
              path: ["reason"],
              equals: "shopify_order_cancelled",
            },
          },
        ],
      }
    : {
        OR: [
          { payload: { path: ["stockAction"], equals: "decrement" } },
          { payload: { path: ["reason"], equals: "shopify_order_created" } },
          { payload: { path: ["reason"], equals: "shopify_order_paid" } },
        ],
      };
}

async function findOrderStockReservationSnapshots(input: {
  lineItemKeys: (string | null)[];
  mappingId: string;
  orderResourceId: string | null;
  shopId: string;
}) {
  const lookups = getOrderReservationSnapshotLookups(input);

  if (lookups.length === 0) return [];

  return prisma.productSnapshot.findMany({
    orderBy: { capturedAt: "desc" },
    where: {
      AND: [
        {
          OR: lookups.map((lookup) => ({
            payload: { path: [lookup.field], equals: lookup.value },
          })),
        },
        {
          payload: {
            path: ["updatedEbayFromShopifyOrder"],
            equals: true,
          },
        },
        getOrderStockActionSnapshotFilter("decrement"),
      ],
      mappingId: input.mappingId,
      shopId: input.shopId,
      source: ProductSnapshotSource.SYNCBAY,
    },
  });
}

function getShopifyOrderStockReason(
  payload: Prisma.JsonValue | null,
  action: "decrement" | "restore",
) {
  if (action === "restore") return "shopify_order_cancelled";
  return getStringFromPayload(payload, "topic") === "orders/create"
    ? "shopify_order_created"
    : "shopify_order_paid";
}

async function getLiveShopifyQuantityForMapping(input: {
  defaultLocationGid: string | null;
  shopDomain: string;
  shopifyProductGid: string | null;
  shopifyVariantGid: string | null;
}) {
  if (!input.shopifyProductGid) return null;

  const admin = await getShopifyAdminGraphqlClient(input.shopDomain);
  const product = await getShopifyProductForConflict(
    admin,
    input.shopifyProductGid,
    input.defaultLocationGid,
    { preferredVariantGid: input.shopifyVariantGid },
  );

  return product
    ? getLiveShopifyQuantityForConflict(
        product,
        Boolean(input.defaultLocationGid),
        input.shopifyVariantGid,
      )
    : null;
}

function getLiveShopifyQuantityForConflict(
  product: ShopifyProductForConflict,
  hasManagedLocation: boolean,
  preferredVariantGid?: string | null,
) {
  const variant = selectShopifyVariantForSync({
    preferredVariantGid,
    variants: product.variants?.nodes,
  });
  const variantLocationQuantity = getVariantLocationQuantity(variant);

  return hasManagedLocation
    ? variantLocationQuantity
    : (variantLocationQuantity ?? variant?.inventoryQuantity ?? null);
}

function getVariantLocationQuantity(
  variant: NonNullable<NonNullable<ShopifyProductForConflict["variants"]>["nodes"]>[number] | null,
) {
  const availableQuantity = variant?.inventoryItem?.inventoryLevel?.quantities?.find(
    (quantity) => quantity.name === "available",
  )?.quantity;

  return typeof availableQuantity === "number" ? availableQuantity : null;
}

async function resolveOrderStockQuantityConflicts(input: {
  defaultLocationGid: string | null;
  mappingId: string;
  mappingStatus: ProductMappingStatus;
  nextQuantity: number;
  shopDomain: string;
  shopId: string;
  shopifyProductGid: string | null;
  shopifyVariantGid: string | null;
}) {
  const conflicts = await prisma.syncConflict.findMany({
    select: {
      field: true,
      id: true,
    },
    where: {
      field: "quantity",
      mappingId: input.mappingId,
      shopId: input.shopId,
      status: SyncConflictStatus.OPEN,
    },
  });
  if (conflicts.length === 0 || !input.shopifyProductGid) return 0;

  const admin = await getShopifyAdminGraphqlClient(input.shopDomain);
  const product = await getShopifyProductForConflict(
    admin,
    input.shopifyProductGid,
    input.defaultLocationGid,
    { preferredVariantGid: input.shopifyVariantGid },
  );
  const liveShopifyQuantity = product
    ? getLiveShopifyQuantityForConflict(
        product,
        Boolean(input.defaultLocationGid),
        input.shopifyVariantGid,
      )
    : null;
  const conflictIds = conflicts.flatMap((conflict) =>
    shouldResolveOrderStockQuantityConflict({
      field: conflict.field,
      liveShopifyQuantity,
      mappingStatus: input.mappingStatus,
      nextQuantity: input.nextQuantity,
    })
      ? [conflict.id]
      : [],
  );

  if (conflictIds.length === 0) return 0;

  const result = await prisma.syncConflict.updateMany({
    data: {
      resolution: SyncConflictResolution.KEEP_SHOPIFY,
      resolvedAt: new Date(),
      status: SyncConflictStatus.RESOLVED,
    },
    where: {
      id: { in: conflictIds },
      shopId: input.shopId,
      status: SyncConflictStatus.OPEN,
    },
  });

  return result.count;
}
