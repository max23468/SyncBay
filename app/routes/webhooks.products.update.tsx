import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { isTransientWebhookPersistenceError } from "../lib/syncbay-webhook-errors";
import {
  extractWebhookResourceId,
  recordShopifyWebhookPlaceholder,
} from "../services/syncbay.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { payload, shop, topic, webhookId } =
      await authenticate.webhook(request);

    await recordShopifyWebhookPlaceholder({
      payload,
      resourceId: extractWebhookResourceId(payload),
      shopDomain: shop,
      topic,
      webhookId,
    });
  } catch (error) {
    if (!isTransientWebhookPersistenceError(error)) {
      throw error;
    }

    return new Response(null, {
      headers: {
        "X-SyncBay-Webhook-Degraded":
          "shopify-product-update-persistence-timeout",
      },
      status: 202,
    });
  }

  return new Response();
};
