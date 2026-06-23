import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildEgressBudgetReport } from "./syncbay-egress-budget.ts";

test("computes the 5 GB monthly egress budget without inventing byte data", () => {
  const report = buildEgressBudgetReport({
    monthlyBudgetGb: 5,
    totalRows: 1_200,
    windowMinutes: 60,
  });

  assert.equal(report.monthlyBudgetMb, 5_000);
  assert.equal(report.dailyBudgetMb, 166.67);
  assert.equal(report.windowBudgetMb, 6.94);
  assert.equal(report.rowsPerDay, 28_800);
  assert.equal(report.maxAverageBytesPerRowForBudget, 5_787);
  assert.equal(report.estimatedWindowEgressMb, null);
  assert.equal(report.budgetUsageRatio, null);
  assert.equal(report.status, "unestimated");
});

test("classifies estimated egress against the monthly budget", () => {
  assert.equal(
    buildEgressBudgetReport({
      estimatedAverageBytesPerRow: 3_000,
      monthlyBudgetGb: 5,
      totalRows: 1_200,
      windowMinutes: 60,
    }).status,
    "within_budget",
  );

  assert.equal(
    buildEgressBudgetReport({
      estimatedAverageBytesPerRow: 5_700,
      monthlyBudgetGb: 5,
      totalRows: 1_200,
      windowMinutes: 60,
    }).status,
    "near_budget",
  );

  assert.equal(
    buildEgressBudgetReport({
      estimatedAverageBytesPerRow: 7_000,
      monthlyBudgetGb: 5,
      totalRows: 1_200,
      windowMinutes: 60,
    }).status,
    "over_budget",
  );
});
