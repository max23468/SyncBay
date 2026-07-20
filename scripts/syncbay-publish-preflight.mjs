#!/usr/bin/env node

import { parseArgs as parseNodeArgs } from "node:util";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const REQUIRED_SCRIPTS = [
  "doctor:local",
  "conflicts:doctor",
  "orders:paid-readiness",
  "smoke:ui",
  "release:dry-run",
];

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  if (report.failures.length > 0) {
    process.exit(1);
  }
}

function buildReport(args) {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const branch = runGit(["branch", "--show-current"]);
  const status = runGit(["status", "--short", "-uall"]);
  const upstreamState = getUpstreamState();
  const failures = [];
  const warnings = [];
  const missingScripts = REQUIRED_SCRIPTS.filter(
    (scriptName) => !packageJson.scripts?.[scriptName],
  );
  const changelogState = getUnreleasedState();
  const publishedMainPreflight = isPublishedMainPreflight({
    branch,
    remote: Boolean(args.remote),
    status,
    upstreamState,
  });

  if (!branch) {
    failures.push("Branch corrente non rilevato.");
  }

  if (branch === "main" && !args.allowMain && !publishedMainPreflight) {
    failures.push("Pubblicazione non docs-only da main: usa una PR dedicata.");
  }

  if (status && !args.allowDirty) {
    failures.push("Worktree sporco: committa o separa le modifiche prima della pubblicazione.");
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
    failures.push("CHANGELOG.md mescola voci versionate e non versionate in [Non rilasciato].");
  }

  const pr = args.remote && !publishedMainPreflight ? readCurrentPullRequest() : null;
  const codexFeedback = loadCodexFeedback({
    pr,
    publishedMainPreflight,
    remote: Boolean(args.remote),
  });

  if (args.remote && !pr && !publishedMainPreflight) {
    failures.push("Nessuna PR GitHub trovata per il branch corrente.");
  }

  if (args.remote && (pr || publishedMainPreflight) && !codexFeedback?.readable) {
    failures.push(
      "Feedback Codex non leggibile: verificare autenticazione GitHub, review thread PR e issue #2 prima della pubblicazione.",
    );
  }

  if (pr && !isConventionalTitle(pr.title)) {
    failures.push(`Titolo PR non Conventional Commit: ${pr.title}`);
  }

  if (pr?.mergeStateStatus && pr.mergeStateStatus !== "CLEAN") {
    warnings.push(`Merge state PR: ${pr.mergeStateStatus}.`);
  }

  if (codexFeedback?.actionable) {
    failures.push(
      pr
        ? `Codex segnala thread actionable su PR #${pr.number}.`
        : "Codex feedback inbox segnala thread actionable nella sezione Da risolvere ora.",
    );
  }

  if (codexFeedback?.globalActionable && !codexFeedback.actionable) {
    warnings.push(
      "Codex feedback inbox segnala thread actionable su altre PR: non blocca questa pubblicazione.",
    );
  }

  return {
    branch,
    changelogState,
    checks: {
      allowDirty: Boolean(args.allowDirty),
      allowMain: Boolean(args.allowMain),
      publishedMainPreflight,
      remote: Boolean(args.remote),
      requiredScripts: REQUIRED_SCRIPTS,
    },
    failures,
    inbox: codexFeedback,
    ok: failures.length === 0,
    pr,
    statusLines: status ? status.split(/\r?\n/).filter(Boolean) : [],
    upstreamState,
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
  } else if (currentReport.checks.publishedMainPreflight) {
    console.log("Remote: main allineato a origin/main, controllo post-merge.");
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
  const { values } = parseNodeArgs({
    args: rawArgs,
    options: {
      "allow-dirty": { type: "boolean" },
      "allow-main": { type: "boolean" },
      help: { short: "h", type: "boolean" },
      json: { type: "boolean" },
      remote: { type: "boolean" },
    },
  });

  if (values.help) {
    console.log(`Uso: npm run publish:preflight -- [--remote] [--allow-dirty] [--allow-main] [--json]

Controlla branch, worktree, changelog, script minimi e, con --remote, PR
GitHub più Codex feedback inbox prima di merge/pubblicazione.`);
    process.exit(0);
  }

  return {
    allowDirty: values["allow-dirty"],
    allowMain: values["allow-main"],
    json: values.json,
    remote: values.remote,
  };
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

function getUpstreamState() {
  const output = runGit(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);

  if (!output) return null;

  const [aheadValue, behindValue] = output.split(/\s+/);
  const ahead = Number.parseInt(aheadValue ?? "", 10);
  const behind = Number.parseInt(behindValue ?? "", 10);

  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) return null;

  return { ahead, behind };
}

function readCurrentPullRequest() {
  const output = runGh(["pr", "view", "--json", "number,title,mergeStateStatus,state,url"]);

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
  const actionableSectionMatch = body.match(/## Da risolvere ora\s*(?<body>[\s\S]*?)(?=\n## |$)/);
  const actionableSection = actionableSectionMatch?.groups?.body ?? "";
  const prSectionMatch = prNumber
    ? body.match(new RegExp(`### PR #${prNumber}[^#]+?(?=\\n### PR #|\\n## |$)`, "s"))
    : null;
  const prSection = prSectionMatch?.[0] ?? "";

  return {
    actionable: prNumber ? hasActionableThreads(prSection) : false,
    globalActionable: hasActionableThreads(actionableSection),
    prActionable: prNumber ? hasActionableThreads(prSection) : false,
    readable: true,
    updatedAt: parsed.updatedAt,
    url: parsed.url,
  };
}

export function loadCodexFeedback(input, readers = {}) {
  if (!input.remote || (!input.pr && !input.publishedMainPreflight)) return null;

  const readInbox = readers.readInbox ?? readCodexInbox;
  const readThreads = readers.readThreads ?? readCodexReviewThreads;

  if (input.pr) {
    const reviewThreads = readThreads(input.pr.number);
    if (reviewThreads.readable) {
      return buildCodexFeedbackPreflight({
        inbox: null,
        prNumber: input.pr.number,
        reviewThreads,
      });
    }

    return buildCodexFeedbackPreflight({
      inbox: readInbox(input.pr.number),
      prNumber: input.pr.number,
      reviewThreads,
    });
  }

  return buildCodexFeedbackPreflight({
    inbox: readInbox(null),
    prNumber: null,
    reviewThreads: null,
  });
}

export function readCodexReviewThreads(prNumber, options = {}) {
  const runGhFn = options.runGhFn ?? runGh;
  const threads = [];
  let after = null;

  do {
    const args = [
      "api",
      "graphql",
      "-f",
      "owner=max23468",
      "-f",
      "repo=SyncBay",
      "-F",
      `number=${prNumber}`,
      "-f",
      "query=query($owner:String!, $repo:String!, $number:Int!, $after:String) { repository(owner:$owner, name:$repo) { pullRequest(number:$number) { reviewThreads(first:100, after:$after) { pageInfo { hasNextPage endCursor } nodes { isResolved isOutdated comments(first:100) { nodes { author { login } } } } } } } }",
    ];

    if (after) {
      args.push("-f", `after=${after}`);
    }

    const output = runGhFn(args);

    if (!output) {
      return {
        actionable: null,
        readable: false,
        source: "reviewThreads:paginated",
      };
    }

    const parsed = JSON.parse(output);
    const connection = parsed.data?.repository?.pullRequest?.reviewThreads ?? null;

    threads.push(...(connection?.nodes ?? []));
    after =
      connection?.pageInfo?.hasNextPage && connection.pageInfo.endCursor
        ? connection.pageInfo.endCursor
        : null;
  } while (after);

  const codexLoginPattern = new RegExp(process.env.CODEX_BOT_LOGIN_PATTERN ?? "codex", "i");
  const actionable = threads.some(
    (thread) =>
      !thread.isResolved &&
      !thread.isOutdated &&
      thread.comments.nodes.some((comment) => codexLoginPattern.test(comment.author?.login ?? "")),
  );

  return {
    actionable,
    readable: true,
    source: "reviewThreads:paginated",
  };
}

export function buildCodexFeedbackPreflight(input) {
  const inbox = input.inbox ?? {
    globalActionable: false,
    prActionable: false,
    readable: false,
  };
  const reviewThreads = input.reviewThreads ?? {
    actionable: null,
    readable: false,
    source: "reviewThreads",
  };
  const canUseReviewThreads = Boolean(input.prNumber) && reviewThreads.readable;
  const actionable = canUseReviewThreads
    ? Boolean(reviewThreads.actionable)
    : input.prNumber
      ? Boolean(inbox.prActionable ?? inbox.actionable)
      : Boolean(inbox.globalActionable);

  return {
    actionable,
    globalActionable: Boolean(inbox.globalActionable),
    readable: Boolean(reviewThreads.readable || inbox.readable),
    source: canUseReviewThreads ? reviewThreads.source : "inbox",
    updatedAt: inbox.updatedAt ?? null,
    url: inbox.url ?? null,
  };
}

export function isPublishedMainPreflight(input) {
  return (
    input.remote &&
    input.branch === "main" &&
    !input.status?.trim() &&
    input.upstreamState?.ahead === 0 &&
    input.upstreamState?.behind === 0
  );
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
  const match = changelog.match(/^## \[Non rilasciato\]\s*(?<body>[\s\S]*?)(?=^## \[[^\]]+\])/m);
  const body = match?.groups?.body?.trim() ?? "";
  const hasVersionedUnreleased =
    /^###\s+(Novità|Correzioni|Sicurezza|Sotto il cofano|Modificato|Rimosso)\s*$/im.test(body);
  const hasNonVersionedUnreleased = /^###\s+Non versionato\s*$/im.test(body);

  return {
    bodyPresent: body.length > 0,
    hasMixedUnreleased: hasVersionedUnreleased && hasNonVersionedUnreleased,
    hasNonVersionedUnreleased,
    hasVersionedUnreleased,
  };
}

function isConventionalTitle(title) {
  return /^(feat|fix|perf|docs|chore|refactor|test|ci)(\([^)]+\))?!?: .+/.test(title);
}
