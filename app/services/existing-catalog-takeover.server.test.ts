import assert from "node:assert/strict";
import test from "node:test";

import {
  EbayConnectionStatus,
  type EbayConnection,
  type Prisma,
} from "@prisma/client";

import type { ExistingCatalogTakeoverApplyRow } from "../lib/syncbay-existing-catalog-takeover";
import type { ExistingProductMatchSuggestion } from "../lib/syncbay-product-matching";
import type { ImportPreviewItem } from "./import-preview.server";
import {
  applyExistingCatalogTakeoverClaims,
  getExistingCatalogTakeoverPreview,
  runExistingCatalogTakeoverStart,
} from "./existing-catalog-takeover.server";
import {
  buildCatalogImportBatchPayload,
  type ShopifyAdminGraphqlClient,
} from "./syncbay.server";

const admin: ShopifyAdminGraphqlClient = {
  graphql: async () => new Response(JSON.stringify({ data: {} })),
};
const connection = {
  status: EbayConnectionStatus.CONNECTED,
} as EbayConnection;

test("builds a conservative read-only existing catalog preview", async () => {
  const calls: string[] = [];
  const result = await getExistingCatalogTakeoverPreview(
    {
      connection,
      descriptionRuleMode: "CLEAN_HTML",
      maxProducts: 2_000,
    },
    {
      getAccessToken: async () => {
        calls.push("token");
        return { accessToken: "synthetic-token" };
      },
      getPreview: async () => {
        calls.push("preview");
        return {
          previewResult: makePreviewResult([]),
          readCount: 2,
          totalAvailable: 5,
          totalPlanned: 2,
          truncatedAtMaxProducts: true,
        };
      },
    },
  );

  assert.deepEqual(calls, ["token", "preview"]);
  assert.equal(result.errorMessage, null);
  assert.equal(result.source, "trading_api");
  assert.deepEqual(result.readCounts, { inventoryApi: 0, tradingApi: 2 });
  assert.match(result.coverageNote, /sola lettura|GetMyeBaySelling/);
  assert.match(result.coverageNote, /rate limit e timeout/);
});

test("blocks apply when the dry-run contains blocking rows", async () => {
  const writes: string[] = [];
  const item = makePreviewItem({
    issueCodes: ["invalid_price"],
    matchSuggestions: [makeAutoMatch()],
    priceAmount: null,
  });
  const result = await withDraftImportEnabled(() =>
    runStartWithItems([item], writes),
  );

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join(" "), /righe bloccanti/);
  assert.deepEqual(writes, []);
});

test("does not write rows that remain da_rivedere", async () => {
  const writes: string[] = [];
  const item = makePreviewItem({
    matchSuggestions: [
      {
        ...makeAutoMatch(),
        autoLinkable: false,
        confidence: "medium",
        reasonCodes: ["title_very_similar"],
        reasons: ["Titolo molto simile"],
        score: 40,
      },
    ],
  });
  const result = await withDraftImportEnabled(() =>
    runStartWithItems([item], writes),
  );

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join(" "), /Nessuna riga applicabile/);
  assert.deepEqual(writes, []);
});

test("serializes the field policy in the reuse-only import payload", async () => {
  const writes: string[] = [];
  let batchInput:
    Parameters<typeof buildCatalogImportBatchPayload>[0] | undefined;
  const item = makePreviewItem({
    matchSuggestions: [
      {
        ...makeAutoMatch(),
        currentHandle: "moneta-manuale",
        currentTags: ["Tag manuale", "Vecchia app"],
        shopifyImageCount: 2,
      },
    ],
  });

  const result = await withDraftImportEnabled(() =>
    runStartWithItems([item], writes, {
      legacyTagsToRemove: ["Vecchia app"],
      onBatch: (input) => {
        batchInput = input;
      },
    }),
  );

  assert.equal(result.status, "queued");
  assert.ok(batchInput);
  const payload = buildCatalogImportBatchPayload(batchInput);
  assert.equal(payload.reuseOnly, true);
  assert.deepEqual(payload.existingCatalogFieldPoliciesByItemId, {
    "item-1": {
      handle: {
        currentHandle: "moneta-manuale",
        operation: "preserve",
        redirectRequired: false,
      },
      images: { operation: "preserve" },
      tags: {
        add: ["Negozio eBay"],
        preserve: ["Tag manuale"],
        remove: ["Vecchia app"],
      },
    },
  });
  assert.deepEqual(writes, ["claims", "batch", "enable", "audit"]);
});

