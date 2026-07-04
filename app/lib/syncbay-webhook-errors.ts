type ErrorLike = {
  code?: unknown;
  message?: unknown;
  name?: unknown;
};

function asErrorLike(error: unknown): ErrorLike {
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: unknown };

    return {
      code: errorWithCode.code,
      message: error.message,
      name: error.name,
    };
  }

  if (error && typeof error === "object") {
    return error as ErrorLike;
  }

  return {};
}

export function isTransientWebhookPersistenceError(error: unknown): boolean {
  const errorLike = asErrorLike(error);
  const code = typeof errorLike.code === "string" ? errorLike.code : "";
  const message =
    typeof errorLike.message === "string" ? errorLike.message : "";
  const normalizedMessage = message.toLowerCase();

  if (code === "P2028" && normalizedMessage.includes("transaction")) {
    return true;
  }

  return (
    normalizedMessage.includes("timeout exceeded when trying to connect") ||
    normalizedMessage.includes("prisma session storage is not ready")
  );
}
