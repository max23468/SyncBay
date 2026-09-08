import { EbayAccountDeletionRelayStatus, type Prisma } from "@prisma/client";

import prisma from "../db.server";
import { isSafeHttpsUrl } from "../lib/safe-http-url";
import { decryptSecret } from "./crypto.server";

const HUB_FATTURE_RELAY_TIMEOUT_MS = 5 * 1000;
const RELAY_BATCH_LIMIT = 5;
const RELAY_CLAIM_TIMEOUT_MS = 10 * 60 * 1000;
const RELAY_DEADLINE_MARGIN_MS = 5 * 1000;
const RELAY_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;

interface ClaimedRelay {
  attemptCount: number;
  claimedAt: Date;
  encryptedBody: string;
  encryptedSignature: string;
  id: string;
}

export function getEbayAccountDeletionRelayRetryAt(attemptCount: number, now: Date) {
  const delay =
    RELAY_RETRY_DELAYS_MS[
      Math.min(Math.max(attemptCount - 1, 0), RELAY_RETRY_DELAYS_MS.length - 1)
    ];
  return new Date(now.getTime() + delay);
}

export async function runDueEbayAccountDeletionRelays(
  input: { deadlineAt?: Date; limit?: number; now?: Date } = {},
) {
  const now = input.now ?? new Date();
  const endpoint = process.env.HUB_FATTURE_EBAY_ACCOUNT_DELETION_URL;
  if (!endpoint?.trim()) {
    return relaySummary({ configured: false });
  }

  const limit = Math.min(Math.max(input.limit ?? RELAY_BATCH_LIMIT, 1), RELAY_BATCH_LIMIT);
  let attemptedCount = 0;
  let deliveredCount = 0;
  let failedCount = 0;
  let exhausted = false;

  while (attemptedCount < limit) {
    if (input.deadlineAt && Date.now() >= input.deadlineAt.getTime() - RELAY_DEADLINE_MARGIN_MS) {
      exhausted = true;
      break;
    }

    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- ogni claim va consegnato e chiuso prima del successivo per limitare payload privacy simultanei.
    const claimed = await claimNextRelay(now);
    if (!claimed) break;
    attemptedCount += 1;

    try {
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- relay privacy seriale e limitato a cinque elementi per tick.
      await forwardEbayAccountDeletionToHubFatture({
        body: Buffer.from(decryptSecret(claimed.encryptedBody), "base64"),
        endpoint,
        signatureHeader: decryptSecret(claimed.encryptedSignature),
      });
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- la chiusura atomica appartiene al claim appena consegnato.
      await markRelayDelivered(claimed);
      deliveredCount += 1;
    } catch {
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- il retry deve essere persistito prima di passare al claim successivo.
      await markRelayForRetry(claimed, now);
      failedCount += 1;
    }
  }

  return relaySummary({
    attemptedCount,
    configured: true,
    continuationNeeded: exhausted || attemptedCount === limit,
    deliveredCount,
    failedCount,
  });
}

export async function forwardEbayAccountDeletionToHubFatture(input: {
  body: Buffer;
  endpoint: string;
  signatureHeader: string;
}) {
  if (!isSafeHttpsUrl(input.endpoint)) {
    throw new Error("Relay account deletion Hub Fatture non configurato correttamente.");
  }
  const endpoint = new URL(input.endpoint);

  const response = await fetch(endpoint, {
    body: new Uint8Array(input.body),
    headers: {
      "Content-Type": "application/json",
      "X-EBAY-SIGNATURE": input.signatureHeader,
    },
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(HUB_FATTURE_RELAY_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Relay account deletion Hub Fatture non riuscito (HTTP ${response.status}).`);
  }
}

async function claimNextRelay(now: Date): Promise<ClaimedRelay | null> {
  const staleBefore = new Date(now.getTime() - RELAY_CLAIM_TIMEOUT_MS);

  return prisma.$transaction(async (tx) => {
    const candidate = await tx.ebayAccountDeletionRequest.findFirst({
      orderBy: [{ relayNextAttemptAt: "asc" }, { receivedAt: "asc" }],
      select: {
        encryptedRelayBody: true,
        encryptedRelaySignature: true,
        id: true,
        relayAttemptCount: true,
        relayStartedAt: true,
        relayStatus: true,
      },
      where: {
        encryptedRelayBody: { not: null },
        encryptedRelaySignature: { not: null },
        OR: [
          { relayStatus: EbayAccountDeletionRelayStatus.PENDING },
          {
            relayNextAttemptAt: { lte: now },
            relayStatus: EbayAccountDeletionRelayStatus.RETRYING,
          },
          {
            relayStartedAt: { lte: staleBefore },
            relayStatus: EbayAccountDeletionRelayStatus.DELIVERING,
          },
        ],
      },
    });
    if (!candidate?.encryptedRelayBody || !candidate.encryptedRelaySignature) return null;

    const claimed = await tx.ebayAccountDeletionRequest.updateMany({
      data: {
        relayAttemptCount: { increment: 1 },
        relayLastErrorCode: null,
        relayNextAttemptAt: null,
        relayStartedAt: now,
        relayStatus: EbayAccountDeletionRelayStatus.DELIVERING,
      },
      where: {
        id: candidate.id,
        relayStartedAt: candidate.relayStartedAt,
        relayStatus: candidate.relayStatus,
      },
    });
    if (claimed.count !== 1) return null;

    return {
      attemptCount: candidate.relayAttemptCount + 1,
      claimedAt: now,
      encryptedBody: candidate.encryptedRelayBody,
      encryptedSignature: candidate.encryptedRelaySignature,
      id: candidate.id,
    };
  });
}

async function markRelayDelivered(claimed: ClaimedRelay) {
  await prisma.ebayAccountDeletionRequest.updateMany({
    data: {
      encryptedRelayBody: null,
      encryptedRelaySignature: null,
      relayLastErrorCode: null,
      relayNextAttemptAt: null,
      relayStartedAt: null,
      relayStatus: EbayAccountDeletionRelayStatus.DELIVERED,
      relayedAt: new Date(),
    },
    where: activeClaimWhere(claimed),
  });
}

async function markRelayForRetry(claimed: ClaimedRelay, now: Date) {
  await prisma.ebayAccountDeletionRequest.updateMany({
    data: {
      relayLastErrorCode: "HUB_FATTURE_RELAY_FAILED",
      relayNextAttemptAt: getEbayAccountDeletionRelayRetryAt(claimed.attemptCount, now),
      relayStartedAt: null,
      relayStatus: EbayAccountDeletionRelayStatus.RETRYING,
    },
    where: activeClaimWhere(claimed),
  });
}

function activeClaimWhere(claimed: ClaimedRelay): Prisma.EbayAccountDeletionRequestWhereInput {
  return {
    id: claimed.id,
    relayStartedAt: claimed.claimedAt,
    relayStatus: EbayAccountDeletionRelayStatus.DELIVERING,
  };
}

function relaySummary(input: {
  attemptedCount?: number;
  configured: boolean;
  continuationNeeded?: boolean;
  deliveredCount?: number;
  failedCount?: number;
}) {
  return {
    attemptedCount: input.attemptedCount ?? 0,
    configured: input.configured,
    continuationNeeded: input.continuationNeeded ?? false,
    deliveredCount: input.deliveredCount ?? 0,
    failedCount: input.failedCount ?? 0,
  };
}