test("records the pre-claim snapshot before metafields and mappings", async () => {
  const order: string[] = [];
  let snapshots: Prisma.ProductSnapshotCreateManyInput[] = [];
  const item = makePreviewItem({ matchSuggestions: [makeAutoMatch()] });
  const row = makeApplyRow(item);

  await applyExistingCatalogTakeoverClaims(
    {
      admin,
      now: new Date("2026-07-13T12:00:00.000Z"),
      previewItemsByItemId: new Map([[item.itemId, item]]),
      rows: [row],
      shopId: "shop-1",
    },
    {
      loadProducts: async () =>
        new Map([
          [
            row.productGid,
            {
              descriptionHtml: "<p>Descrizione manuale</p>",
              handle: "handle-manuale",
              id: row.productGid,
              status: "ACTIVE",
              tags: ["Tag manuale", "Collezione privata"],
              title: "Titolo manuale",
              variants: {
                nodes: [
                  {
                    id: row.variantGid,
                    price: "12.50",
                    sku: row.sku,
                  },
                ],
              },
            },
          ],
        ]),
      recordSnapshots: async (values) => {
        order.push("snapshot");
        snapshots = values;
      },
      upsertMappings: async () => {
        order.push("mapping");
      },
      writeMetafields: async () => {
        order.push("metafields");
      },
      writeSnapshotAudit: async () => {
        order.push("snapshot-audit");
      },
    },
  );

  assert.deepEqual(order, [
    "snapshot",
    "snapshot-audit",
    "metafields",
    "mapping",
  ]);
  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0]?.payload, {
    handle: "handle-manuale",
    metafields: [],
    source: "existing_catalog_takeover_pre_claim",
    tags: ["Tag manuale", "Collezione privata"],
    variantGid: row.variantGid,
    variants: [{ id: row.variantGid, price: "12.50", sku: row.sku }],
  });
});

async function runStartWithItems(
  items: ImportPreviewItem[],
  writes: string[],
  options: {
    legacyTagsToRemove?: string[];
    onBatch?: (
      input: Parameters<typeof buildCatalogImportBatchPayload>[0],
    ) => void;
  } = {},
) {
  return runExistingCatalogTakeoverStart(
    {
      admin,
      confirmation: "COLLEGA",
      connection,
      legacyTagsToRemove: options.legacyTagsToRemove ?? [],
      shop: {
        defaultLocationGid: "gid://shopify/Location/1",
        defaultProductStatus: "DRAFT",
        id: "shop-1",
      } as Parameters<typeof runExistingCatalogTakeoverStart>[0]["shop"],
    },
    {
      applyClaims: async () => {
        writes.push("claims");
      },
      createRunId: () => "run-1",
      enableSync: async () => {
        writes.push("enable");
      },
      enqueueBatch: async (input) => {
        writes.push("batch");
        options.onBatch?.(input);
        return "created";
      },
      getDraftLimit: () => 25,
      loadWizard: async () => makeWizard(items),
      now: () => new Date("2026-07-13T12:00:00.000Z"),
      writeAudit: async () => {
        writes.push("audit");
      },
    },
  );
}

function makeWizard(items: ImportPreviewItem[]) {
  return {
    previewResult: {
      ...makePreviewResult(items),
      existingCatalogTakeover: {
        rows: [],
        shopDomain: "example.myshopify.com",
        summary: {
          alreadyLinked: 0,
          applicable: 0,
          blocked: 0,
          review: 0,
          total: items.length,
        },
      },
    },
    previewSource: {
      errorMessage: null,
      readCount: items.length,
      totalAvailable: items.length,
    },
  } as unknown as Awaited<
    ReturnType<(typeof import("./syncbay.server"))["getImportWizardState"]>
  >;
}

