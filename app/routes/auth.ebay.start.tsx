import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { createEbayAuthorizationRedirect } from "../services/ebay.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { redirect, session } = await authenticate.admin(request);
  const authorization = await createEbayAuthorizationRedirect(session);

  if (!authorization.ready) {
    return Response.json(
      {
        missingRequirements: authorization.missingRequirements,
        status: "blocked",
      },
      { status: 409 },
    );
  }

  return redirect(authorization.url, { target: "_top" });
};
