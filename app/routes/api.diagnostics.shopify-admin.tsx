import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { verifyInternalAppSecret } from "../lib/syncbay-internal-auth";
import {
  buildShopifyAdminDiagnosticsProductQuery,
  normalizeShopifyAdminDiagnosticsProductInput,
} from "../lib/syncbay-shopify-admin-diagnostics";
import { getShopifyAdminGraphqlClient } from "../services/shopify-admin-session.server";

export const loader = async ({ request, url }: LoaderFunctionArgs) => {
  requireInternalAppSecret(request);

  const { shopDomain } = normalizeDiagnosticsProductInput(
    {
      productGids: [],
      shopDomain: url.searchParams.get("shop"),
    },
    { fallbackShopDomain: getOptionalFallbackShopDomain() },
  );
  const admin = await getShopifyAdminGraphqlClient(shopDomain);
  const response = await admin.graphql(
    `query SyncBayShopifyAdminDiagnosticsStatus {
      shop {
        id
        name
      }
    }`,
  );
  const json = await response.json().catch(() => null);

  if (!response.ok || hasGraphqlErrors(json)) {
    return Response.json(
      {
        ok: false,
        shopDomain,
        shopifyStatus: response.status,
        status: "shopify_admin_unavailable",
      },
      { status: 502 },
    );
  }

  return Response.json({
    ok: true,
    endpoint: "syncbay-shopify-admin-diagnostics",
    shopDomain,
    shopIdPresent: Boolean(json?.data?.shop?.id),
    shopNamePresent: Boolean(json?.data?.shop?.name),
    status: "ready",
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  requireInternalAppSecret(request);

  const payload = await request.json().catch(() => {
    throw new Response("JSON diagnostica Shopify non valido.", { status: 400 });
  });
  const input = normalizeDiagnosticsProductInput(payload, {
    fallbackShopDomain: getOptionalFallbackShopDomain(),
  });

  if (input.productGids.length === 0) {
    return Response.json({
      ok: true,
      products: [],
      shopDomain: input.shopDomain,
    });
  }

  const admin = await getShopifyAdminGraphqlClient(input.shopDomain);
  const query = buildShopifyAdminDiagnosticsProductQuery(input);
  const response = await admin.graphql(query.query, {
    variables: query.variables,
  });
  const json = await response.json().catch(() => null);

  if (!response.ok || hasGraphqlErrors(json)) {
    return Response.json(
      {
        ok: false,
        productCount: input.productGids.length,
        shopDomain: input.shopDomain,
        shopifyStatus: response.status,
        status: "shopify_admin_unavailable",
      },
      { status: 502 },
    );
  }

  return Response.json({
    ok: true,
    products: Array.isArray(json?.data?.nodes) ? json.data.nodes : [],
    shopDomain: input.shopDomain,
  });
};

function requireInternalAppSecret(request: Request) {
  const result = verifyInternalAppSecret({
    authorization: request.headers.get("authorization"),
    expectedSecret: process.env.APP_SECRET,
    headerSecret: request.headers.get("x-syncbay-app-secret"),
  });

  if (!result.ok) {
    throw new Response(result.message, { status: result.status });
  }
}

function getOptionalFallbackShopDomain() {
  return process.env.SHOPIFY_DEV_STORE?.trim() ?? "";
}

function normalizeDiagnosticsProductInput(
  payload: unknown,
  input: { fallbackShopDomain: string },
) {
  try {
    return normalizeShopifyAdminDiagnosticsProductInput(payload, input);
  } catch (error) {
    throw new Response(
      error instanceof Error
        ? error.message
        : "Payload diagnostica Shopify non valido.",
      { status: 400 },
    );
  }
}

function hasGraphqlErrors(payload: unknown) {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    "errors" in payload &&
    Array.isArray(payload.errors) &&
    payload.errors.length > 0,
  );
}
