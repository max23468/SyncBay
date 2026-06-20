/**
 * Circuit breaker per le chiamate verso i provider (eBay Trading/Inventory e
 * Shopify Admin GraphQL). Protegge il target di sync entro 5 minuti senza
 * bruciare quota: quando un provider risponde con errori ripetuti di rate limit
 * o outage (429/5xx), il breaker "apre" e sospende il batch, rischedulando con
 * backoff dichiarato. Dopo il cooldown passa a `half_open` per un singolo
 * tentativo di sondaggio; se riesce torna `closed`, altrimenti riapre.
 *
 * Logica pura e deterministica: lo stato vive altrove (coda/job), qui si
 * calcola solo la transizione successiva. Il backoff è esponenziale con tetto,
 * così un outage prolungato non genera tentativi a raffica.
 */

export type CircuitBreakerState = "closed" | "half_open" | "open";

export const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;
export const DEFAULT_CIRCUIT_BASE_COOLDOWN_SECONDS = 60;
export const DEFAULT_CIRCUIT_MAX_COOLDOWN_SECONDS = 30 * 60;

export interface CircuitBreakerSnapshot {
  consecutiveFailures: number;
  openedCount: number;
  openUntil: Date | null;
  state: CircuitBreakerState;
}

export interface CircuitBreakerConfig {
  baseCooldownSeconds?: number;
  failureThreshold?: number;
  maxCooldownSeconds?: number;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

const RETRYABLE_MESSAGE_PATTERNS = [
  /rate limit/i,
  /usage limit/i,
  /too many requests/i,
  /throttl/i,
  /service unavailable/i,
  /timeout/i,
  /temporarily unavailable/i,
];

export function createClosedCircuit(): CircuitBreakerSnapshot {
  return {
    consecutiveFailures: 0,
    openedCount: 0,
    openUntil: null,
    state: "closed",
  };
}

/**
 * Vero quando l'errore osservato è transitorio e va conteggiato dal breaker.
 * Gli errori applicativi (4xx diversi da 429, payload non validi) non aprono il
 * circuito: indicano un problema di dati, non un provider in sofferenza.
 */
export function isRetryableProviderFailure(input: {
  message?: string | null;
  statusCode?: number | null;
}) {
  if (
    typeof input.statusCode === "number" &&
    RETRYABLE_STATUS_CODES.has(input.statusCode)
  ) {
    return true;
  }

  const message = input.message ?? "";

  return RETRYABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Registra un fallimento transitorio e calcola lo stato successivo del breaker.
 */
export function recordProviderFailure(
  snapshot: CircuitBreakerSnapshot,
  input: { now: Date } & CircuitBreakerConfig,
): CircuitBreakerSnapshot {
  const threshold = normalizePositiveInt(
    input.failureThreshold,
    DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
  );
  const consecutiveFailures = snapshot.consecutiveFailures + 1;

  if (consecutiveFailures < threshold && snapshot.state === "closed") {
    return {
      ...snapshot,
      consecutiveFailures,
      state: "closed",
    };
  }

  const openedCount = snapshot.openedCount + 1;
  const cooldownSeconds = getCircuitCooldownSeconds(openedCount, input);

  return {
    consecutiveFailures,
    openedCount,
    openUntil: new Date(input.now.getTime() + cooldownSeconds * 1000),
    state: "open",
  };
}

/**
 * Registra un successo: chiude il circuito e azzera il conteggio.
 */
export function recordProviderSuccess(): CircuitBreakerSnapshot {
  return createClosedCircuit();
}

/**
 * Decide se in questo istante è ammessa una chiamata al provider e con quale
 * stato logico. In `open` prima della scadenza la chiamata va sospesa; raggiunta
 * la scadenza si concede un singolo sondaggio `half_open`.
 */
export function evaluateCircuit(
  snapshot: CircuitBreakerSnapshot,
  now: Date,
): {
  allowRequest: boolean;
  retryAt: Date | null;
  state: CircuitBreakerState;
} {
  if (snapshot.state !== "open" || snapshot.openUntil === null) {
    return { allowRequest: true, retryAt: null, state: snapshot.state };
  }

  if (now.getTime() >= snapshot.openUntil.getTime()) {
    return { allowRequest: true, retryAt: null, state: "half_open" };
  }

  return {
    allowRequest: false,
    retryAt: snapshot.openUntil,
    state: "open",
  };
}

/**
 * Cooldown esponenziale con tetto, in funzione di quante volte il circuito si è
 * già aperto consecutivamente.
 */
export function getCircuitCooldownSeconds(
  openedCount: number,
  config: CircuitBreakerConfig = {},
) {
  const baseCooldownSeconds = normalizePositiveInt(
    config.baseCooldownSeconds,
    DEFAULT_CIRCUIT_BASE_COOLDOWN_SECONDS,
  );
  const maxCooldownSeconds = normalizePositiveInt(
    config.maxCooldownSeconds,
    DEFAULT_CIRCUIT_MAX_COOLDOWN_SECONDS,
  );
  const exponent = Math.max(0, openedCount - 1);
  const scaled = baseCooldownSeconds * 2 ** exponent;

  return Math.min(maxCooldownSeconds, Math.round(scaled));
}

function normalizePositiveInt(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.trunc(value);
}
