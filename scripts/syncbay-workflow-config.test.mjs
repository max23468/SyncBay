import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function readWorkflow(name) {
  return fs.readFileSync(`${ROOT}.github/workflows/${name}`, "utf8");
}

test("CI classifies the diff and runs one lane-specific verifier", () => {
  const source = readWorkflow("ci.yml");

  assert.match(source, /fetch-depth:\s*0/);
  assert.match(source, /id:\s*lane/);
  assert.match(source, /syncbay-verify\.mjs classify/);
  assert.match(source, /steps\.lane\.outputs\.lane == 'docs'/);
  assert.match(source, /git diff --check/);
  assert.match(source, /npx playwright install --with-deps chromium/);
  assert.match(source, /npm run verify:full -- --no-receipt/);
  assert.doesNotMatch(source, /run:\s*npm run test:runtime/);
  assert.doesNotMatch(source, /run:\s*npm run coverage:lib/);
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
});

test("Vercel delegates ignored builds to the tested classifier", () => {
  const source = fs.readFileSync(`${ROOT}vercel.json`, "utf8");

  assert.match(source, /syncbay-vercel-ignore-build\.mjs/);
});
