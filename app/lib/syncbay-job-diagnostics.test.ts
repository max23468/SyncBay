import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as jobDiagnostics from "./syncbay-job-diagnostics.ts";

const { getManualRetryState, getSyncJobDiagnostic } = jobDiagnostics;

const now = new Date("2026-06-05T10:00:00.000Z");

test("explains failed stock jobs as availability risk with manual retry", () => {
  const diagnostic = getSyncJobDiagnostic({
    attempts: 2,
    errorCode: "EBAY_WRITE_FAILED",
    errorMessage: "Trading API non disponibile",
    maxAttempts: 5,
    runAfter: "2026-06-05T10:05:00.000Z",
    status: "FAILED",
    type: "UPDATE_EBAY_STOCK",
  });

  assert.match(diagnostic.impact, /disponibilit[aà] eBay/i);
  assert.match(diagnostic.nextAction, /riprova/i);
  assert.equal(diagnostic.retry.canRetry, true);
  assert.equal(diagnostic.retry.label, "Riprova");
  assert.equal(diagnostic.technicalReference, "EBAY_WRITE_FAILED");
});

test("blocks manual retry during eBay Trading cooldown", () => {
  const retry = getManualRetryState(
    {
      attempts: 3,
      errorCode: "EBAY_TRADING_RATE_LIMITED",
      errorMessage: "Call usage limit has been reached.",
      maxAttempts: 5,
      runAfter: "2026-06-05T11:30:00.000Z",
      status: "FAILED",
      type: "SYNC_INCREMENTAL",
    },
    now,
  );

  assert.equal(retry.canRetry, false);
  assert.equal(retry.label, "Attendi eBay");
  assert.match(retry.reason, /cooldown/i);
});

test("uses the supplied clock for the eBay cooldown diagnostic", () => {
  const diagnostic = getSyncJobDiagnostic(
    {
      attempts: 3,
      errorCode: "EBAY_TRADING_RATE_LIMITED",
      errorMessage: "Call usage limit has been reached.",
      maxAttempts: 5,
      runAfter: "2026-06-05T11:30:00.000Z",
      status: "FAILED",
      type: "SYNC_INCREMENTAL",
    },
    now,
  );

  assert.equal(diagnostic.retry.canRetry, false);
  assert.match(diagnostic.nextAction, /attendi/i);
});

test("shows the next retry window for active eBay cooldowns", () => {
  const diagnostic = getSyncJobDiagnostic(
    {
      attempts: 3,
      errorCode: "EBAY_TRADING_RATE_LIMITED",
      errorMessage: "Call usage limit has been reached.",
      maxAttempts: 5,
      runAfter: "2026-06-05T11:30:00.000Z",
      status: "FAILED",
      type: "SYNC_INCREMENTAL",
    },
    now,
  );

  assert.match(diagnostic.nextAction, /05\/06\/26, 13:30/);
  assert.match(diagnostic.nextAction, /non forzare/i);
});

test("blocks manual retry when incremental enqueue failed because of eBay cooldown", () => {
  const diagnostic = getSyncJobDiagnostic(
    {
      attempts: 1,
      errorCode: "SYNCBAY_INCREMENTAL_ENQUEUE_FAILED",
      errorMessage: "Call usage limit has been reached.",
      maxAttempts: 1,
      runAfter: "2026-06-05T11:30:00.000Z",
      status: "FAILED",
      type: "SYNC_INCREMENTAL",
    },
    now,
  );

  assert.equal(diagnostic.retry.canRetry, false);
  assert.equal(diagnostic.retry.label, "Attendi eBay");
  assert.match(diagnostic.nextAction, /attendi/i);
});

test("keeps manual retry available for non-provider enqueue failures", () => {
  const retry = getManualRetryState(
    {
      attempts: 1,
      errorCode: "SYNCBAY_INCREMENTAL_ENQUEUE_FAILED",
      errorMessage: "Database temporaneamente non disponibile.",
      maxAttempts: 1,
      runAfter: "2026-06-05T11:30:00.000Z",
      status: "FAILED",
      type: "SYNC_INCREMENTAL",
    },
    now,
  );

  assert.equal(retry.canRetry, true);
  assert.equal(retry.label, "Riprova");
});

test("allows manual retry after an eBay cooldown has expired", () => {
  const retry = getManualRetryState(
    {
      attempts: 3,
      errorCode: "EBAY_TRADING_RATE_LIMITED",
      errorMessage: "Call usage limit has been reached.",
      maxAttempts: 5,
      runAfter: "2026-06-05T09:30:00.000Z",
      status: "FAILED",
      type: "SYNC_INCREMENTAL",
    },
    now,
  );

  assert.equal(retry.canRetry, true);
  assert.equal(retry.label, "Riprova");
});

test("does not offer manual retry for jobs that are not failed or retrying", () => {
  const retry = getManualRetryState(
    {
      attempts: 0,
      errorCode: null,
      errorMessage: null,
      maxAttempts: 5,
      runAfter: "2026-06-05T10:00:00.000Z",
      status: "PENDING",
      type: "IMPORT_CATALOG",
    },
    now,
  );

  assert.equal(retry.canRetry, false);
  assert.equal(retry.label, "In coda");
});

test("explains import and conflict-detection impacts with product-level next actions", () => {
  assert.match(
    getSyncJobDiagnostic({
      attempts: 1,
      errorCode: null,
      errorMessage: null,
      maxAttempts: 5,
      runAfter: "2026-06-05T10:05:00.000Z",
      status: "FAILED",
      type: "IMPORT_CATALOG",
    }).impact,
    /importazione/i,
  );

  assert.match(
    getSyncJobDiagnostic({
      attempts: 1,
      errorCode: null,
      errorMessage: null,
      maxAttempts: 5,
      runAfter: "2026-06-05T10:05:00.000Z",
      status: "FAILED",
      type: "DETECT_SHOPIFY_CHANGES",
    }).nextAction,
    /conflitti/i,
  );
});
