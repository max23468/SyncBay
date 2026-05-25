import {
  AuditEventType,
  EbayAccountDeletionRequestStatus,
  EbayConnectionStatus,
  Prisma,
  SyncJobStatus,
} from "@prisma/client";

import prisma from "../db.server";
import { hashSecretIdentifier } from "./crypto.server";
import { verifyEbayNotificationSignature } from "./ebay-notifications.server";

interface AccountDeletionNotification {
  eventDate: Date | null;
  notificationId: string;
  publishAttemptCount: number | null;
  publishDate: Date | null;
  topic: string;
  userId: string;
}

export class EbayAccountDeletionPayloadError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "EbayAccountDeletionPayloadError";
  }
}

export async function processEbayAccountDeletionNotification(input: {
  body: Buffer;
  signatureHeader: string | null;
}) {
  const verification = await verifyEbayNotificationSignature({
    body: input.body,
    signatureHeader: input.signatureHeader,
  });
  const notification = parseAccountDeletionNotification(input.body.toString("utf8"));
  const hashedUserId = hashSecretIdentifier(
    notification.userId,
    "ebay-account-deletion-user-id",
  );
  const existing = await prisma.ebayAccountDeletionRequest.findUnique({
    where: { notificationId: notification.notificationId },
  });

  if (
    existing?.status === EbayAccountDeletionRequestStatus.PROCESSED ||
    existing?.status === EbayAccountDeletionRequestStatus.NO_MATCH
  ) {
    return {
      idempotent: true,
      matchedShopCount: existing.matchedShopCount,
      requestId: existing.id,
      status: existing.status,
    };
  }

  const connections = await prisma.ebayConnection.findMany({
    select: {
      id: true,
      shopId: true,
    },
    where: {
      ebayUserId: notification.userId,
    },
  });
  const connectionIds = connections.map((connection) => connection.id);
  const shopIds = [...new Set(connections.map((connection) => connection.shopId))];
  const matchedShopCount = shopIds.length;
  const status =
    matchedShopCount > 0
      ? EbayAccountDeletionRequestStatus.PROCESSED
      : EbayAccountDeletionRequestStatus.NO_MATCH;

  const request = await prisma.$transaction(async (tx) => {
    const deletionRequest = await tx.ebayAccountDeletionRequest.upsert({
      where: { notificationId: notification.notificationId },
      create: {
        eventDate: notification.eventDate,
        hashedUserId,
        matchedShopCount,
        notificationId: notification.notificationId,
        processedAt: new Date(),
        publishAttemptCount: notification.publishAttemptCount,
        publishDate: notification.publishDate,
        signatureKeyId: verification.keyId,
        status,
      },
      update: {
        eventDate: notification.eventDate,
        failureCode: null,
        failureMessage: null,
        hashedUserId,
        matchedShopCount,
        processedAt: new Date(),
        publishAttemptCount: notification.publishAttemptCount,
        publishDate: notification.publishDate,
        signatureKeyId: verification.keyId,
        status,
      },
    });

    await tx.auditLog.create({
      data: {
        details: {
          accountDeletionRequestId: deletionRequest.id,
          hashedUserId,
          notificationId: notification.notificationId,
          signatureKeyId: verification.keyId,
          topic: notification.topic,
        } satisfies Prisma.JsonObject,
        message: "Notifica eBay account deletion ricevuta e verificata.",
        type: AuditEventType.EBAY_ACCOUNT_DELETION_RECEIVED,
      },
    });

    if (shopIds.length > 0) {
      await purgeEbayDataForShops(tx, {
        accountDeletionRequestId: deletionRequest.id,
        connectionIds,
        hashedUserId,
        notificationId: notification.notificationId,
        shopIds,
      });
    }

    return deletionRequest;
  });

  return {
    idempotent: false,
    matchedShopCount,
    requestId: request.id,
    status,
  };
}

