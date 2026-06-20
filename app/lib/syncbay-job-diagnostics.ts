export interface SyncJobDiagnosticInput {
  attempts: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  maxAttempts: number;
  runAfter: string | Date;
  status: string;
  type: string;
}

export interface ManualRetryState {
  canRetry: boolean;
  label: string;
  reason: string;
}

export interface SyncJobDiagnostic {
  impact: string;
  nextAction: string;
  rateLimit?: {
    provider: string;
    retryAfter: string;
    summary: string;
  };
  retry: ManualRetryState;
  technicalReference: string;
}

const RETRYABLE_STATUSES = new Set(["FAILED", "RETRYING"]);
const EBAY_TRADING_RATE_LIMITED = "EBAY_TRADING_RATE_LIMITED";
const SYNCBAY_INCREMENTAL_ENQUEUE_FAILED =
  "SYNCBAY_INCREMENTAL_ENQUEUE_FAILED";
const EBAY_TRADING_USAGE_LIMIT_PATTERNS = [
  /superato il limite di utilizzo/i,
  /exceeded the usage limit/i,
  /usage limit/i,
  /call limit/i,
  /rate limit/i,
];

const itDateTimeFormatter = new Intl.DateTimeFormat("it-IT", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Rome",
});

export function getSyncJobDiagnostic(
  job: SyncJobDiagnosticInput,
  now = new Date(),
): SyncJobDiagnostic {
  const rateLimit = getRateLimitDetail(job, now);

  return {
    impact: getJobImpact(job.type),
    nextAction: getJobNextAction(job, now),
    ...(rateLimit ? { rateLimit } : {}),
    retry: getManualRetryState(job, now),
    technicalReference: job.errorCode || "Nessun codice tecnico",
  };
}

export function getManualRetryState(
  job: SyncJobDiagnosticInput,
  now = new Date(),
): ManualRetryState {
  if (!RETRYABLE_STATUSES.has(job.status)) {
    return {
      canRetry: false,
      label: job.status === "PENDING" ? "In coda" : "Non disponibile",
      reason: "Il job non è in uno stato che richiede retry manuale.",
    };
  }

  if (isEbayCooldownActive(job, now)) {
    return {
      canRetry: false,
      label: "Attendi eBay",
      reason:
        "eBay ha imposto un cooldown: il retry manuale anticipato consumerebbe tentativi senza risolvere il blocco.",
    };
  }

  return {
    canRetry: true,
    label: "Riprova",
    reason: "Il job può essere rimesso in coda dalla dashboard.",
  };
}

function isEbayCooldownActive(
  job: SyncJobDiagnosticInput,
  now = new Date(),
) {
  if (getTime(job.runAfter) <= now.getTime()) {
    return false;
  }

  if (job.errorCode === EBAY_TRADING_RATE_LIMITED) {
    return true;
  }

  return (
    job.type === "SYNC_INCREMENTAL" &&
    job.errorCode === SYNCBAY_INCREMENTAL_ENQUEUE_FAILED &&
    Boolean(job.errorMessage) &&
    isEbayTradingUsageLimitMessage(job.errorMessage ?? "")
  );
}

function getJobImpact(type: string) {
  if (type === "UPDATE_EBAY_STOCK") {
    return "Disponibilità eBay non aggiornata: controlla il prodotto prima di considerare protetto lo stock.";
  }
  if (type === "IMPORT_CATALOG") {
    return "Importazione catalogo incompleta: alcuni prodotti potrebbero non essere ancora pronti su Shopify.";
  }
  if (type === "SYNC_INCREMENTAL") {
    return "Catalogo Shopify non ancora allineato all'ultimo stato eBay noto.";
  }
  if (type === "DETECT_SHOPIFY_CHANGES") {
    return "Controllo modifiche Shopify non completato: i conflitti potrebbero non essere ancora aggiornati.";
  }
  if (type === "ARCHIVE_INACTIVE_LISTING") {
    return "Messa in esaurito non completata: un prodotto chiuso su eBay potrebbe restare disponibile su Shopify.";
  }

  return "Attività SyncBay non completata: controlla il dettaglio tecnico prima di riprovare.";
}

function getJobNextAction(job: SyncJobDiagnosticInput, now: Date) {
  if (isEbayCooldownActive(job, now)) {
    return `Attendi: eBay ha imposto una pausa fino al ${formatDateTime(job.runAfter)}. Non forzare il retry manuale; lascia lavorare il runner quando la finestra si riapre.`;
  }
  if (job.type === "DETECT_SHOPIFY_CHANGES") {
    return "Riprova il controllo e poi rivedi la pagina Conflitti.";
  }
  if (job.status === "FAILED" || job.status === "RETRYING") {
    return "Riprova dalla dashboard se il problema non è un cooldown provider.";
  }

  return "Lascia completare il runner automatico.";
}

function getTime(value: string | Date) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function formatDateTime(value: string | Date) {
  return itDateTimeFormatter.format(
    value instanceof Date ? value : new Date(value),
  );
}

function isEbayTradingUsageLimitMessage(message: string) {
  return EBAY_TRADING_USAGE_LIMIT_PATTERNS.some((pattern) =>
    pattern.test(message),
  );
}

function getRateLimitDetail(job: SyncJobDiagnosticInput, now: Date) {
  if (!isEbayCooldownActive(job, now)) return null;

  const retryAfter = new Date(job.runAfter);

  return {
    provider: "eBay Trading API",
    retryAfter: retryAfter.toISOString(),
    summary: `eBay Trading API ha imposto un cooldown fino al ${formatDateTime(retryAfter)}.`,
  };
}
