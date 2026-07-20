import type {
  ShopifyProductFacetMetafield,
  SyncBayProductFacet,
  SyncBayProductFacetKey,
} from "./syncbay-product-facets";

type ProductFacetBackfillStatus =
  | "already_correct"
  | "applicable"
  | "conflict_manual"
  | "ebay_lookup_failed"
  | "missing_shopify_product"
  | "uncertain";

interface CurrentProductFacetMetafield {
  key: string;
  namespace: string;
  type: string;
  value: string;
}

export interface ProductFacetBackfillReportRowInput {
  currentMetafields: CurrentProductFacetMetafield[];
  ebayItemId: string;
  lookupFailureReason?: string | null;
  lookupFailed?: boolean;
  proposedFacets: SyncBayProductFacet[];
  shopifyProductGid: string | null;
}

interface ProductFacetBackfillReportRow extends ProductFacetBackfillReportRowInput {
  conflicts: ShopifyProductFacetMetafield[];
  missingMetafields: ShopifyProductFacetMetafield[];
  status: ProductFacetBackfillStatus;
}

export interface ProductFacetBackfillReport {
  proposedFacets: Array<{
    count: number;
    key: SyncBayProductFacetKey;
    label: string;
    value: string;
  }>;
  rows: ProductFacetBackfillReportRow[];
  shopDomain: string;
  summary: {
    alreadyCorrect: number;
    applicable: number;
    conflictsManual: number;
    ebayLookupFailed: number;
    missingShopifyProduct: number;
    total: number;
    uncertain: number;
  };
}

export interface ProductFacetApplyPlan {
  rows: Array<{
    ebayItemId: string;
    metafields: Array<ShopifyProductFacetMetafield & { ownerId: string }>;
    shopifyProductGid: string;
  }>;
  skipped: {
    alreadyCorrect: number;
    conflictsManual: number;
    ebayLookupFailed: number;
    missingShopifyProduct: number;
    uncertain: number;
  };
}

export function buildProductFacetBackfillReport(input: {
  rows: ProductFacetBackfillReportRowInput[];
  shopDomain: string;
}): ProductFacetBackfillReport {
  const rows = input.rows.map((row) => {
    const missingMetafields = getMissingMetafields(row);
    const conflicts = getConflicts(row);

    return {
      ...row,
      conflicts,
      missingMetafields,
      status: getProductFacetBackfillStatus(row, missingMetafields, conflicts),
    };
  });

  return {
    proposedFacets: getProposedFacets(rows),
    rows,
    shopDomain: input.shopDomain,
    summary: {
      alreadyCorrect: countStatus(rows, "already_correct"),
      applicable: countStatus(rows, "applicable"),
      conflictsManual: countStatus(rows, "conflict_manual"),
      ebayLookupFailed: countStatus(rows, "ebay_lookup_failed"),
      missingShopifyProduct: countStatus(rows, "missing_shopify_product"),
      total: rows.length,
      uncertain: countStatus(rows, "uncertain"),
    },
  };
}

export function buildProductFacetApplyPlan(
  report: ProductFacetBackfillReport,
): ProductFacetApplyPlan {
  return {
    rows: report.rows.flatMap((row) => {
      if (
        row.status !== "applicable" ||
        !row.shopifyProductGid ||
        row.missingMetafields.length === 0
      ) {
        return [];
      }

      return [
        {
          ebayItemId: row.ebayItemId,
          metafields: row.missingMetafields.map((metafield) => ({
            ...metafield,
            ownerId: row.shopifyProductGid!,
          })),
          shopifyProductGid: row.shopifyProductGid,
        },
      ];
    }),
    skipped: {
      alreadyCorrect: report.summary.alreadyCorrect,
      conflictsManual: report.summary.conflictsManual,
      ebayLookupFailed: report.summary.ebayLookupFailed,
      missingShopifyProduct: report.summary.missingShopifyProduct,
      uncertain: report.summary.uncertain,
    },
  };
}

function getProductFacetBackfillStatus(
  row: ProductFacetBackfillReportRowInput,
  missingMetafields: ShopifyProductFacetMetafield[],
  conflicts: ShopifyProductFacetMetafield[],
): ProductFacetBackfillStatus {
  if (!row.shopifyProductGid) return "missing_shopify_product";
  if (row.proposedFacets.length === 0) {
    return row.lookupFailed ? "ebay_lookup_failed" : "uncertain";
  }
  if (conflicts.length > 0) return "conflict_manual";
  if (missingMetafields.length === 0) return "already_correct";

  return "applicable";
}

function getMissingMetafields(row: ProductFacetBackfillReportRowInput) {
  return row.proposedFacets.flatMap((facet) => {
    const current = findCurrentMetafield(row.currentMetafields, facet);
    if (current && isExactMetafieldMatch(current, facet)) return [];
    if (current && !hasSameMetafieldValues(current, facet)) return [];

    return [toShopifyProductFacetMetafield(facet)];
  });
}

function getConflicts(row: ProductFacetBackfillReportRowInput) {
  return row.proposedFacets.flatMap((facet) => {
    const current = findCurrentMetafield(row.currentMetafields, facet);
    if (!current) return [];
    if (hasSameMetafieldValues(current, facet)) return [];

    return [toShopifyProductFacetMetafield(facet)];
  });
}

function findCurrentMetafield(
  currentMetafields: CurrentProductFacetMetafield[],
  facet: SyncBayProductFacet,
) {
  return currentMetafields.find(
    (metafield) => metafield.namespace === facet.namespace && metafield.key === facet.key,
  );
}

function isExactMetafieldMatch(current: CurrentProductFacetMetafield, facet: SyncBayProductFacet) {
  return current.type === facet.type && current.value === facet.value;
}

function hasSameMetafieldValues(current: CurrentProductFacetMetafield, facet: SyncBayProductFacet) {
  return areSameValues(
    parseMetafieldValues(current.type, current.value),
    parseMetafieldValues(facet.type, facet.value),
  );
}

function parseMetafieldValues(type: string, value: string) {
  if (type !== "list.single_line_text_field") return [value];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function areSameValues(left: string[], right: string[]) {
  if (left.length !== right.length) return false;

  return left.every((value, index) => value === right[index]);
}

function toShopifyProductFacetMetafield(facet: SyncBayProductFacet): ShopifyProductFacetMetafield {
  return {
    key: facet.key,
    namespace: facet.namespace,
    type: facet.type,
    value: facet.value,
  };
}

function getProposedFacets(rows: ProductFacetBackfillReportRow[]) {
  const counts = new Map<
    string,
    {
      count: number;
      key: SyncBayProductFacetKey;
      label: string;
      value: string;
    }
  >();

  for (const row of rows) {
    for (const facet of row.proposedFacets) {
      const countKey = `${facet.key}\0${facet.value}`;
      const current = counts.get(countKey);
      counts.set(countKey, {
        count: (current?.count ?? 0) + 1,
        key: facet.key,
        label: facet.label,
        value: facet.value,
      });
    }
  }

  return [...counts.values()].sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    if (left.label !== right.label) return left.label.localeCompare(right.label);

    return left.value.localeCompare(right.value);
  });
}

function countStatus(rows: ProductFacetBackfillReportRow[], status: ProductFacetBackfillStatus) {
  return rows.filter((row) => row.status === status).length;
}
