#!/usr/bin/env node
/*
 * Screenshot live di una superficie embedded SyncBay dentro Shopify Admin, via
 * Playwright, con sessione persistente in un profilo dedicato.
 *
 * Primo avvio: si apre una finestra Chromium. Fai il login a Shopify (email +
 * eventuale captcha + 2FA) fino a vedere SyncBay. La sessione resta salvata in
 * `.shopify-pw-profile` (gitignorato): le esecuzioni successive caricano
 * direttamente, anche headless (HEADLESS=1).
 *
 * Uso:
 *   SHOPIFY_DEV_STORE_HANDLE=<shop-handle> node scripts/syncbay-ui-shot-live.mjs
 *   SHOPIFY_DEV_STORE_HANDLE=<shop-handle> node scripts/syncbay-ui-shot-live.mjs Catalogo
 *   SHOPIFY_DEV_STORE_HANDLE=<shop-handle> HEADLESS=1 node scripts/syncbay-ui-shot-live.mjs Conflitti conflitti
 */

import { dirname, join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STORE = process.env.SHOPIFY_DEV_STORE_HANDLE?.trim();
const APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || "syncbay";

if (!STORE) {
  throw new Error(
    "Configura SHOPIFY_DEV_STORE_HANDLE prima di aprire Shopify Admin.",
  );
}

const navLabel = process.argv[2] || ""; // es. "Catalogo"; vuoto = Panoramica
const name = (process.argv[3] || navLabel || "panoramica").replace(
  /[^a-z0-9]+/gi,
  "-",
);
const baseUrl = `https://admin.shopify.com/store/${STORE}/apps/${APP_HANDLE}/app`;

const profileDir = join(root, ".shopify-pw-profile");
const shotsDir = join(root, "preview/shots");
const outPath = join(shotsDir, `${name}-real.png`);
const loginDeadlineMs = Number(process.env.LOGIN_WAIT_MS || 540000); // 9 min

mkdirSync(shotsDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
  headless: process.env.HEADLESS === "1",
  viewport: { width: 1440, height: 1100 },
});

async function findAppFrameSrc(page) {
  const srcs = await page.$$eval("iframe", (frames) =>
    frames.map((f) => f.getAttribute("src") || ""),
  );
  return (
    srcs.find((s) => /trycloudflare\.com|vercel\.app|syncbay/i.test(s)) || null
  );
}

try {
  const page = context.pages()[0] ?? (await context.newPage());

  console.error(`apro: ${baseUrl}`);
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch (error) {
    console.error(`goto non completato (continuo): ${error.message}`);
  }

  console.error(
    "SE compare il login Shopify, accedi ora nella finestra (email + captcha + 2FA). Attendo fino a 9 minuti. NON chiudere la finestra.",
  );

  const deadline = Date.now() + loginDeadlineMs;
  let appFrameSrc = null;
  while (Date.now() < deadline) {
    appFrameSrc = await findAppFrameSrc(page);
    if (appFrameSrc) {
      console.error(`app embedded trovata: ${appFrameSrc.slice(0, 70)}`);
      break;
    }
    console.error(`attendo login... url=${page.url().slice(0, 55)}`);
    await page.waitForTimeout(5000);
  }
  if (!appFrameSrc) throw new Error("App non raggiunta entro il tempo limite.");

  await page.waitForTimeout(6000);

  // Naviga alla sotto-pagina cliccando la voce di menu, se richiesta.
  if (navLabel && !/panoramica/i.test(navLabel)) {
    try {
      await page
        .getByRole("link", { name: navLabel, exact: true })
        .first()
        .click({ timeout: 15000 });
      console.error(`clic su voce nav: ${navLabel}`);
      await page.waitForTimeout(6000);
    } catch (error) {
      console.error(`nav "${navLabel}" non cliccabile: ${error.message}`);
    }
  }

  await page.screenshot({ path: outPath, fullPage: true });
  console.error(`ok (full page): ${outPath}`);

  const finalSrc = await findAppFrameSrc(page);
  if (finalSrc) {
    try {
      const handle = await page
        .locator(`iframe[src="${finalSrc}"]`)
        .first()
        .elementHandle();
      if (handle) {
        const framePath = outPath.replace(/\.png$/, "-frame.png");
        await handle.screenshot({ path: framePath });
        console.error(`ok (frame): ${framePath}`);
      }
    } catch (error) {
      console.error(`screenshot iframe non riuscito: ${error.message}`);
    }
  }

  console.log(outPath);
} finally {
  await context.close();
}
