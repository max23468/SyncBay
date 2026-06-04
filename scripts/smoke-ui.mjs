import fs from "node:fs";

const checks = [
  {
    file: "app/routes/app.tsx",
    needles: [
      "NavMenu",
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
    needles: ["syncbay-embedded.css?url"],
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
    file: "app/routes/app._index.tsx",
    needles: [
      "Panoramica",
      "Centro operativo",
      "getNextAction",
      "Quantità da verificare",
      "nextAction.title",
      "Dettagli tecnici",
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
      "Origine catalogo: eBay",
    ],
  },
  {
    file: "app/routes/app.conflicts.tsx",
    needles: [
      "Conflitti",
      "getConflictActionLabel",
      "Decisioni aperte",
    ],
  },
  {
    file: "app/routes/app.activity.tsx",
    needles: [
      "Attività",
      "Coda operativa",
      "Timeline",
      "Conflitti",
      "Eventi",
      "Nota operativa",
      "retryJob",
      "Controlli rapidi",
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
      "Pianifica import catalogo",
    ],
  },
  {
    file: "app/routes/app.settings.tsx",
    needles: [
      "Sync catalogo",
      "Import prodotti",
      "Canali di vendita",
      "Avanzate",
      "Salva sync catalogo",
      "Salva stato prodotto default",
      "Salva canali",
      "Collega eBay",
      "Torna alla Panoramica",
    ],
  },
  {
    file: "app/services/shopify-location.server.ts",
    needles: ["locationEdit", "write_locations", "nome location"],
  },
];

const failures = [];

for (const check of checks) {
  const content = fs.readFileSync(check.file, "utf8");
  for (const needle of check.needles) {
    if (!content.includes(needle)) {
      failures.push(`${check.file}: manca "${needle}"`);
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
