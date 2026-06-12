#!/usr/bin/env node
/*
 * Render headless di una superficie embedded SyncBay.
 *
 * Come: carica l'env di runtime, esegue il componente di route REALE via Vite
 * SSR + React Router static handler, alimentato dai loader reali (`getDashboardState`,
 * ecc.) letti dalla sessione offline nel database. La chrome dei componenti
 * Polaris `s-*` è simulata (esistono solo dentro Admin embedded: verificato a
 * livello di app-bridge.js, che li registra solo dopo l'handshake col frame
 * Admin). Reali qui: dati, componente di route, design layer SyncBay.
 *
 * Uso:
 *   node scripts/syncbay-ui-render.mjs attivita --fixture
 *   node scripts/syncbay-ui-render.mjs impostazioni --fixture
 *   node scripts/syncbay-ui-render.mjs panoramica --fixture  # smoke veloce
 *   node scripts/syncbay-ui-render.mjs catalogo --fixture
 *   node scripts/syncbay-ui-render.mjs panoramica            # dati reali locali
 *
 * Privacy: lo shop collegato in pilota è il dev store di test. Gli HTML/PNG
 * prodotti restano in preview/shots/ (gitignorato), non vanno in repo.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToString } from "react-dom/server";
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
} from "react-router";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// --- 1. Carica env di runtime (produzione pilota) ------------------------- //
function loadEnvFile(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return 0;
  }
  let count = 0;
  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] === undefined) {
      process.env[match[1]] = value;
      count += 1;
    }
  }
  return count;
}

// `.env` ha i valori locali reali (DB Supabase locale, chiavi Shopify dev).
// Il file `.vercel/.env.production.local` ha valori vuoti (Vercel non esporta i
// segreti), quindi non è una fonte utile qui.
let envCount = loadEnvFile(join(root, ".env"));
envCount += loadEnvFile(join(root, ".env.shopify"));
process.env.NODE_ENV = "development";

// Placeholder difensivi: il modulo shopify.server inizializza shopifyApp() al
// load e richiede questi valori, ma il render non esegue l'auth embedded.
process.env.SHOPIFY_APP_URL ||= "https://syncbay.vercel.app";
process.env.SHOPIFY_API_KEY ||= "render-only";
process.env.SHOPIFY_API_SECRET ||= "render-only";
process.env.SCOPES ||= process.env.SHOPIFY_SCOPES || "read_products";

console.error(`env: caricate ${envCount} variabili di runtime da .env`);

const args = process.argv.slice(2);
const fixtureMode = args.includes("--fixture");
const page = args.find((arg) => !arg.startsWith("--")) || "panoramica";

if (fixtureMode) {
  process.env.SYNCBAY_UI_RENDER_FIXTURE = "1";
}

const PAGES = {
  attivita: {
    module: "/app/routes/app.activity.tsx",
    path: "/app/activity",
    fixture: getDashboardFixture,
    loader: async (_mod, session) => {
      const services = await loadServices();
      return services.getDashboardState(session);
    },
  },
  catalogo: {
    module: "/app/routes/app.catalog.tsx",
    path: "/app/catalog",
    fixture: getCatalogFixture,
    loader: async (_mod, session) => {
      const services = await loadServices();
      return services.getCatalogPageState(session);
    },
  },
  conflitti: {
    module: "/app/routes/app.conflicts.tsx",
    path: "/app/conflicts",
    fixture: getConflictsFixture,
    loader: async (_mod, session) => {
      const services = await loadServices();
      return services.getConflictsPageState(session);
    },
  },
  importazione: {
    module: "/app/routes/app.import-preview.tsx",
    path: "/app/import-preview",
    fixture: getImportPreviewFixture,
    loader: null,
  },
  impostazioni: {
    module: "/app/routes/app.settings.tsx",
    path: "/app/settings",
    fixture: getSettingsFixture,
    loader: async (_mod, session) => {
      const services = await loadServices();
      return services.getShopSettingsState(session);
    },
  },
  panoramica: {
    module: "/app/routes/app._index.tsx",
    path: "/app",
    fixture: getDashboardFixture,
    loader: async (mod, session) => {
      const services = await loadServices();
      return services.getDashboardState(session);
    },
  },
};

const pageConfig = PAGES[page];
if (!pageConfig) {
  console.error(`Pagina non supportata: ${page}. Disponibili: ${Object.keys(PAGES).join(", ")}`);
  process.exit(1);
}

// --- 2. Avvia Vite in SSR per risolvere i moduli app come il server ------- //
const { createServer } = await import("vite");
const vite = await createServer({
  root,
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
  logLevel: "error",
});

let cachedServices;
async function loadServices() {
  if (!cachedServices) {
    cachedServices = await vite.ssrLoadModule("/app/services/syncbay.server.ts");
  }
  return cachedServices;
}

async function loadSession() {
  const db = await vite.ssrLoadModule("/app/db.server.ts");
  const prisma = db.default;
  const shop = process.env.SHOPIFY_DEV_STORE || process.env.SHOP_CUSTOM_DOMAIN;
  const session = await prisma.session.findFirst({
    where: shop ? { shop } : undefined,
    orderBy: { expires: "desc" },
  });
  if (!session) {
    throw new Error(
      "Nessuna sessione offline nel database. Lo shop deve essere installato/collegato.",
    );
  }
  return session;
}

try {
  // --- 3. Dati: fixture veloce o loader reale ----------------------------- //
  const session = fixtureMode
    ? { shop: "syncbay-preview.myshopify.com" }
    : await loadSession();
  console.error(
    fixtureMode
      ? `fixture: shop ${session.shop}`
      : `sessione: shop ${session.shop}`,
  );
  const routeMod = await vite.ssrLoadModule(pageConfig.module);
  if (!fixtureMode && !pageConfig.loader) {
    throw new Error(
      `La pagina ${page} supporta solo --fixture in questo harness: il loader richiede una sessione Shopify Admin embedded.`,
    );
  }
  const data = fixtureMode
    ? pageConfig.fixture()
    : await pageConfig.loader(routeMod, session);
  console.error(
    fixtureMode ? "dati: fixture sintetica caricata" : "dati: loader reale eseguito",
  );

  // --- 4. SSR del componente di route reale ------------------------------ //
  const routes = [
    {
      path: pageConfig.path,
      Component: routeMod.default,
      loader: () => data,
    },
  ];
  const handler = createStaticHandler(routes);
  const context = await handler.query(
    new Request(`http://localhost${pageConfig.path}`),
  );
  if (context instanceof Response) {
    throw new Error(`Route ha restituito una Response (status ${context.status}).`);
  }
  const router = createStaticRouter(handler.dataRoutes, context);
  let markup = renderToString(
    React.createElement(StaticRouterProvider, { router, context }),
  );

  // Adatta le prop di layout Polaris (rese come attributi) a inline style, così
  // gli stand-in `s-*` rispettano griglie e colonne come farebbe Polaris.
  markup = markup
    .replace(
      /<s-thumbnail([^>]*)src="([^"]*)"([^>]*)><\/s-thumbnail>/gi,
      '<img class="preview-thumbnail" src="$2" alt="" />',
    )
    .replace(
      /<s-select([^>]*)>([\s\S]*?)<\/s-select>/gi,
      (_match, attrs, body) => renderPreviewSelect(attrs, body),
    )
    .replace(
      /gridtemplatecolumns="([^"]*)"/gi,
      (_m, value) => `style="grid-template-columns:${value}"`,
    )
    .replace(
      /gridtemplaterows="([^"]*)"/gi,
      (_m, value) => `style="grid-template-rows:${value}"`,
    );

  // --- 5. HTML con chrome simulata + design layer reale ------------------ //
  const stubCss = readFileSync(join(root, "preview/polaris-preview.css"), "utf8");
  const realCss = readFileSync(
    join(root, "app/styles/syncbay-embedded.css"),
    "utf8",
  );
  const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<style>${stubCss}</style>
<style>${realCss}</style>
</head>
<body>
<p class="preview-note">Render ${fixtureMode ? "con fixture sintetica" : "con DATI REALI"} dello shop ${session.shop} · componente di route reale · chrome Polaris simulata.</p>
<div class="preview-frame">${markup}</div>
</body>
</html>`;

  const suffix = fixtureMode ? "fixture" : "live";
  const outPath = join(root, `preview/shots/${page}-${suffix}.html`);
  writeFileSync(outPath, html);
  console.error(`ok html: ${outPath}`);

  // --- 6. Screenshot headless desktop + stretto --------------------------- //
  const CHROME =
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(CHROME)) {
    const shots = [
      { height: 1600, label: "desktop", width: 1280 },
      { height: 1800, label: "narrow", width: 400 },
    ];
    for (const shot of shots) {
      const png = join(root, `preview/shots/${page}-${suffix}-${shot.label}.png`);
      execFileSync(
        CHROME,
        [
          "--headless=new",
          "--disable-gpu",
          "--hide-scrollbars",
          "--force-device-scale-factor=2",
          `--window-size=${shot.width},${shot.height}`,
          `--screenshot=${png}`,
          `file://${outPath}`,
        ],
        { stdio: "ignore" },
      );
      console.error(`ok png: ${png}`);
    }
  } else {
    console.error("Chrome non trovato: salto gli screenshot.");
  }

  console.log(outPath);
} finally {
  await vite.close();
}

function getCatalogFixture() {
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

function getConflictsFixture() {
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

function renderPreviewSelect(attrs, body) {
  const label = getAttribute(attrs, "label") ?? "";
  const value = getAttribute(attrs, "value") ?? "";
  const optionLabels = [...body.matchAll(/<s-option([^>]*)>([\s\S]*?)<\/s-option>/gi)]
    .map((match) => ({
      label: stripTags(match[2]).trim(),
      value: getAttribute(match[1], "value") ?? "",
    }));
  const selectedLabel =
    optionLabels.find((option) => option.value === value)?.label || value;

  return `<span class="preview-select"><span class="preview-select__label">${escapeHtml(label)}</span><span class="preview-select__value">${escapeHtml(selectedLabel)}</span></span>`;
}

function getAttribute(attrs, name) {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`, "i"));

  return match?.[1] ?? null;
}

function stripTags(value) {
  return value.replace(/<[^>]*>/g, "");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getDashboardFixture() {
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
      failedJobs: [],
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
      pendingJobs: 1,
    },
    vercel: { publicUrl: "https://syncbay.vercel.app" },
  };
}

function getImportPreviewFixture() {
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
      normalized: {
        imageCount: 3,
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
      normalized: {
        imageCount: 1,
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
      normalized: {
        imageCount: 0,
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

function getSettingsFixture() {
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
