import {
  applyDescriptionRuleToHtml,
  type DescriptionRuleMode,
} from "../lib/syncbay-description-rules";
import {
  buildDescriptionCleanupReportRow,
  cleanEbayDescriptionHtml,
} from "../lib/syncbay-description-cleanup";
import type { ExistingCatalogTakeoverReport } from "../lib/syncbay-existing-catalog-takeover";
import {
  resolveShopifyCategoryProposal,
  type ShopifyCategoryProposal,
} from "../lib/syncbay-shopify-category-mapping";
import {
  buildSyncBayProductFacets,
  type EbayItemSpecific,
  type SyncBayProductFacet,
} from "../lib/syncbay-product-facets";
import {
  buildExistingProductMatchSuggestions,
  type ExistingProductMatchSuggestion,
  type ShopifyMatchCandidate,
} from "../lib/syncbay-product-matching";
import {
  buildImportQualityChecklist,
  getQualityChecklistSummary,
  type ImportQualityChecklistItem,
} from "../lib/syncbay-quality-checklist";

type ImportPreviewSeverity = "info" | "warning" | "error";
type ImportPreviewStatus = "importable" | "skipped" | "error";

export interface ImportPreviewListingCandidate {
  currency?: string | null;
  descriptionHtml?: string | null;
  ebayPrimaryCategoryId?: string | null;
  ebayPrimaryCategoryName?: string | null;
  ebayPrimaryCategoryPath?: string | null;
  existingShopifyProducts?: ShopifyMatchCandidate[];
  imageUrls?: string[];
  itemId: string;
  itemSpecifics?: EbayItemSpecific[];
  priceAmount?: number | null;
  quantity?: number | null;
  sku?: string | null;
  skuGenerated?: boolean;
  storeCategoryId?: string | null;
  storeCategoryName?: string | null;
  title?: string | null;
  variantCount?: number;
}

interface ImportPreviewIssue {
  code: string;
  message: string;
  severity: ImportPreviewSeverity;
}

export interface ImportPreviewItem {
  itemId: string;
  issues: ImportPreviewIssue[];
  matchSuggestions: ExistingProductMatchSuggestion[];
  normalized: {
    categoryProposal: ShopifyCategoryProposal;
    currency: string | null;
    descriptionCleanedLength: number;
    descriptionCleanedTextExcerpt: string;
    descriptionHtml: string | null;
    descriptionMode: string;
    descriptionOriginalLength: number;
    descriptionOriginalTextExcerpt: string;
    descriptionRemovedPercent: number;
    descriptionTemplateSignalCount: number;
    descriptionWasChanged: boolean;
    ebayPrimaryCategoryId: string | null;
    ebayPrimaryCategoryName: string | null;
    ebayPrimaryCategoryPath: string | null;
    imageUrls: string[];
    imageCount: number;
    priceAmount: number | null;
    productFacets: SyncBayProductFacet[];
    qualityChecklist: ImportQualityChecklistItem[];
    qualitySummary: string;
    productStatus: string;
    quantity: number | null;
    sku: string | null;
    skuGenerated: boolean;
    storeCategoryId: string | null;
    storeCategoryName: string | null;
    title: string;
  };
  status: ImportPreviewStatus;
}

export interface ImportPreviewSummary {
  errorCount: number;
  importableCount: number;
  skippedCount: number;
  totalCount: number;
  warningCount: number;
}

export interface ImportPreviewResult {
  existingCatalogTakeover?: ExistingCatalogTakeoverReport;
  items: ImportPreviewItem[];
  mode: "empty" | "mock" | "live";
  summary: ImportPreviewSummary;
}

const DEFAULT_PRODUCT_STATUS = "published";
const MAX_SIMPLE_VARIANTS = 1;

export function buildImportPreview(
  candidates: ImportPreviewListingCandidate[],
  mode: ImportPreviewResult["mode"] = "live",
  options: { descriptionRuleMode?: DescriptionRuleMode } = {},
): ImportPreviewResult {
  const items = candidates.map((candidate) =>
    buildPreviewItem(candidate, options),
  );
  const summary = summarizePreviewItems(items);

  return {
    items,
    mode,
    summary,
  };
}

export function addExistingProductMatchSuggestions(
  preview: ImportPreviewResult,
  shopifyProducts: ShopifyMatchCandidate[],
): ImportPreviewResult {
  if (shopifyProducts.length === 0) return preview;

  return {
    ...preview,
    items: preview.items.map((item) => ({
      ...item,
      matchSuggestions: buildExistingProductMatchSuggestions({
        ebay: {
          itemId: item.itemId,
          sku: item.normalized.sku,
          title: item.normalized.title,
        },
        shopifyProducts,
      }),
    })),
  };
}

export function getEmptyImportPreview(
  mode: ImportPreviewResult["mode"] = "live",
) {
  return buildImportPreview([], mode);
}

