import assert from "node:assert/strict";
import { test } from "vitest";

import * as backfillModule from "./syncbay-description-backfill.ts";
import * as cleanupModule from "./syncbay-description-cleanup.ts";
import * as descriptionHashModule from "./syncbay-description-hash.ts";

const {
  buildDescriptionBackfillApplyFile,
  buildDescriptionBackfillApplyPlan,
  buildDescriptionBackfillReport,
  buildDescriptionBackfillRow,
  filterDescriptionBackfillApplyFileRows,
} = backfillModule;
const { buildDescriptionCleanupReportRow, cleanEbayDescriptionHtml } =
  cleanupModule;
const { hashNullableText } = descriptionHashModule;

test("plans a description cleanup when cleaned eBay html differs from Shopify", () => {
  const row = buildTestBackfillRow({
    currentShopifyDescriptionHtml:
      '<p style="color:red" class="rosso"><font color="#ff0000">Bella moneta.</font></p>',
    ebayDescriptionHtml:
      '<p style="color:red" class="rosso"><font color="#ff0000">Bella moneta.</font></p>',
    ebayItemId: "1001",
    mappingId: "mapping-1",
    openConflictFields: [],
    shopifyProductGid: "gid://shopify/Product/1",
    title: "Moneta Regno",
  });

  assert.equal(row.status, "applicable");
  assert.equal(row.cleanedDescriptionHtml, "<p>Bella moneta.</p>");
  assert.equal(row.reason, "description_cleanup_available");
  assert.equal(row.descriptionWasChanged, true);
  assert.ok(row.descriptionRemovedPercent > 0);
});

test("skips products without a mapped Shopify product", () => {
  assert.deepEqual(
    buildTestBackfillRow({
      ebayDescriptionHtml: '<p style="color:red">Bella moneta.</p>',
      ebayItemId: "1002",
      mappingId: "mapping-2",
      shopifyProductGid: null,
      title: "Moneta Regno",
    }).status,
    "missing_shopify_product",
  );
});

test("skips products with open conflicts", () => {
  const row = buildTestBackfillRow({
    currentShopifyDescriptionHtml: "<p>Vecchia descrizione</p>",
    ebayDescriptionHtml: '<p style="color:red">Bella moneta.</p>',
    ebayItemId: "1003",
    mappingId: "mapping-3",
    openConflictFields: ["description"],
    shopifyProductGid: "gid://shopify/Product/3",
    title: "Moneta Regno",
  });

  assert.equal(row.status, "conflict_skipped");
  assert.equal(row.reason, "open_conflicts");
});

test("skips descriptions that the cleaner does not change", () => {
  const row = buildTestBackfillRow({
    currentShopifyDescriptionHtml: "<p>Bella moneta.</p>",
    ebayDescriptionHtml: "<p>Bella moneta.</p>",
    ebayItemId: "1004",
    mappingId: "mapping-4",
    openConflictFields: [],
    shopifyProductGid: "gid://shopify/Product/4",
    title: "Moneta Regno",
  });

  assert.equal(row.status, "cleaner_unchanged");
  assert.equal(row.reason, "cleaner_did_not_change_description");
});

test("skips products already aligned to the cleaned description", () => {
  const row = buildTestBackfillRow({
    currentShopifyDescriptionHtml: "<p>Bella moneta.</p>",
    ebayDescriptionHtml:
      '<p style="color:red" class="rosso"><font color="#ff0000">Bella moneta.</font></p>',
    ebayItemId: "1005",
    mappingId: "mapping-5",
    openConflictFields: [],
    shopifyProductGid: "gid://shopify/Product/5",
    title: "Moneta Regno",
  });

  assert.equal(row.status, "already_correct");
  assert.equal(row.reason, "shopify_description_matches_cleaned_ebay");
});

test("skips products changed manually since the latest SyncBay description baseline", () => {
  const row = buildTestBackfillRow({
    currentShopifyDescriptionHtml: "<p>Descrizione riscritta a mano.</p>",
    ebayDescriptionHtml:
      '<p style="color:red" class="rosso"><font color="#ff0000">Bella moneta.</font></p>',
    ebayItemId: "1008",
    latestSyncBayDescriptionHtml:
      '<p style="color:red" class="rosso"><font color="#ff0000">Bella moneta.</font></p>',
    mappingId: "mapping-8",
    openConflictFields: [],
    shopifyProductGid: "gid://shopify/Product/8",
    title: "Moneta Regno",
  });

  assert.equal(row.status, "conflict_skipped");
  assert.equal(
    row.reason,
    "shopify_description_changed_since_last_syncbay_baseline",
  );
});

