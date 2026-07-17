type ErrorLike = {
  cause?: unknown;
  code?: unknown;
  message?: unknown;
  name?: unknown;
  originalMessage?: unknown;
};

function asErrorLike(error: unknown): ErrorLike {
  if (error instanceof Error) {
    const errorWithExtras = error as Error & {
      cause?: unknown;
      code?: unknown;
    };

    return {
      cause: errorWithExtras.cause,
      code: errorWithExtras.code,
      message: error.message,
      name: error.name,
    };
  }

  if (error && typeof error === "object") {
    return error as ErrorLike;
  }

  return {};
}

// Prisma/pg driver errors often nest the actionable text inside `cause`
// (e.g. DriverAdapterError -> cause.message / cause.originalMessage), so we
// flatten the chain before matching known transient signatures.
function collectErrorText(error: unknown, depth = 0): string {
  if (!error || depth > 3) {
    return "";
  }

  const errorLike = asErrorLike(error);
  const parts: string[] = [];

  if (typeof errorLike.message === "string") {
    parts.push(errorLike.message);
  }

  if (typeof errorLike.originalMessage === "string") {
    parts.push(errorLike.originalMessage);
  }

  if (errorLike.cause && errorLike.cause !== error) {
    parts.push(collectErrorText(errorLike.cause, depth + 1));
  }

  return parts.join(" ");
}

export function isTransientWebhookPersistenceError(error: unknown): boolean {
  const errorLike = asErrorLike(error);
  const code = typeof errorLike.code === "string" ? errorLike.code : "";
  const normalizedMessage = collectErrorText(error).toLowerCase();

  if (code === "P2028" && normalizedMessage.includes("transaction")) {
    return true;
  }

  return (
    normalizedMessage.includes("timeout exceeded when trying to connect") ||
    normalizedMessage.includes("prisma session storage is not ready") ||
    // Connection pool checkout timeout in transaction mode (ECHECKOUTTIMEOUT).
    normalizedMessage.includes(
      "unable to check out connection from the pool",
    ) ||
    // Supavisor/pg driver handler dropped the connection (EDBHANDLEREXITED).
    normalizedMessage.includes("dbhandler exited") ||
    // Lock contention under webhook echo bursts resolves on the next sync.
    normalizedMessage.includes("deadlock detected")
  );
}
