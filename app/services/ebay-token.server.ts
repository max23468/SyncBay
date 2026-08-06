import { EbayConnectionStatus, type EbayConnection } from "@prisma/client";

import prisma from "../db.server";
import { decryptSecret, encryptSecret } from "./crypto.server";
import { EbayOAuthRequestError, requestEbayOAuthToken } from "./ebay-oauth.server";

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
    connection.tokenExpiresAt.getTime() > Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS,
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

  const scopes = connection.scopes?.trim() || process.env.EBAY_SCOPES?.trim();
  const refreshToken = decryptSecret(connection.encryptedRefreshToken);
  let token;

  try {
    token = await requestEbayOAuthToken({
      environment: connection.environment,
      grant: {
        refreshToken,
        scope: scopes,
        type: "refresh_token",
      },
    });
  } catch (error) {
    if (
      error instanceof EbayOAuthRequestError &&
      (error.status === 401 || error.status === 403 || isAuthTokenError(error.code))
    ) {
      await markReconnectRequired(connection.id);
    }

    throw new EbayTokenError(
      error instanceof EbayOAuthRequestError
        ? error.status === null
          ? "Errore di rete durante refresh token eBay."
          : error.message
        : "Refresh token eBay non riuscito.",
    );
  }

  const tokenExpiresAt = secondsFromNow(token.expiresIn ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS);
  await prisma.ebayConnection.update({
    data: {
      encryptedAccessToken: encryptSecret(token.accessToken),
      lastRefreshAt: new Date(),
      scopes: token.scope ?? connection.scopes,
      tokenExpiresAt,
    },
    where: { id: connection.id },
  });

  return {
    accessToken: token.accessToken,
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

function isAuthTokenError(error?: string) {
  if (!error) return false;

  return ["invalid_grant", "invalid_request", "invalid_client", "unauthorized_client"].includes(
    error.toLowerCase(),
  );
}

function secondsFromNow(seconds: number) {
  return new Date(Date.now() + seconds * 1000);
}
