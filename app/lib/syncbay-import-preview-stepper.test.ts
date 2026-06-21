import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { isLiveImportPreviewStepComplete } from "./syncbay-import-preview-stepper.ts";

test("completes the preview step only after a live eBay preview", () => {
  assert.equal(
    isLiveImportPreviewStepComplete({
      importableCount: 2,
      previewErrorMessage: null,
      previewSource: "trading_api",
    }),
    true,
  );
  assert.equal(
    isLiveImportPreviewStepComplete({
      importableCount: 2,
      previewErrorMessage: null,
      previewSource: "inventory_api",
    }),
    true,
  );
});

test("does not complete the preview step from mock or failed previews", () => {
  assert.equal(
    isLiveImportPreviewStepComplete({
      importableCount: 2,
      previewErrorMessage: null,
      previewSource: "deferred",
    }),
    false,
  );
  assert.equal(
    isLiveImportPreviewStepComplete({
      importableCount: 2,
      previewErrorMessage: null,
      previewSource: "mock",
    }),
    false,
  );
  assert.equal(
    isLiveImportPreviewStepComplete({
      importableCount: 2,
      previewErrorMessage: "lettura non riuscita",
      previewSource: "trading_api",
    }),
    false,
  );
  assert.equal(
    isLiveImportPreviewStepComplete({
      importableCount: 0,
      previewErrorMessage: null,
      previewSource: "trading_api",
    }),
    false,
  );
});
