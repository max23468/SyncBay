import assert from "node:assert/strict";
import { test } from "vitest";

import * as descriptionRules from "./syncbay-description-rules.ts";

const {
  applyDescriptionRuleToHtml,
  DESCRIPTION_RULE_MODES,
  getDescriptionRuleSummary,
  normalizeDescriptionRuleFormInput,
  normalizeDescriptionRuleMode,
} = descriptionRules;

test("accepts only supported description rule modes", () => {
  assert.deepEqual(
    [...DESCRIPTION_RULE_MODES],
    ["CLEAN_HTML", "FULL_HTML", "TEXT_ONLY"],
  );
  assert.equal(normalizeDescriptionRuleMode("CLEAN_HTML"), "CLEAN_HTML");
  assert.equal(normalizeDescriptionRuleMode(" full_html "), "FULL_HTML");
  assert.equal(normalizeDescriptionRuleMode("text_only"), "TEXT_ONLY");
  assert.equal(normalizeDescriptionRuleMode("markdown"), "CLEAN_HTML");
});

test("normalizes description rule settings from form input", () => {
  assert.deepEqual(normalizeDescriptionRuleFormInput({ mode: "TEXT_ONLY" }), {
    mode: "TEXT_ONLY",
    status: "valid",
  });
  assert.deepEqual(normalizeDescriptionRuleFormInput({ mode: "raw" }), {
    message:
      "Modalità descrizione non valida. Scegli HTML pulito, HTML eBay completo o solo testo.",
    status: "invalid",
  });
});

test("summarizes description rules in merchant-facing Italian", () => {
  assert.equal(getDescriptionRuleSummary("CLEAN_HTML"), "HTML pulito");
  assert.equal(getDescriptionRuleSummary("FULL_HTML"), "HTML eBay completo");
  assert.equal(getDescriptionRuleSummary("TEXT_ONLY"), "Solo testo");
});

test("applies full html and text-only description modes", () => {
  const html = "<p>Moneta <strong>rara</strong></p>";

  assert.deepEqual(
    applyDescriptionRuleToHtml({
      cleanedHtml: "<p>Moneta rara</p>",
      html,
      mode: "FULL_HTML",
    }),
    { html, mode: "FULL_HTML", removedPercent: 0, wasChanged: false },
  );
  const textOnly = applyDescriptionRuleToHtml({
    cleanedHtml: "<p>Moneta rara</p>",
    html: `${html}<script>alert(1)</script>&nbsp;&amp;`,
    mode: "TEXT_ONLY",
  });

  assert.equal(textOnly.html, "Moneta rara &");
  assert.equal(textOnly.mode, "TEXT_ONLY");
  assert.equal(textOnly.wasChanged, true);
  assert.ok(textOnly.removedPercent > 0);
});

test("text-only rimuove il blocco script anche con falsi tag di chiusura", () => {
  const textOnly = applyDescriptionRuleToHtml({
    cleanedHtml: null,
    html: "<p>Moneta</p><script>a</scriptual>b</script>",
    mode: "TEXT_ONLY",
  });

  // `</scriptual>` non e' un tag di chiusura: il corpo `b` non deve finire
  // nella descrizione del prodotto.
  assert.equal(textOnly.html, "Moneta");
});

test("text-only rimuove il blocco style anche con falsi tag di chiusura", () => {
  const textOnly = applyDescriptionRuleToHtml({
    cleanedHtml: null,
    html: "<p>Moneta</p><style>a</styleguide>b</style>",
    mode: "TEXT_ONLY",
  });

  assert.equal(textOnly.html, "Moneta");
});

test("text-only non lascia che falsi tag di apertura mangino il testo", () => {
  const textOnly = applyDescriptionRuleToHtml({
    cleanedHtml: null,
    html: "<p>Intro</p><scripture>Salmo</scripture><p>Tieni</p><script>alert(1)</script><p>Fine</p>",
    mode: "TEXT_ONLY",
  });

  // `<scripture>` non apre un blocco script: il testo del negoziante fra quel
  // tag e il `</script>` reale deve restare nella descrizione.
  assert.equal(textOnly.html, "Intro Salmo Tieni Fine");
});

test("text-only accetta tag di chiusura con spazi e attributi", () => {
  const textOnly = applyDescriptionRuleToHtml({
    cleanedHtml: null,
    html: "<p>Moneta</p><script>alert(1)</script\t\n bar>",
    mode: "TEXT_ONLY",
  });

  assert.equal(textOnly.html, "Moneta");
});

test("text-only non fa doppio unescape delle entita' gia' escapate", () => {
  const textOnly = applyDescriptionRuleToHtml({
    cleanedHtml: null,
    html: "<p>Prezzo &amp;lt;100&amp;gt; &amp;amp; sconto</p>",
    mode: "TEXT_ONLY",
  });

  // `&amp;lt;` deve restare il testo letterale `&lt;`, non diventare `<`.
  assert.equal(textOnly.html, "Prezzo &lt;100&gt; &amp; sconto");
});
