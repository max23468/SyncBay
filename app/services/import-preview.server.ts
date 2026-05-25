export type ImportPreviewSeverity = "info" | "warning" | "error";
export type ImportPreviewStatus = "importable" | "skipped" | "error";

export interface ImportPreviewListingCandidate {
  descriptionHtml?: string | null;
  imageUrls?: string[];
  itemId: string;
  priceAmount?: number | null;
  quantity?: number | null;
  sku?: string | null;
  skuGenerated?: boolean;
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
    descriptionHtml: string | null;
    descriptionMode: string;
    imageUrls: string[];
    imageCount: number;
    priceAmount: number | null;
    productStatus: string;
    quantity: number | null;
    sku: string | null;
    skuGenerated: boolean;
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
  items: ImportPreviewItem[];
  mode: "empty" | "mock" | "live";
  summary: ImportPreviewSummary;
}

const DEFAULT_PRODUCT_STATUS = "draft";
const DEFAULT_DESCRIPTION_MODE = "HTML pulito senza template";
const MAX_SIMPLE_VARIANTS = 1;

export function buildImportPreview(
  candidates: ImportPreviewListingCandidate[],
  mode: ImportPreviewResult["mode"] = "live",
): ImportPreviewResult {
  const items = candidates.map(buildPreviewItem);
  const summary = summarizePreviewItems(items);

  return {
    items,
    mode,
    summary,
  };
}

export function getEmptyImportPreview(
  mode: ImportPreviewResult["mode"] = "live",
) {
  return buildImportPreview([], mode);
}

export function getMockImportPreview() {
  return buildImportPreview(
    [
      {
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
      label: "Descrizione da pulire prima dell'import",
      severity: "info" satisfies ImportPreviewSeverity,
    },
  ];
}

function buildPreviewItem(
  candidate: ImportPreviewListingCandidate,
): ImportPreviewItem {
  const issues = getPreviewIssues(candidate);
  const hasErrors = issues.some((issue) => issue.severity === "error");

  return {
    itemId: candidate.itemId,
    issues,
    normalized: {
      descriptionHtml: normalizeText(candidate.descriptionHtml),
      descriptionMode: DEFAULT_DESCRIPTION_MODE,
      imageUrls: candidate.imageUrls ?? [],
      imageCount: candidate.imageUrls?.length ?? 0,
      priceAmount: normalizeNumber(candidate.priceAmount),
      productStatus: DEFAULT_PRODUCT_STATUS,
      quantity: normalizeInteger(candidate.quantity),
      sku: normalizeText(candidate.sku),
      skuGenerated: Boolean(candidate.skuGenerated),
      title: normalizeText(candidate.title) ?? "Titolo non disponibile",
    },
    status: hasErrors ? "error" : "importable",
  };
}

function getPreviewIssues(candidate: ImportPreviewListingCandidate) {
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
      message: `SKU eBay assente: SyncBay userà ${normalizeText(candidate.sku)} per la bozza pilota.`,
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

  if (
    candidate.descriptionHtml &&
    looksLikeTemplate(candidate.descriptionHtml)
  ) {
    issues.push({
      code: "description_cleanup",
      message: "Descrizione con possibile template storico da ripulire.",
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
