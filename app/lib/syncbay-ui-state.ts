import type { ConflictResolution } from "./syncbay-conflict-actions";

type Tone = "critical" | "warning" | "info" | "success";

export type SyncBayNavigationTarget = "_blank" | "_parent" | "_self" | "_top";

export interface ActivityBadgeStateInput {
  failedJobs: number;
  openConflictCount?: number | null;
  working: boolean;
}

export interface ActivityBadgeState {
  label: string;
  tone: "info" | "success" | "warning";
}

export type NextActionKind =
  | "ebay_connection"
  | "quantity_check"
  | "open_conflicts"
  | "catalog_overdue"
  | "import_incomplete"
  | "settings_missing"
  | "all_clear";

export interface NextActionInput {
  catalogHealthStatus?: string | null;
  ebayOauthEnabled?: boolean;
  ebayOauthReady?: boolean;
  ebayStatus?: string | null;
  importBlockerCount?: number;
  importIncomplete?: boolean;
  openConflictCount?: number;
  quantityIssueCount?: number;
  shopDomain?: string | null;
  settingsBlockerCount?: number;
  settingsMissing?: boolean;
}

export interface NextAction {
  body: string;
  kind: NextActionKind;
  primaryActionHref: string;
  primaryActionLabel: string;
  primaryActionTarget?: SyncBayNavigationTarget;
  title: string;
  tone: Tone;
}

export interface OverviewSyncWorkingInput {
  activeIncrementalJobCount?: number | null;
  catalogHealthStatus?: string | null;
  catalogOverdueAt?: Date | string | null;
  lastJobs?: Array<{
    runAfter?: Date | string | null;
    status?: string | null;
    type?: string | null;
  }>;
  nextRetryRunAfter?: Date | string | null;
  now?: Date | string;
  pendingJobs?: number | null;
}

export interface EbayConnectionActionInput {
  missingRequirementCount?: number;
  oauthEnabled?: boolean;
  oauthReady?: boolean;
  shopDomain?: string | null;
  status?: string | null;
}

export interface EbayConnectionAction {
  blockerText: string | null;
  href: string | null;
  label: string;
  target?: SyncBayNavigationTarget;
  variant?: "primary";
}

export type { ConflictResolution };

export type CatalogStatusKind =
  | "active_fresh"
  | "open_conflict"
  | "mapping_error"
  | "stale_sync"
  | "archived";

export type CatalogAvailabilityKind =
  | "aligned"
  | "blocked"
  | "needs_check"
  | "unknown";

export interface CatalogRowStatusInput {
  lastErrorCode?: string | null;
  lastSyncedAt?: string | null;
  mappingStatus?: string | null;
  openConflictCount?: number;
  stale?: boolean;
}

export type TimelineCategoryKind =
  | "IMPORT_CATALOG"
  | "SYNC_INCREMENTAL"
  | "UPDATE_EBAY_STOCK"
  | "CONFLICT"
  | "FAILED_JOB";

const OVERVIEW_STATUS_HERO_KINDS = new Set<NextActionKind>([
  "ebay_connection",
  "import_incomplete",
  "settings_missing",
]);

const EBAY_OAUTH_START_PATH = "/auth/ebay/start";
const EBAY_OAUTH_LINK_TARGET = "_top" satisfies SyncBayNavigationTarget;

export function getEbayOAuthStartHref(shopDomain?: string | null) {
  const normalizedShopDomain = shopDomain?.trim();

  if (!normalizedShopDomain) return EBAY_OAUTH_START_PATH;

  return `${EBAY_OAUTH_START_PATH}?${new URLSearchParams({
    shop: normalizedShopDomain,
  }).toString()}`;
}

export function shouldShowOverviewStatusHero(kind: NextActionKind) {
  return OVERVIEW_STATUS_HERO_KINDS.has(kind);
}

export function getActivityBadgeState(
  input: ActivityBadgeStateInput,
): ActivityBadgeState {
  const openConflictCount = input.openConflictCount ?? 0;

  if (input.working) {
    return { label: "Aggiornamenti in corso", tone: "info" };
  }

  if (input.failedJobs > 0) {
    return {
      label:
        input.failedJobs === 1
          ? "1 errore da rivedere"
          : `${formatInteger(input.failedJobs)} errori da rivedere`,
      tone: "warning",
    };
  }

  if (openConflictCount > 0) {
    return {
      label:
        openConflictCount === 1
          ? "1 conflitto da gestire"
          : `${formatInteger(openConflictCount)} conflitti da gestire`,
      tone: "warning",
    };
  }

  return { label: "Tutto tranquillo", tone: "success" };
}

