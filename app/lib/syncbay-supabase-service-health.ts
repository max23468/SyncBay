export type SupabaseHttpServiceId = "postgrest" | "auth" | "storage";

export type SupabaseHttpServiceCheck = {
  allowRlsDenied?: boolean;
  id: SupabaseHttpServiceId;
  label: string;
  path: string;
};

export type SupabaseHttpServiceStatus =
  | "healthy"
  | "restricted"
  | "missing_api_key"
  | "unauthorized"
  | "unhealthy";

export type SupabaseHttpServiceDiagnosis = {
  message: string | null;
  reason: string | null;
  status: SupabaseHttpServiceStatus;
  statusCode: number;
};

export const SUPABASE_HTTP_SERVICE_CHECKS: SupabaseHttpServiceCheck[] = [
  {
    allowRlsDenied: true,
    id: "postgrest",
    label: "PostgREST",
    path: "/rest/v1/Shop?select=id&limit=1",
  },
  { id: "auth", label: "Auth", path: "/auth/v1/health" },
  { id: "storage", label: "Storage", path: "/storage/v1/status" },
];

export function buildSupabaseServiceHeaders(apiKey: string) {
  const trimmedKey = apiKey.trim();

  if (!trimmedKey) {
    throw new Error("API key Supabase mancante.");
  }

  return {
    apikey: trimmedKey,
    authorization: `Bearer ${trimmedKey}`,
  };
}

export function classifySupabaseServiceResponse(input: {
  allowRlsDenied?: boolean;
  bodyText: string;
  status: number;
}): SupabaseHttpServiceDiagnosis {
  const message = normalizeSupabaseResponseMessage(input.bodyText);
  const rlsDeniedReason = getSupabaseRlsDeniedReason(input.bodyText);
  const restrictionReason = getSupabaseRestrictionReason(input.bodyText);

  if (
    input.allowRlsDenied &&
    (input.status === 401 || input.status === 403) &&
    rlsDeniedReason
  ) {
    return {
      message,
      reason: rlsDeniedReason,
      status: "healthy",
      statusCode: input.status,
    };
  }

  if (input.status === 402 || restrictionReason) {
    return {
      message,
      reason: restrictionReason,
      status: "restricted",
      statusCode: input.status,
    };
  }

  if (input.status === 401 && isMissingApiKeyResponse(input.bodyText)) {
    return {
      message,
      reason: "missing_api_key",
      status: "missing_api_key",
      statusCode: input.status,
    };
  }

  if (input.status === 401) {
    return {
      message,
      reason: "unauthorized",
      status: "unauthorized",
      statusCode: input.status,
    };
  }

  return {
    message,
    reason: null,
    status: input.status >= 200 && input.status < 300 ? "healthy" : "unhealthy",
    statusCode: input.status,
  };
}

export function getSupabaseRestrictionReason(bodyText: string): string | null {
  const normalized = bodyText.toLowerCase();

  if (normalized.includes("exceed_egress_quota")) {
    return "exceed_egress_quota";
  }

  const violationsMatch = normalized.match(/violations?:\s*([a-z0-9_, -]+)/);
  const firstViolation = violationsMatch?.[1]
    ?.split(/[,\s]+/)
    .find(Boolean)
    ?.trim();

  return firstViolation || null;
}

export function getSupabaseRlsDeniedReason(bodyText: string): string | null {
  const normalized = bodyText.toLowerCase();

  if (
    normalized.includes("permission denied for table") ||
    normalized.includes("row-level security") ||
    normalized.includes("rls")
  ) {
    return "rls_denied";
  }

  return null;
}

function isMissingApiKeyResponse(bodyText: string) {
  const normalized = bodyText.toLowerCase();

  return (
    normalized.includes("no api key") ||
    normalized.includes("missing_api_key") ||
    normalized.includes("apikey")
  );
}

function normalizeSupabaseResponseMessage(bodyText: string): string | null {
  const trimmed = bodyText.trim();

  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as {
      hint?: unknown;
      message?: unknown;
    };
    const parts = [parsed.message, parsed.hint].flatMap((part) => {
      if (typeof part !== "string") return [];
      const trimmed = part.trim();
      return trimmed ? [trimmed] : [];
    });

    return parts.length > 0 ? parts.join(" ") : trimmed;
  } catch {
    return trimmed;
  }
}
