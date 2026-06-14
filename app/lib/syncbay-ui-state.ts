type Tone = "critical" | "warning" | "info" | "success";

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
  settingsBlockerCount?: number;
  settingsMissing?: boolean;
}

export interface NextAction {
  body: string;
  kind: NextActionKind;
  primaryActionHref: string;
  primaryActionLabel: string;
  title: string;
  tone: Tone;
}

export interface OverviewSyncWorkingInput {
  activeIncrementalJobCount?: number | null;
  catalogHealthStatus?: string | null;
  lastJobs?: Array<{
    runAfter?: Date | string | null;
    status?: string | null;
    type?: string | null;
  }>;
  now?: Date | string;
  pendingJobs?: number | null;
}

export interface EbayConnectionActionInput {
  missingRequirementCount?: number;
  oauthEnabled?: boolean;
  oauthReady?: boolean;
  status?: string | null;
}

export interface EbayConnectionAction {
  blockerText: string | null;
  href: string | null;
  label: string;
  variant?: "primary";
}

export type ConflictResolution =
  | "REALIGN_FROM_EBAY"
  | "KEEP_SHOPIFY"
  | "IGNORE_FIELD";

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
  "catalog_overdue",
  "import_incomplete",
  "settings_missing",
]);

export function shouldShowOverviewStatusHero(kind: NextActionKind) {
  return OVERVIEW_STATUS_HERO_KINDS.has(kind);
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
  const nextRunAfter = (input.lastJobs ?? []).reduce<number | null>(
    (earliest, job) => {
      if (job.status !== "RETRYING") return earliest;

      const runAfterTime = getOverviewTime(job.runAfter);

      if (runAfterTime === null || runAfterTime <= nowTime) return earliest;
      if (earliest === null || runAfterTime < earliest) return runAfterTime;

      return earliest;
    },
    null,
  );

  return nextRunAfter === null ? null : new Date(nextRunAfter).toISOString();
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

export function getNextAction(input: NextActionInput): NextAction {
  if (input.ebayStatus !== "CONNECTED") {
    const canStartOAuth = input.ebayOauthReady && input.ebayOauthEnabled;

    return {
      body: "Ricollega l'account eBay per riprendere import, aggiornamenti e controlli sulle disponibilità.",
      kind: "ebay_connection",
      primaryActionHref: canStartOAuth
        ? "/auth/ebay/start"
        : "/app/import-preview",
      primaryActionLabel: canStartOAuth
        ? "Ricollega eBay"
        : "Apri importazione",
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
      body: "L'ultimo aggiornamento catalogo è oltre la finestra prevista. Controlla lo stato delle attività.",
      kind: "catalog_overdue",
      primaryActionHref: "/app/activity",
      primaryActionLabel: "Vedi attività",
      title: "Aggiornamento catalogo in ritardo",
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

export function getEbayConnectionAction(
  input: EbayConnectionActionInput,
): EbayConnectionAction {
  const connected = input.status === "CONNECTED";
  const label = connected ? "Ricollega eBay" : "Collega eBay";

  if (input.oauthEnabled && input.oauthReady) {
    return {
      blockerText: null,
      href: "/auth/ebay/start",
      label,
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