export function isOverviewSyncWorking(input: OverviewSyncWorkingInput) {
  const nowTime = getOverviewTime(input.now ?? new Date()) ?? Date.now();

  return (
    input.catalogHealthStatus === "running" ||
    (input.activeIncrementalJobCount ?? 0) > 0 ||
    (input.pendingJobs ?? 0) > 0 ||
    (input.lastJobs ?? []).some((job) => isOverviewJobWorking(job, nowTime))
  );
}

export function getOverviewSyncWakeAt(input: OverviewSyncWorkingInput) {
  const nowTime = getOverviewTime(input.now ?? new Date()) ?? Date.now();
  const queuedRetryRunAfter = getOverviewTime(input.nextRetryRunAfter);
  const futureWakeTimes: number[] = [];

  if (input.nextRetryRunAfter !== undefined) {
    if (queuedRetryRunAfter !== null && queuedRetryRunAfter > nowTime) {
      futureWakeTimes.push(queuedRetryRunAfter);
    }
  } else {
    for (const job of input.lastJobs ?? []) {
      if (job.status !== "RETRYING") continue;

      const runAfterTime = getOverviewTime(job.runAfter);

      if (runAfterTime !== null && runAfterTime > nowTime) {
        futureWakeTimes.push(runAfterTime);
      }
    }
  }

  const catalogOverdueAt = getOverviewTime(input.catalogOverdueAt);
  if (
    input.catalogHealthStatus !== "overdue" &&
    catalogOverdueAt !== null &&
    catalogOverdueAt > nowTime
  ) {
    futureWakeTimes.push(catalogOverdueAt);
  }

  if (futureWakeTimes.length === 0) return null;

  return new Date(Math.min(...futureWakeTimes)).toISOString();
}

function isOverviewJobWorking(
  job: NonNullable<OverviewSyncWorkingInput["lastJobs"]>[number],
  nowTime: number,
) {
  if (job.status === "RUNNING") return true;
  if (job.status !== "RETRYING") return false;

  const runAfterTime = getOverviewTime(job.runAfter);

  return runAfterTime === null || runAfterTime <= nowTime;
}

function getOverviewTime(value: Date | string | null | undefined) {
  if (!value) return null;

  const time = value instanceof Date ? value.getTime() : Date.parse(value);

  return Number.isNaN(time) ? null : time;
}

const INTEGER_FORMATTER = new Intl.NumberFormat("it-IT", {
  maximumFractionDigits: 0,
});

function formatInteger(value: number) {
  return INTEGER_FORMATTER.format(value);
}

export function getNextAction(input: NextActionInput): NextAction {
  if (input.ebayStatus !== "CONNECTED") {
    const canStartOAuth = input.ebayOauthReady && input.ebayOauthEnabled;

    return {
      body: "Ricollega l'account eBay per riprendere import, aggiornamenti e controlli sulle disponibilità.",
      kind: "ebay_connection",
      primaryActionHref: canStartOAuth
        ? getEbayOAuthStartHref(input.shopDomain)
        : "/app/import-preview",
      primaryActionLabel: canStartOAuth
        ? "Ricollega eBay"
        : "Apri importazione",
      ...(canStartOAuth ? { primaryActionTarget: EBAY_OAUTH_LINK_TARGET } : {}),
      title: "Collegamento eBay mancante o scaduto",
      tone: "critical",
    };
  }

  if ((input.quantityIssueCount ?? 0) > 0) {
    return {
      body: "Alcune quantità richiedono controllo prima di considerare il catalogo allineato.",
      kind: "quantity_check",
      primaryActionHref: "/app/activity",
      primaryActionLabel: "Controlla attività",
      title: "Quantità da verificare",
      tone: "warning",
    };
  }

  if ((input.openConflictCount ?? 0) > 0) {
    return {
      body: "Ci sono modifiche Shopify che SyncBay non sovrascrive senza una tua decisione.",
      kind: "open_conflicts",
      primaryActionHref: "/app/conflicts",
      primaryActionLabel: "Apri conflitti",
      title: "Conflitti aperti",
      tone: "warning",
    };
  }

  if (input.catalogHealthStatus === "overdue") {
    return {
      body: "L'ultimo aggiornamento catalogo è ancora oltre la finestra prevista dopo il margine normale del controllo automatico.",
      kind: "catalog_overdue",
      primaryActionHref: "/app/activity",
      primaryActionLabel: "Vedi attività",
      title: "Aggiornamento catalogo da controllare",
      tone: "warning",
    };
  }

  if (input.importIncomplete || (input.importBlockerCount ?? 0) > 0) {
    return {
      body: "Mancano passaggi o blocchi da risolvere prima di completare l'importazione iniziale.",
      kind: "import_incomplete",
      primaryActionHref: "/app/import-preview",
      primaryActionLabel: "Apri importazione",
      title: "Importazione incompleta",
      tone: "info",
    };
  }

  if (input.settingsMissing || (input.settingsBlockerCount ?? 0) > 0) {
    return {
      body: "Alcune impostazioni operative vanno completate prima di lasciare SyncBay lavorare in autonomia.",
      kind: "settings_missing",
      primaryActionHref: "/app/settings",
      primaryActionLabel: "Apri impostazioni",
      title: "Impostazioni mancanti",
      tone: "info",
    };
  }

  return {
    body: "SyncBay non richiede interventi in questo momento.",
    kind: "all_clear",
    primaryActionHref: "/app/activity",
    primaryActionLabel: "Vedi attività",
    title: "Tutto sotto controllo",
    tone: "success",
  };
}

