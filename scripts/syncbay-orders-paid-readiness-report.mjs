const REQUIRED_WEBHOOK_SCOPE = "read_orders";
const ADMIN_ORDER_CREATE_SCOPE = "write_orders";

export function buildReadinessReport(
  payload,
  { shopDomain = "syncbay-dev.myshopify.com" } = {},
) {
  const scopes = splitScopes(payload.session?.scope);
  const hasShop = Boolean(payload.shop?.id);
  const hasSession = Boolean(payload.session?.id);
  const ebayConnectionStatus = payload.ebayConnection?.status ?? null;
  const ebayConnectionReady = ebayConnectionStatus === "CONNECTED";
  const sessionExpiresAt = parseDateOrNull(payload.session?.expires);
  const refreshTokenExpiresAt = parseDateOrNull(
    payload.session?.refreshTokenExpires,
  );
  const checkedAt = parseDateOrNull(payload.checkedAt) ?? new Date();
  const sessionIsLegacy = hasSession && !sessionExpiresAt;
  const sessionExpired =
    Boolean(sessionExpiresAt) && sessionExpiresAt.getTime() <= checkedAt.getTime();
  const refreshTokenExpired =
    Boolean(refreshTokenExpiresAt) &&
    refreshTokenExpiresAt.getTime() <= checkedAt.getTime();
  const hasRefreshToken = Number(payload.session?.refreshTokenLength ?? 0) > 0;
  const hasAccessToken = Number(payload.session?.accessTokenLength ?? 0) > 0;
  const activeStockJobs = Number(payload.queue?.activeStockJobs ?? 0);
  const activeSyncJobs = Number(payload.queue?.activeSyncJobs ?? 0);
  const eligibleCandidateCount = Number(
    payload.mappingCounts?.eligibleQuantityPositive ?? 0,
  );

  const webhookRuntimeBlockers = [
    ...(!hasShop ? ["Shop SyncBay non trovato."] : []),
    ...(!hasSession ? ["Sessione offline Shopify non trovata."] : []),
    ...(payload.session?.isOnline
      ? ["La sessione trovata è online; serve sessione offline."]
      : []),
    ...(hasSession && !hasAccessToken
      ? ["Access token Shopify offline assente."]
      : []),
    ...(sessionIsLegacy
      ? ["Sessione Shopify offline legacy senza scadenza: riaprire l'app per migrare ai token a scadenza."]
      : []),
    ...(hasSession && !hasRefreshToken
      ? ["Refresh token Shopify offline assente."]
      : []),
    ...(refreshTokenExpired
      ? ["Refresh token Shopify offline scaduto: riaprire l'app Shopify."]
      : []),
    ...(!hasScope(scopes, REQUIRED_WEBHOOK_SCOPE)
      ? [`Scope Shopify mancante: ${REQUIRED_WEBHOOK_SCOPE}.`]
      : []),
    ...(hasShop && !ebayConnectionReady
      ? [
          `Connessione eBay EBAY_IT non pronta: stato ${ebayConnectionStatus ?? "assente"}.`,
        ]
      : []),
    ...(activeStockJobs > 0
      ? [`Ci sono ${activeStockJobs} job UPDATE_EBAY_STOCK attivi.`]
      : []),
    ...(activeSyncJobs > 0
      ? [`Ci sono ${activeSyncJobs} job SYNC_INCREMENTAL attivi.`]
      : []),
    ...(eligibleCandidateCount === 0
      ? ["Nessun mapping attivo con variante Shopify, snapshot EUR e quantità positiva."]
      : []),
  ];
  const adminOrderCreateBlockers = [
    ...webhookRuntimeBlockers,
    ...(!hasScope(scopes, ADMIN_ORDER_CREATE_SCOPE)
      ? [`Scope Shopify mancante per test Admin orderCreate: ${ADMIN_ORDER_CREATE_SCOPE}.`]
      : []),
  ];

  return {
    adminOrderCreateTestReady: adminOrderCreateBlockers.length === 0,
    adminOrderCreateBlockers,
    checkedAt: checkedAt.toISOString(),
    candidates: payload.candidates ?? [],
    ebayConnection: {
      marketplaceId: payload.ebayConnection?.marketplaceId ?? "EBAY_IT",
      status: ebayConnectionStatus,
    },
    latestStockJobs: payload.latestStockJobs ?? [],
    mappingCounts: payload.mappingCounts,
    queue: payload.queue,
    session: {
      expires: payload.session?.expires ?? null,
      hasAccessToken,
      hasRefreshToken,
      id: payload.session?.id ?? null,
      isLegacy: sessionIsLegacy,
      isOnline: Boolean(payload.session?.isOnline),
      refreshTokenExpires: payload.session?.refreshTokenExpires ?? null,
      scopeMissingForAdminOrderCreate: !hasScope(scopes, ADMIN_ORDER_CREATE_SCOPE),
      scopeMissingForWebhook: !hasScope(scopes, REQUIRED_WEBHOOK_SCOPE),
      scopes,
      tokenExpired: sessionExpired,
    },
    shop: payload.shop,
    shopDomain,
    webhookRuntimeBlockers,
    webhookRuntimeReady: webhookRuntimeBlockers.length === 0,
  };
}

function splitScopes(value) {
  return String(value ?? "")
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function hasScope(scopes, requiredScope) {
  if (scopes.includes(requiredScope)) return true;

  if (requiredScope.startsWith("read_")) {
    const writeEquivalent = requiredScope.replace(/^read_/, "write_");
    return scopes.includes(writeEquivalent);
  }

  return false;
}

function parseDateOrNull(value) {
  if (!value) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
