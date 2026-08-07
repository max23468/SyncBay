import {
  AuditEventType,
  EbayConnectionStatus,
  Prisma,
  ShopInstallationStatus,
  SyncJobStatus,
  SyncJobType,
} from "@prisma/client";
import prisma from "../db.server";
import { SYNCBAY_AUDIT_LOG_CREATE_SELECT } from "../lib/syncbay-audit-log-write";
import {
  getShopifyChangeJobResourceKeys,
  UNINSTALLED_SHOP_SYNC_JOB_CANCELLATION_STATUSES,
} from "../lib/syncbay-job-scheduling";
import {
  getShopifyWebhookJobPayloads,
  normalizeShopifyWebhookTopic,
  shouldRecordShopifyWebhook,
} from "../lib/syncbay-shopify-webhook";
import { getEbayMarketplaceId } from "./ebay-environment.server";

import { getJsonString, hasRuntimeValue, ShopifySessionLike } from "./syncbay-shared.server";

interface WebhookRecordInput {
  payload?: unknown;
  shopDomain: string;
  topic: string;
  resourceId?: string | null;
  webhookId?: string | null;
}

const DEFAULT_EBAY_ENVIRONMENT = "sandbox";

const DEFAULT_SYNC_TARGET_SECONDS = 300;

export async function disconnectEbayConnection(session: ShopifySessionLike) {
  const shop = await ensureShopForSession(session);
  const connection = await prisma.ebayConnection.findUnique({
    where: {
      shopId_marketplaceId: {
        marketplaceId: getEbayMarketplaceId(),
        shopId: shop.id,
      },
    },
  });

  if (!connection || connection.status === EbayConnectionStatus.NOT_CONNECTED) {
    return {
      message: "Nessun account eBay collegato da scollegare.",
      status: "not_connected" as const,
    };
  }

  const disconnectedAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const cancelledJobs = await tx.syncJob.updateMany({
      data: {
        errorCode: "EBAY_DISCONNECTED",
        errorMessage: "Account eBay scollegato dalle impostazioni. Job catalogo annullato.",
        finishedAt: disconnectedAt,
        status: SyncJobStatus.CANCELLED,
      },
      where: {
        shopId: shop.id,
        status: {
          in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING, SyncJobStatus.RUNNING],
        },
        type: {
          in: [
            SyncJobType.IMPORT_CATALOG,
            SyncJobType.SYNC_INCREMENTAL,
            SyncJobType.ARCHIVE_INACTIVE_LISTING,
          ],
        },
      },
    });

    await tx.ebayConnection.update({
      data: {
        connectedAt: null,
        ebayUserId: null,
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        lastRefreshAt: null,
        refreshTokenExpiresAt: null,
        scopes: null,
        status: EbayConnectionStatus.NOT_CONNECTED,
        tokenExpiresAt: null,
      },
      where: { id: connection.id },
    });
    await tx.shop.update({
      data: { syncEnabled: false },
      where: { id: shop.id },
    });
    await tx.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
      data: {
        details: { cancelledSyncJobCount: cancelledJobs.count },
        message: "Account eBay scollegato dalle impostazioni. Sync automatico disattivato.",
        shopId: shop.id,
        type: AuditEventType.EBAY_DISCONNECTED,
      },
    });

    return { cancelledSyncJobCount: cancelledJobs.count };
  });

  return {
    message: formatDisconnectEbayMessage(result.cancelledSyncJobCount),
    status: "disconnected" as const,
  };
}

function formatDisconnectEbayMessage(cancelledSyncJobCount: number) {
  const base =
    "Account eBay scollegato. Il catalogo già importato resta su Shopify; ricollega eBay per riprendere gli aggiornamenti.";

  if (cancelledSyncJobCount === 0) return base;

  if (cancelledSyncJobCount === 1) {
    return `${base} 1 aggiornamento catalogo in coda è stato annullato.`;
  }

  return `${base} ${cancelledSyncJobCount} aggiornamenti catalogo in coda sono stati annullati.`;
}