function makePreviewResult(items: ImportPreviewItem[]) {
  return {
    items,
    mode: "live" as const,
    summary: {
      errorCount: items.filter((item) => item.status === "error").length,
      importableCount: items.filter((item) => item.status === "importable")
        .length,
      skippedCount: items.filter((item) => item.status === "skipped").length,
      totalCount: items.length,
      warningCount: 0,
    },
  };
}

function makePreviewItem(input: {
  issueCodes?: string[];
  matchSuggestions: ExistingProductMatchSuggestion[];
  priceAmount?: number | null;
}): ImportPreviewItem {
  const issueCodes = input.issueCodes ?? [];
  return {
    itemId: "item-1",
    issues: issueCodes.map((code) => ({
      code,
      message: code,
      severity: "error",
    })),
    matchSuggestions: input.matchSuggestions,
    normalized: {
      categoryProposal: {
        applied: false,
        confidence: "high",
        productType: "Monete da collezione",
        reason: "dry_run_only",
        shopifyCategoryGid: "gid://shopify/TaxonomyCategory/1",
        shopifyCategoryName: "Collectible Coins",
        source: "title",
      },
      currency: "EUR",
      descriptionCleanedLength: 11,
      descriptionCleanedTextExcerpt: "Descrizione",
      descriptionHtml: "<p>Descrizione</p>",
      descriptionMode: "CLEAN_HTML",
      descriptionOriginalLength: 11,
      descriptionOriginalTextExcerpt: "Descrizione",
      descriptionRemovedPercent: 0,
      descriptionTemplateSignalCount: 0,
      descriptionWasChanged: false,
      ebayPrimaryCategoryId: "111",
      ebayPrimaryCategoryName: "Monete",
      ebayPrimaryCategoryPath: "Collezionismo > Monete",
      imageCount: 1,
      imageUrls: ["https://example.invalid/synthetic.jpg"],
      priceAmount: input.priceAmount === undefined ? 12.5 : input.priceAmount,
      productFacets: [],
      productStatus: "published",
      qualityChecklist: [],
      qualitySummary: "nessun blocco",
      quantity: 1,
      sku: "SKU-1",
      skuGenerated: false,
      storeCategoryId: "222",
      storeCategoryName: "Numismatica",
      title: "Prodotto sintetico",
    },
    status: issueCodes.length > 0 ? "error" : "importable",
  };
}

function makeAutoMatch(): ExistingProductMatchSuggestion {
  return {
    autoLinkable: true,
    confidence: "high",
    productGid: "gid://shopify/Product/1",
    reasonCodes: ["sku_exact"],
    reasons: ["SKU identico"],
    score: 100,
    variantGid: "gid://shopify/ProductVariant/1",
  };
}

function makeApplyRow(
  item: ImportPreviewItem,
): ExistingCatalogTakeoverApplyRow {
  return {
    fieldPolicy: {
      handle: {
        currentHandle: "handle-manuale",
        operation: "preserve",
        redirectRequired: false,
      },
      images: { operation: "preserve" },
      tags: { add: ["Negozio eBay"], preserve: ["Tag manuale"], remove: [] },
    },
    itemId: item.itemId,
    productGid: "gid://shopify/Product/1",
    sku: item.normalized.sku,
    variantGid: "gid://shopify/ProductVariant/1",
  };
}

async function withDraftImportEnabled<T>(callback: () => Promise<T>) {
  const previous = process.env.SYNCBAY_DRAFT_IMPORT_ENABLED;
  process.env.SYNCBAY_DRAFT_IMPORT_ENABLED = "true";
  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete process.env.SYNCBAY_DRAFT_IMPORT_ENABLED;
    } else {
      process.env.SYNCBAY_DRAFT_IMPORT_ENABLED = previous;
    }
  }
}
