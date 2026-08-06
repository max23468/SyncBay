import { AuditEventType, EbayConnectionStatus } from "@prisma/client";

import prisma from "../db.server";
import { SYNCBAY_AUDIT_LOG_CREATE_SELECT } from "../lib/syncbay-audit-log-write";
import { createOAuthState, encryptSecret, hashState } from "./crypto.server";
import { getEbayEnvironment, getEbayMarketplaceId, requiredEnv } from "./ebay-environment.server";
import { requestEbayOAuthToken } from "./ebay-oauth.server";
import { requestEbayRestJson } from "./ebay-rest.server";
import { ensureShopForSession, getEbayRuntimeReadiness } from "./syncbay.server";

interface ShopifySessionLike {
  shop: string;
  scope?: string | null;
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
    select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
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

export async function completeEbayAuthorization({ code, state }: { code: string; state: string }) {
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
  const ebayUser = await fetchEbayUser(token.accessToken);
  const connectedAt = new Date();
  const refreshTokenExpiresAt = token.refreshTokenExpiresIn
    ? secondsFromNow(token.refreshTokenExpiresIn)
    : null;
  const tokenExpiresAt = token.expiresIn ? secondsFromNow(token.expiresIn) : null;
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
        encryptedAccessToken: encryptSecret(token.accessToken),
        encryptedRefreshToken: token.refreshToken ? encryptSecret(token.refreshToken) : null,
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
        encryptedAccessToken: encryptSecret(token.accessToken),
        encryptedRefreshToken: token.refreshToken ? encryptSecret(token.refreshToken) : undefined,
        ebayUserId: ebayUser.userId,
        environment: getEbayEnvironment(),
        refreshTokenExpiresAt: refreshTokenExpiresAt ?? undefined,
        scopes,
        status: EbayConnectionStatus.CONNECTED,
        tokenExpiresAt,
      },
    }),
    prisma.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
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
  const json = await requestEbayRestJson<EbayUserResponse>({
    accessToken,
    operation: "Profilo eBay",
    url: new URL(getIdentityUserUrl()),
  });

  if (!json.userId) {
    throw new Error("Profilo eBay non ottenuto. Verifica scope Identity e consenso utente.");
  }

  return {
    accountType: json.accountType ?? null,
    registrationMarketplaceId: json.registrationMarketplaceId ?? null,
    userId: json.userId,
  };
}

async function exchangeAuthorizationCode(code: string) {
  return requestEbayOAuthToken({
    environment: getEbayEnvironment(),
    grant: {
      code,
      redirectUri: requiredEnv("EBAY_RU_NAME"),
      type: "authorization_code",
    },
  });
}

function getAuthorizeUrl() {
  return getEbayEnvironment() === "production" ? EBAY_AUTH_URLS.production : EBAY_AUTH_URLS.sandbox;
}

function getIdentityUserUrl() {
  return getEbayEnvironment() === "production"
    ? EBAY_IDENTITY_URLS.production
    : EBAY_IDENTITY_URLS.sandbox;
}

function getEbayScopes() {
  return (process.env.EBAY_SCOPES ?? "").split(/\s+/).flatMap((scope) => {
    const trimmedScope = scope.trim();
    return trimmedScope ? [trimmedScope] : [];
  });
}

function minutesFromNow(minutes: number) {
  return secondsFromNow(minutes * 60);
}

function secondsFromNow(seconds: number) {
  return new Date(Date.now() + seconds * 1000);
}
