import assert from "node:assert/strict";
import test from "node:test";

import { isPublishedMainPreflight } from "./syncbay-publish-preflight.mjs";

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
