#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_BASE = "origin/main";

if (import.meta.main) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export function buildCreationPlan({ base = DEFAULT_BASE, branch, context, repoRoot }) {
  validateBranchName(branch);
  const target = deriveTargetPath(repoRoot, branch);

  if (context.isLinkedWorktree && !context.isSubmodule) {
    throw new Error(
      "Sei già in una worktree collegata: non crearne una annidata. Torna al checkout principale e rilancia il comando.",
    );
  }
  if (!context.targetIgnored) {
    throw new Error(
      "La directory .worktrees non è ignorata da Git. Aggiungila a .gitignore e committa la regola prima di creare il worktree.",
    );
  }
  if (!context.baseExists) {
    const recovery =
      base === DEFAULT_BASE
        ? " Eseguire git fetch origin main e rilanciare."
        : " Verificare o aggiornare esplicitamente il ref richiesto.";
    throw new Error(`La base ${base} non esiste.${recovery}`);
  }
  if (context.branchExists || context.registeredBranches.includes(`refs/heads/${branch}`)) {
    throw new Error(
      `Il branch ${branch} esiste già. Ispezionalo invece di ricrearlo o scegli un nome diverso.`,
    );
  }
  if (
    context.targetExists ||
    context.registeredPaths.some(
      (registeredPath) => path.resolve(registeredPath) === path.resolve(target),
    )
  ) {
    throw new Error(
      `Il percorso worktree ${target} esiste già. Ispezionalo prima di riutilizzarlo o rimuoverlo.`,
    );
  }

  return {
    base,
    branch,
    createCommand: {
      args: ["worktree", "add", "-b", branch, target, base],
      command: "git",
    },
    setupCommands: getSetupCommands(),
    target,
  };
}

export function getSetupCommands() {
  return [
    { args: ["install"], command: "npm", label: "npm install" },
    {
      args: ["run", "prisma:generate"],
      command: "npm",
      label: "npm run prisma:generate",
    },
    {
      args: ["run", "doctor:local", "--", "--json"],
      command: "npm",
      label: "npm run doctor:local -- --json",
    },
    {
      args: ["run", "test:lib"],
      command: "npm",
      label: "npm run test:lib",
    },
    {
      args: ["run", "test:services:raw"],
      command: "npm",
      label: "npm run test:services:raw",
    },
    {
      args: ["status", "--short", "--untracked-files=all"],
      captureStdout: true,
      command: "git",
      label: "git status --short --untracked-files=all",
      requireEmptyStdout: true,
    },
  ];
}

export function runCommandsSerially(commands, { cwd, spawn = spawnSync } = {}) {
  for (const entry of commands) {
    console.log(`\n[worktree] ${entry.label}`);
    const result = spawn(entry.command, entry.args, {
      cwd,
      encoding: "utf8",
      stdio: entry.captureStdout ? ["ignore", "pipe", "inherit"] : "inherit",
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `Setup worktree interrotto su ${entry.label} con codice ${result.status ?? "sconosciuto"}.`,
      );
    }
    if (entry.requireEmptyStdout && result.stdout?.trim()) {
      throw new Error(
        `Setup worktree completato ma il checkout non è pulito:\n${result.stdout.trim()}`,
      );
    }
  }
}

