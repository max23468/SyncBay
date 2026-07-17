import prisma from "../db.server";
import { logSyncBayRuntimeEvent } from "../lib/syncbay-runtime-log";
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

// I refresh token Shopify sono rotanti: due refresh concorrenti con lo stesso
// token ne bruciano uno. Dentro la stessa istanza (Fluid Compute serve più
// richieste in parallelo) i chiamanti concorrenti condividono la stessa
// promise invece di gareggiare; tra istanze diverse resta il compare-and-swap.
const inFlightOfflineSessions = new Map<string, Promise<unknown>>();

export function dedupeInFlight<T>(
  map: Map<string, Promise<unknown>>,
  key: string,
  create: () => Promise<T>,
): Promise<T> {
  const existing = map.get(key);
  if (existing) return existing as Promise<T>;

  const promise = create().finally(() => {
    map.delete(key);
  });
  map.set(key, promise);
  return promise;
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
  return dedupeInFlight(inFlightOfflineSessions, sessionId, () =>
    getUsableOfflineShopifySessionWithPorts({
      now: () => new Date(),
      readSession: () =>
        prisma.session.findUnique({ select, where: { id: sessionId } }),
      refresh: (refreshToken) =>
        refreshOfflineShopifyAccessToken({ refreshToken, shopDomain }),
      compareAndSwap: (oldAccessToken, refreshed, scope) =>
        prisma.session
          .updateMany({
            data: {
              accessToken: encryptSecret(refreshed.accessToken),
              expires: refreshed.expiresAt,
              refreshToken: encryptSecret(refreshed.refreshToken),
              refreshTokenExpires: refreshed.refreshTokenExpiresAt,
              scope: refreshed.scope ?? scope,
            },
            where: { id: sessionId, accessToken: oldAccessToken },
          })
          .then(({ count }) => count === 1),
      log: (event) =>
        logSyncBayRuntimeEvent(
          {
            event: "shopify-offline-session-refresh",
            requestId: null,
            route: "shopify-admin-session",
            shopDomain,
            ...event,
          },
          // Eventi rari e decisivi per la diagnosi auth: la campionatura 5%
          // dei log info in produzione li perderebbe, quindi va disattivata.
          { random: () => 0 },
        ),
    }),
  );
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

type OfflineSessionRefreshLog = (event: {
  level: "info" | "warn" | "error";
  outcome: string;
  durationMs?: number;
}) => void;

// Attese tra le riletture quando il refresh fallisce: il vincitore della
// rotazione potrebbe non aver ancora persistito il token nuovo quando il
// nostro 401 arriva. La prima rilettura è immediata, le successive attendono.
const REFRESH_RECOVERY_DELAYS_MS = [0, 500, 1500];

export async function getUsableOfflineShopifySessionWithPorts(input: {
  compareAndSwap: (
    oldAccessToken: string,
    refreshed: RefreshedOfflineSession,
    scope: string | null,
  ) => Promise<boolean>;
  log?: OfflineSessionRefreshLog;
  now: () => Date;
  readSession: () => Promise<PersistedOfflineSession | null>;
  refresh: (refreshToken: string) => Promise<RefreshedOfflineSession>;
  sleep?: (ms: number) => Promise<void>;
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

  if (
    session.refreshTokenExpires &&
    session.refreshTokenExpires.getTime() <= input.now().getTime()
  ) {
    throw new Error(
      "Refresh token Shopify offline scaduto: riapri l'app Shopify per autorizzare di nuovo SyncBay.",
    );
  }

  const log: OfflineSessionRefreshLog = input.log ?? (() => {});
  const sleep =
    input.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const refreshStartedAt = Date.now();

  let refreshed: RefreshedOfflineSession;
  try {
    refreshed = await input.refresh(session.refreshToken);
  } catch (error) {
    // Race sullo stesso shop: un altro runner può aver già ruotato/consumato
    // questo refresh token nella stessa finestra, facendo fallire il nostro
    // refresh prima del percorso compare-and-swap perdente. Se la sessione
    // persistita è cambiata sotto di noi, riusa quella vincente invece di far
    // fallire il job; le riletture attendono il vincitore che potrebbe non
    // aver ancora scritto. Altrimenti il refresh è davvero rotto.
    for (const delayMs of REFRESH_RECOVERY_DELAYS_MS) {
      if (delayMs > 0) await sleep(delayMs);
      const winner = await input.readSession();
      if (winner?.accessToken && winner.accessToken !== persisted.accessToken) {
        log({
          durationMs: Date.now() - refreshStartedAt,
          level: "warn",
          outcome: "refresh-fallito-riusata-sessione-vincente",
        });
        return decryptPersistedSession(winner);
      }
    }
    log({
      durationMs: Date.now() - refreshStartedAt,
      level: "error",
      outcome: `refresh-fallito-${describeRefreshFailure(error)}`,
    });
    throw error;
  }

  const claimed = await input.compareAndSwap(
    persisted.accessToken,
    refreshed,
    session.scope,
  );

  if (claimed) {
    log({
      durationMs: Date.now() - refreshStartedAt,
      level: "info",
      outcome: "refresh-riuscito-e-persistito",
    });
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
    log({
      durationMs: Date.now() - refreshStartedAt,
      level: "error",
      outcome: "cas-perso-sessione-rimossa",
    });
    throw new Error(
      "Sessione offline Shopify rimossa durante l'aggiornamento.",
    );
  }
  log({
    durationMs: Date.now() - refreshStartedAt,
    level: "warn",
    outcome: "cas-perso-riusata-sessione-vincente",
  });
  return decryptPersistedSession(winner);
}

function describeRefreshFailure(error: unknown) {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? `http-${status}` : "senza-status";
}

function decryptPersistedSession<
  T extends { accessToken: string; refreshToken: string | null },
>(session: T) {
  try {
    return {
      ...session,
      accessToken: decryptSecret(session.accessToken),
      refreshToken: session.refreshToken
        ? decryptSecret(session.refreshToken)
        : null,
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
  const json = (await response.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    scope?: string;
  } | null;

  if (!response.ok || !json?.access_token || !json.refresh_token) {
    const error = new Error(
      `Refresh token Shopify offline non riuscito (HTTP ${response.status}).`,
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
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
