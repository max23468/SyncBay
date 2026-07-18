import assert from "node:assert/strict";
import path from "node:path";
import { test } from "vitest";

import {
  buildCreationPlan,
  getSetupCommands,
  runCommandsSerially,
} from "./syncbay-worktree.mjs";

const READY_CONTEXT = {
  baseExists: true,
  branchExists: false,
  isLinkedWorktree: false,
  isSubmodule: false,
  registeredBranches: [],
  registeredPaths: [],
  targetExists: false,
  targetIgnored: true,
};

test("plans one deterministic worktree path from the primary checkout", () => {
  const repoRoot = "/workspace/SyncBay";
  const plan = buildCreationPlan({
    base: "origin/main",
    branch: "codex/catalog-speed",
    context: READY_CONTEXT,
    repoRoot,
  });

  assert.equal(plan.target, path.join(repoRoot, ".worktrees", "catalog-speed"));
  assert.deepEqual(plan.createCommand, {
    args: [
      "worktree",
      "add",
      "-b",
      "codex/catalog-speed",
      path.join(repoRoot, ".worktrees", "catalog-speed"),
      "origin/main",
    ],
    command: "git",
  });
});

test("refuses to create a nested worktree from an existing linked worktree", () => {
  assert.throws(
    () =>
      buildCreationPlan({
        base: "origin/main",
        branch: "codex/nested",
        context: { ...READY_CONTEXT, isLinkedWorktree: true },
        repoRoot: "/workspace/SyncBay/.worktrees/current",
      }),
    /già in una worktree collegata.*checkout principale/i,
  );
});

test("fails early on unsafe branch, ignore, base, branch and path state", () => {
  const input = {
    base: "origin/main",
    branch: "feature/not-codex",
    context: READY_CONTEXT,
    repoRoot: "/workspace/SyncBay",
  };

  assert.throws(() => buildCreationPlan(input), /codex\//i);
  assert.throws(
    () => buildCreationPlan({ ...input, branch: "codex/.hidden" }),
    /ref sicuro/i,
  );
  assert.throws(
    () => buildCreationPlan({ ...input, branch: "codex/trailing." }),
    /ref sicuro/i,
  );
  assert.throws(
    () =>
      buildCreationPlan({
        ...input,
        branch: "codex/safe",
        context: { ...READY_CONTEXT, targetIgnored: false },
      }),
    /\.worktrees.*ignorata/i,
  );
  assert.throws(
    () =>
      buildCreationPlan({
        ...input,
        branch: "codex/safe",
        context: { ...READY_CONTEXT, baseExists: false },
      }),
    /git fetch origin main/i,
  );
  assert.throws(
    () =>
      buildCreationPlan({
        ...input,
        branch: "codex/safe",
        context: { ...READY_CONTEXT, branchExists: true },
      }),
    /branch.*esiste già/i,
  );
  assert.throws(
    () =>
      buildCreationPlan({
        ...input,
        branch: "codex/safe",
        context: { ...READY_CONTEXT, targetExists: true },
      }),
    /percorso.*esiste già/i,
  );
});

test("setup installs and verifies serially with one Prisma generation", () => {
  const commands = getSetupCommands();
  const labels = commands.map((entry) => entry.label);

  assert.deepEqual(labels, [
    "npm install",
    "npm run prisma:generate",
    "npm run doctor:local -- --json",
    "npm run test:lib",
    "npm run test:services:raw",
    "git status --short --untracked-files=all",
  ]);
  assert.equal(
    labels.filter((label) => label.includes("prisma:generate")).length,
    1,
  );
});

test("serial runner stops at the first setup failure", () => {
  const calls = [];
  const commands = [
    { args: ["one"], command: "tool", label: "one" },
    { args: ["two"], command: "tool", label: "two" },
    { args: ["three"], command: "tool", label: "three" },
  ];

  assert.throws(
    () =>
      runCommandsSerially(commands, {
        cwd: "/workspace/SyncBay/.worktrees/test",
        spawn(command, args) {
          calls.push([command, ...args]);
          return { status: args[0] === "two" ? 2 : 0, stdout: "" };
        },
      }),
    /two.*codice 2/i,
  );
  assert.deepEqual(calls, [
    ["tool", "one"],
    ["tool", "two"],
  ]);
});
