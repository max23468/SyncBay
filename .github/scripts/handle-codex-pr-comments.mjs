#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const codexLoginPattern = new RegExp(process.env.CODEX_BOT_LOGIN_PATTERN ?? "codex", "i");
const inboxIssueTitle = process.env.CODEX_INBOX_ISSUE_TITLE ?? "Codex feedback inbox";
const codexCommand = process.env.CODEX_AUTOFIX_COMMENT ?? "@codex address that feedback";
const inboxMarker = "<!-- syncbay-codex-feedback-inbox -->";
const requestMarker = "<!-- syncbay-codex-feedback-request -->";
const dryRun = process.env.DRY_RUN === "true";
const eventName = process.env.GITHUB_EVENT_NAME ?? "";
const eventPayload = await readGitHubEventPayload();
const fullScan = eventName === "workflow_dispatch" || eventName === "schedule";
const eventPullRequestNumber = getEventPullRequestNumber(eventPayload);
const recentPrLimit = parsePositiveInteger(process.env.CODEX_RECENT_PR_LIMIT, 50);
const recentPrDays = parsePositiveInteger(process.env.CODEX_RECENT_PR_DAYS, 30);

if (!repository) fail("GITHUB_REPOSITORY non impostato.");
if (!token) fail("GITHUB_TOKEN non impostato.");

const [owner, repo] = repository.split("/");

if (!owner || !repo) fail(`GITHUB_REPOSITORY non valido: ${repository}`);

const prs = await listPullRequests();
const inboxEntries = [];
const requestedPrs = [];

for (const pr of prs) {
  const threads = await listReviewThreads(pr.number);
  const codexThreads = threads.filter(isCodexThread);

  if (codexThreads.length === 0) continue;

  const actionableThreads = codexThreads.filter(isActionableThread);
  const historicalThreads = codexThreads.filter((thread) => !isActionableThread(thread));

  inboxEntries.push({
    actionableThreads,
    historicalThreads,
    number: pr.number,
    state: pr.state,
    title: pr.title,
    url: pr.html_url,
    wasMerged: Boolean(pr.merged_at),
  });

  if (actionableThreads.length === 0) continue;

  const alreadyRequested = await hasAutomationRequest(pr.number, actionableThreads);

  if (!alreadyRequested) {
    const posted = await requestCodexHandling(pr, actionableThreads);
    if (posted) requestedPrs.push(pr.number);
  }
}

const inboxIssue = await upsertInboxIssue(inboxEntries);

console.log(
  JSON.stringify(
    {
      dryRun,
      eventName,
      fullScan,
      inboxIssue: inboxIssue?.html_url ?? null,
      prsScanned: prs.length,
      prsWithCodexThreads: inboxEntries.length,
      requestedPrs,
      totalActionableThreads: inboxEntries.reduce(
        (total, entry) => total + entry.actionableThreads.length,
        0,
      ),
      totalHistoricalThreads: inboxEntries.reduce(
        (total, entry) => total + entry.historicalThreads.length,
        0,
      ),
    },
    null,
    2,
  ),
);

async function listPullRequests() {
  if (fullScan) return listPullRequestPages({ state: "all" });

  const prsByNumber = new Map();

  for (const pr of await listPullRequestPages({ state: "open" })) {
    prsByNumber.set(pr.number, pr);
  }

  for (const pr of await listRecentPullRequests()) {
    prsByNumber.set(pr.number, pr);
  }

  if (eventPullRequestNumber && !prsByNumber.has(eventPullRequestNumber)) {
    const eventPr = await githubJson(`/repos/${owner}/${repo}/pulls/${eventPullRequestNumber}`);
    prsByNumber.set(eventPr.number, eventPr);
  }

  return [...prsByNumber.values()].sort(
    (left, right) => new Date(right.updated_at) - new Date(left.updated_at),
  );
}

async function listRecentPullRequests() {
  const cutoff = Date.now() - recentPrDays * 24 * 60 * 60 * 1000;

  return listPullRequestPages({
    limit: recentPrLimit,
    state: "all",
    stopAfterBatch: (batch) => {
      const oldestPr = batch.at(-1);
      return oldestPr ? new Date(oldestPr.updated_at).getTime() < cutoff : true;
    },
  });
}

