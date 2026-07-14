#!/usr/bin/env node
/* global HTMLElement, document, getComputedStyle */

import { spawnSync } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

import { UI_PAGES } from "./syncbay-ui-check.mjs";
import { buildIsolatedUiEnv } from "./syncbay-ui-isolation.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMAGE_FIXTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export const UI_BROWSER_VIEWPORTS = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 768, height: 900 },
  { width: 390, height: 844 },
];

export const UI_BROWSER_SCENARIOS = [
  { page: "panoramica", state: "empty" },
  { page: "panoramica", state: "loading" },
  { page: "panoramica", state: "degraded" },
  { page: "panoramica", state: "error" },
  { page: "importazione", state: "blocked" },
  { page: "importazione", state: "in_progress" },
];

export async function runUiBrowserCheck() {
  const fixtureFiles = renderBrowserFixtures();
  const vite = await createViteServer({
    appType: "custom",
    configFile: join(ROOT, "scripts/vite.ui-render.config.ts"),
    logLevel: "error",
    root: ROOT,
    server: { hmr: false, middlewareMode: true },
  });
  const server = createHarnessServer(vite, fixtureFiles);
  const origin = await listen(server);
  const browser = await chromium.launch({ headless: true });

  try {
    for (const pageName of UI_PAGES) {
      for (const viewport of UI_BROWSER_VIEWPORTS) {
        await verifyPage(browser, origin, {
          pageName,
          state: "healthy",
          viewport,
        });
      }
      await verifyZoom(browser, origin, pageName);
    }

    for (const scenario of UI_BROWSER_SCENARIOS) {
      await verifyPage(browser, origin, {
        pageName: scenario.page,
        state: scenario.state,
        viewport: { width: 1024, height: 900 },
      });
    }

    await verifyReducedMotion(browser, origin);
    await verifyNavigationFocus(browser, origin);
    await verifySubmissionFocus(browser, origin);
    console.log(
      `UI browser verificate: ${UI_PAGES.length} pagine x ${UI_BROWSER_VIEWPORTS.length} viewport, zoom 200%, ${UI_BROWSER_SCENARIOS.length} stati, focus navigazione e submit`,
    );
    return 0;
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
    await vite.close();
  }
}

function renderBrowserFixtures() {
  const scenarios = [
    ...UI_PAGES.map((page) => ({ page, state: "healthy" })),
    ...UI_BROWSER_SCENARIOS,
  ];
  const fixtureFiles = new Map();

  for (const { page, state } of scenarios) {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/syncbay-ui-render.mjs",
        page,
        "--fixture",
        "--hydrate",
        `--state=${state}`,
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: buildIsolatedUiEnv(),
      },
    );
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout);
    }
    if (!/env: fixture isolata; 0 variabili runtime caricate/.test(result.stderr)) {
      throw new Error(`Il render browser ${page}/${state} non è isolato.`);
    }
    fixtureFiles.set(`${page}/${state}`, result.stdout.trim().split("\n").at(-1));
  }

  return fixtureFiles;
}

