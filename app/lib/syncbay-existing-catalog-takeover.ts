import type { ImportPreviewItem } from "../services/import-preview.server";
// @ts-expect-error Node --experimental-strip-types resolves this pure module import.
import * as existingCatalogFieldPolicy from "./syncbay-existing-catalog-field-policy.ts";
import type { ExistingCatalogFieldPolicy } from "./syncbay-existing-catalog-field-policy";
import type {
  ExistingProductMatchSuggestion,
} from "./syncbay-product-matching";

const { buildExistingCatalogFieldPolicy } = existingCatalogFieldPolicy;

export type ExistingCatalogTakeoverStatus =
  | "applicabile"
  | "bloccante"
  | "da_rivedere"
  | "gia_collegato";

export type ExistingCatalogTakeoverReason =
  | "categoria_incerta"
  | "disponibilita_ebay_non_valida"
  | "immagini_mancanti"
  | "match_ambiguo"
  | "match_non_automatico"
  | "match_shopify_mancante"
  | "prezzo_ebay_non_valido"
  | "varianti_non_supportate";

export type ExistingCatalogPlannedOperation =
  | "add_syncbay_tag"
  | "claim_mapping"
  | "preserve_handle"
  | "sync_category"
  | "sync_description"
  | "sync_facets"
  | "sync_price"
  | "sync_quantity"
  | "sync_seo"
  | "sync_title";

export interface ExistingCatalogTakeoverReport {
  rows: ExistingCatalogTakeoverRow[];
  shopDomain: string;
  summary: ExistingCatalogTakeoverSummary;
}

export interface ExistingCatalogTakeoverRow {
  fieldPolicy: ExistingCatalogFieldPolicy;
  itemId: string;
  matchSuggestion: ExistingProductMatchSuggestion | null;
  plannedOperations: ExistingCatalogPlannedOperation[];
  productGid: string | null;
  reasons: ExistingCatalogTakeoverReason[];
  sku: string | null;
  status: ExistingCatalogTakeoverStatus;
  variantGid: string | null;
}

export interface ExistingCatalogTakeoverSummary {
  alreadyLinked: number;
  applicable: number;
  blocked: number;
  review: number;
  total: number;
}

export interface ExistingCatalogTakeoverApplyPlan {
  blockers: string[];
  ebayItemIds: string[];
  rows: ExistingCatalogTakeoverApplyRow[];
}

export interface ExistingCatalogTakeoverApplyRow {
  fieldPolicy: ExistingCatalogFieldPolicy;
  itemId: string;
  productGid: string;
  sku: string | null;
  variantGid: string | null;
}

const APPLICABLE_PLANNED_OPERATIONS: ExistingCatalogPlannedOperation[] = [
  "claim_mapping",
  "sync_title",
  "sync_description",
  "sync_price",
  "sync_quantity",
  "sync_category",
  "sync_facets",
  "sync_seo",
  "add_syncbay_tag",
  "preserve_handle",
];

export function buildExistingCatalogTakeoverReport(input: {
  items: ImportPreviewItem[];
  legacyTagsToRemove?: string[];
  shopDomain: string;
}): ExistingCatalogTakeoverReport {
  const rows = input.items.map((item) =>
    buildExistingCatalogTakeoverRow(item, {
      legacyTagsToRemove: input.legacyTagsToRemove ?? [],
    }),
  );

  return {
    rows,
    shopDomain: input.shopDomain,
    summary: summarizeRows(rows),
  };
}

export function buildExistingCatalogTakeoverApplyPlan(
  report: ExistingCatalogTakeoverReport,
): ExistingCatalogTakeoverApplyPlan {
  const blockers = [
    report.summary.blocked > 0
      ? `Il dry-run catalogo esistente contiene ${report.summary.blocked} righe bloccanti da risolvere prima dell'apply.`
      : null,
  ].filter((blocker): blocker is string => Boolean(blocker));

  if (blockers.length > 0) {
    return {
      blockers,
      ebayItemIds: [],
      rows: [],
    };
  }

  const rows = report.rows.flatMap((row): ExistingCatalogTakeoverApplyRow[] =>
    row.status === "applicabile" && row.productGid
      ? [
          {
            fieldPolicy: row.fieldPolicy,
            itemId: row.itemId,
            productGid: row.productGid,
            sku: row.sku,
            variantGid: row.variantGid,
          },
        ]
      : [],
  );

  return {
    blockers:
      rows.length === 0
        ? ["Nessuna riga applicabile nel dry-run catalogo esistente."]
        : [],
    ebayItemIds: rows.map((row) => row.itemId),
    rows,
  };
}

