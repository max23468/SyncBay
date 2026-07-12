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
  assert.match(source, /npm run verify:full -- --no-receipt/);
  assert.doesNotMatch(source, /run:\s*npm run test:runtime/);
  assert.doesNotMatch(source, /run:\s*npm run coverage:lib/);
});

test("React Doctor runs only for runtime and frontend paths", () => {
  const source = readWorkflow("react-doctor.yml");

  assert.match(source, /paths:/);
  assert.match(source, /app\/\*\*\/\*\.tsx/);
  assert.match(source, /package-lock\.json/);
});

test("Doppler check runs only for environment and deployment surfaces", () => {
  const source = readWorkflow("doppler-check.yml");

  assert.match(source, /paths:/);
  assert.match(source, /\.env\.example/);
  assert.match(source, /vercel\.json/);
  assert.match(source, /docs\/doppler-setup\.md/);
});

test("PR title validation does not rerun when only commits change", () => {
  const source = readWorkflow("pr-title.yml");

  assert.doesNotMatch(source, /^\s*- synchronize\s*$/m);
});
