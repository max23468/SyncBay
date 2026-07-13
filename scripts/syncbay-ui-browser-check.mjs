#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";
import { UI_PAGES } from "./syncbay-ui-check.mjs";

const viewports = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 768, height: 900 },
  { width: 390, height: 844 },
];
const browser = await chromium.launch({ headless: true });

try {
  for (const pageName of UI_PAGES) {
    const render = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/syncbay-ui-render.mjs", pageName, "--fixture"],
      { encoding: "utf8" },
    );
    if (render.status !== 0) throw new Error(render.stderr || render.stdout);
    const url = pathToFileURL(resolve(`preview/shots/${pageName}-fixture.html`)).href;

    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" || /hydration/i.test(message.text())) errors.push(message.text());
      });
      await page.route("**/*", (route) => {
        const requestUrl = route.request().url();
        if (requestUrl.startsWith("file:") || requestUrl.startsWith("data:")) {
          return route.continue();
        }
        if (route.request().resourceType() === "image") {
          return route.fulfill({
            body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
            contentType: "image/png",
          });
        }
        return route.abort();
      });
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const documentOverflow = await page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1");
      if (documentOverflow) errors.push(`overflow documento a ${viewport.width}px`);
      if (errors.length > 0) throw new Error(`${pageName} ${viewport.width}px: ${errors.join("; ")}`);
      await context.close();
    }
  }
  console.log(`UI browser verificate: ${UI_PAGES.length} pagine x ${viewports.length} viewport`);
} finally {
  await browser.close();
}
