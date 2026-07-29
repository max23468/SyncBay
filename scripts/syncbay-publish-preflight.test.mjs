import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildCodexFeedbackPreflight,
  isPublishedMainPreflight,
  loadCodexFeedback,
  readCodexReviewThreads,
} from "./syncbay-publish-preflight.mjs";

test("uses readable review threads without querying the Codex inbox", () => {
  const calls = [];
  const feedback = loadCodexFeedback(
    {
      pr: { number: 285 },
      publishedMainPreflight: false,
      remote: true,
    },
    {
      readInbox() {
        calls.push("inbox");
        throw new Error("inbox should not be queried");
      },
      readThreads() {
        calls.push("threads");
        return {
          actionable: false,
          readable: true,
          source: "reviewThreads",
        };
      },
    },
  );

  assert.deepEqual(calls, ["threads"]);
  assert.equal(feedback.readable, true);
  assert.equal(feedback.source, "reviewThreads");
});

test("falls back to the Codex inbox only when review threads are unreadable", () => {
  const calls = [];
  const feedback = loadCodexFeedback(
    {
      pr: { number: 286 },
      publishedMainPreflight: false,
      remote: true,
    },
    {
      readInbox(prNumber) {
        calls.push(`inbox:${prNumber}`);
        return {
          globalActionable: false,
          prActionable: true,
          readable: true,
        };
      },
      readThreads(prNumber) {
        calls.push(`threads:${prNumber}`);
        return { actionable: null, readable: false, source: "reviewThreads" };
      },
    },
  );

  assert.deepEqual(calls, ["threads:286", "inbox:286"]);
  assert.equal(feedback.actionable, true);
  assert.equal(feedback.source, "inbox");
});

test("reads the Codex inbox for a post-merge main preflight", () => {
  const calls = [];
  const feedback = loadCodexFeedback(
    { pr: null, publishedMainPreflight: true, remote: true },
    {
      readInbox(prNumber) {
        calls.push(prNumber);
        return {
          globalActionable: false,
          prActionable: false,
          readable: true,
        };
      },
      readThreads() {
        throw new Error("review threads require a PR");
      },
    },
  );

  assert.deepEqual(calls, [null]);
  assert.equal(feedback.readable, true);
  assert.equal(feedback.source, "inbox");
});

test("recognizes a clean main branch aligned with its upstream as post-merge verification", () => {
  assert.equal(
    isPublishedMainPreflight({
      branch: "main",
      remote: true,
      status: "",
      upstreamState: { ahead: 0, behind: 0 },
    }),
    true,
  );
});

test("does not treat dirty or diverged main as post-merge verification", () => {
  assert.equal(
    isPublishedMainPreflight({
      branch: "main",
      remote: true,
      status: " M package.json",
      upstreamState: { ahead: 0, behind: 0 },
    }),
    false,
  );
  assert.equal(
    isPublishedMainPreflight({
      branch: "main",
      remote: true,
      status: "",
      upstreamState: { ahead: 1, behind: 0 },
    }),
    false,
  );
  assert.equal(
    isPublishedMainPreflight({
      branch: "main",
      remote: true,
      status: "",
      upstreamState: { ahead: 0, behind: 1 },
    }),
    false,
  );
});

test("keeps branch preflight mode for non-main branches and local checks", () => {
  assert.equal(
    isPublishedMainPreflight({
      branch: "codex/example",
      remote: true,
      status: "",
      upstreamState: { ahead: 0, behind: 0 },
    }),
    false,
  );
  assert.equal(
    isPublishedMainPreflight({
      branch: "main",
      remote: false,
      status: "",
      upstreamState: { ahead: 0, behind: 0 },
    }),
    false,
  );
});

test("blocks only actionable Codex threads for the current PR", () => {
  const currentPrFeedback = buildCodexFeedbackPreflight({
    inbox: {
      globalActionable: true,
      prActionable: false,
      readable: true,
      url: "https://github.com/max23468/SyncBay/issues/2",
    },
    prNumber: 285,
    reviewThreads: {
      actionable: true,
      readable: true,
      source: "reviewThreads",
    },
  });

  assert.equal(currentPrFeedback.actionable, true);
  assert.equal(currentPrFeedback.globalActionable, true);
  assert.equal(currentPrFeedback.readable, true);
  assert.equal(currentPrFeedback.source, "reviewThreads");
});

test("keeps actionable Codex threads on other PRs as warnings", () => {
  const currentPrFeedback = buildCodexFeedbackPreflight({
    inbox: {
      globalActionable: true,
      prActionable: false,
      readable: true,
      url: "https://github.com/max23468/SyncBay/issues/2",
    },
    prNumber: 285,
    reviewThreads: {
      actionable: false,
      readable: true,
      source: "reviewThreads",
    },
  });

  assert.equal(currentPrFeedback.actionable, false);
  assert.equal(currentPrFeedback.globalActionable, true);
  assert.equal(currentPrFeedback.readable, true);
  assert.equal(currentPrFeedback.source, "reviewThreads");
});

test("falls back to the inbox PR section when review threads are not readable", () => {
  const currentPrFeedback = buildCodexFeedbackPreflight({
    inbox: {
      globalActionable: true,
      prActionable: true,
      readable: true,
      url: "https://github.com/max23468/SyncBay/issues/2",
    },
    prNumber: 285,
    reviewThreads: {
      actionable: null,
      readable: false,
      source: "reviewThreads",
    },
  });

  assert.equal(currentPrFeedback.actionable, true);
  assert.equal(currentPrFeedback.globalActionable, true);
  assert.equal(currentPrFeedback.readable, true);
  assert.equal(currentPrFeedback.source, "inbox");
});

test("reads paginated Codex review threads before deciding publication safety", () => {
  const calls = [];
  const result = readCodexReviewThreads(286, {
    runGhFn(args) {
      calls.push(args);
      const afterArg = args.find((arg) => arg.startsWith("after="));

      if (!afterArg) {
        return JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { endCursor: "cursor-1", hasNextPage: true },
                  nodes: [
                    {
                      comments: { nodes: [{ author: { login: "human" } }] },
                      isOutdated: false,
                      isResolved: false,
                    },
                  ],
                },
              },
            },
          },
        });
      }

      assert.equal(afterArg, "after=cursor-1");

      return JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { endCursor: null, hasNextPage: false },
                nodes: [
                  {
                    comments: {
                      nodes: [{ author: { login: "chatgpt-codex-connector[bot]" } }],
                    },
                    isOutdated: false,
                    isResolved: false,
                  },
                ],
              },
            },
          },
        },
      });
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(result.actionable, true);
  assert.equal(result.readable, true);
  assert.equal(result.source, "reviewThreads:paginated");
});
