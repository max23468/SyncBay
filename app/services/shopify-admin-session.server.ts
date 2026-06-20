import prisma from "../db.server";
import {
  createShopifyAdminGraphqlClient,
  getOfflineShopifySessionId,
} from "../lib/syncbay-shopify-admin";
import { shouldRefreshOfflineShopifySession } from "../lib/syncbay-shopify-session-refresh";

export async function getShopifyAdminGraphqlClient(shopDomain: string) {
  const session = await getUsableOfflineShopifySession(shopDomain);

  return createShopifyAdminGraphqlClient({
    accessToken: session.accessToken,
    shopDomain,
  });
}

async function getUsableOfflineShopifySession(shopDomain: string) {
  const sessionId = getOfflineShopifySessionId(shopDomain);

  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM "Session"
        WHERE id = ${sessionId}
        FOR UPDATE
      `;

      const session = await tx.session.findUnique({
        select: {
          accessToken: true,
          expires: true,
          refreshToken: true,
          refreshTokenExpires: true,
          scope: true,
        },
        where: { id: sessionId },
      });

      if (!session?.accessToken) {
        throw new Error(
          "Sessione offline Shopify non disponibile per il runner automatico.",
        );
      }

      if (!shouldRefreshOfflineShopifySession(session.expires, new Date())) {
        return session;
      }

      if (!session.refreshToken) {
        if (!session.expires) {
          throw new Error(
            "Sessione offline Shopify legacy senza scadenza e senza refresh token: riapri l'app Shopify per migrare ai token offline a scadenza richiesti dalle public app Shopify dal 2027.",
          );
        }

        throw new Error(
          "Sessione offline Shopify scaduta senza refresh token: riapri l'app Shopify per autorizzare di nuovo SyncBay.",
        );
      }

      if (
        session.refreshTokenExpires &&
        session.refreshTokenExpires.getTime() <= Date.now()
      ) {
        throw new Error(
          "Refresh token Shopify offline scaduto: riapri l'app Shopify per autorizzare di nuovo SyncBay.",
        );
      }

      const refreshed = await refreshOfflineShopifyAccessToken({
        refreshToken: session.refreshToken,
        shopDomain,
      });

      return tx.session.update({
        data: {
          accessToken: refreshed.accessToken,
          expires: refreshed.expiresAt,
          refreshToken: refreshed.refreshToken,
          refreshTokenExpires: refreshed.refreshTokenExpiresAt,
          scope: refreshed.scope ?? session.scope,
        },
        select: {
          accessToken: true,
          expires: true,
          refreshToken: true,
          refreshTokenExpires: true,
          scope: true,
        },
        where: { id: sessionId },
      });
    },
    { timeout: 20_000 },
  );
}

async function refreshOfflineShopifyAccessToken(input: {
  refreshToken: string;
  shopDomain: string;
}) {
  const clientId = process.env.SHOPIFY_API_KEY;
  const clientSecret = process.env.SHOPIFY_API_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Credenziali Shopify app mancanti: impossibile aggiornare il token offline.",
    );
  }

  const response = await fetch(
    `https://${input.shopDomain}/admin/oauth/access_token`,
    {
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
      }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    },
  );
  const json = (await response.json().catch(() => null)) as
    | {
        access_token?: string;
        expires_in?: number;
        refresh_token?: string;
        refresh_token_expires_in?: number;
        scope?: string;
      }
    | null;

  if (!response.ok || !json?.access_token || !json.refresh_token) {
    throw new Error(
      `Refresh token Shopify offline non riuscito (HTTP ${response.status}).`,
    );
  }

  const now = Date.now();

  return {
    accessToken: json.access_token,
    expiresAt: new Date(now + Number(json.expires_in ?? 3600) * 1000),
    refreshToken: json.refresh_token,
    refreshTokenExpiresAt: new Date(
      now + Number(json.refresh_token_expires_in ?? 7_776_000) * 1000,
    ),
    scope: json.scope,
  };
}
