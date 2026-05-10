export type ImportPreviewSeverity = "info" | "warning" | "error";
export type ImportPreviewStatus = "importable" | "skipped" | "error";

export interface ImportPreviewListingCandidate {
  descriptionHtml?: string | null;
  imageUrls?: string[];
  itemId: string;
  priceAmount?: number | null;
  quantity?: number | null;
  sku?: string | null;
  title?: string | null;
  variantCount?: number;
}

export interface ImportPreviewIssue {
  code: string;
  message: string;
  severity: ImportPreviewSeverity;
}

export interface ImportPreviewItem {
  itemId: string;
  issues: ImportPreviewIssue[];
  normalized: {
    descriptionMode: string;
    imageCount: number;
    productStatus: string;
    sku: string | null;
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

const DEFAULT_PRODUCT_STATUS = "draft";
const DEFAULT_DESCRIPTION_MODE = "HTML pulito senza template";
const MAX_SIMPLE_VARIANTS = 1;

export function buildImportPreview(candidates: ImportPreviewListingCandidate[]) {
  const items = candidates.map(buildPreviewItem);
  const summary = summarizePreviewItems(items);

  return {
    items,
    summary,
  };
}

export function getEmptyImportPreview() {
  return buildImportPreview([]);
}

export function getImportPreviewValidationRules() {
  return [
    {
      code: "missing_sku",
      label: "SKU mancante",
      severity: "error" satisfies ImportPreviewSeverity,
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
      label: "Listing senza immagini",
      severity: "warning" satisfies ImportPreviewSeverity,
    },
    {
      code: "complex_variants",
      label: "Varianti troppo complesse per MVP",
      severity: "error" satisfies ImportPreviewSeverity,
    },
    {
      code: "description_cleanup",
      label: "Descrizione da pulire prima dell'import",
      severity: "info" satisfies ImportPreviewSeverity,
    },
  ];
}

function buildPreviewItem(candidate: ImportPreviewListingCandidate): ImportPreviewItem {
  const issues = getPreviewIssues(candidate);
  const hasErrors = issues.some((issue) => issue.severity === "error");
  const hasWarnings = issues.some((issue) => issue.severity === "warning");

  return {
    itemId: candidate.itemId,
    issues,
    normalized: {
      descriptionMode: DEFAULT_DESCRIPTION_MODE,
      imageCount: candidate.imageUrls?.length ?? 0,
      productStatus: DEFAULT_PRODUCT_STATUS,
      sku: normalizeText(candidate.sku),
      title: normalizeText(candidate.title) ?? "Titolo non disponibile",
    },
    status: hasErrors ? "error" : hasWarnings ? "skipped" : "importable",
  };
}

function getPreviewIssues(candidate: ImportPreviewListingCandidate) {
  const issues: ImportPreviewIssue[] = [];

  if (!normalizeText(candidate.sku)) {
    issues.push({
      code: "missing_sku",
      message: "SKU mancante: il prodotto va corretto o escluso prima dell'import.",
      severity: "error",
    });
  }

  if (!isPositiveNumber(candidate.priceAmount)) {
    issues.push({
      code: "invalid_price",
      message: "Prezzo eBay assente o non valido.",
      severity: "error",
    });
  }

  if (!isNonNegativeInteger(candidate.quantity)) {
    issues.push({
      code: "invalid_quantity",
      message: "Disponibilità eBay assente o non leggibile.",
      severity: "error",
    });
  }

  if ((candidate.imageUrls?.length ?? 0) === 0) {
    issues.push({
      code: "missing_images",
      message: "Nessuna immagine leggibile dal listing eBay.",
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

  if (candidate.descriptionHtml && looksLikeTemplate(candidate.descriptionHtml)) {
    issues.push({
      code: "description_cleanup",
      message: "Descrizione con possibile template eBay da ripulire.",
      severity: "info",
    });
  }

  return issues;
}

function summarizePreviewItems(items: ImportPreviewItem[]): ImportPreviewSummary {
  return {
    errorCount: items.filter((item) => item.status === "error").length,
    importableCount: items.filter((item) => item.status === "importable").length,
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

function looksLikeTemplate(descriptionHtml: string) {
  const normalized = descriptionHtml.toLowerCase();
  return (
    normalized.includes("<table") ||
    normalized.includes("<style") ||
    normalized.includes("template")
  );
}

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}