test("skips cleared Shopify descriptions as manual edits since the latest SyncBay baseline", () => {
  const row = buildTestBackfillRow({
    currentShopifyDescriptionHtml: null,
    ebayDescriptionHtml:
      '<p style="color:red" class="rosso"><font color="#ff0000">Bella moneta.</font></p>',
    ebayItemId: "1009",
    latestSyncBayDescriptionHtml:
      '<p style="color:red" class="rosso"><font color="#ff0000">Bella moneta.</font></p>',
    mappingId: "mapping-9",
    openConflictFields: [],
    shopifyProductGid: "gid://shopify/Product/9",
    title: "Moneta Regno",
  });

  assert.equal(row.status, "conflict_skipped");
  assert.equal(
    row.reason,
    "shopify_description_changed_since_last_syncbay_baseline",
  );
});

test("summarizes rows and builds an apply plan only from applicable rows", () => {
  const report = buildDescriptionBackfillReport({
    rows: [
      buildTestBackfillRow({
        currentShopifyDescriptionHtml: "<p>Vecchia</p>",
        ebayDescriptionHtml:
          '<p style="color:red" class="rosso"><font color="#ff0000">Bella moneta.</font></p>',
        ebayItemId: "1006",
        mappingId: "mapping-6",
        openConflictFields: [],
        shopifyProductGid: "gid://shopify/Product/6",
        title: "Moneta Regno",
      }),
      buildTestBackfillRow({
        currentShopifyDescriptionHtml: "<p>Bella moneta.</p>",
        ebayDescriptionHtml:
          '<p style="color:red" class="rosso"><font color="#ff0000">Bella moneta.</font></p>',
        ebayItemId: "1007",
        mappingId: "mapping-7",
        openConflictFields: [],
        shopifyProductGid: "gid://shopify/Product/7",
        title: "Moneta Regno",
      }),
    ],
    shopDomain: "fixture-shop.myshopify.com",
  });
  const plan = buildDescriptionBackfillApplyPlan(report);

  assert.equal(report.summary.applicable, 1);
  assert.equal(report.summary.alreadyCorrect, 1);
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0]?.ebayItemId, "1006");
  assert.equal(plan.skipped.alreadyCorrect, 1);
});

test("serializes an apply file with only applicable rows and full cleaned html", () => {
  const applicableRow = buildTestBackfillRow({
    currentShopifyDescriptionHtml: "<p>Vecchia</p>",
    ebayDescriptionHtml:
      '<p style="color:red" class="rosso"><font color="#ff0000">Bella moneta.</font></p>',
    ebayItemId: "1010",
    mappingId: "mapping-10",
    openConflictFields: [],
    shopifyProductGid: "gid://shopify/Product/10",
    title: "Moneta Regno",
  });
  const alreadyCorrectRow = buildTestBackfillRow({
    currentShopifyDescriptionHtml: "<p>Bella moneta.</p>",
    ebayDescriptionHtml:
      '<p style="color:red" class="rosso"><font color="#ff0000">Bella moneta.</font></p>',
    ebayItemId: "1011",
    mappingId: "mapping-11",
    openConflictFields: [],
    shopifyProductGid: "gid://shopify/Product/11",
    title: "Moneta gia corretta",
  });

  const applyFile = buildDescriptionBackfillApplyFile({
    generatedAt: "2026-06-20T12:00:00.000Z",
    report: buildDescriptionBackfillReport({
      rows: [applicableRow, alreadyCorrectRow],
      shopDomain: "fixture-shop.myshopify.com",
    }),
  });

  assert.equal(applyFile.version, 1);
  assert.equal(applyFile.shopDomain, "fixture-shop.myshopify.com");
  assert.equal(applyFile.rows.length, 1);
  assert.equal(applyFile.rows[0]?.ebayItemId, "1010");
  assert.equal(
    applyFile.rows[0]?.cleanedDescriptionHtml,
    "<p>Bella moneta.</p>",
  );
  assert.equal(
    applyFile.rows[0]?.currentShopifyDescriptionHash,
    hashNullableText("<p>Vecchia</p>"),
  );
});

