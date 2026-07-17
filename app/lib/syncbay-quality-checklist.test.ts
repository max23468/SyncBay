import assert from "node:assert/strict";
import test from "node:test";

import * as qualityChecklist from "./syncbay-quality-checklist.ts";

const { buildImportQualityChecklist, getQualityChecklistSummary } =
  qualityChecklist;

test("builds a transparent checklist for risky import rows", () => {
  const checklist = buildImportQualityChecklist({
    categoryConfidence: "low",
    descriptionWasChanged: true,
    imageCount: 0,
    priceAmount: null,
    quantity: null,
    sku: null,
    skuGenerated: false,
    variantCount: 3,
  });

  assert.deepEqual(
    checklist.map((item) => [item.code, item.status, item.severity]),
    [
      ["sku_missing", "fail", "critical"],
      ["price_invalid", "fail", "critical"],
      ["quantity_unknown", "fail", "critical"],
      ["images_missing", "warning", "warning"],
      ["variants_complex", "fail", "critical"],
      ["category_weak", "warning", "warning"],
      ["description_cleaned", "pass", "info"],
    ],
  );
});

test("summarizes quality checklist without opaque scores", () => {
  const checklist = buildImportQualityChecklist({
    categoryConfidence: "high",
    descriptionWasChanged: false,
    imageCount: 2,
    priceAmount: 10,
    quantity: 1,
    sku: "SKU-1",
    skuGenerated: false,
    variantCount: 1,
  });

  assert.equal(getQualityChecklistSummary(checklist), "7 controlli ok");
});
