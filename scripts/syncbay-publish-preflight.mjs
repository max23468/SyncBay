#!/usr/bin/env node

import fs from "node:fs";
import { spawnSync } from "node:child_process";

const REQUIRED_SCRIPTS = [
  "doctor:local",
  "conflicts:doctor",
  "orders:paid-readiness",
  "smoke:ui",
  "release:dry-run",
];

const args = parseArgs(process.argv.slice(2));
const report = buildReport();

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport(report);
}

if (report.failures.length > 0) {
  process.exit(1);
}

function buildReport() {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const branch = runGit(["branch", "--show-current"]);
  const status = runGit(["status", "--short", "-uall"]);
  const failures = [];
  const warnings = [];
  const missingScripts = REQUIRED_SCRIPTS.filter(
    (scriptName) => !packageJson.scripts?.[scriptName],
  );
  const changelogState = getUnreleasedState();

  if (!branch) {
    failures.push("Branch corrente non rilevato.");
  }

  if (branch === "main" && !args.allowMain) {
    failures.push("Pubblicazione non docs-only da main: usa una PR dedicata.");
  }

  if (status && !args.allowDirty) {
    failures.push(
      "Worktree sporco: committa o separa le modifiche prima della pubblicazione.",
    );
  } else if (status) {
    warnings.push("Worktree sporco consentito da --allow-dirty.");
  }

  if (missingScripts.length > 0) {
    failures.push(`Script package mancanti: ${missingScripts.join(", ")}.`);
  }

  if (changelogState.hasVersionedUnreleased) {
    failures.push(
      "CHANGELOG.md contiene voci versionate in [Non rilasciato]: eseguire npm run release prima di pubblicare.",
    );
  }

  if (changelogState.hasMixedUnreleased) {
    failures.push(
      "CHANGELOG.md mescola voci versionate e non versionate in [Non rilasciato].",
    );
  }

  const pr = args.remote ? readCurrentPullRequest() : null;
  const inbox = args.remote && pr ? readCodexInbox(pr.number) : null;

  if (args.remote && !pr) {
    failures.push("Nessuna PR GitHub trovata per il branch corrente.");
  }

  if (args.remote && pr && !inbox?.readable) {
    failures.push(
      "Codex feedback inbox non leggibile: verificare autenticazione GitHub e issue #2 prima della pubblicazione.",
    );
  }

  if (pr && !isConventionalTitle(pr.title)) {
    failures.push(`Titolo PR non Conventional Commit: ${pr.title}`);
  }

  if (pr?.mergeStateStatus && pr.mergeStateStatus !== "CLEAN") {
    warnings.push(`Merge state PR: ${pr.mergeStateStatus}.`);
  }

  if (inbox?.globalActionable) {
    failures.push(
      "Codex feedback inbox segnala thread actionable nella sezione Da risolvere ora.",
    );
  } else if (inbox?.actionable) {
    failures.push(
      `Codex feedback inbox segnala thread actionable su PR #${pr.number}.`,
    );
  }

  return {
    branch,
    changelogState,
    checks: {
      allowDirty: Boolean(args.allowDirty),
      allowMain: Boolean(args.allowMain),
      remote: Boolean(args.remote),
      requiredScripts: REQUIRED_SCRIPTS,
    },
    failures,
    inbox,
    ok: failures.length === 0,
    pr,
    statusLines: status ? status.split(/\r?\n/).filter(Boolean) : [],
    warnings,
  };
}

