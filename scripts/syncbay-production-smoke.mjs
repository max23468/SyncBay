#!/usr/bin/env node

// Smoke del deployment Vercel Production.
//
// Il target e' il dominio canonico dichiarato in `shopify.app.toml`
// (`application_url` e `redirect_urls`): e' l'endpoint che Shopify ed eBay
// chiamano davvero. L'alias di progetto `syncbay-<team>.vercel.app` e' invece
// protetto da Vercel SSO e risponderebbe 302 verso la pagina di login, quindi
// non e' un bersaglio valido per lo smoke.

import { parseArgs as parseNodeArgs } from "node:util";

const DEFAULT_BASE_URL = "https://syncbay.vercel.app";
const REQUEST_TIMEOUT_MS = 20_000;

// `/app` e' embedded: a una richiesta anonima Shopify risponde con il proprio
// boundary di autenticazione, non con la dashboard. Verificato 410 sia sul
// deploy corrente sia sul precedente; accettiamo l'insieme degli stati di
// boundary perche' la libreria Shopify puo' cambiarlo, mentre un 200 (rotta
// embedded esposta senza sessione) o un 5xx restano fallimenti veri.
const AUTH_BOUNDARY_STATUSES = [302, 401, 403, 410];

export const PRODUCTION_SMOKE_CHECKS = [
  { expected: [200], label: "landing", path: "/" },
  { expected: [200], label: "informazioni", path: "/about" },
  { expected: [200], label: "privacy", path: "/privacy" },
  { expected: [200], label: "termini", path: "/terms" },
  { expected: [200], label: "accesso negoziante", path: "/auth/login" },
  {
    expected: AUTH_BOUNDARY_STATUSES,
    label: "dashboard embedded (boundary auth)",
    path: "/app",
  },
];

export function evaluateSmokeResults(results) {
  const failures = results.filter((result) => !result.ok);

  return { failures, ok: failures.length === 0 };
}

export function formatSmokeResult(result) {
  const status = result.error ? `errore: ${result.error}` : result.status;

  return `${result.ok ? "ok" : "FALLITO"} ${result.label} (${result.path}) -> ${status}`;
}

export async function checkRoute({ baseUrl, check }) {
  try {
    const response = await fetch(new URL(check.path, baseUrl), {
      // Senza `manual` un redirect verso una pagina di login o di errore
      // verrebbe seguito e lo smoke leggerebbe 200 al posto dello stato reale.
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    return {
      ...check,
      ok: check.expected.includes(response.status),
      status: response.status,
    };
  } catch (error) {
    return {
      ...check,
      error: error instanceof Error ? error.message : String(error),
      ok: false,
      status: null,
    };
  }
}

export async function runProductionSmoke({ baseUrl }) {
  const results = [];

  for (const check of PRODUCTION_SMOKE_CHECKS) {
    const result = await checkRoute({ baseUrl, check });
    results.push(result);
    console.log(formatSmokeResult(result));
  }

  return evaluateSmokeResults(results);
}

async function runCli(args) {
  const baseUrl =
    args.baseUrl || process.env.SYNCBAY_SMOKE_BASE_URL || DEFAULT_BASE_URL;

  console.log(`Smoke production SyncBay: ${baseUrl}`);

  const { failures, ok } = await runProductionSmoke({ baseUrl });

  if (!ok) {
    throw new Error(
      `Smoke production fallito su ${failures.length} rotta/e: ` +
        `${failures.map((failure) => failure.path).join(", ")}.`,
    );
  }

  console.log("Smoke production superato.");
}

function parseArgs(rawArgs) {
  const { values } = parseNodeArgs({
    args: rawArgs,
    options: { "base-url": { type: "string" } },
  });

  return { baseUrl: values["base-url"] };
}

if (import.meta.main) {
  try {
    await runCli(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
