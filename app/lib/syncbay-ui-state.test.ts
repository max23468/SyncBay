import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as uiState from "./syncbay-ui-state.ts";

const {
  formatSyncJobStatus,
  getCatalogAvailabilityLabel,
  getCatalogRowStatus,
  getCatalogStatusLabel,
  getActivityBadgeState,
  getConflictActionLabel,
  getConflictFieldLabel,
  getConflictImpactText,
  getEbayConnectionAction,
  getEbayOAuthStartHref,
  getEbayConnectionStatusLabel,
  getNextAction,
  getOverviewSyncWakeAt,
  getProductPublicationModeSummaryLabel,
  getProviderHealthNotice,
  getSyncJobTitle,
  getSyncJobTone,
  getTimelineCategoryLabel,
  isOverviewSyncWorking,
  isCatalogMappingStale,
  shouldShowOverviewStatusHero,
} = uiState;

test("builds eBay OAuth start href with the current shop context", () => {
  assert.equal(
    getEbayOAuthStartHref("numisleo.myshopify.com"),
    "/auth/ebay/start?shop=numisleo.myshopify.com",
  );
  assert.equal(getEbayOAuthStartHref(null), "/auth/ebay/start");
});

test("prioritizes missing eBay connection before other dashboard issues", () => {
  const action = getNextAction({
    catalogHealthStatus: "overdue",
    ebayOauthEnabled: true,
    ebayOauthReady: true,
    ebayStatus: "EXPIRED",
    importIncomplete: true,
    openConflictCount: 4,
    quantityIssueCount: 7,
    shopDomain: "numisleo.myshopify.com",
    settingsMissing: true,
  });

  assert.deepEqual(action, {
    body: "Ricollega l'account eBay per riprendere import, aggiornamenti e controlli sulle disponibilità.",
    kind: "ebay_connection",
    primaryActionHref: "/auth/ebay/start?shop=numisleo.myshopify.com",
    primaryActionLabel: "Ricollega eBay",
    primaryActionTarget: "_top",
    title: "Collegamento eBay mancante o scaduto",
    tone: "critical",
  });
});

test("prioritizes quantity checks after eBay is connected", () => {
  const action = getNextAction({
    catalogHealthStatus: "overdue",
    ebayStatus: "CONNECTED",
    openConflictCount: 4,
    quantityIssueCount: 2,
  });

  assert.equal(action.kind, "quantity_check");
  assert.equal(action.title, "Quantità da verificare");
  assert.equal(action.primaryActionHref, "/app/activity");
});

test("builds eBay connection actions only when OAuth is startable", () => {
  assert.deepEqual(
    getEbayConnectionAction({
      oauthEnabled: true,
      oauthReady: true,
      shopDomain: "numisleo.myshopify.com",
      status: "NOT_CONNECTED",
    }),
    {
      blockerText: null,
      href: "/auth/ebay/start?shop=numisleo.myshopify.com",
      label: "Collega eBay",
      target: "_top",
      variant: "primary",
    },
  );

  assert.deepEqual(
    getEbayConnectionAction({
      missingRequirementCount: 2,
      oauthEnabled: false,
      oauthReady: false,
      status: "NOT_CONNECTED",
    }),
    {
      blockerText:
        "Collegamento eBay non disponibile: mancano 2 requisiti di configurazione.",
      href: null,
      label: "Collega eBay",
      variant: undefined,
    },
  );
});

test("prioritizes open conflicts after quantity checks", () => {
  const action = getNextAction({
    catalogHealthStatus: "overdue",
    ebayStatus: "CONNECTED",
    openConflictCount: 3,
  });

  assert.equal(action.kind, "open_conflicts");
  assert.equal(action.title, "Conflitti aperti");
  assert.equal(action.primaryActionHref, "/app/conflicts");
});

test("reports overdue catalog sync before import and settings issues", () => {
  const action = getNextAction({
    catalogHealthStatus: "overdue",
    ebayStatus: "CONNECTED",
    importIncomplete: true,
    settingsMissing: true,
  });

  assert.equal(action.kind, "catalog_overdue");
  assert.equal(action.title, "Aggiornamento catalogo da controllare");
  assert.equal(action.primaryActionHref, "/app/activity");
});

