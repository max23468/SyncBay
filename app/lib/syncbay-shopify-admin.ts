const SHOPIFY_ADMIN_API_VERSION = "2026-04";
const DEFAULT_MAX_GRAPHQL_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 2_000;
const DEFAULT_THROTTLE_RETRY_DELAY_MS = 20_000;

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
  maxAttempts?: number;
  retryDelayMs?: number;
  shopDomain: string;
  throttleRetryDelayMs?: number;
}): SyncBayShopifyAdminGraphqlClient {
  const fetchImplementation = input.fetch ?? fetch;
  const endpoint = `https://${input.shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;
  const maxAttempts = normalizePositiveInteger(
    input.maxAttempts,
    DEFAULT_MAX_GRAPHQL_ATTEMPTS,
  );
  const retryDelayMs = normalizePositiveInteger(
    input.retryDelayMs,
    DEFAULT_RETRY_DELAY_MS,
  );
  const throttleRetryDelayMs = normalizePositiveInteger(
    input.throttleRetryDelayMs,
    DEFAULT_THROTTLE_RETRY_DELAY_MS,
  );

  return {
    async graphql(query, options) {
      let lastResponse: ShopifyGraphqlFetchResponse | null = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        lastResponse = await fetchShopifyGraphql(fetchImplementation, endpoint, {
          accessToken: input.accessToken,
          query,
          variables: options?.variables ?? {},
        });

        const retryReason = getRetryReason(lastResponse);

        if (!retryReason || attempt === maxAttempts) {
          return toJsonResponse(lastResponse);
        }

        await sleep(getRetryDelayMs(retryReason, attempt, {
          retryDelayMs,
          throttleRetryDelayMs,
        }));
      }

      return toJsonResponse(lastResponse);
    },
  };
}

type ShopifyGraphqlFetchResponse = {
  json: Record<string, unknown> | null;
  ok: boolean;
  status: number;
};

async function fetchShopifyGraphql(
  fetchImplementation: typeof fetch,
  endpoint: string,
  input: {
    accessToken: string;
    query: string;
    variables: Record<string, unknown>;
  },
): Promise<ShopifyGraphqlFetchResponse> {
  const response = await fetchImplementation(endpoint, {
    body: JSON.stringify({
      query: input.query,
      variables: input.variables,
    }),
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": input.accessToken,
    },
    method: "POST",
  });
  const text = await response.text();

  return {
    json: parseJsonObject(text),
    ok: response.ok,
    status: response.status,
  };
}

function toJsonResponse(response: ShopifyGraphqlFetchResponse | null) {
  if (!response) {
    return new Response(
      JSON.stringify({
        errors: [{ message: "Shopify Admin API non ha restituito risposta." }],
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 502,
      },
    );
  }

  if (response.json) {
    return new Response(JSON.stringify(response.json), {
      headers: { "Content-Type": "application/json" },
      status: response.status,
    });
  }

  return new Response(
    JSON.stringify({
      errors: [
        {
          message: `Shopify Admin API ha restituito una risposta non JSON (HTTP ${response.status}).`,
        },
      ],
    }),
    {
      headers: { "Content-Type": "application/json" },
      status: response.ok ? 502 : response.status,
    },
  );
}

function getRetryReason(response: ShopifyGraphqlFetchResponse) {
  const errorMessage = getGraphqlErrorMessage(response.json);

  if (
    response.status === 429 ||
    errorMessage.includes("Throttled") ||
    hasGraphqlThrottleCode(response.json)
  ) {
    return "throttled" as const;
  }

  if (!response.json || response.status >= 500) {
    return "transient" as const;
  }

  return null;
}

function getRetryDelayMs(
  retryReason: "throttled" | "transient",
  attempt: number,
  input: { retryDelayMs: number; throttleRetryDelayMs: number },
) {
  const base =
    retryReason === "throttled"
      ? input.throttleRetryDelayMs
      : input.retryDelayMs;

  return base * attempt;
}

function getGraphqlErrorMessage(json: Record<string, unknown> | null) {
  const errors = Array.isArray(json?.errors) ? json.errors : [];

  return errors
    .map((error) =>
      error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "",
    )
    .filter(Boolean)
    .join("; ");
}

function hasGraphqlThrottleCode(json: Record<string, unknown> | null) {
  const errors = Array.isArray(json?.errors) ? json.errors : [];

  return errors.some((error) => {
    if (!error || typeof error !== "object" || !("extensions" in error)) {
      return false;
    }

    const extensions = error.extensions;

    if (!extensions || typeof extensions !== "object") return false;
    if (!("code" in extensions)) return false;

    return String(extensions.code).toUpperCase() === "THROTTLED";
  });
}

function parseJsonObject(text: string) {
  try {
    const parsed = JSON.parse(text);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
