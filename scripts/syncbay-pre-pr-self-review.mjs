#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE = "origin/main";

const GENERAL_REVIEW_QUESTIONS = [
  "La diagnosi è provata nel codice o nei test, oppure sto seguendo un'ipotesi non verificata?",
  "Qual è il root cause reale e quale parte del diff lo corregge direttamente?",
  "Qual è il fix minimo corretto? Il diff contiene refactor o scope extra non necessari?",
  "Cosa può rompersi per utenti, job, provider, dati o pubblicazione se questa modifica entra in main?",
  "I test o i check proposti coprono il comportamento rotto, non solo il percorso felice?",
];

const AREA_DEFINITIONS = [
  {
    id: "catalogo_esistente",
    label: "Catalogo esistente / takeover",
    match: (path) =>
      /existing-catalog|takeover|import-preview|draft-import|product-matching|matching/i.test(
        path,
      ),
    questions: [
      "Il diff impedisce duplicati Shopify anche con guardrail server-side, non solo disabilitando la UI?",
      "Se c'è reuse/takeover, preserva prodotto e variante Shopify già selezionati invece di ricadere su candidati generici?",
      "Preview, matching e loader hanno limiti espliciti per evitare query o payload sproporzionati?",
    ],
    checks: ["npm run test:lib", "npm run typecheck", "npm run lint"],
    risk: "alto",
  },
  {
    id: "conflitti",
    label: "Conflitti Shopify",
    match: (path) => /conflict|conflitt/i.test(path),
    questions: [
      "Le modifiche manuali Shopify restano conflitti visibili e non vengono sovrascritte silenziosamente?",
      "Gli errori inattesi emergono come blocchi reali invece di essere trattati come stale o successo parziale?",
    ],
    checks: ["npm run conflicts:doctor -- --shop syncbay-dev.myshopify.com"],
    risk: "alto",
  },
  {
    id: "shopify",
    label: "Shopify Admin / inventario",
    match: (path) => /shopify|inventory|publication|product/i.test(path),
    questions: [
      "Le mutation Shopify rispettano product status, inventory item, media, pubblicazioni e location senza inventare dati mancanti?",
      "La UI e il backend concordano su mode, intent, conferme e guardrail critici?",
    ],
    checks: ["npm run typecheck", "npm run lint", "npm run build"],
    risk: "alto",
  },
  {
    id: "ebay",
    label: "eBay / sorgente catalogo",
    match: (path) => /ebay|trading|inventory-api|stock/i.test(path),
    questions: [
      "eBay resta sorgente di verità del catalogo e Shopify aggiorna eBay solo per disponibilità derivata da ordini?",
      "Rate limit, token, marketplace e assenza di campi API sono gestiti esplicitamente?",
    ],
    checks: ["npm run test:stock-guard"],
    risk: "alto",
  },
  {
    id: "database",
    label: "Prisma / Supabase / dati",
    match: (path) =>
      /^prisma\//.test(path) ||
      /migration|supabase|database|schema\.prisma|queue|snapshot/i.test(path),
    questions: [
      "La modifica è compatibile con i dati già presenti e con le migration remote?",
      "Il diff evita query larghe, payload inutili e letture di dati sensibili non necessari?",
    ],
    checks: ["npm run prisma:validate", "npm run db:verify"],
    risk: "alto",
  },
  {
    id: "ui_embedded",
    label: "UI embedded",
    match: (path) =>
      /^app\/routes\/.*\.(tsx|ts)$/.test(path) ||
      /^app\/styles\//.test(path) ||
      /\.(tsx|jsx|css)$/.test(path),
    questions: [
      "La UI usa primitive Shopify `s-*` quando disponibili e non introduce shell o CSS custom non necessari?",
      "Microcopy, stati vuoti, errori e azioni successive sono in italiano operativo e coerenti con BRAND.md?",
      "Il comportamento UI non promette più del backend, soprattutto su import, conflitti e retry?",
    ],
    checks: [
      "npm run typecheck",
      "npm run lint",
      "npm run build",
      "npm run smoke:ui",
      "npm run quality:react-doctor",
    ],
    risk: "medio",
  },
  {
    id: "runtime",
    label: "Runtime applicativo",
    match: (path) =>
      /^app\/(lib|services|routes)\//.test(path),
    questions: [
      "Il path server-side è protetto direttamente, anche se la UI invia input inattesi?",
      "Error handling, retry, idempotenza e logging evitano falsi successi e leak di dati?",
    ],
    checks: ["npm run typecheck", "npm run lint", "npm run build"],
    risk: "medio",
  },
  {
    id: "tooling_ci",
    label: "Tooling / CI / script",
    match: (path) =>
      /^\.github\//.test(path) ||
      /^scripts\//.test(path) ||
      path === "package.json" ||
      path === "package-lock.json",
    questions: [
      "Il comando nuovo è documentato in TOOLCHAIN.md e ha un test mirato se contiene logica?",
      "Workflow o script nuovi non introducono permessi, runtime o release flow fuori dalle ADR approvate?",
    ],
    checks: ["npm run lint", "node --test scripts/*.test.mjs .github/scripts/*.test.mjs"],
    risk: "medio",
  },
  {
    id: "release_governance",
    label: "Release / governance",
    match: (path) =>
      path === "CHANGELOG.md" ||
      path === "app/lib/version.ts" ||
      /versioning|pubblicazione|release|AGENTS\.md|TOOLCHAIN\.md/.test(path),
    questions: [
      "La classificazione release è corretta: runtime versionato o solo Non versionato?",
      "La modifica introduce una decisione operativa stabile che va riflessa in guide, ADR o AGENTS.md?",
    ],
    checks: ["npm run release:dry-run"],
    risk: "medio",
  },
  {
    id: "documentazione",
    label: "Documentazione",
    match: (path) =>
      /^docs\//.test(path) ||
      ["README.md", "BRAND.md", "SECURITY.md", "AGENTS.md", "CHANGELOG.md"].includes(
        path,
      ),
    questions: [
      "La documentazione descrive stato reale e limiti, senza promettere funzionalità non implementate?",
      "La modifica introduce una decisione operativa stabile e aggiorna il documento canonico giusto senza duplicati?",
    ],
    checks: ["git diff --check"],
    risk: "basso",
  },
];

