import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { updateShopifyScopes } from "../services/syncbay-operations.server";
import { getSyncBayRequestId, logSyncBayRuntimeEvent } from "../lib/syncbay-runtime-log";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  const requestId = getSyncBayRequestId(request);

  const current = payload.current as string[];
  if (session) {
    await db.session.update({
      where: {
        id: session.id,
      },
      data: {
        scope: current.toString(),
      },
    });
  }
  await updateShopifyScopes(shop, current);
  logSyncBayRuntimeEvent({
    event: "shopify-webhook",
    level: "info",
    requestId,
    route: "webhooks.app.scopes-update",
    outcome: topic,
  });
  return new Response();
};