function runCli(rawArgs) {
  const args = parseArgs(rawArgs);
  if (args.help) {
    printHelp();
    return;
  }

  if (args.command === "prepare") {
    const repository = inspectRepository(process.cwd());
    if (!repository.isLinkedWorktree || repository.isSubmodule) {
      throw new Error("worktree:prepare va eseguito dentro una worktree collegata di SyncBay.");
    }
    runCommandsSerially(getSetupCommands(), { cwd: repository.repoRoot });
    console.log(`\nWorktree pronta: ${repository.repoRoot}`);
    return;
  }

  if (!args.branch) {
    throw new Error("Manca --branch codex/<tema>.");
  }

  validateBranchName(args.branch);
  const repository = inspectRepository(process.cwd());
  const target = deriveTargetPath(repository.repoRoot, args.branch);
  const context = inspectCreationContext({
    ...repository,
    base: args.base,
    branch: args.branch,
    target,
  });
  const plan = buildCreationPlan({
    base: args.base,
    branch: args.branch,
    context,
    repoRoot: repository.repoRoot,
  });

  if (args.dryRun) {
    if (args.json) console.log(JSON.stringify(plan, null, 2));
    else printPlan(plan);
    return;
  }

  console.log(`Creo ${plan.branch} da ${plan.base} in ${plan.target}.`);
  fs.mkdirSync(path.dirname(plan.target), { recursive: true });
  const creation = spawnSync(plan.createCommand.command, plan.createCommand.args, {
    cwd: repository.repoRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (creation.error) throw creation.error;
  if (creation.status !== 0) {
    throw new Error(
      `git worktree add fallito con codice ${creation.status ?? "sconosciuto"}. Nessun setup eseguito.`,
    );
  }

  try {
    runCommandsSerially(plan.setupCommands, { cwd: plan.target });
  } catch (error) {
    console.error(
      `\nLa worktree esiste ma il setup non è completo. Dopo aver corretto la causa, riprendere con:\n  cd ${shellQuote(plan.target)}\n  npm run worktree:prepare`,
    );
    throw error;
  }

  console.log(`\nWorktree pronta: ${plan.target}`);
  console.log(`Branch: ${plan.branch}`);
  console.log("Baseline: test librerie e servizi passati in serie.");
}

function inspectRepository(cwd) {
  const repoRoot = runGitText(["rev-parse", "--show-toplevel"], cwd);
  const gitDir = runGitText(["rev-parse", "--path-format=absolute", "--git-dir"], cwd);
  const commonDir = runGitText(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  const superproject = runGitText(["rev-parse", "--show-superproject-working-tree"], cwd, {
    allowEmpty: true,
  });

  return {
    commonDir,
    gitDir,
    isLinkedWorktree: normalizeExistingPath(gitDir) !== normalizeExistingPath(commonDir),
    isSubmodule: Boolean(superproject),
    repoRoot,
  };
}

function inspectCreationContext({ base, branch, isLinkedWorktree, isSubmodule, repoRoot, target }) {
  const worktrees = parseWorktreeList(runGitText(["worktree", "list", "--porcelain"], repoRoot));

  return {
    baseExists: runGitStatus(["rev-parse", "--verify", "--quiet", `${base}^{commit}`], repoRoot),
    branchExists: runGitStatus(
      ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      repoRoot,
    ),
    isLinkedWorktree,
    isSubmodule,
    registeredBranches: worktrees.branches,
    registeredPaths: worktrees.paths,
    targetExists: fs.existsSync(target),
    targetIgnored: runGitStatus(["check-ignore", "--quiet", "--no-index", target], repoRoot),
  };
}

function deriveTargetPath(repoRoot, branch) {
  const suffix = branch.slice("codex/".length).replaceAll("/", "-");
  return path.join(repoRoot, ".worktrees", suffix);
}

function validateBranchName(branch) {
  const components = typeof branch === "string" ? branch.slice("codex/".length).split("/") : [];
  if (
    typeof branch !== "string" ||
    !/^codex\/[a-z0-9][a-z0-9._/-]*$/i.test(branch) ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.endsWith("/") ||
    components.some(
      (component) =>
        !component ||
        component.startsWith(".") ||
        component.endsWith(".") ||
        component.endsWith(".lock"),
    )
  ) {
    throw new Error(
      "Il branch deve essere un ref sicuro con prefisso codex/, per esempio codex/catalog-speed.",
    );
  }
}

function parseWorktreeList(source) {
  const paths = [];
  const branches = [];
  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) paths.push(line.slice("worktree ".length));
    if (line.startsWith("branch ")) branches.push(line.slice("branch ".length));
  }
  return { branches, paths };
}

function parseArgs(rawArgs) {
  const parsed = {
    base: DEFAULT_BASE,
    branch: null,
    command: rawArgs[0] ?? null,
    dryRun: false,
    help: false,
    json: false,
  };

  if (parsed.command === "--help" || parsed.command === "-h") {
    parsed.help = true;
    return parsed;
  }
  if (!["create", "prepare"].includes(parsed.command)) {
    throw new Error("Comando richiesto: create oppure prepare.");
  }

  for (let index = 1; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--branch") parsed.branch = requireValue(rawArgs, ++index, arg);
    else if (arg === "--base") parsed.base = requireValue(rawArgs, ++index, arg);
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else throw new Error(`Argomento non supportato: ${arg}`);
  }

  if (
    parsed.command === "prepare" &&
    (parsed.branch || parsed.base !== DEFAULT_BASE || parsed.dryRun)
  ) {
    throw new Error("prepare non accetta --branch, --base o --dry-run.");
  }
  return parsed;
}

function requireValue(rawArgs, index, flag) {
  const value = rawArgs[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Manca il valore per ${flag}.`);
  }
  return value;
}

function printPlan(plan) {
  console.log("Preflight worktree SyncBay: ok.");
  console.log(`Branch: ${plan.branch}`);
  console.log(`Base: ${plan.base}`);
  console.log(`Percorso: ${plan.target}`);
  console.log("Setup seriale:");
  for (const command of plan.setupCommands) console.log(`- ${command.label}`);
}

function printHelp() {
  console.log(`Uso:
  npm run worktree:create -- --branch codex/<tema> [--base origin/main] [--dry-run] [--json]
  npm run worktree:prepare

create va eseguito dal checkout principale. Verifica base, branch, collisioni e
ignore, crea .worktrees/<tema>, installa le dipendenze, genera Prisma una volta
e lancia in serie doctor e baseline runtime. prepare riprende lo stesso setup
dentro una worktree già creata.`);
}

function runGitText(args, cwd, { allowEmpty = false } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `git ${args.join(" ")} fallito.`);
  }
  const output = result.stdout.trim();
  if (!allowEmpty && !output) {
    throw new Error(`git ${args.join(" ")} non ha restituito un valore.`);
  }
  return output;
}

function runGitStatus(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    stdio: "ignore",
  });
  return result.status === 0;
}

function normalizeExistingPath(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}
