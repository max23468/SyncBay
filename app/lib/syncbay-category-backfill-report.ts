import type { ShopifyCategoryProposal } from "./syncbay-shopify-category-mapping";

type CategoryBackfillStatus =
  | "already_correct"
  | "applicable"
  | "conflict_manual"
  | "ebay_lookup_failed"
  | "missing_shopify_product"
  | "uncertain";

const SHOPIFY_TAXONOMY_GIDS = {
  bullionCoins: "gid://shopify/TaxonomyCategory/ae-2-2-2-2-1",
  collectibleBanknotes: "gid://shopify/TaxonomyCategory/ae-2-2-2-1",
  collectibleCoins: "gid://shopify/TaxonomyCategory/ae-2-2-2-2",
  collectibleCoinsAndCurrency: "gid://shopify/TaxonomyCategory/ae-2-2-2",
  commemorativeCoins: "gid://shopify/TaxonomyCategory/ae-2-2-2-2-2",
  firstDayCovers: "gid://shopify/TaxonomyCategory/ae-2-2-5-3",
  postageStamps: "gid://shopify/TaxonomyCategory/ae-2-2-5",
  rareCoins: "gid://shopify/TaxonomyCategory/ae-2-2-2-2-3",
} as const;

export interface CategoryBackfillReportRowInput {
  ebayItemId: string;
  lookupFailureReason?: string | null;
  lookupFailed?: boolean;
  proposal: ShopifyCategoryProposal | null;
  shopifyCategoryGid: string | null;
  shopifyProductGid: string | null;
  shopifyProductType: string | null;
}

interface CategoryBackfillReportRow extends CategoryBackfillReportRowInput {
  status: CategoryBackfillStatus;
}