test("filters apply file rows against current Shopify descriptions without eBay lookups", () => {
  const matchingRow = buildTestBackfillRow({
    currentShopifyDescriptionHtml: "<p>Vecchia</p>",
    ebayDescriptionHtml: '<p style="color:red">Bella moneta.</p>',
    ebayItemId: "1012",
    mappingId: "mapping-12",
    shopifyProductGid: "gid://shopify/Product/12",
    title: "Moneta valida",
  });
  const staleRow = buildTestBackfillRow({
    currentShopifyDescriptionHtml: "<p>Prima descrizione</p>",
    ebayDescriptionHtml: '<p style="color:red">Altra moneta.</p>',
    ebayItemId: "1013",
    mappingId: "mapping-13",
    shopifyProductGid: "gid://shopify/Product/13",
    title: "Moneta cambiata",
  });
  const applyFile = buildDescriptionBackfillApplyFile({
    generatedAt: "2026-06-20T12:00:00.000Z",
    report: buildDescriptionBackfillReport({
      rows: [matchingRow, staleRow],
      shopDomain: "fixture-shop.myshopify.com",
    }),
  });

  const plan = filterDescriptionBackfillApplyFileRows({
    currentShopifyDescriptionHashes: new Map([
      ["gid://shopify/Product/12", hashNullableText("<p>Vecchia</p>")],
      ["gid://shopify/Product/13", hashNullableText("<p>Modifica manuale</p>")],
    ]),
    file: applyFile,
  });

  assert.deepEqual(
    plan.rows.map((row) => row.ebayItemId),
    ["1012"],
  );
  assert.equal(plan.skipped.conflictSkipped, 1);
  assert.equal(plan.skipped.analyzed, 1);
});

test("filters apply file rows against current mapping eligibility", () => {
  const conflictRow = buildTestBackfillRow({
    currentShopifyDescriptionHtml: "<p>Vecchia</p>",
    ebayDescriptionHtml: '<p style="color:red">Bella moneta.</p>',
    ebayItemId: "1014",
    mappingId: "mapping-14",
    shopifyProductGid: "gid://shopify/Product/14",
    title: "Moneta con conflitto",
  });
  const remappedRow = buildTestBackfillRow({
    currentShopifyDescriptionHtml: "<p>Vecchia</p>",
    ebayDescriptionHtml: '<p style="color:red">Altra moneta.</p>',
    ebayItemId: "1015",
    mappingId: "mapping-15",
    shopifyProductGid: "gid://shopify/Product/15",
    title: "Moneta rimappata",
  });
  const applyFile = buildDescriptionBackfillApplyFile({
    generatedAt: "2026-06-20T12:00:00.000Z",
    report: buildDescriptionBackfillReport({
      rows: [conflictRow, remappedRow],
      shopDomain: "fixture-shop.myshopify.com",
    }),
  });

  const plan = filterDescriptionBackfillApplyFileRows({
    currentMappingRows: new Map([
      [
        "mapping-14",
        {
          mappingId: "mapping-14",
          openConflictFields: ["description"],
          shopifyProductGid: "gid://shopify/Product/14",
        },
      ],
      [
        "mapping-15",
        {
          mappingId: "mapping-15",
          openConflictFields: [],
          shopifyProductGid: "gid://shopify/Product/999",
        },
      ],
    ]),
    currentShopifyDescriptionHashes: new Map([
      ["gid://shopify/Product/14", hashNullableText("<p>Vecchia</p>")],
      ["gid://shopify/Product/15", hashNullableText("<p>Vecchia</p>")],
    ]),
    file: applyFile,
  });

  assert.deepEqual(plan.rows, []);
  assert.equal(plan.skipped.conflictSkipped, 2);
  assert.deepEqual(
    plan.skippedRows.map((row) => row.reason),
    ["open_conflicts", "shopify_product_mapping_changed_since_apply_file"],
  );
});

function buildTestBackfillRow(input: {
  currentShopifyDescriptionHtml?: string | null;
  ebayDescriptionHtml?: string | null;
  ebayItemId: string;
  latestSyncBayDescriptionHtml?: string | null;
  mappingId: string;
  openConflictFields?: string[];
  shopifyProductGid?: string | null;
  title?: string | null;
}) {
  const cleanup = cleanEbayDescriptionHtml(input.ebayDescriptionHtml);
  const reportRow = buildDescriptionCleanupReportRow({
    descriptionHtml: input.ebayDescriptionHtml,
    itemId: input.ebayItemId,
    title: input.title,
  });

  return buildDescriptionBackfillRow({
    ...input,
    cleanedDescriptionHash: hashNullableText(cleanup.html),
    cleanedDescriptionHtml: cleanup.html,
    cleanedTextExcerpt: reportRow.cleanedTextExcerpt,
    currentShopifyDescriptionHash: hashNullableText(
      input.currentShopifyDescriptionHtml,
    ),
    descriptionMode: cleanup.mode,
    descriptionRemovedPercent: reportRow.removedPercent,
    descriptionWasChanged: cleanup.wasChanged,
    originalDescriptionHash: hashNullableText(input.ebayDescriptionHtml),
    originalTextExcerpt: reportRow.rawTextExcerpt,
    latestSyncBayDescriptionHash: hashNullableText(
      input.latestSyncBayDescriptionHtml,
    ),
  });
}
