import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isPublishedMainPreflight,
  loadCodexFeedback,
  readCodexReviewThreads,
} from "./syncbay-publish-preflight.mjs";

test("uses the current PR review threads", () => {
  const calls = [];
  const feedback = loadCodexFeedback(
    {
      pr: { number: 285 },
      publishedMainPreflight: false,
      remote: true,
    },
    {
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

test("skips Codex review lookup without a current PR", () => {
  assert.equal(loadCodexFeedback({ pr: null, publishedMainPreflight: true, remote: true }), null);
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
