import fs from "node:fs";

const checks = [
  {
    file: "app/lib/syncbay-brand.ts",
    needles: [
      "SyncBay",
      "Dal tuo negozio eBay a Shopify, pronto a vendere.",
      "/syncbay-logo-horizontal.png",
      "getSyncBayPageTitle",
    ],
  },
  {
    file: "app/components/SyncBayBrandPanel.tsx",
    needles: [
      "SYNCBAY_BRAND_ASSETS.logoHorizontal",
      "SYNCBAY_TAGLINE",
      "<s-image",
      "1.0 privata",
    ],
  },
  {
    file: "app/routes/app.tsx",
    needles: [
      "NavMenu",
      "TitleBar",
      "SYNCBAY_APP_NAME",
      "useNavigation",
      "RoutePendingIndicator",
      "syncbay-route-pending__surface",
      'aria-busy={isRoutePending}',
      'aria-live="polite"',
      "Apro Catalogo",
      "Apro Conflitti",
      "Apro Importazione",
      "Apro Attività",
      "Apro Impostazioni",
      "Apro Panoramica",
      "Panoramica",
      "Catalogo",
      "Conflitti",
      "Importazione",
      "Attività",
      "Impostazioni",
    ],
  },
  {
    file: "app/root.tsx",
    needles: [
      "getSyncBayMeta",
      "syncbay-embedded.css?url",
      "SYNCBAY_BRAND_ASSETS.faviconIco",
      "SYNCBAY_BRAND_ASSETS.appleTouchIcon",
    ],
  },
  {
    file: "app/lib/syncbay-ui-state.ts",
    needles: [
      "Collegamento eBay mancante o scaduto",
      "Quantità da verificare",
      "Conflitti aperti",
      "Aggiornamento catalogo in ritardo",
      "Importazione incompleta",
      "Impostazioni mancanti",
      "Tutto sotto controllo",
      "Usa valore eBay",
      "Mantieni Shopify",
      "Ignora campo",
    ],
  },
  {
    file: "app/lib/syncbay-conflict-actions.ts",
    needles: [
      "Sicuro",
      "Da rivedere",
      "Da decidere",
      "getSafeBatchConflictResolutions",
    ],
  },
  {
    file: "app/lib/syncbay-job-diagnostics.ts",
    needles: [
      "Disponibilità eBay non aggiornata",
      "Attendi eBay",
      "cooldown",
    ],
  },
  {
    file: "app/routes/app._index.tsx",
    needles: [
      "Panoramica",
      "getNextAction",
      "isOverviewSyncWorking",
      "shouldShowOverviewStatusHero",
      "StatusHero",
      "RiskLens",
      "SyncPulse",
      "MetricTile",
      "Da eBay a Shopify",
      "Cosa fare adesso",
      "Attività recente",
      "Benvenuto in SyncBay",
      "slot=\"accessory\"",
    ],
  },
  {
    file: "app/routes/app.catalog.tsx",
    needles: [
      "Catalogo",
      "Prodotto",
      "Collegamento",
      "Disponibilità",
      "Stato",
      "MetricTile",
      "Controllo catalogo",
      "CatalogViewControls",
      "getEbayItemUrl",
      "getShopifyProductAdminUrl",
      "Dettagli",
      "Riprova",
    ],
  },
  {
    file: "scripts/syncbay-ui-render.mjs",
    needles: [
      "--fixture",
      "getCatalogFixture",
      "getDashboardFixture",
      "catalogo",
    ],
  },
  {
    file: "app/routes/app.conflicts.tsx",
    needles: [
      "Conflitti",
      "getConflictActionLabel",
      "Sicuri",
      "Decisioni da prendere",
      "CONFLICT_RESOLUTIONS.map",
      "alignItems=\"start\"",
      "senza il tuo via libera",
    ],
  },
  {
    file: "app/routes/app.activity.tsx",
    needles: [
      "Attività",
      "In coda",
      "Timeline",
      "Conflitti",
      "Eventi",
      "Nota operativa",
      "getSyncJobDiagnostic",
      "retryJob",
      "Controlli rapidi",
      "MetricTile",
      "TimelineEvent",
      "syncbay-timeline",
    ],
  },
  {
    file: "app/routes/app.import-preview.tsx",
    needles: [
      "Importazione",
      "Collegamento eBay",
      "Preparazione Shopify",
      "Anteprima catalogo",
      "Dopo l'import",
      "Pronti da importare",
      "Da reimportare",
      "Modifica impostazioni",
      "Vai al catalogo",
      "Rinomina location",
      "Anteprima prima",
      "Avvia import catalogo",
      "syncbay-stepper",
    ],
  },
  {
    file: "app/routes/app.settings.tsx",
    needles: [
      "Sync catalogo",
      "Import prodotti",
      "Canali di vendita",
      "Regola prezzo",
      "Salva sync catalogo",
      "Salva stato prodotto default",
      "Salva canali",
      "Collega eBay",
      "Collegamenti e diagnostica",
      "Apri dettagli tecnici",
      "SettingCard",
      "MetricTile",
      "Intervallo target",
      "Ultimo aggiornamento",
      "Disattiva sync automatico",
      "Scollega account eBay",
      "disconnectEbay",
      "saveSyncTarget",
    ],
  },
  {
    file: "app/services/shopify-location.server.ts",
    needles: ["locationEdit", "write_locations", "nome location"],
  },
  {
    file: "scripts/syncbay-repair-description-conflicts.mjs",
    needles: [
      "latest_description_syncbay",
      "current_field_baselines",
      "updatedEbayFromShopifyOrder",
      "restoredEbayAfterTest",
    ],
  },
];

