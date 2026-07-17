import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import {
  buildEgressBudgetReport,
  getEgressBudgetReadRows,
  isEgressReadStatementQuery,
} from "./syncbay-egress-budget.ts";

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

test("uses SELECT rows as the egress proxy when DML rows affected are high", () => {
  assert.equal(
    getEgressBudgetReadRows({
      selectRows: 1_775,
      totalRows: 42_435,
    }),
    1_775,
  );
});

test("falls back to total rows when SELECT rows are unavailable", () => {
  assert.equal(
    getEgressBudgetReadRows({
      selectRows: null,
      totalRows: 1_641,
    }),
    1_641,
  );
});

test("classifies simple SELECT and read-only CTE queries as egress reads", () => {
  assert.equal(
    isEgressReadStatementQuery(
      'SELECT "public"."Shop"."id" FROM "public"."Shop" WHERE "id" = $1',
    ),
    true,
  );

  assert.equal(
    isEgressReadStatementQuery(`
      WITH open_conflicts AS (
        SELECT "mappingId", COUNT(*)::integer AS "openConflictCount"
        FROM "SyncConflict"
        GROUP BY "mappingId"
      ),
      catalog_rows AS (
        SELECT m."id", COALESCE(oc."openConflictCount", 0) AS conflicts
        FROM "ProductMapping" m
        LEFT JOIN open_conflicts oc ON oc."mappingId" = m."id"
      )
      SELECT COUNT(*)::integer AS "freshCount"
      FROM catalog_rows
    `),
    true,
  );

  assert.equal(
    isEgressReadStatementQuery(`
      WITH ids(id) AS (
        VALUES ($1), ($2)
      )
      SELECT id
      FROM ids
    `),
    true,
  );
});

test("keeps DML statements out of the egress read classifier", () => {
  assert.equal(
    isEgressReadStatementQuery(
      'DELETE FROM "public"."EbayAccountDeletionRequest" WHERE "createdAt" <= $1',
    ),
    false,
  );

  assert.equal(
    isEgressReadStatementQuery(`
      WITH stale_rows AS (
        SELECT "id"
        FROM "SyncJob"
        WHERE "createdAt" <= $1
      )
      DELETE FROM "SyncJob"
      USING stale_rows
      WHERE "SyncJob"."id" = stale_rows."id"
    `),
    false,
  );

  assert.equal(
    isEgressReadStatementQuery(`
      WITH updated_mappings AS (
        UPDATE "ProductMapping"
        SET status = 'OUT_OF_STOCK'
        WHERE status = 'ARCHIVED'
        RETURNING *
      )
      INSERT INTO "ProductSnapshot"
        (id, "mappingId", payload)
      SELECT
        gen_random_uuid()::text, m.id, jsonb_build_object('backfill', true)
      FROM updated_mappings m
    `),
    false,
  );
});
