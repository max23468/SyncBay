import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildPublishPlan,
  readVersionFromSource,
  resolveTagAction,
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

test("keeps release detection for a merged resume whose tag is missing", () => {
  assert.deepEqual(
    buildPublishPlan({
      changedPaths: ["app/routes/app._index.tsx"],
      currentVersion: "1.0.64",
      mainVersion: "1.0.64",
      mergedResume: true,
      releaseAlreadyPublished: false,
    }),
    { deploy: true, release: true, tag: "v1.0.64" },
  );
});

test("skips release on a merged resume once the tag is already published", () => {
  assert.deepEqual(
    buildPublishPlan({
      changedPaths: ["app/routes/app._index.tsx"],
      currentVersion: "1.0.64",
      mainVersion: "1.0.64",
      mergedResume: true,
      releaseAlreadyPublished: true,
    }),
    { deploy: true, release: false, tag: "v1.0.64" },
  );
});

test("creates the tag when no local tag exists", () => {
  assert.equal(resolveTagAction({ localTagSha: "", mergeSha: "a".repeat(40), tag: "v1.0.64" }), "create");
});

test("reuses a local tag that already points at the merge commit", () => {
  const mergeSha = "a".repeat(40);

  assert.equal(resolveTagAction({ localTagSha: mergeSha, mergeSha, tag: "v1.0.64" }), "reuse");
});

test("refuses a stale local tag pointing away from the merge commit", () => {
  assert.throws(
    () =>
      resolveTagAction({
        localTagSha: "b".repeat(40),
        mergeSha: "a".repeat(40),
        tag: "v1.0.64",
      }),
    /Il tag v1\.0\.64 esiste già in locale su bbbbbbbbbbbb ma il merge è aaaaaaaaaaaa/,
  );
});

test("reads the canonical application version", () => {
  assert.equal(
    readVersionFromSource('export const APP_VERSION = "1.2.3";'),
    "1.2.3",
  );
});

test("treats the GitHub Release, not the pushed tag, as the release signal", () => {
  const source = fs.readFileSync(
    new URL("./syncbay-publish-complete.mjs", import.meta.url),
    "utf8",
  );

  // Un tag spinto senza Release non deve far saltare la pubblicazione: la sonda
  // deve interrogare `gh release view`, non `git ls-remote`.
  assert.match(source, /runGh\(\["release", "view", candidateTag/);
  assert.doesNotMatch(
    source,
    /releaseAlreadyPublished\s*=\s*candidateTag\s*\?\s*Boolean\(\s*runGit\(\["ls-remote"/,
  );
  // I passi di tag e push restano idempotenti sui retry, ma un tag gia' presente
  // vale solo se punta al merge appena completato.
  assert.match(source, /resolveTagAction\(\{ localTagSha, mergeSha, tag: plan\.tag \}\) === "create"/);
  assert.match(source, /if \(!runGit\(\["ls-remote", "--tags", "origin"/);
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
