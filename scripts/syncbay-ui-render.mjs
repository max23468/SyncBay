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
  catalogo: {
    module: "/app/routes/app.catalog.tsx",
    path: "/app/catalog",
    fixture: getCatalogFixture,
    loader: async (_mod, session) => {
      const services = await loadServices();
      return services.getCatalogPageState(session);
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
      freshCount: 1,
      needsCheckCount: 1,
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
    conflicts: { openCount: 1 },
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
          createdAt: "2026-06-11T15:50:00.000Z",
          errorMessage: null,
          id: "job-1",
          status: "SUCCEEDED",
          type: "SYNC_INCREMENTAL",
        },
      ],
    },
    vercel: { publicUrl: "https://syncbay.vercel.app" },
  };
}