export async function ensureShopForSession(session: ShopifySessionLike) {
  return prisma.shop.upsert({
    where: { shopDomain: session.shop },
    create: {
      installationStatus: ShopInstallationStatus.INSTALLED,
      shopDomain: session.shop,
      shopifyScopes: session.scope ?? null,
      syncTargetSeconds: getSyncTargetSeconds(),
      auditLogs: {
        create: {
          message: "Shopify installazione registrata.",
          type: AuditEventType.SHOP_INSTALLED,
        },
      },
    },
    update: {
      installationStatus: ShopInstallationStatus.INSTALLED,
      shopifyScopes: session.scope ?? null,
      uninstalledAt: null,
    },
  });
}

export async function markShopUninstalled(shopDomain: string) {
  const uninstalledAt = new Date();

  await prisma.$transaction(async (tx) => {
    const shop = await tx.shop.upsert({
      where: { shopDomain },
      create: {
        installationStatus: ShopInstallationStatus.UNINSTALLED,
        shopDomain,
        syncTargetSeconds: getSyncTargetSeconds(),
        uninstalledAt,
      },
      update: {
        installationStatus: ShopInstallationStatus.UNINSTALLED,
        syncEnabled: false,
        uninstalledAt,
      },
    });
    const cancelledJobs = await tx.syncJob.updateMany({
      data: {
        errorCode: "SHOP_UNINSTALLED",
        errorMessage: "Shopify app disinstallata. Job SyncBay residuo annullato.",
        finishedAt: uninstalledAt,
        status: SyncJobStatus.CANCELLED,
      },
      where: {
        shopId: shop.id,
        status: {
          in: [...UNINSTALLED_SHOP_SYNC_JOB_CANCELLATION_STATUSES],
        },
      },
    });

    await tx.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
      data: {
        details: { cancelledSyncJobCount: cancelledJobs.count },
        message: "Shopify app disinstallata.",
        shopId: shop.id,
        type: AuditEventType.SHOP_UNINSTALLED,
      },
    });
  });
}

export async function updateShopifyScopes(shopDomain: string, scopes: string[]) {
  const shop = await prisma.shop.upsert({
    where: { shopDomain },
    create: {
      installationStatus: ShopInstallationStatus.INSTALLED,
      shopDomain,
      shopifyScopes: scopes.join(","),
      syncTargetSeconds: getSyncTargetSeconds(),
    },
    update: {
      shopifyScopes: scopes.join(","),
    },
  });

  await prisma.auditLog.create({
    select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
    data: {
      message: "Scope Shopify aggiornati.",
      shopId: shop.id,
      type: AuditEventType.SHOPIFY_SCOPES_UPDATED,
    },
  });
}

