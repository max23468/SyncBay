import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  return Response.json(
    {
      hasCode: url.searchParams.has("code"),
      hasState: url.searchParams.has("state"),
      message: "Callback OAuth eBay riservata alla prossima fase connessioni.",
      status: "not_implemented",
    },
    { status: 501 },
  );
};
