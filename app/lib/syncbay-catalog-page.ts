export const CATALOG_PAGE_SIZE = 50;

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

export const CATALOG_SORT_KEYS = [
  "product",
  "link",
  "availability",
  "price",
  "updated",
  "status",
] as const;

export type CatalogSortKey = (typeof CATALOG_SORT_KEYS)[number];
export type CatalogSortDir = "asc" | "desc";

export function isCatalogRowNeedingCheck(input: {
  availability: string;
  status: string;
}) {
  if (input.status === "mapping_error" || input.status === "stale_sync") {
    return true;
  }

  if (input.status === "archived") return false;

  return input.availability !== "aligned";
}

export function catalogRowMatchesSearch(
  row: {
    ebayItemId: string | null;
    sku: string | null;
    title: string | null;
  },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();

  if (!needle) return true;

  return [row.title, row.sku, row.ebayItemId].some(
    (field) => field?.toLowerCase().includes(needle) ?? false,
  );
}

export function normalizeCatalogSort(
  value: string | null | undefined,
): CatalogSortKey | null {
  return CATALOG_SORT_KEYS.includes(value as CatalogSortKey)
    ? (value as CatalogSortKey)
    : null;
}

export function normalizeCatalogSortDir(
  value: string | null | undefined,
): CatalogSortDir {
  return value === "desc" ? "desc" : "asc";
}

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

export function getCatalogQueryPlan(input: {
  filter: CatalogPageFilter;
  page: number;
  search?: string | null;
  sort: CatalogSortKey | null;
  sortDir: CatalogSortDir;
  totalRows: number;
}) {
  if (
    ["all", "linked", "conflicts", "not_updated", "archived"].includes(
      input.filter,
    ) &&
    !input.search?.trim() &&
    !input.sort
  ) {
    const pagination = getCatalogPageWindow({
      page: input.page,
      pageSize: CATALOG_PAGE_SIZE,
      totalRows: input.totalRows,
    });

    return {
      mode: "database-page" as const,
      pagination,
      take: pagination.pageSize,
    };
  }

  return { mode: "computed-full" as const };
}

export function getCatalogSnapshotLookupIds(input: {
  maxLookupRows: number;
  rows: Array<{ id: string }>;
}) {
  const maxLookupRows =
    Number.isInteger(input.maxLookupRows) && input.maxLookupRows > 0
      ? input.maxLookupRows
      : CATALOG_PAGE_SIZE;
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const row of input.rows) {
    if (seen.has(row.id)) continue;

    seen.add(row.id);
    ids.push(row.id);

    if (ids.length >= maxLookupRows) break;
  }

  return ids;
}
