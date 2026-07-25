#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  buildPrePrSelfReview,
  parseNameStatusDiff,
  parseShortStatus,
} from "./syncbay-pre-pr-self-review.mjs";

const DEFAULT_BASE = "origin/main";
const RECEIPT_DIRECTORY = ".cache/syncbay-verification";
const UI_GATE_LABELS = new Set([
  "npm run smoke:ui",
  "npm run ui:check",
  "npm run ui:browser-check",
]);
// Gate il cui esito dipende dal mondo esterno (database advisory, registry) e
// non dal diff in revisione: restano obbligatori in locale e su workflow
// dedicati, ma non bloccano il merge di una PR che non li ha causati.
const ADVISORY_GATE_LABELS = new Set(["npm run quality:react-doctor", "npm run audit:prod"]);

// La formattazione riguarda ogni tipo di file, quindi il controllo vale per
// tutte le corsie, docs incluse. Costa circa 7 secondi ed e' il gate piu'
// economico: sta per primo cosi' un problema banale fallisce subito.
const FORMAT_CHECK_LABEL = "npm run format:check";

const FULL_COMMANDS = [
  npmCommand("format:check"),
  npmCommand("prisma:generate"),
  npmCommand("lint"),
  npmCommand("test:tooling"),
  npmCommand("typecheck:raw"),
  npmCommand("coverage:lib"),
  npmCommand("test:services:raw"),
  npmCommand("build:raw"),
  npmCommand("prisma:validate"),
  npmCommand("smoke:ui"),
  npmCommand("ui:check"),
  npmCommand("ui:browser-check"),
  npmCommand("audit:prod", { live: true }),
];

if (import.meta.main) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = runCli(args);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export function buildVerificationPlan({
  base = DEFAULT_BASE,
  excludeAdvisoryGates = false,
  excludeUiGates = false,
  mode,
  review,
} = {}) {
  if (mode === "full") {
    return {
      commands: fullCommands({ excludeAdvisoryGates, excludeUiGates }),
      lane: "full",
      manualChecks: [],
      mode,
    };
  }

  if (mode !== "changed") {
    throw new Error(`Modalità di verifica non supportata: ${mode ?? "n/d"}.`);
  }

  if ((review?.unmatchedFiles ?? []).length > 0) {
    return {
      commands: fullCommands({ excludeAdvisoryGates, excludeUiGates }),
      lane: "full",
      manualChecks: [],
      mode,
    };
  }

  const suggestions = unique(review?.suggestedChecks ?? []);
  if (suggestions.length === 1 && suggestions[0] === "git diff --check") {
    return {
      commands: [
        npmCommand("format:check"),
        {
          args: ["diff", "--check", base],
          command: "git",
          label: `git diff --check ${base}`,
        },
      ],
      lane: "docs",
      manualChecks: [],
      mode,
    };
  }

  const manualChecks = suggestions.filter(isManualCheck);
  const executableSuggestions = suggestions.filter((suggestion) => {
    if (isManualCheck(suggestion)) return false;
    if (excludeUiGates && UI_GATE_LABELS.has(suggestion)) return false;
    return !(excludeAdvisoryGates && ADVISORY_GATE_LABELS.has(suggestion));
  });
  const normalized = normalizeSuggestedChecks(executableSuggestions, base);

  return {
    commands: normalized,
    lane: "standard",
    manualChecks,
    mode,
  };
}

export function createVerificationFingerprint(input) {
  const stableInput = {
    base: input.base,
    baseDiff: input.baseDiff,
    commands: input.commands,
    lockfile: input.lockfile,
    nodeVersion: input.nodeVersion,
    stagedDiff: input.stagedDiff,
    status: input.status,
    untracked: [...(input.untracked ?? [])].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    worktreeDiff: input.worktreeDiff,
  };

  return crypto.createHash("sha256").update(JSON.stringify(stableInput)).digest("hex");
}

export function runVerificationPlan(plan, options = {}) {
  const runCommand = options.runCommand ?? runCommandInherited;

  for (const entry of plan.commands) {
    const result = runCommand(entry.command, entry.args, entry);
    if (result.status !== 0) {
      return {
        failedCommand: entry.label,
        ok: false,
        status: result.status ?? 1,
      };
    }
  }

  return { failedCommand: null, ok: true, status: 0 };
}

export function shouldUseReceipt(plan, args = {}) {
  return (
    !args.noReceipt &&
    plan.mode !== "publish" &&
    plan.lane !== "publish" &&
    plan.manualChecks.length === 0 &&
    !(plan.commands ?? []).some((entry) => entry.live)
  );
}

