import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import {
  getEbayTradingRateLimitCooldownSeconds,
  getNextEbayTradingRateLimitRetryAt,
  isEbayTradingUsageLimitError,
} from "./syncbay-ebay-rate-limit.ts";

test("detects localized eBay Trading usage limit errors", () => {
  assert.equal(
    isEbayTradingUsageLimitError(
      "eBay Trading API ha risposto: L'applicazione ha superato il limite di utilizzo in questa funzione.",
    ),
    true,
  );
});

test("detects English eBay Trading call limit errors", () => {
  assert.equal(
    isEbayTradingUsageLimitError(
      "The application has exceeded the usage limit in this call.",
    ),
    true,
  );
});

test("detects English eBay Trading usage limit errors", () => {
  assert.equal(
    isEbayTradingUsageLimitError("Call usage limit has been reached."),
    true,
  );
});

test("ignores unrelated eBay Trading errors", () => {
  assert.equal(
    isEbayTradingUsageLimitError(
      "eBay Trading API ha risposto: token OAuth non valido.",
    ),
    false,
  );
});

test("uses the observed daily Trading API reset when no cooldown override is configured", () => {
  assert.deepEqual(
    getNextEbayTradingRateLimitRetryAt({
      now: new Date("2026-06-03T11:56:28.000Z"),
    }),
    new Date("2026-06-04T07:05:00.000Z"),
  );
});

test("uses today's daily Trading API reset when it is still ahead", () => {
  assert.deepEqual(
    getNextEbayTradingRateLimitRetryAt({
      now: new Date("2026-06-03T06:00:00.000Z"),
    }),
    new Date("2026-06-03T07:05:00.000Z"),
  );
});

test("allows an explicit cooldown override for Trading API rate limits", () => {
  assert.deepEqual(
    getNextEbayTradingRateLimitRetryAt({
      cooldownSecondsValue: "3600",
      now: new Date("2026-06-03T11:56:28.000Z"),
    }),
    new Date("2026-06-03T12:56:28.000Z"),
  );
});

test("caps explicit Trading API rate-limit cooldown overrides at 24 hours", () => {
  assert.equal(getEbayTradingRateLimitCooldownSeconds("999999"), 86_400);
});
