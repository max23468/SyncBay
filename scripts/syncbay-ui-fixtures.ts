import type { ExistingCatalogTakeoverReport } from "../app/lib/syncbay-existing-catalog-takeover";
import type { ExistingProductMatchSuggestion } from "../app/lib/syncbay-product-matching";

export type UiFixturePage =
  | "attivita"
  | "catalogo"
  | "conflitti"
  | "importazione"
  | "impostazioni"
  | "panoramica";

export const UI_FIXTURE_STATES = [
  "healthy",
  "empty",
  "loading",
  "degraded",
  "error",
  "blocked",
  "in_progress",
] as const;
export type UiFixtureState = (typeof UI_FIXTURE_STATES)[number];

const COMMON_FIXTURE_STATES = UI_FIXTURE_STATES.slice(0, 5);

export function getUiFixtureStates(page: UiFixturePage): UiFixtureState[] {
  return page === "importazione"
    ? [...UI_FIXTURE_STATES]
    : [...COMMON_FIXTURE_STATES];
}

export function getCatalogFixture() {
  const rows = [
    {
      availability: "aligned",
      conflictIds: [],
      ebayItemId: "123456789001",
      id: "mapping-1",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncedAt: "2026-06-11T15:42:00.000Z",
      mappingStatus: "ACTIVE",
      openConflictCount: 0,
      price: { amount: "34.90", currency: "EUR" },
      productStatus: "ACTIVE",
      quantity: 4,
      shopifyProductGid: "gid://shopify/Product/901000000001",
      sku: "SYNC-TAZZA-001",
      snapshotCapturedAt: "2026-06-11T15:41:00.000Z",
      status: "active_fresh",
      thumbnailUrl:
        "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=160&h=160&fit=crop",
      title: "Set tazze ceramica giapponese",
    },
    {
      availability: "needs_check",
      conflictIds: ["conflict-1"],
      ebayItemId: "123456789002",
      id: "mapping-2",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncedAt: "2026-06-11T14:08:00.000Z",
      mappingStatus: "ACTIVE",
      openConflictCount: 1,
      price: { amount: "89.00", currency: "EUR" },
      productStatus: "ACTIVE",
      quantity: 1,
      shopifyProductGid: "gid://shopify/Product/901000000002",
      sku: "SYNC-LAMP-002",
      snapshotCapturedAt: "2026-06-11T14:07:00.000Z",
      status: "open_conflict",
      thumbnailUrl: null,
      title: "Lampada da tavolo modernariato",
    },
    {
      availability: "aligned",
      conflictIds: [],
      ebayItemId: "123456789003",
      id: "mapping-3",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncedAt: "2026-06-11T13:20:00.000Z",
      mappingStatus: "OUT_OF_STOCK",
      openConflictCount: 0,
      price: { amount: "22.50", currency: "EUR" },
      productStatus: "ACTIVE",
      quantity: 0,
      shopifyProductGid: "gid://shopify/Product/901000000003",
      sku: "SYNC-VASE-003",
      snapshotCapturedAt: "2026-06-11T13:20:00.000Z",
      status: "archived",
      thumbnailUrl:
        "https://images.unsplash.com/photo-1612196808214-b8e1d6145a8c?w=160&h=160&fit=crop",
      title: "Vaso decorativo in vetro verde",
    },
  ];

  return {
    filters: [
      "all",
      "linked",
      "fresh",
      "needs_check",
      "conflicts",
      "not_updated",
      "archived",
    ],
    pagination: {
      cappedAtMaxProducts: false,
      currentEnd: rows.length,
      currentStart: 1,
      hasNextPage: false,
      hasPreviousPage: false,
      maxLoadedRows: rows.length,
      maxProducts: 2000,
      nextPage: null,
      offset: 0,
      page: 1,
      pageSize: 50,
      previousPage: null,
      totalPages: 1,
      totalRows: rows.length,
    },
    rows,
    shop: {
      domain: "syncbay-preview.myshopify.com",
      syncTargetSeconds: 300,
    },
    summary: {
      archivedCount: 1,
      conflictCount: 1,
      freshCount: 1,
      linkedCount: rows.length,
      needsCheckCount: 1,
      totalCount: rows.length,
    },
  };
}

