import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVerificationPlan,
  createVerificationFingerprint,
  runVerificationPlan,
  shouldUseReceipt,
} from "./syncbay-verify.mjs";

test("keeps docs-only changes on one lightweight check", () => {
  const plan = buildVerificationPlan({
    base: "origin/main",
    mode: "changed",
    review: {
      suggestedChecks: ["git diff --check"],
      unmatchedFiles: [],
    },
  });

  assert.equal(plan.lane, "docs");
  assert.deepEqual(plan.commands, [
    {
      args: ["diff", "--check", "origin/main"],
      command: "git",
      label: "git diff --check origin/main",
    },
  ]);
});

test("falls back to the full lane when changed files are not classified", () => {
  const plan = buildVerificationPlan({
    mode: "changed",
    review: {
      suggestedChecks: ["npm run typecheck", "npm run lint"],
      unmatchedFiles: ["unclassified.config"],
    },
  });

  assert.equal(plan.lane, "full");
  assert.equal(
    plan.commands.filter((entry) => entry.label === "npm run prisma:generate")
      .length,
    1,
  );
});

test("can leave UI gates to separate CI steps without weakening local full verify", () => {
  const complete = buildVerificationPlan({ mode: "full" });
  const ciCore = buildVerificationPlan({
    excludeUiGates: true,
    mode: "full",
  });

  assert.deepEqual(
    complete.commands
      .map((entry) => entry.label)
      .filter((label) =>
        [
          "npm run smoke:ui",
          "npm run ui:check",
          "npm run ui:browser-check",
        ].includes(label),
      ),
    ["npm run smoke:ui", "npm run ui:check", "npm run ui:browser-check"],
  );
  assert.equal(
    ciCore.commands.some((entry) =>
      [
        "npm run smoke:ui",
        "npm run ui:check",
        "npm run ui:browser-check",
      ].includes(entry.label),
    ),
    false,
  );
});

test("deduplicates changed checks and keeps live placeholders manual", () => {
  const plan = buildVerificationPlan({
    mode: "changed",
    review: {
      suggestedChecks: [
        "npm run typecheck",
        "npm run lint",
        "npm run typecheck",
        "npm run conflicts:doctor -- --shop <shop.myshopify.com>",
      ],
      unmatchedFiles: [],
    },
  });

  assert.deepEqual(
    plan.commands.map((entry) => entry.label),
    ["npm run prisma:generate", "npm run typecheck:raw", "npm run lint"],
  );
  assert.deepEqual(plan.manualChecks, [
    "npm run conflicts:doctor -- --shop <shop.myshopify.com>",
  ]);
});

test("CI can omit advisory gates already handled by parallel workflows", () => {
  const plan = buildVerificationPlan({
    excludeAdvisoryGates: true,
    mode: "changed",
    review: {
      suggestedChecks: ["npm run smoke:ui", "npm run quality:react-doctor"],
      unmatchedFiles: [],
    },
  });

  assert.deepEqual(plan.commands.map((entry) => entry.label), ["npm run smoke:ui"]);
});

test("keeps provider-backed checks manual and accepts the tooling wrapper", () => {
  const plan = buildVerificationPlan({
    mode: "changed",
    review: {
      suggestedChecks: [
        "npm run prisma:validate",
        "npm run db:verify",
        "npm run test:tooling",
      ],
      unmatchedFiles: [],
    },
  });

  assert.deepEqual(
    plan.commands.map((entry) => entry.label),
    ["npm run prisma:validate", "npm run test:tooling"],
  );
  assert.deepEqual(plan.manualChecks, ["npm run db:verify"]);
});

test("never reuses receipts for publish, live manual checks, or live commands", () => {
  assert.equal(
    shouldUseReceipt({ lane: "publish", manualChecks: [], mode: "publish" }),
    false,
  );
  assert.equal(
    shouldUseReceipt({
      lane: "standard",
      manualChecks: ["npm run db:verify"],
      mode: "changed",
    }),
    false,
  );
  // The full lane runs a live production audit whose advisories can change
  // even when diff, lockfile and Node stay identical, so it stays fresh.
  assert.equal(shouldUseReceipt(buildVerificationPlan({ mode: "full" })), false);
  // A lane without live commands can reuse a valid receipt.
  assert.equal(
    shouldUseReceipt({
      commands: [
        { args: ["run", "lint"], command: "npm", label: "npm run lint" },
      ],
      lane: "standard",
      manualChecks: [],
      mode: "changed",
    }),
    true,
  );
  assert.equal(
    shouldUseReceipt(buildVerificationPlan({ mode: "full" }), {
      noReceipt: true,
    }),
    false,
  );
});

test("runs verification commands serially and stops at the first failure", () => {
  const calls = [];
  const result = runVerificationPlan(
    {
      commands: [
        { args: ["first"], command: "test", label: "first" },
        { args: ["second"], command: "test", label: "second" },
        { args: ["third"], command: "test", label: "third" },
      ],
      lane: "standard",
      manualChecks: [],
      mode: "changed",
    },
    {
      runCommand(command, args) {
        calls.push([command, ...args]);
        return { status: args[0] === "second" ? 1 : 0 };
      },
    },
  );

  assert.deepEqual(calls, [
    ["test", "first"],
    ["test", "second"],
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.failedCommand, "second");
});

test("full verification generates Prisma once and does not repeat lib tests", () => {
  const plan = buildVerificationPlan({ mode: "full" });
  const labels = plan.commands.map((entry) => entry.label);

  assert.equal(
    labels.filter((label) => label === "npm run prisma:generate").length,
    1,
  );
  assert.equal(labels.includes("npm run test:lib"), false);
  assert.equal(labels.includes("npm run coverage:lib"), true);
  assert.equal(labels.includes("npm run test:services:raw"), true);
  assert.equal(labels.includes("npm run test:tooling"), true);
  assert.equal(labels.includes("npm run typecheck:raw"), true);
  assert.equal(labels.includes("npm run build:raw"), true);
  assert.equal(labels.includes("npm run audit:prod"), true);

  const audit = plan.commands.find(
    (entry) => entry.label === "npm run audit:prod",
  );
  assert.equal(audit.live, true);
});

test("verification fingerprints change with diff lockfile runtime or commands", () => {
  const baseline = {
    base: "origin/main",
    baseDiff: "diff-a",
    commands: ["npm run lint"],
    lockfile: "lock-a",
    nodeVersion: "24.18.0",
    stagedDiff: "",
    status: " M app/example.ts",
    untracked: [],
    worktreeDiff: "diff-b",
  };
  const fingerprint = createVerificationFingerprint(baseline);

  for (const changed of [
    { baseDiff: "diff-c" },
    { lockfile: "lock-b" },
    { nodeVersion: "24.19.0" },
    { commands: ["npm run build"] },
    { untracked: [{ content: "new", path: "new-file.ts" }] },
  ]) {
    assert.notEqual(
      createVerificationFingerprint({ ...baseline, ...changed }),
      fingerprint,
    );
  }
});
