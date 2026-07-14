#!/usr/bin/env node

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { shouldBuildVercel } from "./syncbay-vercel-ignore-build.mjs";

const POLL_MS = 5_000;
const DEPLOY_TIMEOUT_MS = 15 * 60_000;

if (isCliEntrypoint()) {
  try {
    await runCompletePublish(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export function buildPublishPlan({ changedPaths, currentVersion, mainVersion }) {
  return {
    deploy: shouldBuildVercel(changedPaths),
    release:
      Boolean(currentVersion) &&
      Boolean(mainVersion) &&
      currentVersion !== mainVersion,
    tag: currentVersion ? `v${currentVersion}` : null,
  };
}

export function readVersionFromSource(source) {
  return source?.match(/APP_VERSION\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
}

async function runCompletePublish(args) {
  const branch = requireCleanBranch();
  const prSelector = args.pr ? String(args.pr) : null;
  let pr = readPr(prSelector);

  if (!args.dryRun) {
    runInherited("git", ["push", "--set-upstream", "origin", branch]);
    if (!pr) {
      const title = args.title || runGit(["log", "-1", "--pretty=%s"]);
      runInherited("gh", [
        "pr",
        "create",
        "--base",
        "main",
        "--head",
        branch,
        "--title",
        title,
        "--body",
        "## Sintesi\n\nPubblicazione completa tramite il flusso canonico SyncBay.",
      ]);
      pr = readPr(null);
    }
  }

  if (!pr && args.dryRun) {
    pr = { number: null, state: "OPEN" };
  }
  if (!pr || pr.state !== "OPEN") throw new Error("PR aperta non trovata.");

  const changedPaths = (pr.number
    ? runGh(["pr", "diff", String(pr.number), "--name-only"])
    : runGit(["diff", "--name-only", "origin/main...HEAD"]))
    .split(/\r?\n/)
    .filter(Boolean);
  const currentVersion = readVersionFromSource(
    fs.readFileSync("app/lib/version.ts", "utf8"),
  );
  const mainVersion = readVersionFromSource(
    runGit(["show", "origin/main:app/lib/version.ts"]),
  );
  const plan = buildPublishPlan({ changedPaths, currentVersion, mainVersion });
  const repository = runGh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);

  console.log(
    `Pubblicazione completa${pr.number ? ` PR #${pr.number}` : " (dry-run locale)"}: deploy ${plan.deploy ? "sì" : "no"}, release ${plan.release ? plan.tag : "no"}.`,
  );
  if (args.dryRun) return plan;

  runInherited("npm", ["run", "verify:publish", "--", "--remote"]);
  runInherited("gh", [
    "pr",
    "checks",
    String(pr.number),
    "--required",
    "--watch",
    "--interval",
    "10",
  ]);
  runInherited("gh", [
    "pr",
    "merge",
    String(pr.number),
    "--squash",
    "--delete-branch",
  ]);

  const merged = readPr(String(pr.number));
  const mergeSha = merged?.mergeCommit?.oid;
  if (!mergeSha) throw new Error("Merge completato ma SHA non rilevato.");

  if (plan.deploy) {
    await waitForProductionDeployment({ mergeSha, repository });
    runInherited("npm", ["run", "audit:prod"]);
  } else {
    console.log("Deploy Vercel non applicabile: il diff non modifica il runtime.");
  }

  if (plan.release) {
    runInherited("git", ["tag", "-a", plan.tag, mergeSha, "-m", `SyncBay ${currentVersion}`]);
    runInherited("git", ["push", "origin", plan.tag]);
    runInherited("gh", [
      "release",
      "create",
      plan.tag,
      "--target",
      mergeSha,
      "--title",
      `SyncBay ${currentVersion}`,
      "--generate-notes",
    ]);
  } else {
    console.log("Release SemVer non applicabile: versione invariata.");
  }

  console.log(`Pubblicazione completata su ${mergeSha.slice(0, 12)}.`);
  console.log("Resta solo il cleanup della worktree locale dal checkout principale.");
  return { ...plan, mergeSha };
}

async function waitForProductionDeployment({ mergeSha, repository }) {
  const startedAt = Date.now();
  console.log("Attendo il deployment Vercel Production del commit mergeato...");

  while (Date.now() - startedAt < DEPLOY_TIMEOUT_MS) {
    const combinedStatus = JSON.parse(
      runGh([
        "api",
        `repos/${repository}/commits/${mergeSha}/status`,
      ]) || "{}",
    );
    const vercelStatus = combinedStatus.statuses?.find(
      (status) => status.context === "Vercel",
    );
    if (vercelStatus?.state === "success") return;
    if (["error", "failure"].includes(vercelStatus?.state)) {
      throw new Error(
        `Deployment Production concluso con stato ${vercelStatus.state}.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error("Timeout attendendo il deployment Vercel Production.");
}

function requireCleanBranch() {
  const branch = runGit(["branch", "--show-current"]);
  if (!branch || branch === "main") {
    throw new Error("Esegui publish:complete dalla branch della PR.");
  }
  if (runGit(["status", "--short", "-uall"])) {
    throw new Error("Worktree sporca: committa prima di pubblicare.");
  }
  return branch;
}

function readPr(selector) {
  const args = ["pr", "view"];
  if (selector) args.push(selector);
  args.push(
    "--json",
    "number,state,title,url,mergeCommit",
  );
  const output = runGh(args, { allowFailure: true });
  return output ? JSON.parse(output) : null;
}

function parseArgs(rawArgs) {
  const parsed = { dryRun: false, pr: null, title: null };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--pr") {
      parsed.pr = Number.parseInt(rawArgs[index + 1] ?? "", 10);
      if (!Number.isInteger(parsed.pr)) throw new Error("PR non valida.");
      index += 1;
    } else if (arg === "--title") {
      parsed.title = rawArgs[index + 1] ?? "";
      if (!parsed.title) throw new Error("Titolo PR mancante.");
      index += 1;
    } else throw new Error(`Argomento non supportato: ${arg}`);
  }
  return parsed;
}

function runGit(args) {
  return runCapture("git", args);
}

function runGh(args, options) {
  return runCapture("gh", args, options);
}

function runCapture(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    if (allowFailure) return "";
    throw new Error(result.stderr.trim() || `${command} ${args.join(" ")} non riuscito.`);
  }
  return result.stdout.trim();
}

function runInherited(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} non riuscito.`);
  }
}

function isCliEntrypoint() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}