export function getConflictsFixture() {
  const rows = [
    {
      detectedAt: "2026-06-11T15:30:00.000Z",
      ebayItemId: "123456789002",
      field: "description",
      id: "conflict-1",
      product: {
        shopifyProductGid: "gid://shopify/Product/901000000002",
        sku: "SYNC-LAMP-002",
        thumbnailUrl: null,
        title: "Lampada da tavolo modernariato",
      },
      resolution: null,
      resolvedAt: null,
      shopifyValue: "Descrizione aggiornata manualmente su Shopify.",
      sourceValue: "Descrizione pulita letta da eBay.",
      status: "OPEN",
    },
    {
      detectedAt: "2026-06-11T14:20:00.000Z",
      ebayItemId: "123456789004",
      field: "quantity",
      id: "conflict-2",
      product: {
        shopifyProductGid: "gid://shopify/Product/901000000004",
        sku: "SYNC-BOOK-004",
        thumbnailUrl:
          "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=160&h=160&fit=crop",
        title: "Libro illustrato fuori catalogo",
      },
      resolution: null,
      resolvedAt: null,
      shopifyValue: "2 disponibili",
      sourceValue: "1 disponibile su eBay",
      status: "OPEN",
    },
  ];

  return {
    filters: ["open", "resolved", "all"],
    pagination: {
      currentEnd: rows.length,
      currentStart: 1,
      hasNextPage: false,
      hasPreviousPage: false,
      nextPage: null,
      offset: 0,
      page: 1,
      pageSize: 20,
      previousPage: null,
      totalPages: 1,
      totalRows: rows.length,
    },
    rows,
    summary: {
      batchSafeCount: 1,
      guardedCount: 0,
      manualOnlyCount: 1,
      openCount: rows.length,
      totalCount: rows.length,
    },
  };
}

export function getDashboardFixture() {
  return {
    audit: [
      {
        createdAt: "2026-06-11T15:50:00.000Z",
        message: "Aggiornamento catalogo completato.",
        type: "SYNC_COMPLETED",
      },
    ],
    conflicts: {
      openCount: 1,
      recent: [
        {
          detectedAt: "2026-06-11T15:30:00.000Z",
          ebayItemId: "123456789002",
          field: "description",
          id: "conflict-1",
          shopifyProductGid: "gid://shopify/Product/901000000002",
          shopifyValue: "Descrizione aggiornata manualmente su Shopify.",
          syncbayValue: "Descrizione pulita letta da eBay.",
        },
      ],
    },
    ebay: {
      connectedAt: "2026-06-01T09:15:00.000Z",
      marketplaceId: "EBAY_IT",
      missingRequirements: [],
      oauthEnabled: true,
      oauthReady: true,
      status: "CONNECTED",
    },
    importPreview: { blockers: [] },
    imports: { mappingCount: 3 },
    shop: {
      defaultLocationGid: "gid://shopify/Location/1",
      domain: "syncbay-preview.myshopify.com",
      syncEnabled: true,
      syncTargetSeconds: 300,
    },
    shopify: {
      missingConfiguredScopes: [],
      missingScopes: [],
    },
    supabase: {
      queueProviderReady: true,
      schedulerProviderReady: true,
    },
    sync: {
      catalogHealth: {
        activeIncrementalJobCount: 0,
        latestIncrementalFinishedAt: "2026-06-11T15:50:00.000Z",
        latestIncrementalStatus: "SUCCEEDED",
        nextDueAt: "2026-06-11T15:55:00.000Z",
        status: "fresh",
      },
      healthDigest: {
        conflictsOpen: 1,
        failedCount: 0,
        headline: "attention",
        lagBreached: false,
        lagSeconds: 0,
        quarantinedCount: 0,
        syncedCount: 8,
        windowHours: 24,
      },
      catalogHealthCenter: {
        causes: [
          {
            code: "open_conflicts",
            count: 1,
            detail: "Decisioni Shopify aperte bloccano l'allineamento automatico.",
            label: "Conflitti aperti",
            tone: "warning",
          },
        ],
        status: "warning",
        summary: "1 conflitti aperti",
      },
      failedJobs: [],
      fullReconcile: {
        intervalHours: 24,
        latestFinishedAt: "2026-06-11T05:00:00.000Z",
        nextDueAt: "2026-06-12T05:00:00.000Z",
        status: "fresh",
      },
      lastJobs: [
        {
          attempts: 1,
          createdAt: "2026-06-11T15:50:00.000Z",
          errorCode: null,
          errorMessage: null,
          id: "job-1",
          maxAttempts: 1,
          runAfter: "2026-06-11T15:55:00.000Z",
          status: "SUCCEEDED",
          type: "SYNC_INCREMENTAL",
        },
        {
          attempts: 1,
          createdAt: "2026-06-11T15:35:00.000Z",
          errorCode: "EBAY_TRADING_RATE_LIMITED",
          errorMessage: "eBay ha imposto un cooldown temporaneo.",
          id: "job-2",
          maxAttempts: 3,
          runAfter: "2026-06-11T15:58:00.000Z",
          status: "RETRYING",
          type: "UPDATE_EBAY_STOCK",
        },
      ],
      lastRunCounts: { requested: 142, synced: 8 },
      pendingJobs: 1,
    },
    metrics: {
      reliability: {
        daily: [12, 18, 9, 22, 14, 28, 31],
        succeededJobs: 130,
        successRate: 99,
        totalJobs: 131,
        windowDays: 7,
      },
      trends: { newConflicts24h: 2, newMappings24h: 12 },
    },
    vercel: { publicUrl: "https://syncbay.vercel.app" },
  };
}