export interface ProviderHealthNoticeInput {
  failedCount?: number;
  lagBreached?: boolean;
  lagSeconds?: number;
  quarantinedCount?: number;
}

export interface ProviderHealthNotice {
  body: string;
  eyebrow: string;
  kind: "failed_jobs" | "quarantine" | "lag";
  primaryActionHref: string;
  primaryActionLabel: string;
  title: string;
  tone: Extract<Tone, "critical" | "warning">;
}

/**
 * Avviso di stato del sistema quando il sync è degradato in modo che oggi non
 * emerge in Panoramica: attività con tentativi esauriti che richiedono
 * intervento (quarantena) o allineamento oltre il target. La quarantena è più
 * grave e ha la precedenza sul ritardo. Negli altri casi (conflitti, errori
 * isolati) restano i segnali esistenti e qui torna `null`. Presenta solo dati
 * già aggregati nel digest, senza nuove letture provider.
 */
export function getProviderHealthNotice(
  input: ProviderHealthNoticeInput,
): ProviderHealthNotice | null {
  const quarantinedCount = Math.max(0, Math.trunc(input.quarantinedCount ?? 0));
  const failedCount = Math.max(0, Math.trunc(input.failedCount ?? 0));

  if (quarantinedCount > 0) {
    return {
      body:
        "SyncBay ha messo in pausa queste attività dopo errori ripetuti. " +
        "Non ripartono automaticamente: apri Attività, controlla la causa e " +
        "usa Riprova quando disponibile.",
      eyebrow: PROVIDER_HEALTH_EYEBROW,
      kind: "quarantine",
      primaryActionHref: "/app/activity",
      primaryActionLabel: PROVIDER_HEALTH_ACTION_LABEL,
      title:
        quarantinedCount === 1
          ? "Un'attività richiede intervento"
          : `${formatInteger(quarantinedCount)} attività richiedono intervento`,
      tone: "critical",
    };
  }

  if (input.lagBreached) {
    const lagLabel = formatLagLabel(input.lagSeconds ?? 0);

    return {
      body:
        `L'allineamento con eBay non si è aggiornato dopo il normale margine del controllo automatico${
          lagLabel ? ` (${lagLabel})` : ""
        }. Controlla le attività se il ritardo continua o ci sono job bloccati.`,
      eyebrow: PROVIDER_HEALTH_EYEBROW,
      kind: "lag",
      primaryActionHref: "/app/activity",
      primaryActionLabel: PROVIDER_HEALTH_ACTION_LABEL,
      title: "Allineamento con eBay da controllare",
      tone: "warning",
    };
  }

  if (failedCount > 0) {
    return {
      body:
        "Alcune ultime attività non sono riuscite. Se sono già state recuperate " +
        "non serve intervenire; altrimenti apri Attività e usa Riprova quando " +
        "disponibile.",
      eyebrow: PROVIDER_HEALTH_EYEBROW,
      kind: "failed_jobs",
      primaryActionHref: "/app/activity",
      primaryActionLabel: PROVIDER_HEALTH_ACTION_LABEL,
      title:
        failedCount === 1
          ? "Un'attività non riuscita"
          : `${formatInteger(failedCount)} attività non riuscite`,
      tone: "warning",
    };
  }

  return null;
}