function createHarnessServer(vite, fixtureFiles) {
  return createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const match = url.pathname.match(/^\/__syncbay-ui__\/([^/]+)\/([^/]+)$/);
    if (!match) {
      vite.middlewares(request, response);
      return;
    }

    const fixturePath = fixtureFiles.get(`${match[1]}/${match[2]}`);
    if (!fixturePath) {
      response.writeHead(404).end("Fixture non trovata.");
      return;
    }

    try {
      const html = await vite.transformIndexHtml(
        url.pathname,
        readFileSync(resolve(ROOT, fixturePath), "utf8"),
      );
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
      });
      response.end(html);
    } catch (error) {
      response.writeHead(500).end(
        error instanceof Error ? error.message : "Trasformazione Vite fallita.",
      );
    }
  });
}

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Porta browser fixture non disponibile.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function verifyPage(browser, origin, input) {
  const context = await browser.newContext({ viewport: input.viewport });
  const page = await context.newPage();
  const problems = [];
  installBrowserObservers(page, origin, problems);

  try {
    await page.goto(`${origin}/__syncbay-ui__/${input.pageName}/${input.state}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () => document.querySelector("#syncbay-ui-root")?.dataset.hydrated === "true",
    );
    problems.push(...(await inspectRenderedPage(page, input)));
    problems.push(...(await verifyKeyboardAndFocus(page)));
    if (problems.length > 0) {
      throw new Error(
        `${input.pageName}/${input.state} ${input.viewport.width}px: ${problems.join("; ")}`,
      );
    }
  } finally {
    await context.close();
  }
}

function installBrowserObservers(page, origin, problems) {
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      problems.push(`console ${message.type()}: ${message.text()}`);
    }
  });
  page.route("**/*", (route) => {
    const requestUrl = route.request().url();
    if (
      requestUrl.startsWith(origin) ||
      requestUrl.startsWith("data:") ||
      requestUrl.startsWith("blob:")
    ) {
      return route.continue();
    }
    if (route.request().resourceType() === "image") {
      return route.fulfill({ body: IMAGE_FIXTURE, contentType: "image/png" });
    }
    problems.push(`rete esterna bloccata: ${new URL(requestUrl).origin}`);
    return route.abort();
  });
}

async function inspectRenderedPage(page, input) {
  return page.evaluate(({ pageName, state, viewport }) => {
    const problems = [];
    const root = document.querySelector("#syncbay-ui-root");
    const scenario = document.querySelector("[data-fixture-scenario]");
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
    };

    if (!document.title.includes(pageName)) problems.push("titolo pagina errato");
    if (!root || (root.textContent?.trim().length ?? 0) < 80) {
      problems.push("pagina vuota o incompleta");
    }
    if (document.querySelector("vite-error-overlay, react-error-overlay")) {
      problems.push("overlay framework visibile");
    }
    if (!scenario?.hasAttribute("aria-live")) problems.push("aria-live assente");
    if (!scenario?.hasAttribute("aria-busy")) problems.push("aria-busy assente");
    if (scenario?.getAttribute("data-fixture-scenario") !== state) {
      problems.push("scenario fixture non coerente");
    }

    const controlSelector = [
      "a[href]",
      "button",
      "input:not([type=hidden])",
      "select",
      "textarea",
      "[data-syncbay-harness-control]",
    ].join(",");
    for (const control of document.querySelectorAll(controlSelector)) {
      if (!visible(control)) continue;
      const name =
        control.getAttribute("aria-label") ??
        control.getAttribute("label") ??
        control.textContent?.trim() ??
        control.getAttribute("title");
      if (!name) problems.push(`controllo senza nome: ${control.tagName}`);
    }

    for (const badge of document.querySelectorAll("s-badge,[role=status],[role=alert]")) {
      if (visible(badge) && !(badge.textContent?.trim() || badge.getAttribute("aria-label"))) {
        problems.push(`stato senza testo: ${badge.tagName}`);
      }
    }

    const balancedGrids = [...document.querySelectorAll(".syncbay-balanced-box-grid > s-grid")];
    if (state === "healthy" && balancedGrids.length === 0) {
      problems.push("griglia bilanciata assente");
    }
    for (const grid of balancedGrids) {
      const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
      const compact = grid.parentElement?.classList.contains("syncbay-balanced-box-grid--compact-three");
      const expected = viewport.width <= 640 ? 1 : compact && viewport.width >= 1100 ? 3 : 2;
      if (columns !== expected) problems.push(`griglia ${compact ? "compatta" : "standard"}: ${columns} colonne invece di ${expected}`);
      const children = [...grid.children];
      if (viewport.width > 640 && children.length % 2 === 1 && !(compact && viewport.width >= 1100)) {
        const gridWidth = grid.getBoundingClientRect().width;
        const lastWidth = children.at(-1)?.getBoundingClientRect().width ?? 0;
        if (lastWidth < gridWidth * 0.9) problems.push("ultimo box dispari non esteso a tutta riga");
      }
    }

    if (
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1
    ) {
      const viewportWidth = document.documentElement.clientWidth;
      const offender = [...document.querySelectorAll("body *")].find(
        (element) => element.getBoundingClientRect().right > viewportWidth + 1,
      );
      problems.push(
        `overflow dell’intero documento${
          offender
            ? ` da ${offender.tagName.toLowerCase()}.${offender.className || "senza-classe"}`
            : ""
        }`,
      );
    }
    for (const element of document.querySelectorAll(".syncbay-table-wrap,.syncbay-filter-scroll,.syncbay-pulse")) {
      if (element.scrollWidth <= element.clientWidth + 1) continue;
      const overflow = getComputedStyle(element).overflowX;
      if (overflow !== "auto" && overflow !== "scroll") {
        problems.push(`overflow non dichiarato: ${element.className}`);
      }
    }

    return problems;
  }, input);
}

async function verifyKeyboardAndFocus(page) {
  const problems = [];
  const seen = new Set();
  const focusableCount = await page.evaluate(() =>
    [...document.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,[tabindex="0"]')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
      }).length,
  );
  if (focusableCount === 0) return ["nessun controllo raggiungibile da tastiera"];
  await page.locator("body").click({ position: { x: 1, y: 1 } });

  for (let index = 0; index < Math.min(8, focusableCount); index += 1) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement) || element === document.body) return null;
      const style = getComputedStyle(element);
      return {
        key: String([...document.querySelectorAll("*")].indexOf(element)),
        visible:
          style.outlineStyle !== "none" ||
          (style.boxShadow !== "none" && style.boxShadow !== ""),
      };
    });
    if (!focus) {
      problems.push("ordine tastiera interrotto");
      break;
    }
    if (seen.has(focus.key)) {
      problems.push("focus intrappolato o ripetuto");
      break;
    }
    if (!focus.visible) problems.push(`focus invisibile: ${focus.key}`);
    seen.add(focus.key);
  }

  return problems;
}

async function verifyZoom(browser, origin, pageName) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const problems = [];
  installBrowserObservers(page, origin, problems);
  try {
    await page.goto(`${origin}/__syncbay-ui__/${pageName}/healthy`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () => document.querySelector("#syncbay-ui-root")?.dataset.hydrated === "true",
    );
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    if (
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth + 1,
      )
    ) {
      problems.push("overflow documento con zoom 200%");
    }
    if (problems.length > 0) {
      throw new Error(`${pageName} zoom 200%: ${problems.join("; ")}`);
    }
  } finally {
    await context.close();
  }
}

async function verifyReducedMotion(browser, origin) {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1024, height: 900 },
  });
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/__syncbay-ui__/panoramica/healthy`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () => document.querySelector("#syncbay-ui-root")?.dataset.hydrated === "true",
    );
    const animated = await page.evaluate(() =>
      [...document.querySelectorAll("*")].flatMap((element) => {
        const style = getComputedStyle(element);
        return style.animationName !== "none" && style.animationDuration !== "0s"
          ? [`${element.tagName.toLowerCase()}.${element.className || "-"}:${style.animationName}`]
          : [];
      }),
    );
    if (animated.length > 0) {
      throw new Error(
        `prefers-reduced-motion: animazioni ancora attive (${animated.join(", ")}).`,
      );
    }
  } finally {
    await context.close();
  }
}

async function verifyNavigationFocus(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/__syncbay-ui__/panoramica/healthy`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () => document.querySelector("#syncbay-ui-root")?.dataset.hydrated === "true",
    );
    await page.getByRole("link", { name: "Rivedi", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector("[data-syncbay-route-content]")?.getAttribute("aria-busy") === "true",
    );
    await page.waitForFunction(
      () =>
        document.activeElement ===
          document.querySelector("[data-syncbay-route-content]") &&
        document.querySelector("[data-syncbay-route-content]")?.getAttribute("aria-busy") === "false",
    );
  } finally {
    await context.close();
  }
}

async function verifySubmissionFocus(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/__syncbay-ui__/impostazioni/healthy`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () => document.querySelector("#syncbay-ui-root")?.dataset.hydrated === "true",
    );
    await page.getByRole("button", { name: "Salva intervallo", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector("[data-syncbay-route-content]")?.getAttribute("aria-busy") === "true",
    );
    await page.waitForFunction(
      () =>
        document.activeElement ===
          document.querySelector("[data-syncbay-route-content]") &&
        document.querySelector("[data-syncbay-route-content]")?.getAttribute("aria-busy") === "false",
    );
  } finally {
    await context.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await runUiBrowserCheck());
}
