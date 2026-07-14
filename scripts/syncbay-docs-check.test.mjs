import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { checkDocs } from "./syncbay-docs-check.mjs";

test("docs check catches broken links and unknown npm scripts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "syncbay-docs-"));
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { ok: "true" } }));
  fs.writeFileSync(path.join(root, "docs/INDEX.md"), "[rotto](missing.md) `npm run missing`");
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  const failures = checkDocs(root);
  assert.ok(failures.some((failure) => failure.includes("link mancante")));
  assert.ok(failures.some((failure) => failure.includes("script npm inesistente")));
  fs.rmSync(root, { recursive: true });
});
