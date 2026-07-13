export type MatchConfidence = "high" | "medium" | "low";

export interface EbayMatchCandidate {
  itemId: string;
  sku?: string | null;
  title?: string | null;
}

export type ExistingProductMatchReasonCode =
  | "barcode_item_id"
  | "handle_item_id"
  | "sku_exact"
  | "shopify_sku_item_id"
  | "syncbay_metafield_item_id"
  | "tag_item_id"
  | "title_similar"
  | "title_very_similar";

export interface ShopifyMatchMetafieldCandidate {
  key: string;
  namespace: string;
  value?: string | null;
}

export interface ShopifyMatchCandidate {
  barcode?: string | null;
  handle?: string | null;
  metafields?: ShopifyMatchMetafieldCandidate[];
  productGid: string;
  shopifyImageCount?: number;
  sku?: string | null;
  tags?: string[];
  title?: string | null;
  variantGid?: string | null;
  variantsTruncated?: boolean;
}

export interface ExistingProductMatchSuggestion {
  autoLinkable: boolean;
  confidence: MatchConfidence;
  currentHandle?: string | null;
  currentTags?: string[];
  productGid: string;
  reasonCodes: ExistingProductMatchReasonCode[];
  reasons: string[];
  score: number;
  shopifyImageCount?: number;
  variantGid: string | null;
}

const STRONG_AUTO_LINK_CODES = new Set<ExistingProductMatchReasonCode>([
  "barcode_item_id",
  "handle_item_id",
  "sku_exact",
  "shopify_sku_item_id",
  "syncbay_metafield_item_id",
  "tag_item_id",
]);
const VARIANT_EXACT_AUTO_LINK_CODES = new Set<ExistingProductMatchReasonCode>([
  "barcode_item_id",
  "sku_exact",
  "shopify_sku_item_id",
]);

export function buildExistingProductMatchSuggestions(input: {
  ebay: EbayMatchCandidate;
  limit?: number;
  shopifyProducts: ShopifyMatchCandidate[];
}): ExistingProductMatchSuggestion[] {
  const limit = Number.isInteger(input.limit) && (input.limit ?? 0) > 0
    ? (input.limit as number)
    : 5;

  const bestByProduct = new Map<string, ExistingProductMatchSuggestion>();

  const { ebay } = input;
  const ebayItemId = ebay.itemId;

  for (const product of input.shopifyProducts) {
    const reasonCodes: ExistingProductMatchReasonCode[] = [];
    const reasons: string[] = [];
    let score = 0;

    if (sameToken(ebayItemId, getSyncBayItemId(product.metafields))) {
      score += 98;
      reasonCodes.push("syncbay_metafield_item_id");
      reasons.push("ItemID eBay trovato nei metafield SyncBay");
    }
    const hasExactSkuMatch = sameToken(ebay.sku, product.sku);
    if (hasExactSkuMatch) {
      score += 100;
      reasonCodes.push("sku_exact");
      reasons.push("SKU identico");
    }
    if (!hasExactSkuMatch && sameToken(ebayItemId, product.sku)) {
      score += 96;
      reasonCodes.push("shopify_sku_item_id");
      reasons.push("SKU Shopify uguale all'ItemID eBay");
    }
    if (sameToken(ebayItemId, product.barcode)) {
      score += 95;
      reasonCodes.push("barcode_item_id");
      reasons.push("ItemID eBay trovato su barcode");
    }
    if (containsToken(product.handle, ebayItemId)) {
      score += 92;
      reasonCodes.push("handle_item_id");
      reasons.push("ItemID eBay trovato nell'handle Shopify");
    }
    if ((product.tags ?? []).some((tag) => containsToken(tag, ebayItemId))) {
      score += 80;
      reasonCodes.push("tag_item_id");
      reasons.push("ItemID eBay trovato nei tag Shopify");
    }

    const titleSimilarity = getTitleSimilarity(ebay.title, product.title);
    if (titleSimilarity >= 0.8) {
      score += 40;
      reasonCodes.push("title_very_similar");
      reasons.push("Titolo molto simile");
    } else if (titleSimilarity >= 0.55) {
      score += 24;
      reasonCodes.push("title_similar");
      reasons.push("Titolo simile");
    }

    if (score < 20) continue;

    const confidence = getConfidence(score);
    const suggestion = {
      autoLinkable: isAutoLinkable(confidence, reasonCodes, {
        variantsTruncated: product.variantsTruncated === true,
      }),
      confidence,
      currentHandle: product.handle ?? null,
      currentTags: product.tags ?? [],
      productGid: product.productGid,
      reasonCodes,
      reasons,
      score,
      shopifyImageCount: product.shopifyImageCount ?? 0,
      variantGid: product.variantGid ?? null,
    };
    const existing = bestByProduct.get(product.productGid);
    if (!existing || suggestion.score > existing.score) {
      bestByProduct.set(product.productGid, suggestion);
    }
  }

  return Array.from(bestByProduct.values())
    .sort((first, second) => second.score - first.score)
    .slice(0, limit);
}

export function getMatchSuggestionSummary(input: {
  confidence: MatchConfidence;
  reasons: string[];
}) {
  return `Possibile collegamento: confidenza ${getConfidenceLabel(input.confidence)}, ${input.reasons.join(", ")}. Conferma manuale richiesta.`;
}

function getConfidence(score: number): MatchConfidence {
  if (score >= 90) return "high";
  if (score >= 35) return "medium";

  return "low";
}

function getConfidenceLabel(confidence: MatchConfidence) {
  if (confidence === "high") return "alta";
  if (confidence === "medium") return "media";

  return "bassa";
}

function isAutoLinkable(
  confidence: MatchConfidence,
  reasonCodes: ExistingProductMatchReasonCode[],
  options: { variantsTruncated: boolean },
) {
  if (
    options.variantsTruncated &&
    !reasonCodes.some((code) => VARIANT_EXACT_AUTO_LINK_CODES.has(code))
  ) {
    return false;
  }

  return (
    confidence === "high" &&
    reasonCodes.some((code) => STRONG_AUTO_LINK_CODES.has(code))
  );
}

function getSyncBayItemId(
  metafields: ShopifyMatchMetafieldCandidate[] | null | undefined,
) {
  return metafields?.find(
    (metafield) =>
      metafield.namespace === "syncbay" && metafield.key === "ebay_item_id",
  )?.value;
}

function sameToken(first: string | null | undefined, second: string | null | undefined) {
  const a = normalizeToken(first);
  const b = normalizeToken(second);

  return Boolean(a && b && a === b);
}

function containsToken(value: string | null | undefined, token: string | null | undefined) {
  const normalizedToken = normalizeToken(token);

  if (!normalizedToken) return false;

  return tokenizeIdentifier(value).some(
    (candidate) => candidate === normalizedToken,
  );
}

function normalizeToken(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

function tokenizeIdentifier(value: string | null | undefined) {
  return (
    value
      ?.toUpperCase()
      .split(/[^A-Z0-9]+/u)
      .filter((token) => token.length > 0) ?? []
  );
}

function getTitleSimilarity(
  first: string | null | undefined,
  second: string | null | undefined,
) {
  const a = tokenize(first);
  const b = tokenize(second);
  if (a.length === 0 || b.length === 0) return 0;

  const bSet = new Set(b);
  const overlap = a.filter((token) => bSet.has(token)).length;

  return overlap / Math.max(a.length, b.length);
}

function tokenize(value: string | null | undefined) {
  return (
    value
      ?.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/u)
      .filter((token) => token.length >= 3) ?? []
  );
}
