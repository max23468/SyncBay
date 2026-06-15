export function shouldRefreshCategoryFromTrading(input: {
  ebayPrimaryCategoryName?: string | null;
  ebayStoreCategoryName?: string | null;
}) {
  return !normalizeText(input.ebayPrimaryCategoryName);
}

function normalizeText(value: string | null | undefined) {
  const text = value?.trim();

  return text ? text : null;
}