function runCli(args) {
  if (args.mode === "classify") {
    const review = readReview(args.base);
    const plan = buildVerificationPlan({
      base: args.base,
      mode: "changed",
      review,
    });
    const lane = plan.lane === "docs" ? "docs" : "runtime";
    if (args.json) console.log(JSON.stringify({ lane }, null, 2));
    else console.log(`lane=${lane}`);
    return { ok: true };
  }

  if (args.mode === "publish") {
    const publishCommands = [
      npmCommand("doctor:local"),
      {
        args: ["run", "publish:preflight", "--", ...args.passthrough],
        command: "npm",
        label: `npm run publish:preflight${args.passthrough.length > 0 ? ` -- ${args.passthrough.join(" ")}` : ""}`,
      },
    ];
    return printAndRun(
      {
        commands: publishCommands,
        lane: "publish",
        manualChecks: [],
        mode: "publish",
      },
      args,
    );
  }

  const review = args.mode === "changed" ? readReview(args.base) : null;
  const plan = buildVerificationPlan({
    base: args.base,
    excludeAdvisoryGates: args.excludeAdvisoryGates,
    excludeUiGates: args.excludeUiGates,
    mode: args.mode,
    review,
  });
  return printAndRun(plan, args);
}

function printAndRun(plan, args) {
  const receipt = shouldUseReceipt(plan, args)
    ? buildReceiptContext({ base: args.base, plan })
    : null;

  if (!args.force && receipt && readValidReceipt(receipt.path, receipt.fingerprint)) {
    const cached = {
      fingerprint: receipt.fingerprint,
      lane: plan.lane,
      ok: true,
      reused: true,
    };
    if (args.json) console.log(JSON.stringify(cached, null, 2));
    else {
      console.log(
        `Verifica già valida per lo stato corrente (${receipt.fingerprint.slice(0, 12)}).`,
      );
    }
    return cached;
  }

  if (!args.json) {
    console.log(`Verifica SyncBay: corsia ${plan.lane}.`);
    for (const entry of plan.commands) console.log(`- ${entry.label}`);
    for (const check of plan.manualChecks) {
      console.log(`- manuale/live: ${check}`);
    }
  }

  const result = runVerificationPlan(plan);
  if (!result.ok) return result;

  if (receipt) writeReceipt(receipt, plan);

  const output = {
    fingerprint: receipt?.fingerprint ?? null,
    lane: plan.lane,
    manualChecks: plan.manualChecks,
    ok: true,
    reused: false,
  };
  if (args.json) console.log(JSON.stringify(output, null, 2));
  else console.log("Esito: verifica completata.");
  return output;
}

function readReview(base) {
  const changedFiles = parseNameStatusDiff(
    runGit(["diff", "--name-status", "--find-renames", `${base}...HEAD`]),
  );
  const dirtyFiles = parseShortStatus(runGit(["status", "--short", "-uall"]));

  return buildPrePrSelfReview({ base, changedFiles, dirtyFiles });
}

function normalizeSuggestedChecks(suggestions, base) {
  const labels = [];
  for (const suggestion of suggestions) {
    if (suggestion === "git diff --check") {
      labels.push(`git diff --check ${base}`);
      continue;
    }
    if (suggestion === "npm run test:runtime") {
      labels.push("npm run coverage:lib", "npm run test:services:raw");
      continue;
    }
    if (suggestion === "npm run test:lib") {
      labels.push("npm run test:lib");
      continue;
    }
    labels.push(
      suggestion
        .replace("npm run typecheck", "npm run typecheck:raw")
        .replace("npm run build", "npm run build:raw")
        .replace("npm run test:services", "npm run test:services:raw"),
    );
  }

  let normalizedLabels = unique(labels);
  if (normalizedLabels.includes("npm run coverage:lib")) {
    normalizedLabels = normalizedLabels.filter((label) => label !== "npm run test:lib");
  }

  const needsPrisma = normalizedLabels.some((label) =>
    [
      "npm run typecheck:raw",
      "npm run build:raw",
      "npm run test:services:raw",
      "npm run test:tooling",
    ].includes(label),
  );
  if (needsPrisma) normalizedLabels.unshift("npm run prisma:generate");
  normalizedLabels.unshift(FORMAT_CHECK_LABEL);

  return unique(normalizedLabels).map(commandFromLabel);
}

