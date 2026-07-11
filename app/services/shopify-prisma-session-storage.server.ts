import { Session as ShopifySession } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";

import {
  decryptSecret,
  encryptSecretIfNeeded,
} from "./crypto.server";

const UNIQUE_KEY_CONSTRAINT_ERROR_CODE = "P2002";
const RECORD_NOT_FOUND_ERROR_CODE = "P2025";

type SessionTable = {
  upsert(input: {
    where: { id: string };
    update: SessionRowInput;
    create: SessionRowInput;
  }): Promise<unknown>;
  findUnique(input: { where: { id: string } }): Promise<SessionRow | null>;
  delete(input: { where: { id: string } }): Promise<unknown>;
  deleteMany(input: { where: { id: { in: string[] } } }): Promise<unknown>;
  findMany(input: {
    where: { shop: string };
    orderBy: Array<{ expires: "desc" }>;
  }): Promise<SessionRow[]>;
  count(): Promise<number>;
};

type PrismaWithSession = {
  session?: unknown;
};

type SessionRow = {
  id: string;
  shop: string;
  state: string;
  isOnline: boolean;
  scope: string | null;
  expires: Date | null;
  accessToken: string;
  userId: bigint | number | string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  accountOwner: boolean | null;
  locale: string | null;
  collaborator: boolean | null;
  emailVerified: boolean | null;
  refreshToken: string | null;
  refreshTokenExpires: Date | null;
};

type SessionRowInput = Omit<
  SessionRow,
  "accountOwner" | "collaborator" | "emailVerified" | "userId"
> & {
  accountOwner: boolean;
  collaborator: boolean;
  emailVerified: boolean;
  userId: number | null;
};

export class PrismaSessionStorage implements SessionStorage {
  private readonly prisma: PrismaWithSession;
  private ready: Promise<boolean>;
  private readonly connectionRetries: number;
  private readonly connectionRetryIntervalMs: number;

  constructor(
    prisma: PrismaWithSession,
    {
      connectionRetries = 2,
      connectionRetryIntervalMs = 5000,
    }: {
      connectionRetries?: number;
      connectionRetryIntervalMs?: number;
    } = {},
  ) {
    this.prisma = prisma;
    this.connectionRetries = connectionRetries;
    this.connectionRetryIntervalMs = connectionRetryIntervalMs;

    if (!this.prisma.session) {
      throw new Error("PrismaClient does not have a session table");
    }

    this.ready = this.pollForTable()
      .then(() => true)
      .catch(() => false);
  }