const PROVIDER_HEALTH_EYEBROW = "Stato del sistema";
const PROVIDER_HEALTH_ACTION_LABEL = "Vedi le attività";

function formatLagLabel(lagSeconds: number) {
  const seconds = Math.max(0, Math.trunc(lagSeconds));

  if (seconds <= 0) return "";
  if (seconds < 3600) {
    const minutes = Math.max(1, Math.round(seconds / 60));

    return minutes === 1 ? "1 minuto di ritardo" : `${minutes} minuti di ritardo`;
  }

  const hours = Math.round(seconds / 3600);

  return hours === 1 ? "1 ora di ritardo" : `${hours} ore di ritardo`;
}

export function getEbayConnectionAction(
  input: EbayConnectionActionInput,
): EbayConnectionAction {
  const connected = input.status === "CONNECTED";
  const label = connected ? "Ricollega eBay" : "Collega eBay";

  if (input.oauthEnabled && input.oauthReady) {
    return {
      blockerText: null,
      href: getEbayOAuthStartHref(input.shopDomain),
      label,
      target: EBAY_OAUTH_LINK_TARGET,
      variant: connected ? undefined : "primary",
    };
  }

  const missingRequirementCount = input.missingRequirementCount ?? 0;

  return {
    blockerText:
      missingRequirementCount > 0
        ? `Collegamento eBay non disponibile: mancano ${missingRequirementCount} requisiti di configurazione.`
        : "Collegamento eBay predisposto, ma non ancora attivo in questo ambiente.",
    href: null,
    label,
    variant: undefined,
  };
}

export function getConflictActionLabel(resolution: ConflictResolution) {
  if (resolution === "REALIGN_FROM_EBAY") return "Usa valore eBay";
  if (resolution === "KEEP_SHOPIFY") return "Mantieni Shopify";

  return "Ignora campo";
}

export function getCatalogStatusLabel(status: CatalogStatusKind) {
  if (status === "active_fresh") return "Aggiornato";
  if (status === "open_conflict") return "Conflitto";
  if (status === "mapping_error") return "Errore";
  if (status === "stale_sync") return "Da controllare";

  return "Esaurito";
}

export function getCatalogRowStatus(
  input: CatalogRowStatusInput,
): CatalogStatusKind {
  // La corsia "archived" del catalogo ora rappresenta i prodotti esauriti
  // (listing eBay inattivo) oltre agli eventuali archiviati storici. Vedi ADR 0011.
  if (
    input.mappingStatus === "OUT_OF_STOCK" ||
    input.mappingStatus === "ARCHIVED"
  ) {
    return "archived";
  }
  if (input.mappingStatus === "ERROR" || input.lastErrorCode) {
    return "mapping_error";
  }
  if ((input.openConflictCount ?? 0) > 0) return "open_conflict";
  if (input.stale) return "stale_sync";

  return input.lastSyncedAt ? "active_fresh" : "stale_sync";
}

// La sync SyncBay è event-driven: ogni ciclo legge il delta degli eventi
// venditore eBay e riscrive `lastSyncedAt` solo per i prodotti effettivamente
// cambiati, più un reconcile completo periodico. Calcolare la staleness sul
// `lastSyncedAt` per-prodotto farebbe quindi risultare "Da controllare" l'intero
// catalogo pochi minuti dopo ogni reconcile, anche con sync sana. Usiamo invece
// il watermark a livello shop (`catalogVerifiedAt` = ultimo ciclo incrementale
// riuscito): se eBay è stato verificato di recente, un prodotto invariato è
// "corrente as of now". Resta "Da controllare" solo se in pausa, mai
// sincronizzato, o se la verifica del catalogo stessa è in ritardo.
export function isCatalogMappingStale(input: {
  catalogVerifiedAt: Date | null;
  lastSyncedAt: Date | null;
  mappingStatus?: string | null;
  now: Date;
  syncTargetSeconds: number;
}): boolean {
  if (input.mappingStatus === "PAUSED") return true;
  if (!input.lastSyncedAt) return true;

  const thresholdMs = Math.max(input.syncTargetSeconds, 60) * 1000 * 2;
  // Un prodotto è fresco se è stato sincronizzato di recente di per sé oppure se
  // l'intero catalogo è stato verificato contro eBay di recente: prendiamo il
  // segnale più recente tra i due per evitare falsi "Da controllare".
  const referenceMs = Math.max(
    input.lastSyncedAt.getTime(),
    input.catalogVerifiedAt?.getTime() ?? 0,
  );

  return input.now.getTime() - referenceMs > thresholdMs;
}