function commandFromLabel(label) {
  if (label.startsWith("git diff --check ")) {
    return {
      args: ["diff", "--check", label.slice("git diff --check ".length)],
      command: "git",
      label,
    };
  }

  const tokens = label.split(/\s+/);
  if (tokens[0] !== "npm" || tokens[1] !== "run" || !tokens[2]) {
    throw new Error(`Check non eseguibile in modo sicuro: ${label}`);
  }
  return { args: tokens.slice(1), command: "npm", label };
}

function buildReceiptContext({ base, plan }) {
  const status = runGit(["status", "--short", "-uall"]);
  const untracked = parseShortStatus(status)
    .filter((entry) => entry.status === "??")
    .map((entry) => ({
      content: readText(entry.path) ?? "[unreadable]",
      path: entry.path,
    }));
  const fingerprint = createVerificationFingerprint({
    base,
    baseDiff: runGit(["diff", "--binary", "--no-ext-diff", `${base}...HEAD`]),
    commands: plan.commands.map((entry) => entry.label),
    lockfile: readText("package-lock.json") ?? "",
    nodeVersion: process.versions.node,
    stagedDiff: runGit(["diff", "--cached", "--binary", "--no-ext-diff", "HEAD"]),
    status,
    untracked,
    worktreeDiff: runGit(["diff", "--binary", "--no-ext-diff", "HEAD"]),
  });

  return {
    fingerprint,
    path: path.join(RECEIPT_DIRECTORY, `${fingerprint}.json`),
  };
}

function writeReceipt(receipt, plan) {
  fs.mkdirSync(RECEIPT_DIRECTORY, { recursive: true });
  fs.writeFileSync(
    receipt.path,
    `${JSON.stringify(
      {
        commands: plan.commands.map((entry) => entry.label),
        createdAt: new Date().toISOString(),
        fingerprint: receipt.fingerprint,
        lane: plan.lane,
        ok: true,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function readValidReceipt(receiptPath, fingerprint) {
  try {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    return receipt.ok === true && receipt.fingerprint === fingerprint;
  } catch {
    return false;
  }
}

function parseArgs(rawArgs) {
  const parsed = {
    base: DEFAULT_BASE,
    excludeAdvisoryGates: false,
    excludeUiGates: false,
    force: false,
    json: false,
    mode: rawArgs[0] ?? "changed",
    noReceipt: false,
    passthrough: [],
  };

  for (let index = 1; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--base") {
      const value = rawArgs[index + 1];
      if (!value) throw new Error("Valore mancante per --base.");
      parsed.base = value;
      index += 1;
      continue;
    }
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    if (arg === "--without-ui-gates") {
      if (!["changed", "full"].includes(parsed.mode)) {
        throw new Error("--without-ui-gates è supportato solo con verify:changed o verify:full.");
      }
      parsed.excludeUiGates = true;
      continue;
    }
    if (arg === "--without-advisory-gates") {
      if (parsed.mode !== "changed") {
        throw new Error("--without-advisory-gates è supportato solo con verify:changed.");
      }
      parsed.excludeAdvisoryGates = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--no-receipt") {
      parsed.noReceipt = true;
      continue;
    }
    if (parsed.mode === "publish") {
      parsed.passthrough.push(arg);
      continue;
    }
    throw new Error(`Argomento non supportato: ${arg}`);
  }

  if (!["changed", "classify", "full", "publish"].includes(parsed.mode)) {
    throw new Error(`Modalità non supportata: ${parsed.mode}.`);
  }
  return parsed;
}

function npmCommand(scriptName, { live = false } = {}) {
  const command = {
    args: ["run", scriptName],
    command: "npm",
    label: `npm run ${scriptName}`,
  };
  return live ? { ...command, live: true } : command;
}

function cloneCommands(commands) {
  return commands.map((entry) => ({ ...entry, args: [...entry.args] }));
}

function fullCommands({ excludeAdvisoryGates = false, excludeUiGates = false } = {}) {
  const commands = FULL_COMMANDS.filter((entry) => {
    if (excludeUiGates && UI_GATE_LABELS.has(entry.label)) return false;
    return !(excludeAdvisoryGates && ADVISORY_GATE_LABELS.has(entry.label));
  });
  return cloneCommands(commands);
}

function runCommandInherited(command, args) {
  return spawnSync(command, args, { stdio: "inherit" });
}

function runGit(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} non riuscito.`);
  }
  return result.stdout.trimEnd();
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function hasPlaceholder(value) {
  return /<[^>]+>/.test(value);
}

function isManualCheck(value) {
  return hasPlaceholder(value) || value === "npm run db:verify";
}

function unique(values) {
  return [...new Set(values)];
}
