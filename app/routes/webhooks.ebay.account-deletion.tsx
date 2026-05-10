import { createHash } from "node:crypto";

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { getAccountDeletionChallengeConfig } from "../services/syncbay.server";

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

  return Response.json({ challengeResponse });
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

  const config = getAccountDeletionChallengeConfig();
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

  return Response.json(
    {
      message:
        "Notifica ricevuta. La verifica firma e la cancellazione dati vanno completate prima della beta reale.",
      status: "received",
    },
    { status: 202 },
  );
};
