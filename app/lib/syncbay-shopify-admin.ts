import { setTimeout as sleep } from "node:timers/promises";

const SHOPIFY_ADMIN_API_VERSION = "2026-07";
const DEFAULT_MAX_GRAPHQL_ATTEMPTS = 4;
const DEFAULT_MAX_ELAPSED_MS = 45_000;
const DEFAULT_RETRY_DELAY_MS = 2_000;
const DEFAULT_THROTTLE_RETRY_DELAY_MS = 15_000;

export interface ShopifyAdminRetryPolicy {
  maxAttempts: number;
  maxElapsedMs: number;
  retryDelayMs: number;
  throttleRetryDelayMs: number;
}

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
  now?: () => number;
  policy?: Partial<ShopifyAdminRetryPolicy>;
  shopDomain: string;
  sleep?: (ms: number) => Promise<void>;
}): SyncBayShopifyAdminGraphqlClient {
  const fetchImplementation = input.fetch ?? fetch;
  const now = input.now ?? Date.now;
  const sleepImplementation = input.sleep ?? sleep;
  const endpoint = `https://${input.shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;
  const policy: ShopifyAdminRetryPolicy = {
    maxAttempts: normalizePositiveInteger(input.policy?.maxAttempts,
    DEFAULT_MAX_GRAPHQL_ATTEMPTS,
    ),
    maxElapsedMs: normalizePositiveInteger(input.policy?.maxElapsedMs, DEFAULT_MAX_ELAPSED_MS),
    retryDelayMs: normalizePositiveInteger(input.policy?.retryDelayMs, DEFAULT_RETRY_DELAY_MS),
    throttleRetryDelayMs: normalizePositiveInteger(input.policy?.throttleRetryDelayMs, DEFAULT_THROTTLE_RETRY_DELAY_MS),
  };

  return {
    async graphql(query, options) {
      let lastResponse: ShopifyGraphqlFetchResponse | null = null;
      const startedAt = now();

      for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
        lastResponse = await fetchShopifyGraphql(fetchImplementation, endpoint, {
          accessToken: input.accessToken,
          query,
          variables: options?.variables ?? {},
        });

        const retryReason = getRetryReason(lastResponse);

        if (!retryReason || attempt === policy.maxAttempts) {
          return toJsonResponse(lastResponse);
        }

        const retryDelay = getRetryDelayMs(
          retryReason,
          attempt,
          policy,
          lastResponse.json,
        );
        if (now() - startedAt + retryDelay >= policy.maxElapsedMs) {
          return toJsonResponse(lastResponse);
        }
        await sleepImplementation(retryDelay);
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
  if (
    response.status === 429 ||
    hasGraphqlThrottleSignal(response.json)
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
  json: Record<string, unknown> | null,
) {
  const base =
    retryReason === "throttled"
      ? input.throttleRetryDelayMs
      : input.retryDelayMs;

  return Math.max(base * attempt, getThrottleCostDelayMs(json));
}

function getThrottleCostDelayMs(json: Record<string, unknown> | null) {
  const extensions = json?.extensions;
  if (!extensions || typeof extensions !== "object") return 0;
  const cost = "cost" in extensions && extensions.cost && typeof extensions.cost === "object"
    ? extensions.cost : null;
  const throttle = cost && "throttleStatus" in cost && cost.throttleStatus && typeof cost.throttleStatus === "object"
    ? cost.throttleStatus : null;
  const requested = cost && "requestedQueryCost" in cost ? Number(cost.requestedQueryCost) : 0;
  const available = throttle && "currentlyAvailable" in throttle ? Number(throttle.currentlyAvailable) : 0;
  const restoreRate = throttle && "restoreRate" in throttle ? Number(throttle.restoreRate) : 0;
  if (restoreRate <= 0 || requested <= available) return 0;
  return Math.ceil(((requested - available) / restoreRate) * 1000);
}

function hasGraphqlThrottleSignal(json: Record<string, unknown> | null) {
  const errors = Array.isArray(json?.errors) ? json.errors : [];

  return errors.some((error) => {
    if (!error || typeof error !== "object") return false;

    const message =
      "message" in error ? String(error.message).toLowerCase() : "";
    const extensions =
      "extensions" in error &&
      error.extensions &&
      typeof error.extensions === "object"
        ? error.extensions
        : null;
    const code =
      extensions && "code" in extensions
        ? String(extensions.code).toUpperCase()
        : "";

    return code === "THROTTLED" || message.includes("throttled");
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