test("reports import incomplete before settings issues", () => {
  const action = getNextAction({
    ebayStatus: "CONNECTED",
    importIncomplete: true,
    settingsMissing: true,
  });

  assert.equal(action.kind, "import_incomplete");
  assert.equal(action.title, "Importazione incompleta");
  assert.equal(action.primaryActionHref, "/app/import-preview");
});

test("reports missing settings before all clear", () => {
  const action = getNextAction({
    ebayStatus: "CONNECTED",
    settingsMissing: true,
  });

  assert.equal(action.kind, "settings_missing");
  assert.equal(action.title, "Impostazioni mancanti");
  assert.equal(action.primaryActionHref, "/app/settings");
});

test("reports all clear when no action is needed", () => {
  const action = getNextAction({
    catalogHealthStatus: "fresh",
    ebayStatus: "CONNECTED",
  });

  assert.deepEqual(action, {
    body: "SyncBay non richiede interventi in questo momento.",
    kind: "all_clear",
    primaryActionHref: "/app/activity",
    primaryActionLabel: "Vedi attività",
    title: "Tutto sotto controllo",
    tone: "success",
  });
});

test("shows overview status hero for setup and overdue blockers", () => {
  assert.equal(shouldShowOverviewStatusHero("ebay_connection"), true);
  assert.equal(shouldShowOverviewStatusHero("catalog_overdue"), false);
  assert.equal(shouldShowOverviewStatusHero("import_incomplete"), true);
  assert.equal(shouldShowOverviewStatusHero("settings_missing"), true);
  assert.equal(shouldShowOverviewStatusHero("quantity_check"), false);
  assert.equal(shouldShowOverviewStatusHero("open_conflicts"), false);
  assert.equal(shouldShowOverviewStatusHero("all_clear"), false);
});

test("keeps Activity badge out of all-clear while conflicts are open", () => {
  assert.deepEqual(
    getActivityBadgeState({
      failedJobs: 0,
      openConflictCount: 2,
      working: false,
    }),
    {
      label: "2 conflitti da gestire",
      tone: "warning",
    },
  );
});

test("keeps overview working while active stock retries are running", () => {
  assert.equal(
    isOverviewSyncWorking({
      activeIncrementalJobCount: 0,
      catalogHealthStatus: "fresh",
      lastJobs: [{ status: "RUNNING", type: "UPDATE_EBAY_STOCK" }],
      pendingJobs: 0,
    }),
    true,
  );
  assert.equal(
    isOverviewSyncWorking({
      activeIncrementalJobCount: 0,
      catalogHealthStatus: "fresh",
      lastJobs: [
        {
          runAfter: "2026-06-14T09:59:00.000Z",
          status: "RETRYING",
          type: "UPDATE_EBAY_STOCK",
        },
      ],
      now: "2026-06-14T10:00:00.000Z",
      pendingJobs: 0,
    }),
    true,
  );
});

test("does not keep overview working through future retry backoffs", () => {
  assert.equal(
    isOverviewSyncWorking({
      activeIncrementalJobCount: 0,
      catalogHealthStatus: "fresh",
      lastJobs: [
        {
          runAfter: "2026-06-14T10:15:00.000Z",
          status: "RETRYING",
          type: "UPDATE_EBAY_STOCK",
        },
      ],
      now: "2026-06-14T10:00:00.000Z",
      pendingJobs: 0,
    }),
    false,
  );
});

test("schedules overview revalidation for the next future retry backoff", () => {
  assert.equal(
    getOverviewSyncWakeAt({
      activeIncrementalJobCount: 0,
      catalogHealthStatus: "fresh",
      lastJobs: [
        {
          runAfter: "2026-06-14T10:15:00.000Z",
          status: "RETRYING",
          type: "UPDATE_EBAY_STOCK",
        },
        {
          runAfter: "2026-06-14T10:05:00.000Z",
          status: "RETRYING",
          type: "SYNC_INCREMENTAL",
        },
      ],
      now: "2026-06-14T10:00:00.000Z",
      pendingJobs: 0,
    }),
    "2026-06-14T10:05:00.000Z",
  );
});

