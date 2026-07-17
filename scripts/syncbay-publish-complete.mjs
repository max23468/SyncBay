#!/usr/bin/env node

import { parseArgs as parseNodeArgs } from "node:util";
import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { spawnSync } from "node:child_process";

import { shouldBuildVercel } from "./syncbay-vercel-ignore-build.mjs";

const POLL_MS = 5_000;
const DEPLOY_TIMEOUT_MS = 15 * 60_000;

if (import.meta.main) {
  try {
    await runCompletePublish(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export function buildPublishPlan({
  changedPaths,
  currentVersion,
  mainVersion,
  mergedResume = false,
  releaseAlreadyPublished = false,
}) {
  const versionChanged =
    Boolean(currentVersion) &&
    Boolean(mainVersion) &&
    currentVersion !== mainVersion;
  // Su una PR aperta la differenza di versione rispetto a origin/main indica
  // che serve la release. Quando si riprende una PR già mergeata, origin/main
  // contiene già il bump: la versione coincide, quindi ci si basa sul fatto che
  // il tag/Release per questa versione sia già stato pubblicato o meno.
  return {
    deploy: shouldBuildVercel(changedPaths),
    release:
      Boolean(currentVersion) &&
      !releaseAlreadyPublished &&
      (mergedResume ? true : versionChanged),
    tag: currentVersion ? `v${currentVersion}` : null,
  };
}

export function readVersionFromSource(source) {
  return source?.match(/APP_VERSION\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
}

// Su un tag annotato `ls-remote` riporta due righe: quella semplice porta lo sha
// dell'oggetto tag, solo quella dereferenziata `^{}` porta il commit. Un tag
// leggero ha la sola riga semplice, gia' sul commit.
export function parseRemoteTagSha(lsRemoteOutput) {
  let plain = "";
  let dereferenced = "";

  for (const line of lsRemoteOutput.split(/\r?\n/)) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (!sha || !ref) continue;
    if (ref.endsWith("^{}")) dereferenced = sha;
    else plain = sha;
  }

  return dereferenced || plain;
}

// Un tag rimasto da un tentativo precedente puo' puntare a un commit diverso dal
// merge appena completato. `gh release create --target` usa il target solo se il
// tag non esiste ancora: qualunque tag gia' presente, in locale o su origin,
// verrebbe usato com'e' e porterebbe la Release sul commit sbagliato. Il tag
// remoto e' quello che vince sulla Release, quindi va confrontato anche quando
// in locale non c'e' nulla.
export function planTagPublication({
  localTagSha,
  remoteTagSha,
  mergeSha,
  tag,
}) {
  if (remoteTagSha && remoteTagSha !== mergeSha) {
    throw new Error(
      `Il tag ${tag} esiste già su origin sul commit ${remoteTagSha.slice(0, 12)}, diverso dal merge ${mergeSha.slice(0, 12)}. ` +
        `La GitHub Release seguirebbe il tag remoto e non il merge. Verifica cosa è già stato rilasciato con quel tag prima di toccarlo: se è pubblicato per errore va deciso a mano se spostarlo o rilasciare una nuova versione.`,
    );
  }

  if (localTagSha && localTagSha !== mergeSha) {
    throw new Error(
      `Il tag ${tag} esiste già in locale su ${localTagSha.slice(0, 12)} ma il merge è ${mergeSha.slice(0, 12)}. ` +
        `Verifica quale commit deve essere rilasciato, poi elimina il tag errato con "git tag -d ${tag}" e ripeti la pubblicazione.`,
    );
  }

  return { createTag: !localTagSha, pushTag: !remoteTagSha };
}

async function runCompletePublish(args) {
  const branch = requireCleanBranch();
  const prSelector = args.pr ? String(args.pr) : null;
  let pr = readPr(prSelector);

  if (!args.dryRun && pr?.state !== "MERGED") {
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
  if (!pr || !["OPEN", "MERGED"].includes(pr.state)) {
    throw new Error("PR aperta o appena mergeata non trovata.");
  }

  const changedPaths = (
    pr.number
      ? // `gh pr diff --name-only` va in HTTP 406 oltre i 300 file: l'API paginata
        // dei file della PR non ha quel tetto (`{owner}/{repo}` risolti da gh).
        runGh([
          "api",
          `repos/{owner}/{repo}/pulls/${pr.number}/files`,
          "--paginate",
          "--jq",
          ".[].filename",
        ])
      : runGit(["diff", "--name-only", "origin/main...HEAD"])
  )
    .split(/\r?\n/)
    .filter(Boolean);
  const currentVersion = readVersionFromSource(
    fs.readFileSync("app/lib/version.ts", "utf8"),
  );
  const mainVersion = readVersionFromSource(
    runGit(["show", "origin/main:app/lib/version.ts"]),
  );
  const candidateTag = currentVersion ? `v${currentVersion}` : null;
  // Il segnale di release completata e' la GitHub Release, non il tag: un tentativo
  // interrotto fra `git push origin <tag>` e `gh release create` lascia il tag su
  // origin senza Release, e fermarsi sul tag renderebbe definitiva quella lacuna.
  const releaseAlreadyPublished = candidateTag
    ? Boolean(
        runGh(["release", "view", candidateTag, "--json", "tagName"], {
          allowFailure: true,
        }),
      )
    : false;
  const plan = buildPublishPlan({
    changedPaths,
    currentVersion,
    mainVersion,
    mergedResume: pr.state === "MERGED",
    releaseAlreadyPublished,
  });
  const repository = runGh([
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]);

  console.log(
    `Pubblicazione completa${pr.number ? ` PR #${pr.number}` : " (dry-run locale)"}: deploy ${plan.deploy ? "sì" : "no"}, release ${plan.release ? plan.tag : "no"}.`,
  );
  if (args.dryRun) return plan;

  if (pr.state === "OPEN") {
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
      "--repo",
      repository,
      "--squash",
      "--delete-branch",
    ]);
  } else {
    console.log(`Riprendo la chiusura della PR #${pr.number} già mergeata.`);
  }

  const merged = readPr(String(pr.number));
  const mergeSha = merged?.mergeCommit?.oid;
  if (!mergeSha) throw new Error("Merge completato ma SHA non rilevato.");

  if (plan.deploy) {
    await waitForProductionDeployment({ mergeSha, repository });
    runInherited("npm", ["run", "audit:prod"]);
  } else {
    console.log(
      "Deploy Vercel non applicabile: il diff non modifica il runtime.",
    );
  }

  if (plan.release) {
    // Ogni passo e' idempotente: un retry dopo un tag gia' creato o gia' spinto
    // deve arrivare comunque a pubblicare la GitHub Release mancante.
    const localTagSha = runGit(
      ["rev-parse", "--verify", "--quiet", `${plan.tag}^{commit}`],
      {
        allowFailure: true,
      },
    );
    const remoteTagSha = parseRemoteTagSha(
      runGit([
        "ls-remote",
        "--tags",
        "origin",
        `refs/tags/${plan.tag}`,
        `refs/tags/${plan.tag}^{}`,
      ]),
    );
    const tagPlan = planTagPublication({
      localTagSha,
      remoteTagSha,
      mergeSha,
      tag: plan.tag,
    });

    if (tagPlan.createTag) {
      // Il merge commit lo crea GitHub: senza fetch puo' non esistere ancora in
      // locale e `git tag` fallirebbe con "fatal: tipo oggetto errato".
      runInherited("git", ["fetch", "origin", "main"]);
      try {
        runInherited("git", [
          "tag",
          "-a",
          plan.tag,
          mergeSha,
          "-m",
          `SyncBay ${currentVersion}`,
        ]);
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} ` +
            `Il merge ${mergeSha.slice(0, 12)} potrebbe non essere ancora raggiungibile da origin/main: ` +
            `attendi qualche secondo e ripeti la pubblicazione, il flusso è idempotente.`,
          { cause: error },
        );
      }
    }
    if (tagPlan.pushTag) {
      runInherited("git", ["push", "origin", plan.tag]);
    }
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
  } else if (releaseAlreadyPublished) {
    console.log(`Release SemVer già pubblicata: ${plan.tag} esiste già.`);
  } else {
    console.log("Release SemVer non applicabile: versione invariata.");
  }

  console.log(`Pubblicazione completata su ${mergeSha.slice(0, 12)}.`);
  console.log(
    "Resta solo il cleanup della worktree locale dal checkout principale.",
  );
  return { ...plan, mergeSha };
}

async function waitForProductionDeployment({ mergeSha, repository }) {
  const startedAt = Date.now();
  console.log("Attendo il deployment Vercel Production del commit mergeato...");

  while (Date.now() - startedAt < DEPLOY_TIMEOUT_MS) {
    const combinedStatus = JSON.parse(
      runGh(["api", `repos/${repository}/commits/${mergeSha}/status`]) || "{}",
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
    await sleep(POLL_MS);
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
  args.push("--json", "number,state,title,url,mergeCommit");
  const output = runGh(args, { allowFailure: true });
  return output ? JSON.parse(output) : null;
}

function parseArgs(rawArgs) {
  const { values } = parseNodeArgs({
    args: rawArgs,
    options: {
      "dry-run": { type: "boolean" },
      pr: { type: "string" },
      title: { type: "string" },
    },
  });
  const pr = values.pr === undefined ? null : Number.parseInt(values.pr, 10);
  if (values.pr !== undefined && !Number.isInteger(pr)) {
    throw new Error("PR non valida.");
  }
  if (values.title !== undefined && !values.title) {
    throw new Error("Titolo PR mancante.");
  }

  return {
    dryRun: values["dry-run"] ?? false,
    pr,
    title: values.title ?? null,
  };
}

function runGit(args, options) {
  return runCapture("git", args, options);
}

function runGh(args, options) {
  return runCapture("gh", args, options);
}

function runCapture(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    if (allowFailure) return "";
    throw new Error(
      result.stderr.trim() || `${command} ${args.join(" ")} non riuscito.`,
    );
  }
  return result.stdout.trim();
}

function runInherited(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} non riuscito.`);
  }
}
