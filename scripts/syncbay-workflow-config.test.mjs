import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function readWorkflow(name) {
  return fs.readFileSync(`${ROOT}.github/workflows/${name}`, "utf8");
}

test("CI classifies the diff and runs only targeted blocking gates", () => {
  const source = readWorkflow("ci.yml");

  assert.match(source, /fetch-depth:\s*0/);
  assert.match(source, /id:\s*lane/);
  assert.match(source, /syncbay-verify\.mjs classify/);
  assert.match(source, /steps\.lane\.outputs\.lane == 'docs'/);
  assert.match(source, /git diff --check/);
  assert.match(
    source,
    /npm run verify:changed -- --base .* --no-receipt --without-advisory-gates --without-ui-gates/,
  );
  assert.doesNotMatch(source, /playwright install/);
  assert.doesNotMatch(source, /verify:full/);
  // I run manuali (workflow_dispatch) devono avere una base valida: senza di
  // essa il verifier riceverebbe --base "" e fallirebbe prima di ogni check.
  assert.match(source, /base="origin\/main"/);
  assert.doesNotMatch(
    source,
    /echo "lane=runtime" >> "\$GITHUB_OUTPUT"\s*\n\s*exit 0/,
  );
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

test("React Doctor runs only for runtime and frontend paths", () => {
  const source = readWorkflow("react-doctor.yml");

  assert.match(source, /paths:/);
  assert.match(source, /app\/\*\*\/\*\.tsx/);
  assert.match(source, /package-lock\.json/);
  assert.match(source, /eslint\.config\.mjs/);
  assert.match(source, /version:\s*latest/);
  assert.doesNotMatch(source, /ready_for_review/);
  assert.doesNotMatch(source, /^\s*push:\s*$/m);
});

test("Doppler check runs only for environment and deployment surfaces", () => {
  const source = readWorkflow("doppler-check.yml");

  assert.match(source, /paths:/);
  assert.match(source, /\.env\.example/);
  assert.match(source, /vercel\.json/);
  assert.match(source, /docs\/doppler-setup\.md/);
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

test("Codex inbox uses one daily refresh and ignores ordinary issues", () => {
  const source = readWorkflow("codex-pr-comments.yml");

  assert.match(source, /cron:\s*"17 3 \* \* \*"/);
  assert.match(source, /github\.event\.issue\.pull_request/);
  assert.match(source, /Codex feedback inbox/);
  assert.doesNotMatch(source, /types:\s*\[[^\]]*synchronize/);
});

test("Vercel delegates ignored builds to the tested classifier", () => {
  const source = fs.readFileSync(`${ROOT}vercel.json`, "utf8");

  assert.match(source, /syncbay-vercel-ignore-build\.mjs/);
});