export function getMockImportPreview(
  descriptionRuleMode: DescriptionRuleMode = "CLEAN_HTML",
) {
  return buildImportPreview(
    [
      {
        currency: "EUR",
        descriptionHtml: "<p>Giacca vintage in pelle.</p>",
        imageUrls: [
          "https://example.invalid/syncbay/mock/giacca-pelle-1.jpg",
          "https://example.invalid/syncbay/mock/giacca-pelle-2.jpg",
        ],
        itemId: "mock-ebay-it-1001",
        priceAmount: 89.9,
        quantity: 3,
        sku: "MOCK-GIACCA-001",
        title: "Giacca vintage in pelle",
        variantCount: 1,
      },
      {
        descriptionHtml: "<table><tr><td>Template storico</td></tr></table>",
        currency: "EUR",
        imageUrls: [],
        itemId: "mock-ebay-it-1002",
        priceAmount: 24.5,
        quantity: 12,
        sku: "MOCK-LAMPADA-002",
        title: "Lampada da tavolo",
        variantCount: 1,
      },
      {
        descriptionHtml: "<p>Set con varianti multiple.</p>",
        currency: "EUR",
        imageUrls: ["https://example.invalid/syncbay/mock/set-tazze-1.jpg"],
        itemId: "mock-ebay-it-1003",
        priceAmount: 19.9,
        quantity: 5,
        sku: "MOCK-TAZZE-003",
        title: "Set tazze colorate",
        variantCount: 3,
      },
      {
        descriptionHtml: "<p>Prodotto senza SKU.</p>",
        currency: "EUR",
        imageUrls: ["https://example.invalid/syncbay/mock/scatola-1.jpg"],
        itemId: "mock-ebay-it-1004",
        priceAmount: 12,
        quantity: 8,
        sku: "",
        title: "Scatola in legno",
        variantCount: 1,
      },
    ],
    "mock",
    { descriptionRuleMode },
  );
}

export function getImportPreviewValidationRules() {
  return [
    {
      code: "missing_sku",
      label: "SKU mancante",
      severity: "error" satisfies ImportPreviewSeverity,
    },
    {
      code: "generated_sku",
      label: "SKU generato da eBay ItemID",
      severity: "info" satisfies ImportPreviewSeverity,
    },
    {
      code: "invalid_price",
      label: "Prezzo assente o non valido",
      severity: "error" satisfies ImportPreviewSeverity,
    },
    {
      code: "invalid_quantity",
      label: "Disponibilità non leggibile",
      severity: "error" satisfies ImportPreviewSeverity,
    },
    {
      code: "missing_images",
      label: "Elemento senza immagini",
      severity: "warning" satisfies ImportPreviewSeverity,
    },
    {
      code: "complex_variants",
      label: "Varianti troppo complesse per MVP",
      severity: "error" satisfies ImportPreviewSeverity,
    },
    {
      code: "description_cleanup",
      label: "Descrizione ripulita da SyncBay",
      severity: "info" satisfies ImportPreviewSeverity,
    },
  ];
}