test("schedules overview revalidation when due sync can become overdue", () => {
  assert.equal(
    getOverviewSyncWakeAt({
      activeIncrementalJobCount: 0,
      catalogHealthStatus: "due",
      catalogOverdueAt: "2026-06-14T10:05:01.000Z",
      nextRetryRunAfter: null,
      now: "2026-06-14T10:00:00.000Z",
      pendingJobs: 0,
    }),
    "2026-06-14T10:05:01.000Z",
  );
});

test("prefers the earliest wake between retry and catalog overdue transition", () => {
  assert.equal(
    getOverviewSyncWakeAt({
      activeIncrementalJobCount: 0,
      catalogHealthStatus: "due",
      catalogOverdueAt: "2026-06-14T10:05:01.000Z",
      nextRetryRunAfter: "2026-06-14T10:02:00.000Z",
      now: "2026-06-14T10:00:00.000Z",
      pendingJobs: 0,
    }),
    "2026-06-14T10:02:00.000Z",
  );
});

test("prefers queued future retry wake time over recent jobs", () => {
  assert.equal(
    getOverviewSyncWakeAt({
      activeIncrementalJobCount: 0,
      catalogHealthStatus: "fresh",
      lastJobs: [
        {
          runAfter: "2026-06-14T10:30:00.000Z",
          status: "RETRYING",
          type: "UPDATE_EBAY_STOCK",
        },
      ],
      nextRetryRunAfter: "2026-06-14T10:15:00.000Z",
      now: "2026-06-14T10:00:00.000Z",
      pendingJobs: 0,
    }),
    "2026-06-14T10:15:00.000Z",
  );
});

test("does not fall back to recent jobs when queued retry wake time is known empty", () => {
  assert.equal(
    getOverviewSyncWakeAt({
      activeIncrementalJobCount: 0,
      catalogHealthStatus: "fresh",
      lastJobs: [
        {
          runAfter: "2026-06-14T10:15:00.000Z",
          status: "RETRYING",
          type: "UPDATE_EBAY_STOCK",
        },
      ],
      nextRetryRunAfter: null,
      now: "2026-06-14T10:00:00.000Z",
      pendingJobs: 0,
    }),
    null,
  );
});

test("does not schedule overview revalidation for due or terminal jobs", () => {
  assert.equal(
    getOverviewSyncWakeAt({
      activeIncrementalJobCount: 0,
      catalogHealthStatus: "fresh",
      lastJobs: [
        {
          runAfter: "2026-06-14T09:59:00.000Z",
          status: "RETRYING",
          type: "UPDATE_EBAY_STOCK",
        },
        {
          runAfter: "2026-06-14T10:15:00.000Z",
          status: "SUCCEEDED",
          type: "SYNC_INCREMENTAL",
        },
      ],
      now: "2026-06-14T10:00:00.000Z",
      pendingJobs: 0,
    }),
    null,
  );
});

test("does not treat terminal recent jobs as overview work in progress", () => {
  assert.equal(
    isOverviewSyncWorking({
      activeIncrementalJobCount: 0,
      catalogHealthStatus: "fresh",
      lastJobs: [
        { status: "FAILED", type: "UPDATE_EBAY_STOCK" },
        { status: "SUCCEEDED", type: "SYNC_INCREMENTAL" },
      ],
      pendingJobs: 0,
    }),
    false,
  );
});

test("maps conflict action labels", () => {
  assert.equal(getConflictActionLabel("REALIGN_FROM_EBAY"), "Usa valore eBay");
  assert.equal(getConflictActionLabel("KEEP_SHOPIFY"), "Mantieni Shopify");
  assert.equal(getConflictActionLabel("IGNORE_FIELD"), "Ignora campo");
});

test("maps catalog status labels", () => {
  assert.equal(getCatalogStatusLabel("active_fresh"), "Aggiornato");
  assert.equal(getCatalogStatusLabel("open_conflict"), "Conflitto");
  assert.equal(getCatalogStatusLabel("mapping_error"), "Errore");
  assert.equal(getCatalogStatusLabel("stale_sync"), "Da controllare");
  assert.equal(getCatalogStatusLabel("archived"), "Esaurito");
});

