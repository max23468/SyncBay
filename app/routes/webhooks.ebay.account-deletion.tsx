import { createHash } from "node:crypto";

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { readRequestBodyWithLimit, RequestBodyTooLargeError } from "../lib/syncbay-request-body";
import {
  EbayAccountDeletionPayloadError,
  processEbayAccountDeletionNotification,
} from "../services/ebay-account-deletion.server";
import { EbayNotificationSignatureError } from "../services/ebay-notifications.server";
import {
  getAccountDeletionChallengeConfig,
  getAccountDeletionPostConfig,
} from "../services/syncbay.server";

const MAX_NOTIFICATION_BODY_BYTES = 128 * 1024;

export const loader = async ({ url }: LoaderFunctionArgs) => {
  const challengeCode = url.searchParams.get("challenge_code");
  if (!challengeCode) {
    return Response.json(
      {
        message: "Challenge code eBay mancante.",
        status: "invalid_request",
      },
      { status: 400 },
    );
  }

  const config = getAccountDeletionChallengeConfig();
  if (!config.endpoint || !config.verificationToken || config.missingRequirements.length > 0) {
    return Response.json(
      {
        missingRequirements: config.missingRequirements,
        status: "not_configured",
      },
      { status: 503 },
    );
  }

  const challengeResponse = createHash("sha256")
    .update(challengeCode)
    .update(config.verificationToken)
    .update(config.endpoint)
    .digest("hex");

  return Response.json({
    challengeResponse,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method.toUpperCase() !== "POST") {
    return Response.json(
      {
        message: "Metodo non supportato.",
        status: "method_not_allowed",
      },
      { status: 405 },
    );
  }

  const config = getAccountDeletionPostConfig();
  if (config.missingRequirements.length > 0) {
    return Response.json(
      {
        missingRequirements: config.missingRequirements,
        status: "not_configured",
      },
      { status: 503 },
    );
  }

  if (!config.notificationsEnabled) {
    return Response.json(
      {
        message: "Notifiche account deletion eBay non abilitate per SyncBay 1.0 privata.",
        status: "disabled",
      },
      { status: 503 },
    );
  }

  let body: Buffer;
  try {
    body = Buffer.from(await readRequestBodyWithLimit(request, MAX_NOTIFICATION_BODY_BYTES));
  } catch (error) {
    if (!(error instanceof RequestBodyTooLargeError)) throw error;

    return Response.json(
      {
        message: "Payload eBay account deletion troppo grande.",
        status: "payload_too_large",
      },
      { status: 413 },
    );
  }

  try {
    await processEbayAccountDeletionNotification({
      body,
      lookupBudgetKey:
        request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || "unattributed",
      signatureHeader: request.headers.get("x-ebay-signature"),
    });
  } catch (error) {
    if (error instanceof EbayNotificationSignatureError) {
      return Response.json(
        {
          code: error.code,
          message: "Firma notifica eBay non valida.",
          status: "signature_invalid",
        },
        { status: 412 },
      );
    }

    if (error instanceof EbayAccountDeletionPayloadError) {
      return Response.json(
        {
          code: error.code,
          message: error.message,
          status: "invalid_payload",
        },
        { status: 400 },
      );
    }

    return Response.json(
      {
        message: "Notifica eBay non processabile ora.",
        status: "processing_error",
      },
      { status: 503 },
    );
  }

  return new Response(null, { status: 204 });
};
