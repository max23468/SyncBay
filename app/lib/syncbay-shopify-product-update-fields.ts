export interface ShopifyProductUpdateDraftFields {
  category?: string;
  descriptionHtml?: string;
  productType?: string;
  status?: string;
  title: string;
}

export interface ShopifyProductUpdateFields extends ShopifyProductUpdateDraftFields {
  id: string;
}

export function buildShopifyProductUpdateFieldsFromDraft(input: {
  product: ShopifyProductUpdateDraftFields;
  productId: string;
}): ShopifyProductUpdateFields {
  const fields: ShopifyProductUpdateFields = {
    id: input.productId,
    title: input.product.title,
  };

  assignDefined(fields, "category", input.product.category);
  assignDefined(fields, "descriptionHtml", input.product.descriptionHtml);
  assignDefined(fields, "productType", input.product.productType);
  assignDefined(fields, "status", input.product.status);

  return fields;
}

function assignDefined<K extends keyof ShopifyProductUpdateDraftFields>(
  target: ShopifyProductUpdateFields,
  key: K,
  value: ShopifyProductUpdateDraftFields[K],
) {
  if (value !== undefined) {
    target[key] = value;
  }
}