function buildExistingCatalogTakeoverRow(
  item: ImportPreviewItem,
  options: { legacyTagsToRemove: string[] },
): ExistingCatalogTakeoverRow {
  const blockingReasons = getBlockingReasons(item);
  const matchReasons = getMatchReasons(item.matchSuggestions);
  const matchSuggestion = getBestAutoLinkableMatch(item.matchSuggestions);
  const reviewReasons = getReviewReasons(item, matchSuggestion);
  const reasons = [...blockingReasons, ...reviewReasons, ...matchReasons];
  const status = getStatus({
    blockingReasons,
    matchSuggestion,
    reviewReasons: [...reviewReasons, ...matchReasons],
  });

  return {
    fieldPolicy: buildExistingCatalogFieldPolicy({
      currentHandle: matchSuggestion?.currentHandle ?? null,
      currentTags: matchSuggestion?.currentTags ?? [],
      legacyTagsToRemove: options.legacyTagsToRemove,
      shopifyImageCount: matchSuggestion?.shopifyImageCount ?? 0,
      syncbayLegacyTags: ["SyncBay", "Import preview", "eBay import pilot"],
    }),
    itemId: item.itemId,
    matchSuggestion,
    plannedOperations:
      status === "applicabile" ? getPlannedOperations(item) : [],
    productGid: matchSuggestion?.productGid ?? null,
    reasons,
    sku: item.normalized.sku,
    status,
    variantGid: matchSuggestion?.variantGid ?? null,
  };
}

function getBlockingReasons(item: ImportPreviewItem) {
  const issueCodes = new Set(item.issues.map((issue) => issue.code));

  return [
    issueCodes.has("invalid_price") || item.normalized.priceAmount === null
      ? "prezzo_ebay_non_valido"
      : null,
    issueCodes.has("invalid_quantity") || item.normalized.quantity === null
      ? "disponibilita_ebay_non_valida"
      : null,
    issueCodes.has("complex_variants") ? "varianti_non_supportate" : null,
  ].filter((reason): reason is ExistingCatalogTakeoverReason =>
    Boolean(reason),
  );
}

function getReviewReasons(
  item: ImportPreviewItem,
  matchSuggestion: ExistingProductMatchSuggestion | null,
) {
  const issueCodes = new Set(item.issues.map((issue) => issue.code));
  const hasMissingEbayImages =
    issueCodes.has("missing_images") || item.normalized.imageCount === 0;
  const hasShopifyImagesToPreserve =
    (matchSuggestion?.shopifyImageCount ?? 0) > 0;
  const hasStrongAutoMatch = Boolean(matchSuggestion);

  return [
    hasMissingEbayImages && !hasShopifyImagesToPreserve
      ? "immagini_mancanti"
      : null,
    item.normalized.categoryProposal.confidence === "low" && !hasStrongAutoMatch
      ? "categoria_incerta"
      : null,
  ].filter((reason): reason is ExistingCatalogTakeoverReason =>
    Boolean(reason),
  );
}

function getPlannedOperations(
  item: ImportPreviewItem,
): ExistingCatalogPlannedOperation[] {
  return APPLICABLE_PLANNED_OPERATIONS.filter(
    (operation) =>
      operation !== "sync_category" ||
      item.normalized.categoryProposal.confidence !== "low",
  );
}

function getMatchReasons(
  matches: ExistingProductMatchSuggestion[],
): ExistingCatalogTakeoverReason[] {
  const autoMatches = matches.filter((match) => match.autoLinkable);
  const productIds = new Set(autoMatches.map((match) => match.productGid));

  if (productIds.size > 1) return ["match_ambiguo"];
  if (autoMatches.length > 0) return [];
  if (matches.length > 0) return ["match_non_automatico"];

  return ["match_shopify_mancante"];
}

function getBestAutoLinkableMatch(matches: ExistingProductMatchSuggestion[]) {
  const autoMatches = matches.filter((match) => match.autoLinkable);
  const productIds = new Set(autoMatches.map((match) => match.productGid));

  if (productIds.size !== 1) return null;

  return autoMatches[0] ?? null;
}

function getStatus(input: {
  blockingReasons: ExistingCatalogTakeoverReason[];
  matchSuggestion: ExistingProductMatchSuggestion | null;
  reviewReasons: ExistingCatalogTakeoverReason[];
}): ExistingCatalogTakeoverStatus {
  if (input.blockingReasons.length > 0) return "bloccante";
  if (input.reviewReasons.length > 0) return "da_rivedere";
  if (input.matchSuggestion) return "applicabile";

  return "da_rivedere";
}

function summarizeRows(
  rows: ExistingCatalogTakeoverRow[],
): ExistingCatalogTakeoverSummary {
  return {
    alreadyLinked: rows.filter((row) => row.status === "gia_collegato").length,
    applicable: rows.filter((row) => row.status === "applicabile").length,
    blocked: rows.filter((row) => row.status === "bloccante").length,
    review: rows.filter((row) => row.status === "da_rivedere").length,
    total: rows.length,
  };
}
