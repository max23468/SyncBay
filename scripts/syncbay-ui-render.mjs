#!/usr/bin/env node
/*
 * Render headless di una superficie embedded SyncBay.
 *
 * Come: carica l'env di runtime, esegue il componente di route REALE via Vite
 * SSR + React Router static handler, alimentato dai loader reali (`getOverviewState`,
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
 * Privacy: i render versionabili usano esclusivamente fixture sintetiche. Gli HTML/PNG
 * prodotti restano in preview/shots/ (gitignorato), non vanno in repo.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToString } from "react-dom/server";
import {
  getCatalogFixture,
  getConflictsFixture,
  getDashboardFixture,
  getImportPreviewFixture,
  getSettingsFixture,
  getUiFixture,
  getUiFixtureScenario,
  getUiFixtureStates,
} from "./syncbay-ui-fixtures.ts";
import { scrubRuntimeEnv } from "./syncbay-ui-isolation.mjs";
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
} from "react-router";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const fixtureMode = args.includes("--fixture");
const checkMode = args.includes("--check");
const hydrateMode = args.includes("--hydrate");
const page = args.find((arg) => !arg.startsWith("--")) || "panoramica";
const fixtureState = args.find((arg) => arg.startsWith("--state="))?.slice(8) || "healthy";

// --- 1. Carica env di runtime (distribuzione privata) --------------------- //
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
let envCount = 0;
if (fixtureMode) {
  scrubRuntimeEnv();
} else {
  envCount += loadEnvFile(join(root, ".env"));
  envCount += loadEnvFile(join(root, ".env.shopify"));
}
process.env.NODE_ENV ||= fixtureMode ? "test" : "development";

// Placeholder difensivi: il modulo shopify.server inizializza shopifyApp() al
// load e richiede questi valori, ma il render non esegue l'auth embedded.
process.env.SHOPIFY_APP_URL ||= "https://syncbay.vercel.app";
process.env.SHOPIFY_API_KEY ||= "render-only";
process.env.SHOPIFY_API_SECRET ||= "render-only";
process.env.SCOPES ||= process.env.SHOPIFY_SCOPES || "read_products";

console.error(
  fixtureMode
    ? "env: fixture isolata; 0 variabili runtime caricate"
    : `env: caricate ${envCount} variabili di runtime da .env`,
);

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
      return services.getOverviewState(session);
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
      return services.getOverviewState(session);
    },
  },
};

const pageConfig = PAGES[page];
if (!pageConfig) {
  console.error(`Pagina non supportata: ${page}. Disponibili: ${Object.keys(PAGES).join(", ")}`);
  process.exit(1);
}
if (!getUiFixtureStates(page).includes(fixtureState)) {
  throw new Error(
    `Stato fixture ${fixtureState} non supportato per ${page}.`,
  );
}

// --- 2. Avvia Vite in SSR per risolvere i moduli app come il server ------- //
const { createServer } = await import("vite");
const vite = await createServer({
  root,
  appType: "custom",
  configFile: join(root, "scripts/vite.ui-render.config.ts"),
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
  const shellMod = await vite.ssrLoadModule("/app/routes/app.tsx");
  if (!fixtureMode && !pageConfig.loader) {
    throw new Error(
      `La pagina ${page} supporta solo --fixture in questo harness: il loader richiede una sessione Shopify Admin embedded.`,
    );
  }
  const data = fixtureMode
    ? getUiFixture(page, fixtureState)
    : await pageConfig.loader(routeMod, session);
  console.error(
    fixtureMode ? "dati: fixture sintetica caricata" : "dati: loader reale eseguito",
  );

  // --- 4. SSR del componente di route reale ------------------------------ //
  const childRoute = {
    Component: routeMod.default,
    id: page,
    loader: () => data,
    ...(page === "panoramica"
      ? { index: true }
      : { path: pageConfig.path.replace("/app/", "") }),
  };
  const routes = [
    {
      children: [childRoute],
      Component: shellMod.default,
      id: "app",
      loader: () => ({ apiKey: "render-only" }),
      path: "/app",
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
    React.createElement(StaticRouterProvider, {
      context,
      hydrate: false,
      router,
    }),
  );

  // Adatta le prop di layout Polaris (rese come attributi) a inline style, così
  // gli stand-in `s-*` rispettano griglie e colonne come farebbe Polaris.
  if (!hydrateMode) {
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
  }

  // --- 5. HTML con chrome simulata + design layer reale ------------------ //
  const stubCss = readFileSync(join(root, "preview/polaris-preview.css"), "utf8");
  const realCss = readFileSync(
    join(root, "app/styles/syncbay-embedded.css"),
    "utf8",
  );
  const scenario = fixtureMode
    ? getUiFixtureScenario(page, fixtureState)
    : null;
  const scenarioMarkup = scenario
    ? renderFixtureScenario(scenario, fixtureState)
    : "";
  const hydrationScripts = hydrateMode
    ? `<script>window.__SYNCBAY_UI_HARNESS__=${serializeForHtml({ page, state: fixtureState })};</script>
<script src="/scripts/syncbay-ui-polaris-stub.js"></script>
<script type="module" src="/@id/__x00__virtual:react-router/inject-hmr-runtime"></script>
<script type="module" src="/scripts/syncbay-ui-browser-client.tsx"></script>`
    : "";
  const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(page)} · SyncBay UI fixture</title>
<style>${stubCss}</style>
<style>${realCss}</style>
<style>[data-syncbay-harness-control]:focus{outline:3px solid #0968f6;outline-offset:2px}</style>
</head>
<body>
<p class="preview-note">Render ${fixtureMode ? "con fixture sintetica" : "con DATI REALI"} dello shop ${session.shop} · componente di route reale · chrome Polaris simulata.</p>
${scenarioMarkup}
<div class="preview-frame" data-fixture-page="${escapeHtml(page)}" data-fixture-state="${escapeHtml(fixtureState)}" id="syncbay-ui-root">${markup}</div>
${hydrationScripts}
</body>
</html>`;

  if (checkMode) {
    if (markup.trim().length === 0) {
      throw new Error(`Il render ${page} non ha prodotto markup.`);
    }
    console.error(`ok check: ${page}`);
    console.log(`checked:${page}:${fixtureState}`);
  } else {
  const suffix = fixtureMode
    ? fixtureState === "healthy"
      ? "fixture"
      : `fixture-${fixtureState}`
    : "live";
  const shotsDir = join(root, "preview/shots");
  mkdirSync(shotsDir, { recursive: true });
  const outPath = join(shotsDir, `${page}-${suffix}.html`);
  writeFileSync(outPath, html);
  console.error(`ok html: ${outPath}`);

  // --- 6. Screenshot headless desktop + stretto --------------------------- //
  const CHROME =
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (!hydrateMode && existsSync(CHROME)) {
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
  } else if (!hydrateMode) {
    console.error("Chrome non trovato: salto gli screenshot.");
  }

  console.log(outPath);
  }
} finally {
  await vite.close();
}

function renderFixtureScenario(scenario, state) {
  const action = scenario.actionHref && scenario.actionLabel
    ? `<a data-syncbay-harness-control href="${escapeHtml(scenario.actionHref)}">${escapeHtml(scenario.actionLabel)}</a>`
    : "";

  return `<aside aria-busy="${scenario.ariaBusy}" aria-live="polite" class="preview-note" data-fixture-scenario="${escapeHtml(state)}" role="${scenario.role}"><strong>${escapeHtml(scenario.title)}</strong><span> ${escapeHtml(scenario.detail)}</span>${action}</aside>`;
}

function serializeForHtml(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
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
  // Ripete finche' la stringa non cambia: un solo passaggio puo' lasciare tag
  // ricomposti dalla rimozione (es. `<<b>>` -> `<b>`).
  let current = value;
  let previous = "";

  while (current !== previous) {
    previous = current;
    current = current.replace(/<[^>]*>/g, "");
  }

  return current;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
