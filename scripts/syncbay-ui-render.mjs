#!/usr/bin/env node
/*
 * Render headless di una superficie embedded SyncBay con DATI REALI dello shop
 * collegato, senza Shopify Admin e senza browser autenticato.
 *
 * Come: carica l'env di runtime, esegue il componente di route REALE via Vite
 * SSR + React Router static handler, alimentato dai loader reali (`getDashboardState`,
 * ecc.) letti dalla sessione offline nel database. La chrome dei componenti
 * Polaris `s-*` è simulata (esistono solo dentro Admin embedded: verificato a
 * livello di app-bridge.js, che li registra solo dopo l'handshake col frame
 * Admin). Reali qui: dati, componente di route, design layer SyncBay.
 *
 * Uso:
 *   node scripts/syncbay-ui-render.mjs panoramica
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

const page = process.argv[2] || "panoramica";

const PAGES = {
  panoramica: {
    module: "/app/routes/app._index.tsx",
    path: "/app",
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
  // --- 3. Dati reali dal loader vero ------------------------------------- //
  const session = await loadSession();
  console.error(`sessione: shop ${session.shop}`);
  const routeMod = await vite.ssrLoadModule(pageConfig.module);
  const data = await pageConfig.loader(routeMod, session);
  console.error("dati: loader reale eseguito");

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
<p class="preview-note">Render con DATI REALI dello shop ${session.shop} · componente di route reale · chrome Polaris simulata.</p>
<div class="preview-frame">${markup}</div>
</body>
</html>`;

  const outPath = join(root, `preview/shots/${page}-live.html`);
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
      const png = join(root, `preview/shots/${page}-live-${shot.label}.png`);
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
