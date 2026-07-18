#!/usr/bin/env node

// Smoke del deployment Vercel Production. Il deployment e' privato e protetto
// da Vercel SSO: senza bypass una richiesta anonima riceve 302 verso
// vercel.com/sso-api e lo smoke misurerebbe la protezione, non l'app.
//
// Il bypass usa l'header `x-vercel-protection-bypass` con il valore di
// VERCEL_AUTOMATION_BYPASS_SECRET (Vercel: Project Settings > Deployment
// Protection > Protection Bypass for Automation). Il segreto non viene mai
// stampato.

import { parseArgs as parseNodeArgs } from "node:util";

const DEFAULT_BASE_URL = "https://syncbay-matteos-projects-9226d217.vercel.app";
const REQUEST_TIMEOUT_MS = 20_000;

// `/app` e' embedded: a una richiesta anonima Shopify risponde con il proprio
// boundary di autenticazione, non con la dashboard. Verificato 410 sia sul
// deploy corrente sia sul precedente; accettiamo l'insieme degli stati di
// boundary perche' la libreria Shopify puo' cambiarlo, mentre un 200 (rotta
// esposta senza sessione) o un 5xx restano fallimenti veri.
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

export async function checkRoute({ baseUrl, check, secret }) {
  try {
    const response = await fetch(new URL(check.path, baseUrl), {
      headers: secret ? { "x-vercel-protection-bypass": secret } : {},
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

export async function runProductionSmoke({ baseUrl, secret }) {
  const results = [];

  for (const check of PRODUCTION_SMOKE_CHECKS) {
    const result = await checkRoute({ baseUrl, check, secret });
    results.push(result);
    console.log(formatSmokeResult(result));
  }

  return evaluateSmokeResults(results);
}

async function runCli(args) {
  const baseUrl =
    args.baseUrl || process.env.SYNCBAY_SMOKE_BASE_URL || DEFAULT_BASE_URL;
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();

  console.log(`Smoke production SyncBay: ${baseUrl}`);
  console.log(
    `Bypass protezione Vercel: ${secret ? "configurato" : "assente"}`,
  );

  if (!secret) {
    // Senza segreto ogni rotta risponderebbe con il redirect SSO: uno smoke che
    // "passa" cosi' sarebbe una falsa conferma, quindi non si esegue mai.
    const message =
      "VERCEL_AUTOMATION_BYPASS_SECRET non impostata: senza bypass lo smoke " +
      "misurerebbe la protezione Vercel e non l'app. Genera il segreto in " +
      "Vercel (Project Settings > Deployment Protection > Protection Bypass " +
      "for Automation) ed esportalo nell'ambiente.";

    // In `publish:complete` lo smoke gira dopo merge, tag e release: li' un
    // exit 1 lascerebbe una pubblicazione gia' irreversibile a meta'. Meglio
    // dichiarare forte la verifica mancante e lasciare chiudere il flusso.
    if (args.warnIfUnconfigured) {
      console.warn(`SMOKE PRODUCTION NON ESEGUITO. ${message}`);
      return;
    }

    throw new Error(message);
  }

  const { failures, ok } = await runProductionSmoke({ baseUrl, secret });

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
    options: {
      "base-url": { type: "string" },
      "warn-if-unconfigured": { type: "boolean" },
    },
  });

  return {
    baseUrl: values["base-url"],
    warnIfUnconfigured: Boolean(values["warn-if-unconfigured"]),
  };
}

if (import.meta.main) {
  try {
    await runCli(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
