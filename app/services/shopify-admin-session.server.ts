import prisma from "../db.server";
import {
  createShopifyAdminGraphqlClient,
  getOfflineShopifySessionId,
} from "../lib/syncbay-shopify-admin";
import { shouldRefreshOfflineShopifySession } from "../lib/syncbay-shopify-session-refresh";
import { decryptSecret, encryptSecret } from "./crypto.server";

export async function getShopifyAdminGraphqlClient(shopDomain: string) {
  const session = await getUsableOfflineShopifySession(shopDomain);

  return createShopifyAdminGraphqlClient({
    accessToken: session.accessToken,
    shopDomain,
  });
}

async function getUsableOfflineShopifySession(shopDomain: string) {
  const sessionId = getOfflineShopifySessionId(shopDomain);
  const select = {
    accessToken: true,
    expires: true,
    refreshToken: true,
    refreshTokenExpires: true,
    scope: true,
  } as const;
  return getUsableOfflineShopifySessionWithPorts({
    now: () => new Date(),
    readSession: () => prisma.session.findUnique({ select, where: { id: sessionId } }),
    refresh: (refreshToken) => refreshOfflineShopifyAccessToken({ refreshToken, shopDomain }),
    compareAndSwap: (oldAccessToken, refreshed, scope) => prisma.session.updateMany({
      data: {
        accessToken: encryptSecret(refreshed.accessToken),
        expires: refreshed.expiresAt,
        refreshToken: encryptSecret(refreshed.refreshToken),
        refreshTokenExpires: refreshed.refreshTokenExpiresAt,
        scope: refreshed.scope ?? scope,
      },
      where: { id: sessionId, accessToken: oldAccessToken },
    }).then(({ count }) => count === 1),
  });
}

type PersistedOfflineSession = {
  accessToken: string;
  expires: Date | null;
  refreshToken: string | null;
  refreshTokenExpires: Date | null;
  scope: string | null;
};

type RefreshedOfflineSession = {
  accessToken: string;
  expiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  scope?: string;
};

export async function getUsableOfflineShopifySessionWithPorts(input: {
  compareAndSwap: (oldAccessToken: string, refreshed: RefreshedOfflineSession, scope: string | null) => Promise<boolean>;
  now: () => Date;
  readSession: () => Promise<PersistedOfflineSession | null>;
  refresh: (refreshToken: string) => Promise<RefreshedOfflineSession>;
}) {
  const persisted = await input.readSession();

  if (!persisted?.accessToken) {
    throw new Error(
      "Sessione offline Shopify non disponibile per il runner automatico.",
    );
  }

  const session = decryptPersistedSession(persisted);

  if (!shouldRefreshOfflineShopifySession(session.expires, input.now())) {
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

  if (session.refreshTokenExpires && session.refreshTokenExpires.getTime() <= input.now().getTime()) {
    throw new Error(
      "Refresh token Shopify offline scaduto: riapri l'app Shopify per autorizzare di nuovo SyncBay.",
    );
  }

  const refreshed = await input.refresh(session.refreshToken);
  const claimed = await input.compareAndSwap(
    persisted.accessToken,
    refreshed,
    session.scope,
  );

  if (claimed) {
    return {
      accessToken: refreshed.accessToken,
      expires: refreshed.expiresAt,
      refreshToken: refreshed.refreshToken,
      refreshTokenExpires: refreshed.refreshTokenExpiresAt,
      scope: refreshed.scope ?? session.scope,
    };
  }

  const winner = await input.readSession();
  if (!winner?.accessToken) {
    throw new Error("Sessione offline Shopify rimossa durante l'aggiornamento.");
  }
  return decryptPersistedSession(winner);
}

function decryptPersistedSession<T extends { accessToken: string; refreshToken: string | null }>(session: T) {
  try {
    return {
      ...session,
      accessToken: decryptSecret(session.accessToken),
      refreshToken: session.refreshToken ? decryptSecret(session.refreshToken) : null,
    };
  } catch {
    throw new Error(
      "Sessione Shopify non cifrata o non valida: riapri l'app per autorizzare di nuovo SyncBay.",
    );
  }
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