export function getCatalogAvailabilityLabel(
  availability: CatalogAvailabilityKind,
) {
  if (availability === "aligned") return "Allineata";
  if (availability === "needs_check") return "Da verificare";
  if (availability === "blocked") return "Bloccata";

  return "Non letta";
}

export function getConflictFieldLabel(field: string) {
  if (field === "quantity") return "Quantità";
  if (field === "price") return "Prezzo";
  if (field === "title") return "Titolo";
  if (field === "description") return "Descrizione";
  if (field === "images") return "Immagini";
  if (field === "status") return "Stato prodotto";
  if (field === "sku") return "SKU";

  return field;
}

export function getConflictImpactText(field: string) {
  if (field === "quantity") {
    return "La disponibilità può non essere allineata tra eBay e Shopify.";
  }
  if (field === "price") {
    return "Il prezzo mostrato su Shopify può differire dal valore eBay.";
  }
  if (field === "title") {
    return "Il titolo su Shopify resterà diverso da quello di eBay finché non scegli quale tenere.";
  }
  if (field === "description") {
    return "Su Shopify la descrizione è stata modificata a mano e SyncBay non la tocca senza il tuo via libera.";
  }
  if (field === "images") {
    return "Le immagini su Shopify potrebbero non essere le ultime arrivate da eBay.";
  }
  if (field === "status") {
    return "Lo stato del prodotto su Shopify può cambiarne la pubblicazione.";
  }

  return "SyncBay ha trovato una differenza da sistemare prima del prossimo aggiornamento.";
}

export function getProductPublicationModeSummaryLabel(
  mode: string,
  selectedCount: number,
) {
  if (mode === "NONE") return "Non pubblicare automaticamente";
  if (mode === "SELECTED") {
    if (selectedCount === 0) return "Nessun canale selezionato";
    if (selectedCount === 1) return "1 canale selezionato";

    return `${selectedCount} canali selezionati`;
  }

  return "Tutti i canali disponibili";
}

export function getEbayConnectionStatusLabel(
  status: string | null | undefined,
) {
  if (status === "CONNECTED") return "Collegato";
  if (status === "EXPIRED") return "Da ricollegare";
  if (status === "REVOKED") return "Revocato";
  if (status === "RECONNECT_REQUIRED") return "Da ricollegare";

  return "Non collegato";
}

export function getTimelineCategoryLabel(category: TimelineCategoryKind) {
  if (category === "IMPORT_CATALOG") return "Importazioni";
  if (category === "SYNC_INCREMENTAL") return "Aggiornamenti";
  if (category === "UPDATE_EBAY_STOCK") return "Disponibilità";
  if (category === "CONFLICT") return "Conflitti";

  return "Errori";
}

// Etichette canoniche dei job sync, condivise da Panoramica e Attività (prima
// duplicate e divergenti): unica fonte di verità per questo microcopy.
export function getSyncJobTitle(type: string) {
  if (type === "IMPORT_CATALOG") return "Importazione catalogo";
  if (type === "SYNC_INCREMENTAL") return "Aggiornamento catalogo";
  if (type === "UPDATE_EBAY_STOCK") return "Disponibilità aggiornata su eBay";
  if (type === "DETECT_SHOPIFY_CHANGES") return "Modifica rilevata su Shopify";
  if (type === "ARCHIVE_INACTIVE_LISTING") {
    return "Prodotto segnato come esaurito";
  }

  return "Attività SyncBay";
}

export function formatSyncJobStatus(status: string) {
  if (status === "PENDING") return "In coda";
  if (status === "RUNNING") return "In corso";
  if (status === "SUCCEEDED") return "Completata";
  if (status === "FAILED") return "Errore";
  if (status === "RETRYING") return "Riprova automatica in corso";
  if (status === "CANCELLED") return "Annullata";

  return status;
}

export function getSyncJobTone(status: string): Tone {
  if (status === "SUCCEEDED") return "success";
  if (status === "FAILED") return "critical";
  if (status === "RETRYING") return "warning";

  return "info";
}