export function getImportPreviewFixture() {
  const locations = [
    {
      fulfillsOnlineOrders: true,
      id: "gid://shopify/Location/preview-main",
      isActive: true,
      name: "Sede principale",
    },
  ];
  const items = [
    {
      itemId: "123456789001",
      issues: [],
      matchSuggestions: [
        {
          autoLinkable: true,
          confidence: "high",
          productGid: "gid://shopify/Product/preview-strong",
          reasonCodes: ["sku_exact"],
          reasons: ["SKU identico"],
          score: 100,
          variantGid: "gid://shopify/ProductVariant/preview-strong",
        },
      ],
      normalized: {
        descriptionCleanedLength: 0,
        descriptionCleanedTextExcerpt: "",
        descriptionOriginalLength: 0,
        descriptionOriginalTextExcerpt: "",
        descriptionRemovedPercent: 0,
        descriptionTemplateSignalCount: 0,
        descriptionWasChanged: false,
        imageCount: 3,
        qualityChecklist: [
          { code: "sku_present", label: "SKU presente", severity: "info", status: "pass" },
          { code: "price_invalid", label: "Prezzo valido", severity: "info", status: "pass" },
        ],
        qualitySummary: "2 controlli ok",
        sku: "SYNC-TAZZA-001",
        title: "Set tazze ceramica giapponese",
      },
      status: "importable",
    },
    {
      itemId: "123456789005",
      issues: [
        {
          message: "Prezzo non letto dalla preview eBay.",
          severity: "warning",
        },
      ],
      matchSuggestions: [
        {
          autoLinkable: false,
          confidence: "medium",
          productGid: "gid://shopify/Product/preview-existing",
          reasonCodes: ["title_very_similar"],
          reasons: ["Titolo simile"],
          score: 40,
          variantGid: "gid://shopify/ProductVariant/preview-existing",
        },
      ],
      normalized: {
        descriptionCleanedLength: 120,
        descriptionCleanedTextExcerpt: "Radio vintage da collezione.",
        descriptionOriginalLength: 180,
        descriptionOriginalTextExcerpt: "Radio vintage da collezione con template negozio.",
        descriptionRemovedPercent: 33,
        descriptionTemplateSignalCount: 1,
        descriptionWasChanged: true,
        imageCount: 1,
        qualityChecklist: [
          { code: "sku_present", label: "SKU presente", severity: "info", status: "pass" },
          { code: "images_missing", label: "Immagini presenti", severity: "info", status: "pass" },
          { code: "description_cleaned", label: "Descrizione ripulita", severity: "info", status: "pass" },
        ],
        qualitySummary: "3 controlli ok",
        sku: "SYNC-RADIO-005",
        title: "Radio vintage da collezione",
      },
      status: "importable",
    },
    {
      itemId: "123456789006",
      issues: [
        {
          message: "SKU mancante: SyncBay userà un fallback EBAY-ItemID.",
          severity: "info",
        },
      ],
      matchSuggestions: [],
      normalized: {
        descriptionCleanedLength: 0,
        descriptionCleanedTextExcerpt: "",
        descriptionOriginalLength: 0,
        descriptionOriginalTextExcerpt: "",
        descriptionRemovedPercent: 0,
        descriptionTemplateSignalCount: 0,
        descriptionWasChanged: false,
        imageCount: 0,
        qualityChecklist: [
          { code: "sku_missing", label: "SKU mancante", severity: "critical", status: "fail" },
          { code: "images_missing", label: "Immagini mancanti", severity: "warning", status: "warning" },
        ],
        qualitySummary: "1 blocchi, 1 avvisi",
        sku: null,
        title: "Specchio da parete anni 70",
      },
      status: "error",
    },
  ];

  return {
    canWriteLocations: true,
    locationError: null,
    locationRename: {
      canRename: true,
      nextAction: "Puoi rinominare la location selezionata da SyncBay.",
    },
    locations,
    wizard: {
      catalogMode: "existing_catalog",
      draftImport: {
        blockers: [],
        draftLimit: 25,
        enabled: true,
        importProductStatus: "DRAFT",
        importableCount: 2,
        nextAction: "Controlla l'anteprima e avvia l'import quando sei pronto.",
        plannedCreateCount: 2,
      },
      ebay: {
        missingRequirements: [],
        oauthEnabled: true,
        oauthReady: true,
        status: "CONNECTED",
      },
      importPreview: {
        blockers: [],
        defaults: {
          descriptionMode: "Descrizioni pulite per Shopify",
          imageImport: "Importa immagini eBay disponibili",
          productStatus: "Bozza",
        },
      },
      previewPlan: {
        limits: {
          maxProducts: 2000,
        },
      },
      previewResult: {
        existingCatalogTakeover: {
          rows: [
            {
              fieldPolicy: {
                handle: { currentHandle: "set-tazze", operation: "preserve", redirectRequired: false },
                images: { operation: "preserve" },
                tags: { add: ["Negozio eBay"], preserve: ["Ceramica"], remove: [] },
              },
              itemId: "123456789001",
              matchSuggestion:
                items[0]
                  .matchSuggestions[0] as ExistingProductMatchSuggestion,
              plannedOperations: [
                "claim_mapping",
                "sync_title",
                "sync_description",
                "sync_price",
                "sync_quantity",
                "sync_category",
                "sync_facets",
                "sync_seo",
                "add_syncbay_tag",
                "preserve_handle",
              ],
              productGid: "gid://shopify/Product/preview-strong",
              reasons: [],
              sku: "SYNC-TAZZA-001",
              status: "applicabile",
              variantGid: "gid://shopify/ProductVariant/preview-strong",
            },
            {
              fieldPolicy: {
                handle: { currentHandle: "radio-vintage", operation: "preserve", redirectRequired: false },
                images: { operation: "preserve" },
                tags: { add: ["Negozio eBay"], preserve: [], remove: [] },
              },
              itemId: "123456789005",
              matchSuggestion: null,
              plannedOperations: [],
              productGid: null,
              reasons: ["match_non_automatico"],
              sku: "SYNC-RADIO-005",
              status: "da_rivedere",
              variantGid: null,
            },
            {
              fieldPolicy: {
                handle: { currentHandle: null, operation: "preserve", redirectRequired: false },
                images: { operation: "sync_from_ebay_if_available" },
                tags: { add: ["Negozio eBay"], preserve: [], remove: [] },
              },
              itemId: "123456789006",
              matchSuggestion: null,
              plannedOperations: [],
              productGid: null,
              reasons: ["match_shopify_mancante", "immagini_mancanti"],
              sku: "SYNC-MISSING-006",
              status: "bloccante",
              variantGid: null,
            },
          ],
          shopDomain: "syncbay-preview.myshopify.com",
          summary: {
            alreadyLinked: 0,
            applicable: 1,
            blocked: 1,
            review: 1,
            total: 3,
          },
        } satisfies ExistingCatalogTakeoverReport,
        items,
        mode: "live",
        summary: {
          errorCount: 1,
          importableCount: 2,
          totalCount: items.length,
        },
      },
      previewSource: {
        coverageNote: "Fixture sintetica con stato collegato e dati sanitizzati.",
        errorMessage: null,
        readCount: items.length,
        source: "trading_api",
      },
      productPublications: {
        mode: "SELECTED",
        selectedCount: 2,
      },
      runtimePhases: [
        {
          detail: "Preview locale senza chiamate provider.",
          label: "Harness fixture",
          status: "ready",
        },
        {
          detail: "Scritture disabilitate finché non confermate nell'app.",
          label: "Protezione scritture",
          status: "ready",
        },
      ],
      shop: {
        defaultLocationGid: locations[0].id,
        domain: "syncbay-preview.myshopify.com",
      },
      validationRules: [
        {
          code: "sku_fallback",
          label: "SKU fallback EBAY-ItemID quando manca lo SKU eBay",
          severity: "info",
        },
        {
          code: "max_products",
          label: "Limite pilota 2.000 prodotti",
          severity: "warning",
        },
      ],
    },
  };
}

