const SHOPIFY_ADMIN_API_VERSION = "2026-04";

export type SyncBayShopifyAdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export function getOfflineShopifySessionId(shopDomain: string) {
  return `offline_${shopDomain}`;
}

export function createShopifyAdminGraphqlClient(input: {
  accessToken: string;
  fetch?: typeof fetch;
  shopDomain: string;
}): SyncBayShopifyAdminGraphqlClient {
  const fetchImplementation = input.fetch ?? fetch;
  const endpoint = `https://${input.shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;

  return {
    graphql(query, options) {
      return fetchImplementation(endpoint, {
        body: JSON.stringify({
          query,
          variables: options?.variables ?? {},
        }),
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": input.accessToken,
        },
        method: "POST",
      });
    },
  };
}