function buildPreviewItem(
  candidate: ImportPreviewListingCandidate,
  options: { descriptionRuleMode?: DescriptionRuleMode } = {},
): ImportPreviewItem {
  const descriptionCleanup = cleanEbayDescriptionHtml(
    candidate.descriptionHtml,
  );
  const descriptionProjection = applyDescriptionRuleToHtml({
    cleanedHtml: descriptionCleanup.html,
    html: candidate.descriptionHtml,
    mode: options.descriptionRuleMode ?? "CLEAN_HTML",
  });
  const descriptionReport = buildDescriptionCleanupReportRow({
    descriptionHtml: candidate.descriptionHtml,
    itemId: candidate.itemId,
    title: candidate.title,
  });
  const issues = getPreviewIssues(candidate, descriptionProjection.wasChanged);
  const hasErrors = issues.some((issue) => issue.severity === "error");
  const ebayPrimaryCategoryName = normalizeText(
    candidate.ebayPrimaryCategoryName,
  );
  const ebayPrimaryCategoryPath = normalizeText(
    candidate.ebayPrimaryCategoryPath,
  );
  const storeCategoryName = normalizeText(candidate.storeCategoryName);
  const title = normalizeText(candidate.title) ?? "Titolo non disponibile";
  const categoryProposal = resolveShopifyCategoryProposal({
    ebayPrimaryCategoryName,
    ebayPrimaryCategoryPath,
    ebayStoreCategoryName: storeCategoryName,
    title,
  });
  const imageCount = candidate.imageUrls?.length ?? 0;
  const priceAmount = normalizeNumber(candidate.priceAmount);
  const quantity = normalizeInteger(candidate.quantity);
  const sku = normalizeText(candidate.sku);
  const qualityChecklist = buildImportQualityChecklist({
    categoryConfidence: categoryProposal.confidence,
    descriptionWasChanged: descriptionProjection.wasChanged,
    imageCount,
    priceAmount,
    quantity,
    sku,
    skuGenerated: Boolean(candidate.skuGenerated),
    variantCount: candidate.variantCount,
  });

  return {
    itemId: candidate.itemId,
    issues,
    matchSuggestions: buildExistingProductMatchSuggestions({
      ebay: {
        itemId: candidate.itemId,
        sku,
        title,
      },
      shopifyProducts: candidate.existingShopifyProducts ?? [],
    }),
    normalized: {
      categoryProposal,
      currency: normalizeCurrency(candidate.currency),
      descriptionCleanedLength: descriptionProjection.html?.length ?? 0,
      descriptionCleanedTextExcerpt: normalizePreviewDescriptionExcerpt(
        descriptionProjection.html,
      ),
      descriptionHtml: descriptionProjection.html,
      descriptionMode: descriptionProjection.mode,
      descriptionOriginalLength: descriptionReport.rawLength,
      descriptionOriginalTextExcerpt: descriptionReport.rawTextExcerpt,
      descriptionRemovedPercent: descriptionProjection.removedPercent,
      descriptionTemplateSignalCount: descriptionReport.templateSignalCount,
      descriptionWasChanged: descriptionProjection.wasChanged,
      ebayPrimaryCategoryId: normalizeText(candidate.ebayPrimaryCategoryId),
      ebayPrimaryCategoryName,
      ebayPrimaryCategoryPath,
      imageUrls: candidate.imageUrls ?? [],
      imageCount,
      priceAmount,
      productFacets: buildSyncBayProductFacets({
        ebayPrimaryCategoryName,
        itemSpecifics: candidate.itemSpecifics ?? [],
        storeCategoryName,
        title,
      }),
      qualityChecklist,
      qualitySummary: getQualityChecklistSummary(qualityChecklist),
      productStatus: DEFAULT_PRODUCT_STATUS,
      quantity,
      sku,
      skuGenerated: Boolean(candidate.skuGenerated),
      storeCategoryId: normalizeText(candidate.storeCategoryId),
      storeCategoryName,
      title,
    },
    status: hasErrors ? "error" : "importable",
  };
}

function normalizePreviewDescriptionExcerpt(value: string | null | undefined) {
  return (
    value
      ?.replace(/<[^>]+>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 180) ?? ""
  );
}

function getPreviewIssues(
  candidate: ImportPreviewListingCandidate,
  descriptionWasChanged: boolean,
) {
  const issues: ImportPreviewIssue[] = [];

  if (!normalizeText(candidate.sku)) {
    issues.push({
      code: "missing_sku",
      message:
        "SKU mancante: il prodotto va corretto o escluso prima dell'import.",
      severity: "error",
    });
  }

  if (candidate.skuGenerated && normalizeText(candidate.sku)) {
    issues.push({
      code: "generated_sku",
      message: `SKU eBay assente: SyncBay userà ${normalizeText(candidate.sku)} per il prodotto pilota.`,
      severity: "info",
    });
  }

  if (!isPositiveNumber(candidate.priceAmount)) {
    issues.push({
      code: "invalid_price",
      message: "Prezzo assente o non valido.",
      severity: "error",
    });
  }

  if (!isNonNegativeInteger(candidate.quantity)) {
    issues.push({
      code: "invalid_quantity",
      message: "Disponibilità assente o non leggibile.",
      severity: "error",
    });
  }

  if ((candidate.imageUrls?.length ?? 0) === 0) {
    issues.push({
      code: "missing_images",
      message: "Nessuna immagine leggibile per questo elemento.",
      severity: "warning",
    });
  }

  if ((candidate.variantCount ?? 1) > MAX_SIMPLE_VARIANTS) {
    issues.push({
      code: "complex_variants",
      message: "Varianti multiple non ancora supportate nel MVP base.",
      severity: "error",
    });
  }

  if (candidate.descriptionHtml && descriptionWasChanged) {
    issues.push({
      code: "description_cleanup",
      message:
        "Descrizione eBay ripulita da template, colori o markup non essenziale.",
      severity: "info",
    });
  }

  return issues;
}

function summarizePreviewItems(
  items: ImportPreviewItem[],
): ImportPreviewSummary {
  return {
    errorCount: items.filter((item) => item.status === "error").length,
    importableCount: items.filter((item) => item.status === "importable")
      .length,
    skippedCount: items.filter((item) => item.status === "skipped").length,
    totalCount: items.length,
    warningCount: items.reduce(
      (total, item) =>
        total +
        item.issues.filter((issue) => issue.severity === "warning").length,
      0,
    ),
  };
}

function isNonNegativeInteger(value: number | null | undefined) {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isPositiveNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizeNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeInteger(value: number | null | undefined) {
  return Number.isInteger(value) ? Number(value) : null;
}

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeCurrency(value: string | null | undefined) {
  return normalizeText(value)?.toUpperCase() ?? null;
}
