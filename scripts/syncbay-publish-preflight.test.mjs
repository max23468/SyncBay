import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCodexFeedbackPreflight,
  isPublishedMainPreflight,
} from "./syncbay-publish-preflight.mjs";

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
