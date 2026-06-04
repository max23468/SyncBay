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

  return "Archiviato";
}

export function getCatalogRowStatus(
  input: CatalogRowStatusInput,
): CatalogStatusKind {
  if (input.mappingStatus === "ARCHIVED") return "archived";
  if (input.mappingStatus === "ERROR" || input.lastErrorCode) {
    return "mapping_error";
  }
  if ((input.openConflictCount ?? 0) > 0) return "open_conflict";
  if (input.stale) return "stale_sync";

  return input.lastSyncedAt ? "active_fresh" : "stale_sync";
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
    return "Il titolo Shopify resterà diverso dal catalogo eBay finché non scegli una direzione.";
  }
  if (field === "description") {
    return "La descrizione Shopify contiene modifiche che SyncBay non sovrascrive senza conferma.";
  }
  if (field === "images") {
    return "Le immagini Shopify possono non riflettere l'ultima versione letta da eBay.";
  }
  if (field === "status") {
    return "Lo stato prodotto Shopify può bloccare o modificare la pubblicazione prevista.";
  }

  return "SyncBay ha trovato una differenza che richiede una decisione prima del prossimo allineamento.";
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