export interface CategoryBackfillReport {
  proposedCategories: Array<{
    count: number;
    shopifyCategoryGid: string;
    shopifyCategoryName: string;
  }>;
  rows: CategoryBackfillReportRow[];
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

export interface CategoryApplyPlan {
  rows: Array<{
    ebayItemId: string;
    productType: string;
    shopifyCategoryGid: string;
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

export function buildCategoryBackfillReport(input: {
  rows: CategoryBackfillReportRowInput[];
  shopDomain: string;
}): CategoryBackfillReport {
  const rows = input.rows.map((row) => ({
    ...row,
    status: getCategoryBackfillStatus(row),
  }));

  return {
    proposedCategories: getProposedCategories(rows),
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

export function buildCategoryApplyPlan(
  report: CategoryBackfillReport,
  options: {
    forceCategoryConflicts?: boolean;
    includeCategoryConflicts?: boolean;
  } = {},
): CategoryApplyPlan {
  return {
    rows: report.rows.flatMap((row) => {
      const included =
        row.status === "applicable" ||
        (options.forceCategoryConflicts &&
          row.status === "conflict_manual") ||
        (options.includeCategoryConflicts &&
          isKnownLegacyMapperConflict(row));
      if (!included) return [];

      const mapped = {
        ebayItemId: row.ebayItemId,
        productType: row.proposal?.productType ?? "",
        shopifyCategoryGid: row.proposal?.shopifyCategoryGid ?? "",
        shopifyProductGid: row.shopifyProductGid ?? "",
      };
      if (
        !mapped.productType ||
        !mapped.shopifyCategoryGid ||
        !mapped.shopifyProductGid
      ) {
        return [];
      }

      return [mapped];
    }),
    skipped: {
      alreadyCorrect: report.summary.alreadyCorrect,
      conflictsManual: options.forceCategoryConflicts
        ? 0
        : options.includeCategoryConflicts
        ? report.rows.filter(
            (row) =>
              row.status === "conflict_manual" &&
              !isKnownLegacyMapperConflict(row),
          ).length
        : report.summary.conflictsManual,
      ebayLookupFailed: report.summary.ebayLookupFailed,
      missingShopifyProduct: report.summary.missingShopifyProduct,
      uncertain: report.summary.uncertain,
    },
  };
}

function isKnownLegacyMapperConflict(row: CategoryBackfillReportRow) {
  const proposal = row.proposal;
  if (row.status !== "conflict_manual" || !proposal) {
    return false;
  }

  const canRepairHighConfidence = proposal.confidence === "high";
  const canRepairUnchangedProductType =
    proposal.confidence === "medium" &&
    normalizeNullableText(row.shopifyProductType) === proposal.productType;

  const isCoinFlatteningConflict =
    (canRepairHighConfidence || canRepairUnchangedProductType) &&
    proposal.shopifyCategoryGid === SHOPIFY_TAXONOMY_GIDS.collectibleCoins &&
    ["Monete italiane", "Monete commemorative", "Monete bullion"].includes(
      proposal.productType,
    ) &&
    new Set<string>([
      SHOPIFY_TAXONOMY_GIDS.bullionCoins,
      SHOPIFY_TAXONOMY_GIDS.commemorativeCoins,
      SHOPIFY_TAXONOMY_GIDS.firstDayCovers,
      SHOPIFY_TAXONOMY_GIDS.rareCoins,
    ]).has(row.shopifyCategoryGid ?? "");

  const isMedalFlatteningConflict =
    canRepairHighConfidence &&
    proposal.shopifyCategoryGid ===
      SHOPIFY_TAXONOMY_GIDS.collectibleCoinsAndCurrency &&
    proposal.productType === "Medaglie" &&
    new Set<string>([
      SHOPIFY_TAXONOMY_GIDS.collectibleCoins,
      SHOPIFY_TAXONOMY_GIDS.postageStamps,
      SHOPIFY_TAXONOMY_GIDS.rareCoins,
    ]).has(row.shopifyCategoryGid ?? "");

  const isBanknoteFromCoinConflict =
    canRepairHighConfidence &&
    proposal.shopifyCategoryGid ===
      SHOPIFY_TAXONOMY_GIDS.collectibleBanknotes &&
    proposal.productType === "Banconote italiane" &&
    new Set<string>([
      SHOPIFY_TAXONOMY_GIDS.collectibleCoins,
      SHOPIFY_TAXONOMY_GIDS.rareCoins,
    ]).has(row.shopifyCategoryGid ?? "");

  return (
    isCoinFlatteningConflict ||
    isMedalFlatteningConflict ||
    isBanknoteFromCoinConflict
  );
}

function getCategoryBackfillStatus(
  row: CategoryBackfillReportRowInput,
): CategoryBackfillStatus {
  if (!row.shopifyProductGid) return "missing_shopify_product";

  const proposal = row.proposal;
  if (
    !proposal ||
    proposal.confidence === "low" ||
    !proposal.shopifyCategoryGid
  ) {
    if (row.lookupFailed) return "ebay_lookup_failed";

    return "uncertain";
  }

  if (
    row.shopifyCategoryGid &&
    row.shopifyCategoryGid !== proposal.shopifyCategoryGid
  ) {
    return "conflict_manual";
  }

  if (
    row.shopifyCategoryGid === proposal.shopifyCategoryGid &&
    normalizeNullableText(row.shopifyProductType) === proposal.productType
  ) {
    return "already_correct";
  }

  return "applicable";
}

function getProposedCategories(rows: CategoryBackfillReportRow[]) {
  const counts = new Map<
    string,
    { count: number; shopifyCategoryGid: string; shopifyCategoryName: string }
  >();

  for (const row of rows) {
    const proposal = row.proposal;
    if (!proposal?.shopifyCategoryGid || !proposal.shopifyCategoryName) {
      continue;
    }

    const current = counts.get(proposal.shopifyCategoryGid);
    counts.set(proposal.shopifyCategoryGid, {
      count: (current?.count ?? 0) + 1,
      shopifyCategoryGid: proposal.shopifyCategoryGid,
      shopifyCategoryName: proposal.shopifyCategoryName,
    });
  }

  return [...counts.values()].sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;

    return left.shopifyCategoryName.localeCompare(right.shopifyCategoryName);
  });
}

function countStatus(
  rows: CategoryBackfillReportRow[],
  status: CategoryBackfillStatus,
) {
  return rows.filter((row) => row.status === status).length;
}

function normalizeNullableText(value: string | null) {
  const normalized = value?.trim();

  return normalized && normalized.length > 0 ? normalized : null;
}
