import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { authenticate } from "../shopify.server";
import {
  createEbayAuthorizationRedirect,
} from "../services/ebay.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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

  throw redirect(authorization.url);
};
