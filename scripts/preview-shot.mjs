#!/usr/bin/env node
/*
 * Screenshot headless delle anteprime locali in `preview/`.
 *
 * Ambiente di test visivo locale per il design layer SyncBay senza il runtime
 * Shopify (che esiste solo dentro Admin embedded). Renderizza gli HTML di
 * preview con Chrome headless a più larghezze e salva i PNG in
 * `preview/shots/`. Approssimazione: i componenti `s-*` sono stand-in neutri.
 *
 * Uso:
 *   node scripts/preview-shot.mjs                 # tutte le pagine in preview/
 *   node scripts/preview-shot.mjs panoramica      # solo panoramica.html
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const previewDir = join(root, "preview");
const shotsDir = join(previewDir, "shots");

const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const VIEWPORTS = [
  { height: 2400, label: "desktop", width: 1280 },
  { height: 2600, label: "narrow", width: 390 },
];

if (!existsSync(CHROME)) {
  console.error(`Chrome non trovato in: ${CHROME}`);
  process.exit(1);
}

mkdirSync(shotsDir, { recursive: true });

const filter = process.argv[2];
const pages = readdirSync(previewDir)
  .filter((file) => file.endsWith(".html"))
  .filter((file) => !filter || file.startsWith(filter));

if (pages.length === 0) {
  console.error("Nessuna pagina di preview trovata.");
  process.exit(1);
}

for (const page of pages) {
  const name = page.replace(/\.html$/, "");
  const url = `file://${join(previewDir, page)}`;

  for (const viewport of VIEWPORTS) {
    const out = join(shotsDir, `${name}-${viewport.label}.png`);

    execFileSync(
      CHROME,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=2",
        `--window-size=${viewport.width},${viewport.height}`,
        `--screenshot=${out}`,
        url,
      ],
      { stdio: "ignore" },
    );

    console.log(`ok  ${name} ${viewport.label}  -> ${out}`);
  }
}
