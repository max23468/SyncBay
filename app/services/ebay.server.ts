import { AuditEventType, EbayConnectionStatus } from "@prisma/client";

import prisma from "../db.server";
import { createOAuthState, encryptSecret, hashState } from "./crypto.server";
import {
  ensureShopForSession,
  getEbayRuntimeReadiness,
} from "./syncbay.server";

interface ShopifySessionLike {
  shop: string;
  scope?: string | null;
}

interface EbayTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

interface EbayUserResponse {
  accountType?: string;
  registrationMarketplaceId?: string;
  userId?: string;
}

const EBAY_AUTH_URLS = {
  production: "https://auth.ebay.com/oauth2/authorize",
  sandbox: "https://auth.sandbox.ebay.com/oauth2/authorize",
};

const EBAY_TOKEN_URLS = {
  production: "https://api.ebay.com/identity/v1/oauth2/token",
  sandbox: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
};

const EBAY_IDENTITY_URLS = {
  production: "https://apiz.ebay.com/commerce/identity/v1/user/",
  sandbox: "https://apiz.sandbox.ebay.com/commerce/identity/v1/user/",
};

const OAUTH_STATE_TTL_MINUTES = 15;

export async function createEbayAuthorizationRedirect(session: ShopifySessionLike) {
  const readiness = getEbayRuntimeReadiness();
  if (!readiness.ready) {
    return {
      missingRequirements: readiness.missingRequirements,
      ready: false as const,
    };
  }

  const shop = await ensureShopForSession(session);
  const state = createOAuthState();
  await prisma.ebayOAuthState.create({
    data: {
      expiresAt: minutesFromNow(OAUTH_STATE_TTL_MINUTES),
      shopId: shop.id,
      stateHash: hashState(state),
    },
  });
  await prisma.auditLog.create({
    data: {
      message: "Connessione eBay avviata.",
      shopId: shop.id,
      type: AuditEventType.EBAY_CONNECT_STARTED,
    },
  });

  const authorizeUrl = new URL(getAuthorizeUrl());
  authorizeUrl.searchParams.set("client_id", requiredEnv("EBAY_CLIENT_ID"));
  authorizeUrl.searchParams.set("redirect_uri", requiredEnv("EBAY_RU_NAME"));
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", getEbayScopes().join(" "));
  authorizeUrl.searchParams.set("state", state);

  return {
    ready: true as const,
    url: authorizeUrl.toString(),
  };
}

export async function completeEbayAuthorization({
  code,
  state,
}: {
  code: string;
  state: string;
}) {
  const stateHash = hashState(state);
  const oauthState = await prisma.ebayOAuthState.findUnique({
    include: { shop: true },
    where: { stateHash },
  });

  if (!oauthState) {
    throw new Error("State OAuth eBay non valido o scaduto.");
  }

  await consumeOAuthState(oauthState.id);

  const token = await exchangeAuthorizationCode(code);
  const ebayUser = await fetchEbayUser(token.access_token);
  const connectedAt = new Date();
  const refreshTokenExpiresAt = token.refresh_token_expires_in
    ? secondsFromNow(token.refresh_token_expires_in)
    : null;
  const tokenExpiresAt = token.expires_in ? secondsFromNow(token.expires_in) : null;
  const scopes = token.scope ?? getEbayScopes().join(" ");

  await prisma.$transaction([
    prisma.ebayConnection.upsert({
      where: {
        shopId_marketplaceId: {
          marketplaceId: getEbayMarketplaceId(),
          shopId: oauthState.shopId,
        },
      },
      create: {
        connectedAt,
        encryptedAccessToken: encryptSecret(token.access_token),
        encryptedRefreshToken: token.refresh_token ? encryptSecret(token.refresh_token) : null,
        ebayUserId: ebayUser.userId,
        environment: getEbayEnvironment(),
        marketplaceId: getEbayMarketplaceId(),
        refreshTokenExpiresAt,
        scopes,
        shopId: oauthState.shopId,
        status: EbayConnectionStatus.CONNECTED,
        tokenExpiresAt,
      },
      update: {
        connectedAt,
        encryptedAccessToken: encryptSecret(token.access_token),
        encryptedRefreshToken: token.refresh_token ? encryptSecret(token.refresh_token) : undefined,
        ebayUserId: ebayUser.userId,
        environment: getEbayEnvironment(),
        refreshTokenExpiresAt: refreshTokenExpiresAt ?? undefined,
        scopes,
        status: EbayConnectionStatus.CONNECTED,
        tokenExpiresAt,
      },
    }),
    prisma.auditLog.create({
      data: {
        message: "Account eBay collegato.",
        shopId: oauthState.shopId,
        type: AuditEventType.EBAY_CONNECTED,
      },
    }),
  ]);

  return oauthState.shop.shopDomain;
}

