import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrePrSelfReview,
  parseNameStatusDiff,
  parseShortStatus,
} from "./syncbay-pre-pr-self-review.mjs";

test("builds SyncBay-specific review prompts for existing catalog runtime diffs", () => {
  const review = buildPrePrSelfReview({
    base: "origin/main",
    changedFiles: [
      { path: "app/lib/syncbay-existing-catalog-takeover.ts", status: "M" },
      {
        path: "app/services/shopify-existing-products.server.ts",
        status: "M",
      },
      { path: "app/routes/app.import-preview.tsx", status: "M" },
      {
        path: "app/lib/syncbay-existing-catalog-takeover.test.ts",
        status: "M",
      },
    ],
    dirtyFiles: [],
  });

  assert.equal(review.riskLevel, "alto");
  assert.ok(review.detectedAreas.includes("catalogo_esistente"));
  assert.ok(review.detectedAreas.includes("ui_embedded"));
  assert.ok(review.detectedAreas.includes("shopify"));
  assert.ok(review.suggestedChecks.includes("npm run test:lib"));
  assert.ok(review.suggestedChecks.includes("npm run typecheck"));
  assert.ok(
    review.reviewQuestions.some((question) =>
      question.includes("duplicati Shopify"),
    ),
  );
  assert.ok(
    review.reviewQuestions.some((question) =>
      question.includes("guardrail server-side"),
    ),
  );
});

test("keeps docs-only diffs on the lightweight verification lane", () => {
  const review = buildPrePrSelfReview({
    base: "origin/main",
    changedFiles: [
      { path: "docs/guides/git-e-pubblicazione.md", status: "M" },
      { path: "CHANGELOG.md", status: "M" },
    ],
    dirtyFiles: [],
  });

  assert.equal(review.riskLevel, "basso");
  assert.deepEqual(review.suggestedChecks, ["git diff --check"]);
  assert.ok(review.detectedAreas.includes("documentazione"));
  assert.ok(
    review.reviewQuestions.some((question) =>
      question.includes("decisione operativa stabile"),
    ),
  );
});

test("parses git name-status output including renames", () => {
  assert.deepEqual(
    parseNameStatusDiff(`M\tpackage.json
A\tscripts/new-tool.mjs
R100\tdocs/old.md\tdocs/new.md
`),
    [
      { path: "package.json", status: "M" },
      { path: "scripts/new-tool.mjs", status: "A" },
      { path: "docs/new.md", previousPath: "docs/old.md", status: "R100" },
    ],
  );
});

test("parses short status output including untracked files", () => {
  assert.deepEqual(
    parseShortStatus(` M package.json
A  scripts/added.mjs
?? scripts/new-tool.test.mjs
R  docs/old.md -> docs/new.md
`),
    [
      { path: "package.json", status: "M" },
      { path: "scripts/added.mjs", status: "A" },
      { path: "scripts/new-tool.test.mjs", status: "??" },
      { path: "docs/new.md", previousPath: "docs/old.md", status: "R" },
    ],
  );
});
