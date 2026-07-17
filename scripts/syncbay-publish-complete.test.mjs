import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildPublishPlan,
  parseRemoteTagSha,
  planTagPublication,
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

const MERGE_SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const TAG_OBJECT_SHA = "c".repeat(40);

test("creates and pushes the tag when it exists nowhere", () => {
  assert.deepEqual(
    planTagPublication({ localTagSha: "", remoteTagSha: "", mergeSha: MERGE_SHA, tag: "v1.0.68" }),
    { createTag: true, pushTag: true },
  );
});

test("reuses local and remote tags that already point at the merge commit", () => {
  assert.deepEqual(
    planTagPublication({
      localTagSha: MERGE_SHA,
      remoteTagSha: MERGE_SHA,
      mergeSha: MERGE_SHA,
      tag: "v1.0.68",
    }),
    { createTag: false, pushTag: false },
  );
});

test("still pushes a correct local tag that origin does not have yet", () => {
  assert.deepEqual(
    planTagPublication({
      localTagSha: MERGE_SHA,
      remoteTagSha: "",
      mergeSha: MERGE_SHA,
      tag: "v1.0.68",
    }),
    { createTag: false, pushTag: true },
  );
});

test("refuses a stale local tag pointing away from the merge commit", () => {
  assert.throws(
    () =>
      planTagPublication({
        localTagSha: OTHER_SHA,
        remoteTagSha: "",
        mergeSha: MERGE_SHA,
        tag: "v1.0.68",
      }),
    /Il tag v1\.0\.68 esiste già in locale su bbbbbbbbbbbb ma il merge è aaaaaaaaaaaa/,
  );
});

// Il caso segnalato da Codex: checkout senza tag locale, origin con il tag su un
// altro commit. Senza il controllo remoto il tag locale corretto non verrebbe
// spinto e la Release seguirebbe quello stale.
test("refuses a stale remote tag even when no local tag exists", () => {
  assert.throws(
    () =>
      planTagPublication({
        localTagSha: "",
        remoteTagSha: OTHER_SHA,
        mergeSha: MERGE_SHA,
        tag: "v1.0.68",
      }),
    /Il tag v1\.0\.68 esiste già su origin sul commit bbbbbbbbbbbb, diverso dal merge aaaaaaaaaaaa/,
  );
});

test("reads the commit from the dereferenced line of an annotated tag", () => {
  const output = `${TAG_OBJECT_SHA}\trefs/tags/v1.0.68\n${MERGE_SHA}\trefs/tags/v1.0.68^{}`;

  assert.equal(parseRemoteTagSha(output), MERGE_SHA);
});

test("reads the commit from the single line of a lightweight tag", () => {
  assert.equal(parseRemoteTagSha(`${MERGE_SHA}\trefs/tags/v1.0.68`), MERGE_SHA);
});

test("reports no remote tag when ls-remote returns nothing", () => {
  assert.equal(parseRemoteTagSha(""), "");
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
  // vale solo se punta al merge: il confronto copre locale e origin, e il commit
  // del tag remoto va letto dalla riga dereferenziata.
  assert.match(source, /planTagPublication\(\{ localTagSha, remoteTagSha, mergeSha, tag: plan\.tag \}\)/);
  assert.match(source, /if \(tagPlan\.createTag\)/);
  assert.match(source, /if \(tagPlan\.pushTag\)/);
  assert.match(source, /refs\/tags\/\$\{plan\.tag\}\^\{\}/);
});

// Il merge commit lo crea GitHub: senza fetch il tag fallisce con
// "fatal: tipo oggetto errato" e l'errore deve suggerire il retry idempotente.
test("fetches origin before tagging the fresh merge commit and hints at retry", () => {
  const source = fs.readFileSync(
    new URL("./syncbay-publish-complete.mjs", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /if \(tagPlan\.createTag\) \{[^}]*runInherited\("git", \["fetch", "origin", "main"\]\);[^}]*runInherited\("git", \["tag"/,
  );
  assert.match(source, /ripeti la pubblicazione, il flusso è idempotente/);
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