async function consumeOAuthState(oauthStateId: string) {
  const consumedAt = new Date();
  const result = await prisma.ebayOAuthState.updateMany({
    data: { consumedAt },
    where: {
      consumedAt: null,
      expiresAt: {
        gte: consumedAt,
      },
      id: oauthStateId,
    },
  });

  if (result.count !== 1) {
    throw new Error("State OAuth eBay non valido o scaduto.");
  }
}

async function fetchEbayUser(accessToken: string) {
  const response = await fetch(getIdentityUserUrl(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const json = (await response.json()) as EbayUserResponse & {
    errors?: Array<{ message?: string }>;
  };

  if (!response.ok || !json.userId) {
    throw new Error("Profilo eBay non ottenuto. Verifica scope Identity e consenso utente.");
  }

  return {
    accountType: json.accountType ?? null,
    registrationMarketplaceId: json.registrationMarketplaceId ?? null,
    userId: json.userId,
  };
}

async function exchangeAuthorizationCode(code: string) {
  const response = await fetch(getTokenUrl(), {
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      redirect_uri: requiredEnv("EBAY_RU_NAME"),
    }),
    headers: {
      Authorization: `Basic ${getBasicAuthHeader()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const json = (await response.json()) as Partial<EbayTokenResponse> & {
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description ?? json.error ?? "Token OAuth eBay non ottenuto.");
  }

  return json as EbayTokenResponse;
}

function getBasicAuthHeader() {
  return Buffer.from(
    `${requiredEnv("EBAY_CLIENT_ID")}:${requiredEnv("EBAY_CLIENT_SECRET")}`,
    "utf8",
  ).toString("base64");
}

function getAuthorizeUrl() {
  return getEbayEnvironment() === "production"
    ? EBAY_AUTH_URLS.production
    : EBAY_AUTH_URLS.sandbox;
}

function getTokenUrl() {
  return getEbayEnvironment() === "production"
    ? EBAY_TOKEN_URLS.production
    : EBAY_TOKEN_URLS.sandbox;
}

function getIdentityUserUrl() {
  return getEbayEnvironment() === "production"
    ? EBAY_IDENTITY_URLS.production
    : EBAY_IDENTITY_URLS.sandbox;
}

function getEbayEnvironment() {
  return process.env.EBAY_ENVIRONMENT === "production" ? "production" : "sandbox";
}

function getEbayMarketplaceId() {
  return process.env.EBAY_MARKETPLACE_ID ?? "EBAY_IT";
}

function getEbayScopes() {
  return (process.env.EBAY_SCOPES ?? "")
    .split(/\s+/)
    .flatMap((scope) => {
      const trimmedScope = scope.trim();
      return trimmedScope ? [trimmedScope] : [];
    });
}

function requiredEnv(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} non configurata.`);

  return value;
}

function minutesFromNow(minutes: number) {
  return secondsFromNow(minutes * 60);
}

function secondsFromNow(seconds: number) {
  return new Date(Date.now() + seconds * 1000);
}