async function listPullRequestPages({ limit = Infinity, state, stopAfterBatch } = {}) {
  const results = [];

  for (let page = 1; results.length < limit; page += 1) {
    const query = new URLSearchParams({
      direction: "desc",
      page: String(page),
      per_page: "100",
      sort: "updated",
      state,
    });
    const batch = await githubJson(`/repos/${owner}/${repo}/pulls?${query}`);

    if (batch.length === 0) break;

    results.push(...batch);
    if (stopAfterBatch?.(batch)) break;
  }

  return results.slice(0, limit);
}

async function listReviewThreads(prNumber) {
  const query = `query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            isResolved
            isOutdated
            path
            line
            originalLine
            comments(first: 50) {
              nodes {
                author {
                  login
                }
                body
                createdAt
                url
              }
            }
          }
        }
      }
    }
  }`;

  const threads = [];
  let cursor = null;

  do {
    const data = await githubGraphql(query, {
      cursor,
      number: prNumber,
      owner,
      repo,
    });
    const page = data.repository.pullRequest.reviewThreads;

    threads.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  return threads;
}

function isCodexThread(thread) {
  return thread.comments.nodes.some((comment) =>
    codexLoginPattern.test(comment.author?.login ?? ""),
  );
}

function isActionableThread(thread) {
  return isCodexThread(thread) && !thread.isResolved && !thread.isOutdated;
}

async function hasAutomationRequest(prNumber, threads) {
  const comments = await githubJson(
    `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`,
  );
  const threadUrls = threads.map(getCodexThreadUrl).filter(Boolean);

  return comments.some((comment) => {
    if (!comment.body?.includes(requestMarker)) return false;
    if (threadUrls.length === 0) return true;

    return threadUrls.every((url) => comment.body.includes(url));
  });
}

async function requestCodexHandling(pr, threads) {
  const threadList = threads.map(renderThreadForRequest).join("\n");
  const prState = pr.state === "open" ? "aperta" : pr.merged_at ? "mergiata" : "chiusa";
  const body = `${requestMarker}
${codexCommand}

Ho trovato ${threads.length} thread Codex actionable in questa PR (${prState}):
${threadList}

Risolvi i problemi segnalati, controlla anche la issue "${inboxIssueTitle}" per il backlog completo dei commenti Codex e aggiorna la PR o apri un follow-up se questa PR non e piu modificabile.`;

  if (dryRun) {
    console.log(`DRY RUN: commento non pubblicato su PR #${pr.number}:\n${body}`);
    return true;
  }

  try {
    await githubJson(`/repos/${owner}/${repo}/issues/${pr.number}/comments`, { body });
    return true;
  } catch (error) {
    console.warn(`Impossibile commentare la PR #${pr.number}: ${error.message}`);
    return false;
  }
}

async function upsertInboxIssue(entries) {
  const body = buildInboxBody(entries);
  const existingIssue = await findInboxIssue();

  if (dryRun) {
    console.log(`DRY RUN: issue inbox non aggiornata.\n${body}`);
    return existingIssue;
  }

  if (existingIssue) {
    try {
      return await githubJson(
        `/repos/${owner}/${repo}/issues/${existingIssue.number}`,
        {
          body,
          state: "open",
          title: inboxIssueTitle,
        },
        "PATCH",
      );
    } catch (error) {
      if (isNonCriticalWriteError(error)) {
        console.warn(`Impossibile aggiornare la issue inbox: ${error.message}`);
        return existingIssue;
      }

      throw error;
    }
  }

  try {
    return await githubJson(`/repos/${owner}/${repo}/issues`, {
      body,
      title: inboxIssueTitle,
    });
  } catch (error) {
    if (isNonCriticalWriteError(error)) {
      console.warn(`Impossibile creare la issue inbox: ${error.message}`);
      return null;
    }

    throw error;
  }
}

async function findInboxIssue() {
  const query = new URLSearchParams({
    per_page: "20",
    q: `repo:${owner}/${repo} is:issue in:title "${inboxIssueTitle}"`,
  });
  const result = await githubJson(`/search/issues?${query}`);

  for (const item of result.items) {
    if (item.title !== inboxIssueTitle) continue;

    const issue = await githubJson(`/repos/${owner}/${repo}/issues/${item.number}`);
    if (issue.body?.includes(inboxMarker)) return issue;
  }

  return null;
}

function buildInboxBody(entries) {
  const actionableCount = entries.reduce(
    (total, entry) => total + entry.actionableThreads.length,
    0,
  );
  const historicalCount = entries.reduce(
    (total, entry) => total + entry.historicalThreads.length,
    0,
  );
  const lines = [
    inboxMarker,
    "# Codex feedback inbox",
    "",
    "Issue aggiornata automaticamente dal workflow `Codex PR comments`.",
    "",
    `- PR con thread Codex: ${entries.length}`,
    `- Thread actionable: ${actionableCount}`,
    `- Thread storici/non actionable: ${historicalCount}`,
    "",
  ];

  if (entries.length === 0) {
    lines.push("Nessun thread Codex trovato nelle PR analizzate.");
    return lines.join("\n");
  }

  for (const entry of entries) {
    const state = entry.state === "open" ? "aperta" : entry.wasMerged ? "mergiata" : "chiusa";

    lines.push(`## PR #${entry.number} - ${entry.title}`);
    lines.push("");
    lines.push(`- Stato: ${state}`);
    lines.push(`- Link: ${entry.url}`);
    lines.push(`- Actionable: ${entry.actionableThreads.length}`);
    lines.push(`- Storici/non actionable: ${entry.historicalThreads.length}`);

    if (entry.actionableThreads.length > 0) {
      lines.push("");
      lines.push("### Actionable");
      lines.push(...entry.actionableThreads.map(renderThreadForInbox));
    }

    lines.push("");
  }

  return lines.join("\n");
}

function renderThreadForRequest(thread) {
  return `- ${renderThreadLocation(thread)}: ${getCodexThreadUrl(thread) ?? "thread senza URL"}`;
}

function renderThreadForInbox(thread) {
  return `- ${renderThreadLocation(thread)} - ${getCodexThreadUrl(thread) ?? "thread senza URL"}`;
}

function renderThreadLocation(thread) {
  const line = thread.line ?? thread.originalLine;
  return line ? `${thread.path}:${line}` : thread.path;
}

function getCodexThreadUrl(thread) {
  return thread.comments.nodes.find((comment) =>
    codexLoginPattern.test(comment.author?.login ?? ""),
  )?.url;
}

async function githubGraphql(query, variables) {
  const response = await fetch("https://api.github.com/graphql", {
    body: JSON.stringify({ query, variables }),
    headers: githubHeaders(),
    method: "POST",
  });
  const json = await parseGitHubResponse(response);

  if (json.errors?.length) {
    fail(JSON.stringify(json.errors));
  }

  return json.data;
}

async function githubJson(path, body, method = body ? "POST" : "GET") {
  const response = await fetch(`https://api.github.com${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: githubHeaders(),
    method,
  });

  return parseGitHubResponse(response);
}

function githubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function parseGitHubResponse(response) {
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new GitHubApiError(response.status, response.statusText, text);
  }

  return json;
}

function isNonCriticalWriteError(error) {
  return error instanceof GitHubApiError && [403, 404, 410].includes(error.status);
}

async function readGitHubEventPayload() {
  if (!process.env.GITHUB_EVENT_PATH) return {};

  try {
    return JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  } catch {
    return {};
  }
}

function getEventPullRequestNumber(payload) {
  if (payload.pull_request?.number) return payload.pull_request.number;
  if (payload.issue?.pull_request && payload.issue?.number) return payload.issue.number;
  return null;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

class GitHubApiError extends Error {
  constructor(status, statusText, body) {
    super(`${status} ${statusText}: ${body}`);
    this.name = "GitHubApiError";
    this.status = status;
  }
}
