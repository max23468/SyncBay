import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { markShopUninstalled } from "../services/syncbay.server";
import {
  getSyncBayRequestId,
  logSyncBayRuntimeEvent,
} from "../lib/syncbay-runtime-log";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  const requestId = getSyncBayRequestId(request);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }
  await markShopUninstalled(shop);
  logSyncBayRuntimeEvent({
    event: "shopify-webhook",
    level: "info",
    requestId,
    route: "webhooks.app.uninstalled",
    outcome: topic,
  });

  return new Response();
};