export function getSettingsFixture() {
  return {
    ebay: {
      connectedAt: "2026-06-01T09:15:00.000Z",
      marketplaceId: "EBAY_IT",
      oauthEnabled: true,
      oauthReady: true,
      status: "CONNECTED",
    },
    productPublications: {
      availablePublications: [
        {
          id: "gid://shopify/Publication/online-store",
          title: "Negozio online",
        },
        {
          id: "gid://shopify/Publication/shop-app",
          title: "Shop",
        },
      ],
      errorMessage: null,
      mode: "SELECTED",
      selectedPublicationIds: [
        "gid://shopify/Publication/online-store",
        "gid://shopify/Publication/shop-app",
      ],
    },
    shop: {
      defaultProductStatus: "ACTIVE",
      domain: "syncbay-preview.myshopify.com",
      syncEnabled: true,
      syncTargetSeconds: 300,
    },
    shopify: {
      configuredScopes: [
        "read_products",
        "write_products",
        "read_inventory",
        "write_inventory",
        "read_locations",
        "write_locations",
      ],
      missingConfiguredScopes: [],
      missingScopes: [],
      scopes: [
        "read_products",
        "write_products",
        "read_inventory",
        "write_inventory",
        "read_locations",
        "write_locations",
      ],
      webhookTopics: [
        "orders/paid",
        "products/update",
        "inventory_levels/update",
        "app/uninstalled",
      ],
    },
    sync: {
      activeMappingCount: 896,
      canEnable: true,
      enablementBlockers: [],
      lastIncrementalFinishedAt: "2026-06-12T20:18:00.000Z",
    },
  };
}

