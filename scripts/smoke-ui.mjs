import fs from "node:fs";

const checks = [
  {
    file: "app/routes/app._index.tsx",
    needles: ["Stato connessioni", "Apri preview import", "Scope Shopify"],
  },
  {
    file: "app/routes/app.import-preview.tsx",
    needles: [
      "Preview mock pronta",
      "Preview live pronta",
      "Rinomina location",
      "Fasi Shopify",
      "Crea bozze da preview",
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

console.log("Smoke UI passato: dashboard, preview import e gestione location presenti.");