const RISK_ORDER = { basso: 1, medio: 2, alto: 3 };

if (isCliEntrypoint()) {
  const args = parseArgs(process.argv.slice(2));
  const changedFiles = readChangedFiles(args.base);
  const dirtyFiles = readDirtyFiles();
  const report = buildPrePrSelfReview({
    base: args.base,
    changedFiles,
    dirtyFiles,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printPrePrSelfReview(report);
  }

  process.exit(report.ok ? 0 : 1);
}

export function buildPrePrSelfReview({
  base = DEFAULT_BASE,
  changedFiles,
  dirtyFiles = [],
}) {
  const files = dedupeFiles([...(changedFiles ?? []), ...dirtyFiles]);
  const detectedDefinitions = AREA_DEFINITIONS.filter((definition) =>
    files.some((file) => definition.match(file.path)),
  );
  const detectedAreas = detectedDefinitions.map((definition) => definition.id);
  const docsOnly =
    files.length > 0 &&
    detectedAreas.length > 0 &&
    detectedAreas.every((area) =>
      ["documentazione", "release_governance"].includes(area),
    );
  const riskLevel = files.length === 0
    ? "basso"
    : docsOnly
      ? "basso"
      : getHighestRisk(detectedDefinitions);
  const suggestedChecks = docsOnly
    ? ["git diff --check"]
    : unique([
        "git diff --check",
        ...detectedDefinitions.flatMap((definition) => definition.checks),
      ]);
  const reviewQuestions = unique([
    ...GENERAL_REVIEW_QUESTIONS,
    ...detectedDefinitions.flatMap((definition) => definition.questions),
  ]);
  const failures = [];
  const warnings = [];

  if (files.length === 0) {
    failures.push(
      `Nessun diff rilevato rispetto a ${base}: non c'è una PR da rivedere.`,
    );
  }

  if (dirtyFiles.length > 0) {
    warnings.push(
      "Il report include file staged/unstaged: prima della PR congela il diff o dichiarali esplicitamente.",
    );
  }

  return {
    base,
    changedFiles: files,
    detectedAreas,
    failures,
    ok: failures.length === 0,
    reviewQuestions,
    riskLevel,
    suggestedChecks,
    warnings,
  };
}

export function parseNameStatusDiff(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, firstPath, secondPath] = line.split("\t");

      if (/^R\d+/.test(status) || /^C\d+/.test(status)) {
        return { path: secondPath, previousPath: firstPath, status };
      }

      return { path: firstPath, status };
    })
    .filter((file) => Boolean(file.path));
}

