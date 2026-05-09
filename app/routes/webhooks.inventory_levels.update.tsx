import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import {
  extractWebhookResourceId,
  recordShopifyWebhookPlaceholder,
} from "../services/syncbay.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  await recordShopifyWebhookPlaceholder({
    resourceId: extractWebhookResourceId(payload),
    shopDomain: shop,
    topic,
  });

  return new Response();
};
