const REQUIRED_WEBHOOK_SCOPE = "read_orders";
const ADMIN_ORDER_CREATE_SCOPE = "write_orders";
const TOKEN_REFRESH_SAFETY_MS = 5 * 60 * 1000;

export function buildReadinessReport(
  payload,
  { shopDomain = "shop non specificato" } = {},
) {
  const scopes = splitScopes(payload.session?.scope);
  const hasShop = Boolean(payload.shop?.id);
  const hasSession = Boolean(payload.session?.id);
  const ebayConnectionStatus = payload.ebayConnection?.status ?? null;
  const ebayConnectionReady = ebayConnectionStatus === "CONNECTED";
  const ebayAccessTokenExpiresAt = parseDateOrNull(
    payload.ebayConnection?.tokenExpiresAt,
  );
  const ebayRefreshTokenExpiresAt = parseDateOrNull(
    payload.ebayConnection?.refreshTokenExpiresAt,
  );
  const sessionExpiresAt = parseDateOrNull(payload.session?.expires);
  const refreshTokenExpiresAt = parseDateOrNull(
    payload.session?.refreshTokenExpires,
  );
  const checkedAt = parseDateOrNull(payload.checkedAt) ?? new Date();
  const sessionIsLegacy = hasSession && !sessionExpiresAt;
  const sessionExpired =
    Boolean(sessionExpiresAt) &&
    sessionExpiresAt.getTime() <= checkedAt.getTime();
  const refreshTokenExpired =
    Boolean(refreshTokenExpiresAt) &&
    refreshTokenExpiresAt.getTime() <= checkedAt.getTime();
  const hasEbayAccessToken =
    Number(payload.ebayConnection?.accessTokenLength ?? 0) > 0;
  const hasEbayRefreshToken =
    Number(payload.ebayConnection?.refreshTokenLength ?? 0) > 0;
  const ebayAccessTokenUsable =
    hasEbayAccessToken &&
    Boolean(ebayAccessTokenExpiresAt) &&
    ebayAccessTokenExpiresAt.getTime() >
      checkedAt.getTime() + TOKEN_REFRESH_SAFETY_MS;
  const ebayRefreshTokenExpired =
    Boolean(ebayRefreshTokenExpiresAt) &&
    ebayRefreshTokenExpiresAt.getTime() <= checkedAt.getTime();
  const ebayTokenRefreshRequired =
    ebayConnectionReady && !ebayAccessTokenUsable;
  const hasRefreshToken = Number(payload.session?.refreshTokenLength ?? 0) > 0;
  const hasAccessToken = Number(payload.session?.accessTokenLength ?? 0) > 0;
  const activeStockJobs = Number(payload.queue?.activeStockJobs ?? 0);
  const activeSyncJobs = Number(payload.queue?.activeSyncJobs ?? 0);
  const eligibleCandidateCount = Number(
    payload.mappingCounts?.eligibleQuantityPositive ?? 0,
  );
  const ebayTradingCooldownRetryAt = parseDateOrNull(
    payload.tradingApiCooldown?.retryScheduledAt ??
      payload.tradingApiCooldown?.runAfter,
  );
  const ebayTradingCooldownActive =
    Boolean(ebayTradingCooldownRetryAt) &&
    ebayTradingCooldownRetryAt.getTime() > checkedAt.getTime();
  const ebayTradingCooldownBlockers = ebayTradingCooldownActive
    ? [
        `Trading API eBay in cooldown fino a ${ebayTradingCooldownRetryAt.toISOString()}: rimanda il test Admin orderCreate.`,
      ]
    : [];

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
      ? [
          "Sessione Shopify offline legacy senza scadenza: riaprire l'app per migrare ai token a scadenza.",
        ]
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
    ...(ebayTokenRefreshRequired && !hasEbayRefreshToken
      ? ["Refresh token eBay assente: ricollega eBay."]
      : []),
    ...(ebayTokenRefreshRequired && ebayRefreshTokenExpired
      ? ["Refresh token eBay scaduto: ricollega eBay."]
      : []),
    ...(activeStockJobs > 0
      ? [`Ci sono ${activeStockJobs} job UPDATE_EBAY_STOCK attivi.`]
      : []),
    ...(activeSyncJobs > 0
      ? [`Ci sono ${activeSyncJobs} job SYNC_INCREMENTAL attivi.`]
      : []),
    ...(eligibleCandidateCount === 0
      ? [
          "Nessun mapping attivo con variante Shopify, snapshot EUR e quantità positiva.",
        ]
      : []),
  ];
  const adminOrderCreateBlockers = [
    ...webhookRuntimeBlockers,
    ...(!hasScope(scopes, ADMIN_ORDER_CREATE_SCOPE)
      ? [
          `Scope Shopify mancante per test Admin orderCreate: ${ADMIN_ORDER_CREATE_SCOPE}.`,
        ]
      : []),
    ...ebayTradingCooldownBlockers,
  ];

  return {
    adminOrderCreateTestReady: adminOrderCreateBlockers.length === 0,
    adminOrderCreateBlockers,
    checkedAt: checkedAt.toISOString(),
    candidates: payload.candidates ?? [],
    ebayConnection: {
      hasAccessToken: hasEbayAccessToken,
      hasRefreshToken: hasEbayRefreshToken,
      marketplaceId: payload.ebayConnection?.marketplaceId ?? "EBAY_IT",
      refreshTokenExpired: ebayRefreshTokenExpired,
      refreshTokenExpiresAt:
        payload.ebayConnection?.refreshTokenExpiresAt ?? null,
      status: ebayConnectionStatus,
      tokenExpiresAt: payload.ebayConnection?.tokenExpiresAt ?? null,
      tokenRefreshRequired: ebayTokenRefreshRequired,
    },
    ebayTradingCooldown: {
      active: ebayTradingCooldownActive,
      errorCode: payload.tradingApiCooldown?.errorCode ?? null,
      jobId: payload.tradingApiCooldown?.id ?? null,
      jobType: payload.tradingApiCooldown?.type ?? null,
      retryAt: ebayTradingCooldownRetryAt?.toISOString() ?? null,
      status: payload.tradingApiCooldown?.status ?? null,
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
      scopeMissingForAdminOrderCreate: !hasScope(
        scopes,
        ADMIN_ORDER_CREATE_SCOPE,
      ),
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

  const source = String(value);
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(source)
    ? source
    : `${source}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