export function parseShortStatus(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const rawStatus = line.slice(0, 2);
      const status = rawStatus === "??" ? "??" : rawStatus.trim();
      const rawPath = line.slice(3);
      const renameSeparator = " -> ";

      if (rawPath.includes(renameSeparator)) {
        const [previousPath, path] = rawPath.split(renameSeparator);
        return { path, previousPath, status };
      }

      return { path: rawPath, status };
    })
    .filter((file) => Boolean(file.path));
}

function parseArgs(rawArgs) {
  const parsed = { base: DEFAULT_BASE };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--base") {
      const nextValue = rawArgs[index + 1];
      if (!nextValue) throw new Error("Valore mancante per --base.");
      parsed.base = nextValue;
      index += 1;
      continue;
    }

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(`Uso: npm run review:pre-pr -- [--base origin/main] [--json]

Genera una self-review mirata del diff prima di aprire o sincronizzare una PR.
Non sostituisce i test: serve a trovare prima i commenti Codex prevedibili.`);
      process.exit(0);
    }

    throw new Error(`Argomento non supportato: ${arg}`);
  }

  return parsed;
}

function readChangedFiles(base) {
  return parseNameStatusDiff(
    runGit(["diff", "--name-status", "--find-renames", `${base}...HEAD`]),
  );
}

function readDirtyFiles() {
  return parseShortStatus(runGit(["status", "--short", "-uall"]));
}

function runGit(gitArgs) {
  const result = spawnSync("git", gitArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) return "";

  return result.stdout.trimEnd();
}

function printPrePrSelfReview(report) {
  console.log("Self-review pre-PR SyncBay");
  console.log(`Base: ${report.base}`);
  console.log(`Rischio: ${report.riskLevel}`);
  console.log(`File nel diff: ${report.changedFiles.length}`);

  if (report.detectedAreas.length > 0) {
    console.log(`Aree: ${report.detectedAreas.join(", ")}`);
  }

  if (report.changedFiles.length > 0) {
    console.log("");
    console.log("File:");
    for (const file of report.changedFiles) {
      const previous = file.previousPath ? ` da ${file.previousPath}` : "";
      console.log(`- ${file.status} ${file.path}${previous}`);
    }
  }

  if (report.failures.length > 0) {
    console.log("");
    console.log("Blocchi:");
    for (const failure of report.failures) console.log(`- ${failure}`);
  }

  if (report.warnings.length > 0) {
    console.log("");
    console.log("Avvisi:");
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }

  console.log("");
  console.log("Domande da chiudere prima della PR:");
  for (const question of report.reviewQuestions) console.log(`- ${question}`);

  console.log("");
  console.log("Verifiche suggerite:");
  for (const check of report.suggestedChecks) console.log(`- ${check}`);

  console.log("");
  console.log(
    report.ok
      ? "Esito: self-review pronta. Correggi i punti emersi prima di aprire o sincronizzare la PR."
      : "Esito: non aprire la PR finché i blocchi non sono chiusi.",
  );
}

function getHighestRisk(definitions) {
  return definitions.reduce((highest, definition) => {
    return RISK_ORDER[definition.risk] > RISK_ORDER[highest]
      ? definition.risk
      : highest;
  }, "basso");
}

function dedupeFiles(files) {
  const byPath = new Map();

  for (const file of files) {
    if (!file?.path) continue;
    byPath.set(file.path, file);
  }

  return [...byPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function unique(items) {
  return [...new Set(items)];
}

function isCliEntrypoint() {
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}
