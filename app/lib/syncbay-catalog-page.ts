export const CATALOG_PAGE_SIZE = 100;

export const CATALOG_PAGE_FILTERS = [
  "all",
  "linked",
  "fresh",
  "needs_check",
  "conflicts",
  "not_updated",
  "archived",
] as const;

export type CatalogPageFilter = (typeof CATALOG_PAGE_FILTERS)[number];

export function normalizeCatalogPageFilter(
  value: string | null | undefined,
): CatalogPageFilter {
  return CATALOG_PAGE_FILTERS.includes(value as CatalogPageFilter)
    ? (value as CatalogPageFilter)
    : "all";
}

export function normalizeCatalogPage(
  value: string | number | null | undefined,
) {
  const page =
    typeof value === "number" ? value : Number.parseInt(value ?? "", 10);

  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function getCatalogPageWindow(input: {
  page: number;
  pageSize?: number;
  totalRows: number;
}) {
  const pageSize =
    Number.isInteger(input.pageSize) && (input.pageSize ?? 0) > 0
      ? (input.pageSize as number)
      : CATALOG_PAGE_SIZE;
  const totalRows = Math.max(0, input.totalRows);
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const page = Math.min(Math.max(1, input.page), totalPages);
  const offset = (page - 1) * pageSize;
  const currentStart = totalRows === 0 ? 0 : offset + 1;
  const currentEnd = Math.min(offset + pageSize, totalRows);

  return {
    currentEnd,
    currentStart,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
    nextPage: page < totalPages ? page + 1 : null,
    offset,
    page,
    pageSize,
    previousPage: page > 1 ? page - 1 : null,
    totalPages,
    totalRows,
  };
}
