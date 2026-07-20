type DescriptionBackfillStatus =
  | "applicable"
  | "already_correct"
  | "cleaner_unchanged"
  | "conflict_skipped"
  | "ebay_description_missing"
  | "ebay_lookup_failed"
  | "empty_cleaned_description"
  | "missing_shopify_product"
  | "shopify_lookup_failed";

export interface DescriptionBackfillInput {
  cleanedDescriptionHash: string | null;
  cleanedDescriptionHtml: string | null;
  cleanedTextExcerpt: string;
  currentShopifyDescriptionHtml?: string | null;
  currentShopifyDescriptionHash: string | null;
  descriptionMode: string;
  descriptionRemovedPercent: number;
  descriptionWasChanged: boolean;
  ebayDescriptionHtml?: string | null;
  ebayItemId: string;
  ebayLookupFailed?: boolean;
  ebayLookupFailureReason?: string | null;
  latestSyncBayDescriptionHash?: string | null;
  mappingId: string;
  openConflictFields?: string[];
  originalDescriptionHash: string | null;
  originalTextExcerpt: string;
  shopifyLookupFailed?: boolean;
  shopifyProductGid?: string | null;
  title?: string | null;
}

export interface DescriptionBackfillRow {
  cleanedDescriptionHash: string | null;
  cleanedDescriptionHtml: string | null;
  cleanedTextExcerpt: string;
  currentShopifyDescriptionHash: string | null;
  descriptionMode: string;
  descriptionRemovedPercent: number;
  descriptionWasChanged: boolean;
  ebayItemId: string;
  ebayLookupFailureReason: string | null;
  mappingId: string;
  openConflictFields: string[];
  originalDescriptionHash: string | null;
  originalTextExcerpt: string;
  reason: string;
  shopifyProductGid: string | null;
  status: DescriptionBackfillStatus;
  title: string;
}

export interface DescriptionBackfillReport {
  rows: DescriptionBackfillRow[];
  shopDomain: string;
  summary: DescriptionBackfillSummary;
}

interface DescriptionBackfillSummary {
  alreadyCorrect: number;
  analyzed: number;
  applicable: number;
  cleanerUnchanged: number;
  conflictSkipped: number;
  ebayDescriptionMissing: number;
  ebayLookupFailed: number;
  emptyCleanedDescription: number;
  missingShopifyProduct: number;
  shopifyLookupFailed: number;
}

export interface DescriptionBackfillApplyFile {
  generatedAt: string;
  rows: DescriptionBackfillRow[];
  shopDomain: string;
  version: 1;
}

export function buildDescriptionBackfillRow(
  input: DescriptionBackfillInput,
): DescriptionBackfillRow {
  const baseRow = {
    cleanedDescriptionHash: input.cleanedDescriptionHash,
    cleanedDescriptionHtml: input.cleanedDescriptionHtml,
    cleanedTextExcerpt: input.cleanedTextExcerpt,
    currentShopifyDescriptionHash: input.currentShopifyDescriptionHash,
    descriptionMode: input.descriptionMode,
    descriptionRemovedPercent: input.descriptionRemovedPercent,
    descriptionWasChanged: input.descriptionWasChanged,
    ebayItemId: input.ebayItemId,
    ebayLookupFailureReason: input.ebayLookupFailureReason?.trim() || null,
    mappingId: input.mappingId,
    openConflictFields: normalizeConflictFields(input.openConflictFields),
    originalDescriptionHash: input.originalDescriptionHash,
    originalTextExcerpt: input.originalTextExcerpt,
    shopifyProductGid: input.shopifyProductGid?.trim() || null,
    title: normalizeTitle(input.title, input.ebayItemId),
  };

  if (!baseRow.shopifyProductGid) {
    return withStatus(baseRow, "missing_shopify_product", "shopify_product_not_mapped");
  }

  if (input.shopifyLookupFailed) {
    return withStatus(baseRow, "shopify_lookup_failed", "shopify_product_not_loaded");
  }

  if (baseRow.openConflictFields.length > 0) {
    return withStatus(baseRow, "conflict_skipped", "open_conflicts");
  }

  if (input.ebayLookupFailed) {
    return withStatus(baseRow, "ebay_lookup_failed", "ebay_description_lookup_failed");
  }

  if (!input.ebayDescriptionHtml?.trim()) {
    return withStatus(baseRow, "ebay_description_missing", "ebay_description_missing");
  }

  if (!input.cleanedDescriptionHtml) {
    return withStatus(baseRow, "empty_cleaned_description", "cleaner_removed_entire_description");
  }

  if (!input.descriptionWasChanged) {
    return withStatus(baseRow, "cleaner_unchanged", "cleaner_did_not_change_description");
  }

  if (input.cleanedDescriptionHash === input.currentShopifyDescriptionHash) {
    return withStatus(baseRow, "already_correct", "shopify_description_matches_cleaned_ebay");
  }

  if (
    input.latestSyncBayDescriptionHash &&
    input.currentShopifyDescriptionHash !== input.latestSyncBayDescriptionHash
  ) {
    return withStatus(
      baseRow,
      "conflict_skipped",
      "shopify_description_changed_since_last_syncbay_baseline",
    );
  }

  return withStatus(baseRow, "applicable", "description_cleanup_available");
}

