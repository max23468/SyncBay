export type MatchConfidence = "high" | "medium" | "low";

export interface EbayMatchCandidate {
  itemId: string;
  sku?: string | null;
  title?: string | null;
}

export interface ShopifyMatchCandidate {
  barcode?: string | null;
  productGid: string;
  sku?: string | null;
  title?: string | null;
  variantGid?: string | null;
}

export interface ExistingProductMatchSuggestion {
  confidence: MatchConfidence;
  productGid: string;
  reasons: string[];
  score: number;
  variantGid: string | null;
}

export function buildExistingProductMatchSuggestions(input: {
  ebay: EbayMatchCandidate;
  limit?: number;
  shopifyProducts: ShopifyMatchCandidate[];
}): ExistingProductMatchSuggestion[] {
  const limit = Number.isInteger(input.limit) && (input.limit ?? 0) > 0
    ? (input.limit as number)
    : 5;

  const bestByProduct = new Map<string, ExistingProductMatchSuggestion>();

  for (const product of input.shopifyProducts) {
    const reasons: string[] = [];
    let score = 0;

    if (sameToken(input.ebay.sku, product.sku)) {
      score += 100;
      reasons.push("SKU identico");
    }
    if (sameToken(input.ebay.itemId, product.barcode)) {
      score += 95;
      reasons.push("ItemID eBay trovato su barcode");
    }

    const titleSimilarity = getTitleSimilarity(input.ebay.title, product.title);
    if (titleSimilarity >= 0.8) {
      score += 40;
      reasons.push("Titolo molto simile");
    } else if (titleSimilarity >= 0.55) {
      score += 24;
      reasons.push("Titolo simile");
    }

    if (score < 20) continue;

    const suggestion = {
      confidence: getConfidence(score),
      productGid: product.productGid,
      reasons,
      score,
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

function sameToken(first: string | null | undefined, second: string | null | undefined) {
  const a = normalizeToken(first);
  const b = normalizeToken(second);

  return Boolean(a && b && a === b);
}

function normalizeToken(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase();
  return normalized && normalized.length > 0 ? normalized : null;
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