test("computes catalog row status from mapping health", () => {
  assert.equal(
    getCatalogRowStatus({
      mappingStatus: "ARCHIVED",
      openConflictCount: 3,
      stale: true,
    }),
    "archived",
  );
  assert.equal(
    getCatalogRowStatus({
      mappingStatus: "OUT_OF_STOCK",
      openConflictCount: 3,
      stale: true,
    }),
    "archived",
  );
  assert.equal(
    getCatalogRowStatus({
      lastErrorCode: "shopify_write_failed",
      mappingStatus: "ACTIVE",
    }),
    "mapping_error",
  );
  assert.equal(
    getCatalogRowStatus({
      mappingStatus: "ACTIVE",
      openConflictCount: 1,
    }),
    "open_conflict",
  );
  assert.equal(
    getCatalogRowStatus({
      mappingStatus: "ACTIVE",
      stale: true,
    }),
    "stale_sync",
  );
  assert.equal(
    getCatalogRowStatus({
      lastSyncedAt: "2026-06-03T10:00:00.000Z",
      mappingStatus: "ACTIVE",
    }),
    "active_fresh",
  );
});

test("derives catalog staleness from the shop verification watermark", () => {
  const now = new Date("2026-06-13T12:00:00.000Z");
  const syncTargetSeconds = 300; // soglia stale = 2x = 10 minuti
  const longAgo = new Date("2026-06-12T12:00:00.000Z");
  const recent = new Date("2026-06-13T11:55:00.000Z");

  // Catalogo tranquillo: prodotto invariato da 24h ma eBay verificato 5 min fa.
  // Non deve risultare "Da controllare".
  assert.equal(
    isCatalogMappingStale({
      catalogVerifiedAt: recent,
      lastSyncedAt: longAgo,
      mappingStatus: "ACTIVE",
      now,
      syncTargetSeconds,
    }),
    false,
  );

  // Verifica del catalogo in ritardo (oltre 10 min): è genuinamente stale.
  assert.equal(
    isCatalogMappingStale({
      catalogVerifiedAt: longAgo,
      lastSyncedAt: longAgo,
      mappingStatus: "ACTIVE",
      now,
      syncTargetSeconds,
    }),
    true,
  );

  // Prodotto sincronizzato di recente di per sé, senza watermark di shop.
  assert.equal(
    isCatalogMappingStale({
      catalogVerifiedAt: null,
      lastSyncedAt: recent,
      mappingStatus: "ACTIVE",
      now,
      syncTargetSeconds,
    }),
    false,
  );

  // In pausa: sempre da controllare, anche con watermark fresco.
  assert.equal(
    isCatalogMappingStale({
      catalogVerifiedAt: recent,
      lastSyncedAt: recent,
      mappingStatus: "PAUSED",
      now,
      syncTargetSeconds,
    }),
    true,
  );

  // Mai sincronizzato: da controllare anche con watermark fresco.
  assert.equal(
    isCatalogMappingStale({
      catalogVerifiedAt: recent,
      lastSyncedAt: null,
      mappingStatus: "ACTIVE",
      now,
      syncTargetSeconds,
    }),
    true,
  );
});

test("maps catalog availability labels", () => {
  assert.equal(getCatalogAvailabilityLabel("aligned"), "Allineata");
  assert.equal(getCatalogAvailabilityLabel("needs_check"), "Da verificare");
  assert.equal(getCatalogAvailabilityLabel("unknown"), "Non letta");
  assert.equal(getCatalogAvailabilityLabel("blocked"), "Bloccata");
});

test("maps conflict fields and impact text for merchant decisions", () => {
  assert.equal(getConflictFieldLabel("quantity"), "Quantità");
  assert.equal(getConflictFieldLabel("price"), "Prezzo");
  assert.equal(getConflictFieldLabel("title"), "Titolo");
  assert.equal(getConflictFieldLabel("description"), "Descrizione");
  assert.equal(getConflictFieldLabel("unknown_field"), "unknown_field");
  assert.match(getConflictImpactText("quantity"), /disponibilità/i);
  assert.match(getConflictImpactText("price"), /prezzo/i);
  assert.match(getConflictImpactText("images"), /immagini/i);
});

test("maps product publication policy summaries", () => {
  assert.equal(
    getProductPublicationModeSummaryLabel("ALL", 0),
    "Tutti i canali disponibili",
  );
  assert.equal(
    getProductPublicationModeSummaryLabel("NONE", 0),
    "Non pubblicare automaticamente",
  );
  assert.equal(
    getProductPublicationModeSummaryLabel("SELECTED", 2),
    "2 canali selezionati",
  );
  assert.equal(
    getProductPublicationModeSummaryLabel("SELECTED", 0),
    "Nessun canale selezionato",
  );
});

