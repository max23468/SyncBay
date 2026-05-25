import { EbayConnectionStatus, type EbayConnection } from "@prisma/client";

import prisma from "../db.server";
import { decryptSecret, encryptSecret } from "./crypto.server";

interface EbayTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
  scope?: string;
}

const EBAY_TOKEN_URLS = {
  production: "https://api.ebay.com/identity/v1/oauth2/token",
  sandbox: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
};
const ACCESS_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 7200;

export class EbayTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EbayTokenError";
  }
}

export async function getUsableEbayAccessToken(connection: EbayConnection) {
  if (connection.status !== EbayConnectionStatus.CONNECTED) {
    throw new EbayTokenError("Account eBay non collegato.");
  }

  if (connection.encryptedAccessToken && hasUsableAccessToken(connection)) {
    return {
      accessToken: decryptSecret(connection.encryptedAccessToken),
      refreshed: false,
    };
  }

  return refreshEbayAccessToken(connection);
}

function hasUsableAccessToken(connection: EbayConnection) {
  return Boolean(
    connection.tokenExpiresAt &&
    connection.tokenExpiresAt.getTime() >
      Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS,
  );
}

async function refreshEbayAccessToken(connection: EbayConnection) {
  if (!connection.encryptedRefreshToken) {
    await markReconnectRequired(connection.id);
    throw new EbayTokenError("Refresh token eBay assente: ricollega eBay.");
  }

  if (
    connection.refreshTokenExpiresAt &&
    connection.refreshTokenExpiresAt.getTime() <= Date.now()
  ) {
    await markReconnectRequired(connection.id);
    throw new EbayTokenError("Refresh token eBay scaduto: ricollega eBay.");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: decryptSecret(connection.encryptedRefreshToken),
  });
  const scopes = connection.scopes?.trim() || process.env.EBAY_SCOPES?.trim();
  if (scopes) body.set("scope", scopes);

  const response = await fetch(getTokenUrl(connection.environment), {
    body,
    headers: {
      Authorization: `Basic ${getBasicAuthHeader()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const json = (await response.json()) as EbayTokenResponse;

  if (!response.ok || !json.access_token) {
    await markReconnectRequired(connection.id);
    throw new EbayTokenError(
      json.error_description ??
        json.error ??
        "Refresh token eBay non riuscito.",
    );
  }

  const tokenExpiresAt = secondsFromNow(
    json.expires_in ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  );
  await prisma.ebayConnection.update({
    data: {
      encryptedAccessToken: encryptSecret(json.access_token),
      lastRefreshAt: new Date(),
      scopes: json.scope ?? connection.scopes,
      tokenExpiresAt,
    },
    where: { id: connection.id },
  });

  return {
    accessToken: json.access_token,
    refreshed: true,
  };
}

async function markReconnectRequired(connectionId: string) {
  await prisma.ebayConnection.update({
    data: {
      status: EbayConnectionStatus.RECONNECT_REQUIRED,
    },
    where: { id: connectionId },
  });
}

function getBasicAuthHeader() {
  return Buffer.from(
    `${requiredEnv("EBAY_CLIENT_ID")}:${requiredEnv("EBAY_CLIENT_SECRET")}`,
    "utf8",
  ).toString("base64");
}

function getTokenUrl(environment: string) {
  return environment === "production"
    ? EBAY_TOKEN_URLS.production
    : EBAY_TOKEN_URLS.sandbox;
}

function requiredEnv(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} non configurata.`);

  return value;
}

function secondsFromNow(seconds: number) {
  return new Date(Date.now() + seconds * 1000);
}