function parseAccountDeletionNotification(body: string): AccountDeletionNotification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new EbayAccountDeletionPayloadError(
      "Payload eBay account deletion non leggibile.",
      "payload_malformed",
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new EbayAccountDeletionPayloadError(
      "Payload eBay account deletion non valido.",
      "payload_malformed",
    );
  }

  const payload = parsed as Record<string, unknown>;
  const metadata = getObject(payload.metadata);
  const notification = getObject(payload.notification);
  const data = getObject(notification?.data);
  const topic = getString(metadata?.topic);
  const notificationId = getString(notification?.notificationId);
  const userId = getString(data?.userId);

  if (topic !== "MARKETPLACE_ACCOUNT_DELETION") {
    throw new EbayAccountDeletionPayloadError(
      "Topic eBay account deletion non supportato.",
      "topic_unsupported",
    );
  }

  if (!notificationId) {
    throw new EbayAccountDeletionPayloadError(
      "Notification ID eBay mancante.",
      "notification_id_missing",
    );
  }

  if (!userId) {
    throw new EbayAccountDeletionPayloadError(
      "User ID eBay mancante.",
      "user_id_missing",
    );
  }

  return {
    eventDate: parseDate(getString(notification?.eventDate)),
    notificationId,
    publishAttemptCount: getNumber(notification?.publishAttemptCount),
    publishDate: parseDate(getString(notification?.publishDate)),
    topic,
    userId,
  };
}

async function purgeEbayDataForShops(
  tx: Prisma.TransactionClient,
  input: {
    accountDeletionRequestId: string;
    connectionIds: string[];
    hashedUserId: string;
    notificationId: string;
    shopIds: string[];
  },
) {
  const jobStatusFilters = [
    SyncJobStatus.PENDING,
    SyncJobStatus.RUNNING,
    SyncJobStatus.RETRYING,
  ];

  await tx.shop.updateMany({
    data: { syncEnabled: false },
    where: { id: { in: input.shopIds } },
  });
  await tx.syncJob.updateMany({
    data: {
      errorCode: "EBAY_ACCOUNT_DELETION",
      errorMessage: "Pulizia dati eBay richiesta.",
      finishedAt: new Date(),
      payload: Prisma.DbNull,
      result: Prisma.DbNull,
      status: SyncJobStatus.CANCELLED,
    },
    where: {
      shopId: { in: input.shopIds },
      status: { in: jobStatusFilters },
    },
  });
  await tx.syncJob.updateMany({
    data: {
      payload: Prisma.DbNull,
      result: Prisma.DbNull,
    },
    where: {
      shopId: { in: input.shopIds },
      status: { notIn: jobStatusFilters },
    },
  });
  await tx.syncConflict.deleteMany({
    where: { shopId: { in: input.shopIds } },
  });
  await tx.productSnapshot.deleteMany({
    where: { shopId: { in: input.shopIds } },
  });
  await tx.productMapping.deleteMany({
    where: { shopId: { in: input.shopIds } },
  });
  await tx.ebayOAuthState.deleteMany({
    where: { shopId: { in: input.shopIds } },
  });
  await tx.ebayConnection.updateMany({
    data: {
      connectedAt: null,
      ebayUserId: null,
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      lastRefreshAt: null,
      refreshTokenExpiresAt: null,
      scopes: null,
      status: EbayConnectionStatus.REVOKED,
      tokenExpiresAt: null,
    },
    where: { id: { in: input.connectionIds } },
  });
  await tx.auditLog.createMany({
    data: input.shopIds.map((shopId) => ({
      details: {
        accountDeletionRequestId: input.accountDeletionRequestId,
        hashedUserId: input.hashedUserId,
        notificationId: input.notificationId,
      } satisfies Prisma.JsonObject,
      message: "Dati eBay del negozio rimossi per account deletion.",
      shopId,
      type: AuditEventType.EBAY_ACCOUNT_DELETION_PROCESSED,
    })),
  });
}

function getObject(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}