export async function recordShopifyWebhookPlaceholder(input: WebhookRecordInput) {
  const normalizedTopic = normalizeShopifyWebhookTopic(input.topic);
  const jobType = getPlaceholderJobType(normalizedTopic);
  const jobPayloads = getShopifyWebhookJobPayloads(normalizedTopic, input.payload);

  await prisma.$transaction(async (tx) => {
    const shop = await tx.shop.upsert({
      where: { shopDomain: input.shopDomain },
      create: {
        installationStatus: ShopInstallationStatus.INSTALLED,
        shopDomain: input.shopDomain,
        syncTargetSeconds: getSyncTargetSeconds(),
      },
      update: {},
    });
    await lockShopForWebhookCoalescing(tx, shop.id);

    const installation = await tx.shop.findUniqueOrThrow({
      select: { installationStatus: true },
      where: { id: shop.id },
    });
    if (!shouldRecordShopifyWebhook(installation.installationStatus)) return;

    let anyJobCoalesced = false;
    let anyJobCreated = false;

    for (const [index, payload] of jobPayloads.entries()) {
      const details = {
        ...payload,
        provider: "shopify",
        resourceId: input.resourceId ?? null,
        topic: normalizedTopic,
        webhookId: input.webhookId ?? null,
      } satisfies Prisma.JsonObject;

      if (!jobType) continue;

      const idempotencyKey = input.webhookId
        ? `shopify:${shop.id}:${normalizedTopic}:${input.webhookId}${
            jobPayloads.length > 1 ? `:${index + 1}` : ""
          }`
        : null;
      // Sequenziale per forza: transazione interattiva Prisma su connessione
      // singola, e la coalescenza vede i job creati dai payload precedenti.
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      const coalescedJob = await findCoalescedWebhookJob(tx, {
        details,
        jobType,
        shopId: shop.id,
      });

      if (coalescedJob) {
        const updated = await tx.syncJob.updateMany({
          where: {
            id: coalescedJob.id,
            status: { in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING] },
          },
          data: {
            errorCode: null,
            errorMessage: null,
            finishedAt: null,
            payload: details,
            runAfter: new Date(),
            status: SyncJobStatus.PENDING,
          },
        });

        anyJobCoalesced ||= updated.count === 1;
        if (updated.count === 1) continue;
      }

      const jobData = {
        idempotencyKey,
        payload: details,
        shopId: shop.id,
        status: SyncJobStatus.PENDING,
        type: jobType,
      };
      if (idempotencyKey) {
        const created = await tx.syncJob.createMany({
          data: [jobData],
          skipDuplicates: true,
        });
        anyJobCreated ||= created.count === 1;
      } else {
        await tx.syncJob.create({ data: jobData });
        anyJobCreated = true;
      }
    }

    if (!jobType || (anyJobCreated && !anyJobCoalesced)) {
      await tx.auditLog.create({
        select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
        data: {
          details:
            jobPayloads.length === 1
              ? {
                  ...jobPayloads[0],
                  provider: "shopify",
                  resourceId: input.resourceId ?? null,
                  topic: normalizedTopic,
                  webhookId: input.webhookId ?? null,
                }
              : {
                  jobBatchCount: jobPayloads.length,
                  lineItemCount: jobPayloads.reduce(
                    (count, payload) =>
                      count +
                      ("lineItems" in payload && Array.isArray(payload.lineItems)
                        ? payload.lineItems.length
                        : 0),
                    0,
                  ),
                  provider: "shopify",
                  resourceId: input.resourceId ?? null,
                  topic: normalizedTopic,
                  webhookId: input.webhookId ?? null,
                },
          message: "Webhook Shopify ricevuto e tracciato.",
          shopId: shop.id,
          type: AuditEventType.SHOPIFY_WEBHOOK_RECEIVED,
        },
      });
    }
  });
}

export function getEbayRuntimeReadiness() {
  const requirements = [
    { envKey: "EBAY_CLIENT_ID", label: "Client ID eBay" },
    { envKey: "EBAY_CLIENT_SECRET", label: "Client secret eBay" },
    { envKey: "EBAY_RU_NAME", label: "RuName eBay" },
    { envKey: "EBAY_SCOPES", label: "scope OAuth eBay" },
    { envKey: "EBAY_OAUTH_ACCEPT_URL", label: "OAuth accept URL eBay" },
    { envKey: "EBAY_OAUTH_REJECT_URL", label: "OAuth reject URL eBay" },
    { envKey: "TOKEN_ENCRYPTION_KEY", label: "chiave cifratura token" },
  ];
  const missingRequirements = requirements.flatMap((requirement) =>
    hasRuntimeValue(process.env[requirement.envKey]) ? [] : [requirement.label],
  );

  const oauthEnabled = process.env.EBAY_OAUTH_ENABLED === "true";

  return {
    environment: process.env.EBAY_ENVIRONMENT ?? DEFAULT_EBAY_ENVIRONMENT,
    marketplaceId: getEbayMarketplaceId(),
    missingRequirements,
    oauthEnabled,
    oauthStatus: oauthEnabled ? "Attivabile" : "Predisposto, ma disabilitato da flag runtime",
    ready: missingRequirements.length === 0,
    summary: {
      detail:
        missingRequirements.length === 0
          ? oauthEnabled
            ? "Env OAuth presenti; pronto per test end-to-end."
            : "Env OAuth presenti; abilita il flag runtime per testare."
          : `Mancano ${missingRequirements.length} requisiti OAuth.`,
      label: "eBay",
      status: missingRequirements.length === 0 && oauthEnabled ? "pronto" : "da completare",
    },
  };
}

