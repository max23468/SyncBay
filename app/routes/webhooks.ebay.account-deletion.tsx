import { createHash } from "node:crypto";

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
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
  if (
    !config.endpoint ||
    !config.verificationToken ||
    config.missingRequirements.length > 0
  ) {
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

  return new Response(challengeResponse, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
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
        message:
          "Notifiche account deletion eBay non abilitate per il pilota SyncBay.",
        status: "disabled",
      },
      { status: 503 },
    );
  }

  const body = Buffer.from(await request.arrayBuffer());
  if (body.byteLength > MAX_NOTIFICATION_BODY_BYTES) {
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
