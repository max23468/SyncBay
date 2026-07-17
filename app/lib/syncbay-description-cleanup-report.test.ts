import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDescriptionCleanupReportRow,
  summarizeDescriptionCleanupReport,
} from "./syncbay-description-cleanup.ts";

test("builds a dry-run row with cleanup metrics and safe excerpts", () => {
  const row = buildDescriptionCleanupReportRow({
    descriptionHtml:
      "<ul><li>Visita il negozio</li><li>Feedback</li></ul><p>1000 Lire Argento 1996.</p><p>VISITA IL NOSTRO SITO!</p><p>Spedizione e pagamenti.</p>",
    itemId: "157909984776",
    title: "1000 Lire Argento 1996",
  });

  assert.equal(row.itemId, "157909984776");
  assert.equal(row.title, "1000 Lire Argento 1996");
  assert.equal(row.wasChanged, true);
  assert.equal(row.cleanedTextExcerpt, "1000 Lire Argento 1996.");
  assert.equal(row.rawTextExcerpt.includes("Spedizione e pagamenti"), false);
  assert.equal(row.removedPercent > 50, true);
});

test("l'estratto di testo non fa doppio unescape delle entita' escapate", () => {
  const row = buildDescriptionCleanupReportRow({
    descriptionHtml: "<p>a &amp;quot;b&amp;quot; &amp;amp; c</p>",
    itemId: "1",
    title: "t",
  });

  // `&amp;quot;` deve restare `&quot;`, non collassare in `"`.
  assert.equal(row.cleanedTextExcerpt, "a &quot;b&quot; &amp; c");
});

test("summarizes dry-run cleanup rows", () => {
  assert.deepEqual(
    summarizeDescriptionCleanupReport([
      {
        cleanedLength: 10,
        cleanedTextExcerpt: "A",
        itemId: "1",
        rawLength: 100,
        rawTextExcerpt: "A",
        removedPercent: 90,
        templateSignalCount: 2,
        title: "Uno",
        wasChanged: true,
      },
      {
        cleanedLength: 20,
        cleanedTextExcerpt: "B",
        itemId: "2",
        rawLength: 20,
        rawTextExcerpt: "B",
        removedPercent: 0,
        templateSignalCount: 0,
        title: "Due",
        wasChanged: false,
      },
    ]),
    {
      averageRemovedPercent: 45,
      changedCount: 1,
      maxRemovedPercent: 90,
      sampledCount: 2,
      templateSignalCount: 2,
    },
  );
});