export function getAccountDeletionChallengeConfig() {
  const endpoint = process.env.EBAY_ACCOUNT_DELETION_ENDPOINT_URL;
  const verificationToken = process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN;

  return {
    endpoint,
    missingRequirements: [
      !hasRuntimeValue(endpoint) ? "endpoint account deletion eBay" : null,
      !hasRuntimeValue(verificationToken) ? "verification token account deletion eBay" : null,
    ].filter((requirement): requirement is string => Boolean(requirement)),
    notificationsEnabled: process.env.EBAY_ACCOUNT_DELETION_NOTIFICATIONS_ENABLED === "true",
    verificationToken,
  };
}

export function getAccountDeletionPostConfig() {
  const challengeConfig = getAccountDeletionChallengeConfig();
  const postRequirements = [
    { envKey: "EBAY_CLIENT_ID", label: "Client ID eBay" },
    { envKey: "EBAY_CLIENT_SECRET", label: "Client secret eBay" },
    { envKey: "TOKEN_ENCRYPTION_KEY", label: "chiave cifratura token" },
  ].flatMap((requirement) =>
    hasRuntimeValue(process.env[requirement.envKey]) ? [] : [requirement.label],
  );

  return {
    ...challengeConfig,
    missingRequirements: [...challengeConfig.missingRequirements, ...postRequirements],
  };
}

export function extractWebhookResourceId(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  return getStringField(record, "admin_graphql_api_id") ?? getStringField(record, "id");
}

function getPlaceholderJobType(topic: string) {
  if (["orders/create", "orders/paid", "orders/cancelled"].includes(topic))
    return SyncJobType.UPDATE_EBAY_STOCK;
  if (topic === "products/update") return SyncJobType.DETECT_SHOPIFY_CHANGES;
  if (topic === "inventory_levels/update") return SyncJobType.DETECT_SHOPIFY_CHANGES;

  return null;
}

function getSyncTargetSeconds() {
  const parsed = Number.parseInt(process.env.SYNC_POLL_INTERVAL_SECONDS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SYNC_TARGET_SECONDS;
}

async function lockShopForWebhookCoalescing(tx: Prisma.TransactionClient, shopId: string) {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "Shop"
    WHERE id = ${shopId}
    FOR UPDATE
  `;
}

async function findCoalescedWebhookJob(
  tx: Prisma.TransactionClient,
  input: {
    details: Prisma.JsonObject;
    jobType: SyncJobType;
    shopId: string;
  },
) {
  if (input.jobType !== SyncJobType.DETECT_SHOPIFY_CHANGES) return null;

  const matchers = getCoalescedWebhookMatchers(input.details);

  if (matchers.length === 0) return null;

  return tx.syncJob.findFirst({
    select: { id: true },
    orderBy: { createdAt: "desc" },
    where: {
      OR: matchers,
      shopId: input.shopId,
      status: { in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING] },
      type: input.jobType,
    },
  });
}

function getCoalescedWebhookMatchers(details: Prisma.JsonObject): Prisma.SyncJobWhereInput[] {
  const topic = getJsonString(details.topic);
  const resourceKeys = getShopifyChangeJobResourceKeys(details);
  const topicMatcher = topic ? { payload: { path: ["topic"], equals: topic } } : null;
  const matchers: Prisma.SyncJobWhereInput[] = [];

  for (const resourceKey of resourceKeys) {
    for (const path of [
      ["resourceId"],
      ["inventoryItemGid"],
      ["adminGraphqlApiId"],
      ["admin_graphql_api_id"],
    ]) {
      matchers.push({
        AND: [...(topicMatcher ? [topicMatcher] : []), { payload: { path, equals: resourceKey } }],
      });
    }
  }

  return matchers;
}

function getStringField(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  return null;
}