  async storeSession(session: ShopifySession) {
    await this.ensureReady();

    const data = this.sessionToRow(session);

    try {
      await this.sessionTable.upsert({
        where: { id: session.id },
        update: data,
        create: data,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        await this.sessionTable.upsert({
          where: { id: session.id },
          update: data,
          create: data,
        });
      } else {
        throw error;
      }
    }

    return true;
  }

  async loadSession(id: string) {
    await this.ensureReady();

    const row = await this.sessionTable.findUnique({ where: { id } });

    return row ? this.rowToSession(row) : undefined;
  }

  async deleteSession(id: string) {
    await this.ensureReady();

    try {
      await this.sessionTable.delete({ where: { id } });
    } catch (error) {
      if (!isRecordNotFoundError(error)) {
        throw error;
      }
    }

    return true;
  }

  async deleteSessions(ids: string[]) {
    await this.ensureReady();
    await this.sessionTable.deleteMany({ where: { id: { in: ids } } });

    return true;
  }

  async findSessionsByShop(shop: string) {
    await this.ensureReady();

    const sessions = await this.sessionTable.findMany({
      where: { shop },
      orderBy: [{ expires: "desc" }],
    });

    return sessions.map((session) => this.rowToSession(session));
  }

  async isReady() {
    try {
      await this.pollForTable();
      this.ready = Promise.resolve(true);
    } catch {
      this.ready = Promise.resolve(false);
    }

    return this.ready;
  }

  private get sessionTable() {
    const table = this.prisma.session;

    if (!table) throw new Error("PrismaClient does not have a session table");

    return table as SessionTable;
  }

  private async ensureReady() {
    if (!(await this.ready)) {
      throw new Error("Prisma session storage is not ready");
    }
  }

  private async pollForTable() {
    for (let attempt = 0; attempt < this.connectionRetries; attempt += 1) {
      try {
        await this.sessionTable.count();
        return;
      } catch {
        await sleep(this.connectionRetryIntervalMs);
      }
    }

    throw new Error("The table `session` does not exist in the current database");
  }

  private sessionToRow(session: ShopifySession): SessionRowInput {
    const sessionParams = session.toObject();
    const user = sessionParams.onlineAccessInfo?.associated_user;

    return {
      id: session.id,
      shop: session.shop,
      state: session.state,
      isOnline: session.isOnline,
      scope: session.scope ?? null,
      expires: session.expires ?? null,
      accessToken: encryptSecretIfNeeded(session.accessToken ?? ""),
      userId: user?.id ?? null,
      firstName: user?.first_name ?? null,
      lastName: user?.last_name ?? null,
      email: user?.email ?? null,
      accountOwner: user?.account_owner ?? false,
      locale: user?.locale ?? null,
      collaborator: user?.collaborator ?? false,
      emailVerified: user?.email_verified ?? false,
      refreshToken: sessionParams.refreshToken
        ? encryptSecretIfNeeded(sessionParams.refreshToken)
        : null,
      refreshTokenExpires: sessionParams.refreshTokenExpires ?? null,
    };
  }

  private rowToSession(row: SessionRow) {
    const sessionParams: Array<[string, string | number | boolean]> = [
      ["id", row.id],
      ["shop", row.shop],
      ["state", row.state],
      ["isOnline", row.isOnline],
    ];

    pushOptional(sessionParams, "userId", row.userId?.toString());
    pushOptional(sessionParams, "firstName", row.firstName);
    pushOptional(sessionParams, "lastName", row.lastName);
    pushOptional(sessionParams, "email", row.email);
    pushOptional(sessionParams, "accountOwner", row.accountOwner);
    pushOptional(sessionParams, "locale", row.locale);
    pushOptional(sessionParams, "collaborator", row.collaborator);
    pushOptional(sessionParams, "emailVerified", row.emailVerified);
    pushOptional(sessionParams, "expires", row.expires?.getTime());
    pushOptional(sessionParams, "scope", row.scope);
    pushOptional(
      sessionParams,
      "accessToken",
      decryptSessionSecret(row.accessToken),
    );
    pushOptional(
      sessionParams,
      "refreshToken",
      row.refreshToken
        ? decryptSessionSecret(row.refreshToken)
        : null,
    );
    pushOptional(
      sessionParams,
      "refreshTokenExpires",
      row.refreshTokenExpires?.getTime(),
    );

    return ShopifySession.fromPropertyArray(sessionParams, true);
  }
}

function decryptSessionSecret(value: string) {
  try {
    return decryptSecret(value);
  } catch {
    throw new Error(
      "Sessione Shopify non cifrata o non valida: riapri l'app per autorizzare di nuovo SyncBay.",
    );
  }
}

function pushOptional(
  entries: Array<[string, string | number | boolean]>,
  key: string,
  value: string | number | boolean | null | undefined,
) {
  if (value !== null && value !== undefined) {
    entries.push([key, value]);
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUniqueConstraintError(error: unknown) {
  return isPrismaErrorCode(error, UNIQUE_KEY_CONSTRAINT_ERROR_CODE);
}

function isRecordNotFoundError(error: unknown) {
  return isPrismaErrorCode(error, RECORD_NOT_FOUND_ERROR_CODE);
}

function isPrismaErrorCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