function printReport(currentReport) {
  console.log("Preflight pubblicazione SyncBay");
  console.log(`Branch: ${currentReport.branch || "n/d"}`);
  console.log(
    `Worktree: ${currentReport.statusLines.length === 0 ? "pulito" : `${currentReport.statusLines.length} righe dirty`}`,
  );

  if (currentReport.pr) {
    console.log(`PR: #${currentReport.pr.number} ${currentReport.pr.title}`);
  }

  if (currentReport.failures.length > 0) {
    console.log("");
    console.log("Blocchi:");
    for (const failure of currentReport.failures) console.log(`- ${failure}`);
  }

  if (currentReport.warnings.length > 0) {
    console.log("");
    console.log("Avvisi:");
    for (const warning of currentReport.warnings) console.log(`- ${warning}`);
  }

  console.log("");
  console.log(
    currentReport.ok
      ? "Esito: ok per procedere con PR/merge secondo AGENTS.md."
      : "Esito: non pubblicare finché i blocchi non sono chiusi.",
  );
}

function parseArgs(rawArgs) {
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--allow-dirty") {
      parsed.allowDirty = true;
      continue;
    }

    if (arg === "--allow-main") {
      parsed.allowMain = true;
      continue;
    }

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--remote") {
      parsed.remote = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(`Uso: npm run publish:preflight -- [--remote] [--allow-dirty] [--allow-main] [--json]

Controlla branch, worktree, changelog, script minimi e, con --remote, PR
GitHub più Codex feedback inbox prima di merge/pubblicazione.`);
      process.exit(0);
    }

    throw new Error(`Argomento non supportato: ${arg}`);
  }

  return parsed;
}

function runGit(gitArgs) {
  const result = spawnSync("git", gitArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) return "";

  return result.stdout.trim();
}

function runGh(ghArgs) {
  const result = spawnSync("gh", ghArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) return null;

  return result.stdout.trim();
}

function readCurrentPullRequest() {
  const output = runGh([
    "pr",
    "view",
    "--json",
    "number,title,mergeStateStatus,state,url",
  ]);

  if (!output) return null;

  return JSON.parse(output);
}

function readCodexInbox(prNumber) {
  const output = runGh([
    "issue",
    "view",
    "2",
    "--repo",
    "max23468/SyncBay",
    "--json",
    "body,updatedAt,url",
  ]);

  if (!output) {
    return {
      actionable: null,
      readable: false,
    };
  }

  const parsed = JSON.parse(output);
  const body = parsed.body ?? "";
  const actionableSectionMatch = body.match(
    /## Da risolvere ora\s*(?<body>[\s\S]*?)(?=\n## |$)/,
  );
  const actionableSection = actionableSectionMatch?.groups?.body ?? "";
  const prSectionMatch = body.match(
    new RegExp(`### PR #${prNumber}[^#]+?(?=\\n### PR #|\\n## |$)`, "s"),
  );
  const prSection = prSectionMatch?.[0] ?? "";

  return {
    actionable: hasActionableThreads(prSection),
    globalActionable: hasActionableThreads(actionableSection),
    readable: true,
    updatedAt: parsed.updatedAt,
    url: parsed.url,
  };
}

function hasActionableThreads(markdown) {
  return (
    /Thread actionable totali:\s*[1-9]\d*/.test(markdown) ||
    markdown.includes("resolved=no") ||
    /- \[ \]/.test(markdown)
  );
}

function getUnreleasedState() {
  const changelog = fs.readFileSync("CHANGELOG.md", "utf8");
  const match = changelog.match(
    /^## \[Non rilasciato\]\s*(?<body>[\s\S]*?)(?=^## \[[^\]]+\])/m,
  );
  const body = match?.groups?.body?.trim() ?? "";
  const hasVersionedUnreleased =
    /^###\s+(Novità|Correzioni|Sicurezza|Sotto il cofano|Modificato|Rimosso)\s*$/im.test(
      body,
    );
  const hasNonVersionedUnreleased = /^###\s+Non versionato\s*$/im.test(body);

  return {
    bodyPresent: body.length > 0,
    hasMixedUnreleased: hasVersionedUnreleased && hasNonVersionedUnreleased,
    hasNonVersionedUnreleased,
    hasVersionedUnreleased,
  };
}

function isConventionalTitle(title) {
  return /^(feat|fix|perf|docs|chore|refactor|test|ci)(\([^)]+\))?!?: .+/.test(
    title,
  );
}
