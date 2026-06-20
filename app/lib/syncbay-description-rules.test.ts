import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as descriptionRules from "./syncbay-description-rules.ts";

const {
  applyDescriptionRuleToHtml,
  DESCRIPTION_RULE_MODES,
  getDescriptionRuleSummary,
  normalizeDescriptionRuleFormInput,
  normalizeDescriptionRuleMode,
} = descriptionRules;

test("accepts only supported description rule modes", () => {
  assert.deepEqual([...DESCRIPTION_RULE_MODES], [
    "CLEAN_HTML",
    "FULL_HTML",
    "TEXT_ONLY",
  ]);
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
