import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import {
  ensureShopForSession,
  getEbayRuntimeReadiness,
} from "../services/syncbay.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await ensureShopForSession(session);

  const readiness = getEbayRuntimeReadiness();
  if (!readiness.ready) {
    return Response.json(
      {
        missingRequirements: readiness.missingRequirements,
        status: "blocked",
      },
      { status: 409 },
    );
  }

  return Response.json(
    {
      message: "OAuth eBay pronto per la prossima fase.",
      status: "not_implemented",
    },
    { status: 501 },
  );
};
