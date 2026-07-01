import assert from "node:assert/strict";
import test from "node:test";

import { getSupabaseCliCwd } from "./supabase-cli-env.mjs";
import { parseAdvisorType } from "./syncbay-supabase-advisors.mjs";

test("uses the explicit Supabase cwd before the process cwd", () => {
  assert.equal(
    getSupabaseCliCwd(
      { SYNCBAY_SUPABASE_CWD: "/Users/Matteo/Progetti/SyncBay" },
      "/tmp/worktree",
    ),
    "/Users/Matteo/Progetti/SyncBay",
  );
});

test("falls back to the process cwd when no Supabase cwd is configured", () => {
  assert.equal(
    getSupabaseCliCwd({}, "/tmp/worktree", {
      exists: () => false,
      runGitWorktreeList: () => null,
    }),
    "/tmp/worktree",
  );
});

test("discovers a linked Supabase cwd from git worktrees", () => {
  assert.equal(
    getSupabaseCliCwd({}, "/tmp/unlinked-worktree", {
      exists: (path) =>
        path === "/Users/Matteo/Progetti/SyncBay/supabase/.temp/project-ref",
      runGitWorktreeList: () => `worktree /tmp/unlinked-worktree
HEAD abc
branch refs/heads/codex/example

worktree /Users/Matteo/Progetti/SyncBay
HEAD def
branch refs/heads/main
`,
    }),
    "/Users/Matteo/Progetti/SyncBay",
  );
});

test("accepts only known Supabase advisor types", () => {
  assert.equal(parseAdvisorType(["security"]), "security");
  assert.equal(parseAdvisorType(["performance"]), "performance");
  assert.throws(() => parseAdvisorType(["other"]), /security\|performance/);
});
