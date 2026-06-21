import assert from "node:assert/strict";
import test from "node:test";

import {
  getCodexPrScanMode,
  getRecentPrDays,
  shouldPatchInboxIssue,
} from "./codex-pr-comments-helpers.mjs";

test("uses targeted scan mode for pull request events", () => {
  assert.equal(
    getCodexPrScanMode({
      eventName: "pull_request_target",
      eventPayload: {
        pull_request: {
          number: 285,
        },
      },
    }),
    "targeted",
  );
});

test("uses broad scan mode for scheduled, manual, and inbox refresh events", () => {
  assert.equal(
    getCodexPrScanMode({
      eventName: "schedule",
      eventPayload: null,
    }),
    "broad",
  );
  assert.equal(
    getCodexPrScanMode({
      eventName: "workflow_dispatch",
      eventPayload: null,
    }),
    "broad",
  );
  assert.equal(
    getCodexPrScanMode({
      eventName: "issue_comment",
      eventPayload: {
        issue: {
          title: "Codex feedback inbox",
        },
      },
    }),
    "broad",
  );
});

test("keeps explicit full history scan opt-in", () => {
  assert.equal(
    getCodexPrScanMode({
      codeFullScan: true,
      eventName: "pull_request_target",
      eventPayload: {
        pull_request: {
          number: 285,
        },
      },
    }),
    "full-history",
  );
});

test("defaults recent PR scanning to one week", () => {
  assert.equal(getRecentPrDays(), 7);
  assert.equal(getRecentPrDays("30"), 30);
});

test("skips inbox issue patch when the managed body is already current", () => {
  assert.equal(
    shouldPatchInboxIssue({
      body: "current body\n",
      isLabeledInboxIssue: true,
      nextBody: "current body\n",
      state: "open",
    }),
    false,
  );
  assert.equal(
    shouldPatchInboxIssue({
      body: "old body\n",
      isLabeledInboxIssue: true,
      nextBody: "current body\n",
      state: "open",
    }),
    true,
  );
});
