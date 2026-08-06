import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "vitest";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function readWorkflow(name) {
  return fs.readFileSync(`${ROOT}.github/workflows/${name}`, "utf8");
}

function readJson(name) {
  return JSON.parse(fs.readFileSync(`${ROOT}${name}`, "utf8"));
}

test("CI classifies the diff and runs only targeted blocking gates", () => {
  const source = readWorkflow("ci.yml");

  assert.match(source, /fetch-depth:\s*0/);
  assert.match(source, /id:\s*lane/);
  assert.match(source, /syncbay-verify\.mjs classify/);
  // I gate non devono essere condizionati alla corsia: altrimenti un diff
  // docs-only salterebbe `format:check`, che nessun altro check intercetta.
  assert.doesNotMatch(source, /steps\.lane\.outputs\.lane ==/);
  assert.match(
    source,
    /npm run verify:changed -- --base .* --no-receipt --without-advisory-gates --without-ui-gates/,
  );
  assert.doesNotMatch(source, /playwright install/);
  assert.doesNotMatch(source, /verify:full/);
  // I run manuali (workflow_dispatch) devono avere una base valida: senza di
  // essa il verifier riceverebbe --base "" e fallirebbe prima di ogni check.
  assert.match(source, /base="origin\/main"/);
  assert.doesNotMatch(source, /echo "lane=runtime" >> "\$GITHUB_OUTPUT"\s*\n\s*exit 0/);
});

test("browser UI gates run only on explicit request or label", () => {
  const source = readWorkflow("ui-browser-check.yml");

  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /types:\s*\[labeled\]/);
  assert.match(source, /full-ui-check/);
  assert.match(source, /npx playwright install-deps chromium/);
  assert.match(source, /run:\s*npm run ui:check/);
  assert.match(source, /run:\s*npm run ui:browser-check/);
});

test("React Doctor follows the advisory PR gate used by CF-Ready", () => {
  const source = readWorkflow("react-doctor.yml");

  assert.match(source, /types:\s*\[opened, synchronize, reopened, ready_for_review\]/);
  assert.match(source, /^\s*push:\s*$/m);
  assert.match(source, /branches:\s*\[main\]/);
  assert.doesNotMatch(source, /paths:/);
  assert.match(source, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(source, /millionco\/react-doctor@[0-9a-f]{40}/);
  assert.match(source, /persist-credentials:\s*false/);
  assert.match(source, /version:\s*0\.9\.5/);
  assert.match(source, /scope:.*github\.event_name == 'push'.*'full'.*'changed'/);
  assert.match(source, /blocking:\s*none/);
  assert.match(source, /comment:\s*"false"/);
  assert.match(source, /review-comments:\s*"true"/);
  assert.doesNotMatch(source, /workflow_dispatch:/);
});

test("React Doctor blocks local full scans on warnings", () => {
  const config = readJson("doctor.config.json");
  const packageJson = readJson("package.json");

  assert.equal(config.blocking, "warning");
  assert.equal(config.supplyChain.enabled, false);
  assert.ok(config.ignore.files.includes(".worktrees/**"));
  assert.equal(packageJson.scripts["quality:react-doctor"], "react-doctor --scope full .");
  assert.equal(packageJson.scripts.shopify, "npm exec --no --package=@shopify/cli -- shopify");
});

test("PR title validation reruns cheaply for every title-related PR event", () => {
  const source = readWorkflow("pr-title.yml");

  assert.match(source, /pull_request_target:/);
  assert.match(source, /types:\s*\[opened, edited, reopened, synchronize\]/);
  assert.match(source, /\.strip\(\)/);
  assert.match(source, /\.\*\\S\$/);
  assert.doesNotMatch(source, /actions\/checkout/);
  assert.doesNotMatch(source, /github\.event\.changes\.title/);
});

test("Dependabot auto-merges only patch and minor updates through branch gates", () => {
  const source = readWorkflow("dependabot-automerge.yml");

  // Serve l'evento scrivibile: su `pull_request` Dependabot ha token read-only.
  assert.match(source, /pull_request_target:/);
  assert.match(source, /dependabot\[bot\]/);
  assert.match(source, /contents:\s*write/);
  assert.match(source, /pull-requests:\s*write/);
  assert.match(source, /dependabot\/fetch-metadata@[a-f0-9]{40}/);
  assert.match(source, /version-update:semver-patch/);
  assert.match(source, /version-update:semver-minor/);
  assert.doesNotMatch(source, /version-update:semver-major/);
  assert.match(source, /gh pr merge --auto --squash/);
  assert.doesNotMatch(source, /actions\/checkout/);
});

test("CI workflows use the current Node and cache action majors", () => {
  for (const name of ["ci.yml", "ui-browser-check.yml"]) {
    assert.match(readWorkflow(name), /actions\/setup-node@v7/);
  }

  assert.match(readWorkflow("ui-browser-check.yml"), /actions\/cache@v6/);
});

test("Codex review gate reruns on every PR HEAD and executes trusted code", () => {
  const source = readWorkflow("codex-review-gate.yml");

  assert.match(source, /pull_request_target:/);
  assert.match(source, /types:\s*\[opened, synchronize, reopened, ready_for_review\]/);
  assert.match(source, /statuses:\s*write/);
  assert.match(source, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(source, /ref:\s*\$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(source, /node scripts\/codex-review-gate\.mjs/);
});

test("Vercel delegates ignored builds to the tested classifier", () => {
  const source = fs.readFileSync(`${ROOT}vercel.json`, "utf8");

  assert.match(source, /syncbay-vercel-ignore-build\.mjs/);
});
