import type { ShopifyCategoryProposal } from "./syncbay-shopify-category-mapping";

export interface ShopifyDraftCategoryFields {
  category?: string;
  productType?: string;
}

export function buildShopifyDraftCategoryFields(
  proposal?: ShopifyCategoryProposal | null,
): ShopifyDraftCategoryFields {
  if (!proposal || proposal.confidence === "low" || !proposal.shopifyCategoryGid) {
    return {};
  }

  return {
    category: proposal.shopifyCategoryGid,
    productType: proposal.productType,
  };
}