export function getUiFixture(page: UiFixturePage, state: UiFixtureState) {
  if (!getUiFixtureStates(page).includes(state)) {
    throw new Error(`Stato fixture ${state} non supportato per ${page}.`);
  }

  const base =
    page === "catalogo"
      ? getCatalogFixture()
      : page === "conflitti"
        ? getConflictsFixture()
        : page === "importazione"
          ? getImportPreviewFixture()
          : page === "impostazioni"
            ? getSettingsFixture()
            : getDashboardFixture();
  const fixture = structuredClone(base) as Record<string, unknown>;
  fixture.fixtureState = state;

  if (state === "empty") {
    if (Array.isArray(fixture.rows)) fixture.rows = [];
    const summary = asRecord(fixture.summary);
    for (const key of Object.keys(summary)) {
      if (typeof summary[key] === "number") summary[key] = 0;
    }
    if (page === "panoramica" || page === "attivita") {
      fixture.audit = [];
      const conflicts = asRecord(fixture.conflicts);
      conflicts.openCount = 0;
      conflicts.recent = [];
      const imports = asRecord(fixture.imports);
      imports.mappingCount = 0;
      const sync = asRecord(fixture.sync);
      sync.failedJobs = [];
      sync.lastJobs = [];
      sync.pendingJobs = 0;
    }
  }

  if (page === "importazione" && (state === "degraded" || state === "error")) {
    fixture.locationError =
      state === "error"
        ? "Location Shopify non leggibili. Riprova dalla pagina Importazione."
        : "Location Shopify temporaneamente non verificata.";
  }

  if ((page === "panoramica" || page === "attivita") && state === "degraded") {
    const sync = asRecord(fixture.sync);
    const digest = asRecord(sync.healthDigest);
    digest.headline = "degraded";
    digest.failedCount = 1;
  }

  if (state === "error") {
    applyErrorState(page, fixture);
  }

  if (page === "importazione" && state === "blocked") {
    const wizard = asRecord(fixture.wizard);
    const draftImport = asRecord(wizard.draftImport);
    const importPreview = asRecord(wizard.importPreview);
    draftImport.blockers = [
      "Seleziona una location Shopify prima di avviare l’importazione.",
    ];
    draftImport.enabled = false;
    draftImport.nextAction =
      "Apri Impostazioni, seleziona la location e torna alla simulazione.";
    importPreview.blockers = [
      "La location Shopify predefinita non è ancora configurata.",
    ];
  }

  if (page === "importazione" && state === "in_progress") {
    const wizard = asRecord(fixture.wizard);
    wizard.runtimePhases = [
      {
        detail: "SyncBay sta collegando i prodotti applicabili in batch.",
        label: "Collegamento catalogo",
        status: "working",
      },
      {
        detail: "Non chiudere la pagina finché la coda non è stata preparata.",
        label: "Preparazione sincronizzazione",
        status: "pending",
      },
    ];
  }

  return fixture;
}

