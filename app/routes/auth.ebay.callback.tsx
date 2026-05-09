import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { completeEbayAuthorization } from "../services/ebay.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return Response.json(
      {
        error,
        message:
          url.searchParams.get("error_description") ??
          "Connessione eBay rifiutata o interrotta.",
        status: "rejected",
      },
      { status: 400 },
    );
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return Response.json(
      {
        message: "Callback OAuth eBay senza code o state.",
        status: "invalid_request",
      },
      { status: 400 },
    );
  }

  const shopDomain = await completeEbayAuthorization({ code, state });
  throw redirect(`/app?shop=${encodeURIComponent(shopDomain)}`);
};