export function buildDescriptionBackfillReport(input: {
  rows: DescriptionBackfillRow[];
  shopDomain: string;
}): DescriptionBackfillReport {
  return {
    rows: input.rows,
    shopDomain: input.shopDomain,
    summary: summarizeRows(input.rows),
  };
}

export function buildDescriptionBackfillApplyPlan(report: DescriptionBackfillReport) {
  const rows = report.rows.filter(
    (row) => row.status === "applicable" && row.cleanedDescriptionHtml,
  );
  const skipped = summarizeRows(report.rows.filter((row) => row.status !== "applicable"));

  return { rows, skipped };
}

export function buildDescriptionBackfillApplyFile(input: {
  generatedAt: string;
  report: DescriptionBackfillReport;
}): DescriptionBackfillApplyFile {
  return {
    generatedAt: input.generatedAt,
    rows: buildDescriptionBackfillApplyPlan(input.report).rows,
    shopDomain: input.report.shopDomain,
    version: 1,
  };
}

export function filterDescriptionBackfillApplyFileRows(input: {
  currentMappingRows?: Map<
    string,
    {
      openConflictFields?: string[];
      shopifyProductGid?: string | null;
    }
  >;
  currentShopifyDescriptionHashes: Map<string, string | null>;
  file: DescriptionBackfillApplyFile;
}) {
  const rows: DescriptionBackfillRow[] = [];
  const skippedRows: DescriptionBackfillRow[] = [];

  for (const row of input.file.rows) {
    const currentMapping = input.currentMappingRows?.get(row.mappingId);
    const currentConflictFields = normalizeConflictFields(currentMapping?.openConflictFields);

    if (input.currentMappingRows && !currentMapping) {
      skippedRows.push({
        ...row,
        reason: "mapping_not_currently_applicable",
        status: "conflict_skipped",
      });
      continue;
    }

    if (currentConflictFields.length > 0) {
      skippedRows.push({
        ...row,
        openConflictFields: currentConflictFields,
        reason: "open_conflicts",
        status: "conflict_skipped",
      });
      continue;
    }

    if (currentMapping && currentMapping.shopifyProductGid !== row.shopifyProductGid) {
      skippedRows.push({
        ...row,
        reason: "shopify_product_mapping_changed_since_apply_file",
        shopifyProductGid: currentMapping.shopifyProductGid ?? null,
        status: "conflict_skipped",
      });
      continue;
    }

    const currentHash = row.shopifyProductGid
      ? input.currentShopifyDescriptionHashes.get(row.shopifyProductGid)
      : undefined;

    if (currentHash === row.currentShopifyDescriptionHash) {
      rows.push(row);
      continue;
    }

    skippedRows.push({
      ...row,
      reason:
        currentHash === undefined
          ? "shopify_product_not_loaded"
          : "shopify_description_changed_since_apply_file",
      status: currentHash === undefined ? "shopify_lookup_failed" : "conflict_skipped",
    });
  }

  return {
    rows,
    skipped: summarizeRows(skippedRows),
    skippedRows,
  };
}

export function buildDescriptionBackfillSnapshotPayload(input: {
  cleanedDescriptionHash: string | null;
  descriptionMode: string;
  descriptionRemovedPercent: number;
  originalDescriptionHash: string | null;
}) {
  return {
    cleanedDescriptionHash: input.cleanedDescriptionHash,
    descriptionBackfill: true,
    descriptionMode: input.descriptionMode,
    descriptionRemovedPercent: input.descriptionRemovedPercent,
    originalDescriptionHash: input.originalDescriptionHash,
  };
}

function normalizeTitle(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();

  return normalized || fallback;
}

function withStatus(
  row: Omit<DescriptionBackfillRow, "reason" | "status">,
  status: DescriptionBackfillStatus,
  reason: string,
): DescriptionBackfillRow {
  return { ...row, reason, status };
}

function summarizeRows(rows: DescriptionBackfillRow[]) {
  const counts = {
    alreadyCorrect: 0,
    analyzed: rows.length,
    applicable: 0,
    cleanerUnchanged: 0,
    conflictSkipped: 0,
    ebayDescriptionMissing: 0,
    ebayLookupFailed: 0,
    emptyCleanedDescription: 0,
    missingShopifyProduct: 0,
    shopifyLookupFailed: 0,
  } satisfies DescriptionBackfillSummary;

  for (const row of rows) {
    counts[getSummaryKey(row.status)] += 1;
  }

  return counts;
}

function getSummaryKey(
  status: DescriptionBackfillStatus,
): Exclude<keyof DescriptionBackfillSummary, "analyzed"> {
  if (status === "already_correct") return "alreadyCorrect";
  if (status === "cleaner_unchanged") return "cleanerUnchanged";
  if (status === "conflict_skipped") return "conflictSkipped";
  if (status === "ebay_description_missing") return "ebayDescriptionMissing";
  if (status === "ebay_lookup_failed") return "ebayLookupFailed";
  if (status === "empty_cleaned_description") return "emptyCleanedDescription";
  if (status === "missing_shopify_product") return "missingShopifyProduct";
  if (status === "shopify_lookup_failed") return "shopifyLookupFailed";

  return "applicable";
}

function normalizeConflictFields(fields: string[] | undefined) {
  return [...new Set((fields ?? []).map((field) => field.trim()))].filter(Boolean);
}