test("maps eBay connection status labels", () => {
  assert.equal(getEbayConnectionStatusLabel("CONNECTED"), "Collegato");
  assert.equal(getEbayConnectionStatusLabel("EXPIRED"), "Da ricollegare");
  assert.equal(getEbayConnectionStatusLabel("REVOKED"), "Revocato");
  assert.equal(getEbayConnectionStatusLabel("NOT_CONNECTED"), "Non collegato");
});

test("maps timeline category labels", () => {
  assert.equal(getTimelineCategoryLabel("IMPORT_CATALOG"), "Importazioni");
  assert.equal(getTimelineCategoryLabel("SYNC_INCREMENTAL"), "Aggiornamenti");
  assert.equal(getTimelineCategoryLabel("UPDATE_EBAY_STOCK"), "Disponibilità");
  assert.equal(getTimelineCategoryLabel("CONFLICT"), "Conflitti");
  assert.equal(getTimelineCategoryLabel("FAILED_JOB"), "Errori");
});

test("maps canonical sync job titles", () => {
  assert.equal(getSyncJobTitle("IMPORT_CATALOG"), "Importazione catalogo");
  assert.equal(getSyncJobTitle("SYNC_INCREMENTAL"), "Aggiornamento catalogo");
  assert.equal(
    getSyncJobTitle("ARCHIVE_INACTIVE_LISTING"),
    "Prodotto segnato come esaurito",
  );
  assert.equal(getSyncJobTitle("UNKNOWN"), "Attività SyncBay");
});

test("formats and tones sync job statuses", () => {
  assert.equal(formatSyncJobStatus("SUCCEEDED"), "Completata");
  assert.equal(formatSyncJobStatus("RETRYING"), "Riprova automatica in corso");
  assert.equal(formatSyncJobStatus("WHATEVER"), "WHATEVER");
  assert.equal(getSyncJobTone("SUCCEEDED"), "success");
  assert.equal(getSyncJobTone("FAILED"), "critical");
  assert.equal(getSyncJobTone("RETRYING"), "warning");
  assert.equal(getSyncJobTone("PENDING"), "info");
});

test("surfaces quarantined updates as a critical provider notice", () => {
  const notice = getProviderHealthNotice({
    quarantinedCount: 2,
    lagBreached: true,
    lagSeconds: 600,
  });

  assert.equal(notice?.kind, "quarantine");
  assert.equal(notice?.tone, "critical");
  assert.equal(notice?.primaryActionHref, "/app/activity");
  assert.match(notice?.title ?? "", /2 attività/);
  assert.match(notice?.body ?? "", /Non ripartono automaticamente/);
  assert.match(notice?.body ?? "", /Riprova/);
  assert.doesNotMatch(notice?.body ?? "", /riprende da solo/i);
});

test("uses singular copy for a single quarantined update", () => {
  const notice = getProviderHealthNotice({ quarantinedCount: 1 });

  assert.equal(notice?.kind, "quarantine");
  assert.match(notice?.title ?? "", /Un'attività/);
});

test("falls back to a warning lag notice when nothing is quarantined", () => {
  const notice = getProviderHealthNotice({
    quarantinedCount: 0,
    lagBreached: true,
    lagSeconds: 420,
  });

  assert.equal(notice?.kind, "lag");
  assert.equal(notice?.tone, "warning");
  assert.match(notice?.body ?? "", /7 minuti di ritardo/);
});

test("surfaces recent failed jobs as a provider notice", () => {
  const notice = getProviderHealthNotice({
    failedCount: 2,
    lagBreached: false,
    quarantinedCount: 0,
  });

  assert.equal(notice?.kind, "failed_jobs");
  assert.equal(notice?.tone, "warning");
  assert.match(notice?.title ?? "", /2 attività non riuscite/);
  assert.match(notice?.body ?? "", /ultime attività/);
});

test("returns no provider notice when the sync is healthy", () => {
  assert.equal(
    getProviderHealthNotice({
      failedCount: 0,
      quarantinedCount: 0,
      lagBreached: false,
    }),
    null,
  );
});
