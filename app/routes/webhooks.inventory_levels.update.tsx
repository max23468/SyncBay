import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { getSyncBayRequestId, logSyncBayRuntimeEvent } from "../lib/syncbay-runtime-log";
import {
  extractWebhookResourceId,
  recordShopifyWebhookPlaceholder,
} from "../services/syncbay.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const requestId = getSyncBayRequestId(request);
  const startedAt = performance.now();
  try {
    const { payload, shop, topic, webhookId } = await authenticate.webhook(request);

    await recordShopifyWebhookPlaceholder({
      payload,
      resourceId: extractWebhookResourceId(payload),
      shopDomain: shop,
      topic,
      webhookId,
    });
  } catch (error) {
    logSyncBayRuntimeEvent({
      event: "shopify-webhook",
      level: "error",
      requestId,
      route: "webhooks.inventory-levels.update",
      durationMs: Math.round(performance.now() - startedAt),
      outcome: "failed",
    });
    throw error;
  }

  logSyncBayRuntimeEvent({
    event: "shopify-webhook",
    level: "info",
    requestId,
    route: "webhooks.inventory-levels.update",
    durationMs: Math.round(performance.now() - startedAt),
    outcome: "accepted",
  });

  return new Response();
};
