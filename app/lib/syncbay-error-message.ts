type ErrorWithCause = Error & {
  cause?: unknown;
  code?: unknown;
};

const MAX_ERROR_MESSAGE_LENGTH = 500;
const MAX_CAUSE_DEPTH = 3;
const SAFE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_.-]{1,63}$/i;

/**
 * Conserva il messaggio applicativo e i soli codici tecnici della catena
 * `cause`. I codici Node/Undici (`ENOTFOUND`, `ECONNRESET`,
 * `UND_ERR_CONNECT_TIMEOUT`) distinguono i guasti di rete senza persistere URL,
 * host, header, token o stack trace presenti nei dettagli del provider.
 */
export function formatSyncJobErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return null;

  const message = normalizeMessage(error.message);
  if (!message) return null;

  const codes = collectSafeErrorCodes(error);
  const newCodes = codes.filter((code) => !message.toUpperCase().includes(code.toUpperCase()));
  const suffix = newCodes.length > 0 ? ` (${newCodes.join(" -> ")})` : "";

  return `${message}${suffix}`.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function collectSafeErrorCodes(error: unknown, depth = 0, seen = new Set<unknown>()): string[] {
  if (!(error instanceof Error) || depth > MAX_CAUSE_DEPTH || seen.has(error)) return [];

  seen.add(error);
  const errorWithCause = error as ErrorWithCause;
  const code = normalizeErrorCode(errorWithCause.code);
  const ownCodes = code ? [code] : [];

  if (!errorWithCause.cause || errorWithCause.cause === error) return ownCodes;

  if (errorWithCause.cause instanceof Error) {
    return [...ownCodes, ...collectSafeErrorCodes(errorWithCause.cause, depth + 1, seen)];
  }

  const nestedCode = normalizeErrorCode((errorWithCause.cause as { code?: unknown } | null)?.code);

  return nestedCode ? [...ownCodes, nestedCode] : ownCodes;
}

function normalizeErrorCode(value: unknown) {
  if (typeof value !== "string") return null;

  const code = value.trim();

  return SAFE_ERROR_CODE_PATTERN.test(code) ? code : null;
}

function normalizeMessage(value: string) {
  return value.replaceAll(/\s+/g, " ").trim();
}
