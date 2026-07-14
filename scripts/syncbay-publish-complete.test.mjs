import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildPublishPlan,
  readVersionFromSource,
} from "./syncbay-publish-complete.mjs";

test("skips deploy and release for unversioned tooling changes", () => {
  assert.deepEqual(
    buildPublishPlan({
      changedPaths: ["scripts/example.mjs", "docs/TOOLCHAIN.md"],
      currentVersion: "1.0.63",
      mainVersion: "1.0.63",
    }),
    { deploy: false, release: false, tag: "v1.0.63" },
  );
});

test("requires deploy and release for a versioned runtime change", () => {
  assert.deepEqual(
    buildPublishPlan({
      changedPaths: ["app/routes/app._index.tsx"],
      currentVersion: "1.0.64",
      mainVersion: "1.0.63",
    }),
    { deploy: true, release: true, tag: "v1.0.64" },
  );
});

test("reads the canonical application version", () => {
  assert.equal(
    readVersionFromSource('export const APP_VERSION = "1.2.3";'),
    "1.2.3",
  );
});

test("merges through the remote repository and can resume an existing merge", () => {
  const source = fs.readFileSync(
    new URL("./syncbay-publish-complete.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /"--repo",\s*repository/);
  assert.match(source, /\["OPEN", "MERGED"\]/);
  assert.match(source, /Riprendo la chiusura/);
});