const publicFiles = [
  "public/apple-touch-icon.png",
  "public/favicon.ico",
  "public/syncbay-icon-192.png",
  "public/syncbay-logo-horizontal.png",
];

const forbiddenChecks = [
  {
    file: "app/routes/app.tsx",
    needles: [
      "SYNCBAY_BRAND_ASSETS",
      "logoHorizontal",
      "syncbay-app-brand",
      "syncbay-app-shell",
    ],
  },
  {
    file: "app/styles/syncbay-embedded.css",
    needles: ["syncbay-app-brand", "syncbay-app-shell"],
  },
];

const navMenuContent = fs.existsSync("app/routes/app.tsx")
  ? fs.readFileSync("app/routes/app.tsx", "utf8")
  : "";

const visibleOverviewLink = /<(?:a|Link)\s+(?:href|to)="\/app">\s*Panoramica\s*<\/(?:a|Link)>/.test(
  navMenuContent,
);

const hiddenHomeLink = /<(?:a|Link)\s+(?:href|to)="\/app"\s+rel="home">\s*\{SYNCBAY_APP_NAME\}\s*<\/(?:a|Link)>/.test(
  navMenuContent,
);

const failures = [];

for (const file of publicFiles) {
  if (!fs.existsSync(file)) {
    failures.push(`${file}: file pubblico brand mancante`);
  }
}

if (!hiddenHomeLink) {
  failures.push(
    'app/routes/app.tsx: manca il link home tecnico nascosto href="/app" rel="home"',
  );
}

if (!visibleOverviewLink) {
  failures.push(
    'app/routes/app.tsx: manca la voce menu visibile href="/app">Panoramica</a>',
  );
}

for (const check of checks) {
  if (!fs.existsSync(check.file)) {
    failures.push(`${check.file}: file mancante`);
    continue;
  }

  const content = fs.readFileSync(check.file, "utf8");
  for (const needle of check.needles) {
    if (!content.includes(needle)) {
      failures.push(`${check.file}: manca "${needle}"`);
    }
  }
}

for (const check of forbiddenChecks) {
  if (!fs.existsSync(check.file)) {
    failures.push(`${check.file}: file mancante`);
    continue;
  }

  const content = fs.readFileSync(check.file, "utf8");
  for (const needle of check.needles) {
    if (content.includes(needle)) {
      failures.push(`${check.file}: non deve contenere "${needle}"`);
    }
  }
}

if (failures.length > 0) {
  console.error("Smoke UI fallito:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  "Smoke UI passato: nav, Panoramica, Catalogo, Conflitti, Attività, Importazione, Impostazioni e gestione location presenti.",
);