export function getUiFixtureScenario(
  page: UiFixturePage,
  state: UiFixtureState,
) {
  if (!getUiFixtureStates(page).includes(state)) {
    throw new Error(`Scenario fixture ${state} non supportato per ${page}.`);
  }

  if (state === "loading") {
    return {
      actionHref: null,
      actionLabel: null,
      ariaBusy: true,
      detail: "Attendi: i dati della sezione sono in preparazione.",
      role: "status" as const,
      title: "Caricamento in corso",
    };
  }
  if (state === "degraded") {
    return {
      actionHref: "/app/activity?filter=errors",
      actionLabel: "Controlla attività",
      ariaBusy: false,
      detail: "Alcuni dati non sono aggiornati. Controlla il dettaglio operativo.",
      role: "status" as const,
      title: "Aggiornamento parziale",
    };
  }
  if (state === "error") {
    return {
      actionHref: `/${page}`,
      actionLabel: "Riprova",
      ariaBusy: false,
      detail: "La sezione non è stata caricata. Riprova senza modificare i dati.",
      role: "alert" as const,
      title: "Caricamento non riuscito",
    };
  }
  if (state === "blocked") {
    return {
      actionHref: "/app/settings",
      actionLabel: "Completa impostazioni",
      ariaBusy: false,
      detail: "Manca un requisito obbligatorio prima di collegare il catalogo.",
      role: "alert" as const,
      title: "Importazione bloccata",
    };
  }
  if (state === "in_progress") {
    return {
      actionHref: "/app/activity",
      actionLabel: "Segui attività",
      ariaBusy: true,
      detail: "I batch sono in preparazione. Lo stato si aggiornerà automaticamente.",
      role: "status" as const,
      title: "Importazione in corso",
    };
  }

  return {
    actionHref: null,
    actionLabel: null,
    ariaBusy: false,
    detail:
      state === "empty"
        ? "Non ci sono ancora elementi da mostrare in questa sezione."
        : "Dati sintetici pronti per la verifica.",
    role: "status" as const,
    title: state === "empty" ? "Nessun elemento" : "Sezione pronta",
  };
}

function applyErrorState(
  page: UiFixturePage,
  fixture: Record<string, unknown>,
) {
  if (page === "catalogo" && Array.isArray(fixture.rows) && fixture.rows[0]) {
    Object.assign(asRecord(fixture.rows[0]), {
      lastErrorCode: "SHOPIFY_READ_FAILED",
      lastErrorMessage: "Shopify non ha risposto. Riprova da Attività.",
      status: "mapping_error",
    });
  }
  if (page === "impostazioni") {
    const publications = asRecord(fixture.productPublications);
    publications.errorMessage =
      "Canali Shopify non leggibili. Riprova prima di salvare.";
  }
  if (page === "panoramica" || page === "attivita") {
    const sync = asRecord(fixture.sync);
    const digest = asRecord(sync.healthDigest);
    digest.failedCount = 1;
    digest.headline = "degraded";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
