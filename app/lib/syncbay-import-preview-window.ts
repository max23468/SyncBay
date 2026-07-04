export type ImportPreviewWindowFilter =
  | "all"
  | "error"
  | "imported"
  | "importing"
  | "ready"
  | "reimport";

type WindowablePreviewItem = {
  itemId: string;
  status: string;
};

type WindowableTakeoverRow = {
  itemId: string;
};

type WindowableImportPreviewResult<
  Item extends WindowablePreviewItem,
  TakeoverRow extends WindowableTakeoverRow,
> = {
  existingCatalogTakeover?: {
    rows: TakeoverRow[];
    summary: unknown;
  };
  items: Item[];
};

export function windowImportPreviewResult<
  Item extends WindowablePreviewItem,
  TakeoverRow extends WindowableTakeoverRow,
  PreviewResult extends WindowableImportPreviewResult<Item, TakeoverRow>,
>(
  previewResult: PreviewResult,
  input: {
    filter: ImportPreviewWindowFilter;
    page: number;
    pageSize: number;
  },
) {
  const filteredItems = filterPreviewItems(previewResult.items, input.filter);
  const pagination = getPageWindow({
    page: input.page,
    pageSize: input.pageSize,
    totalRows: filteredItems.length,
  });
  const windowedItems = filteredItems.slice(
    pagination.offset,
    pagination.offset + pagination.pageSize,
  );
  const windowedItemIds = new Set(windowedItems.map((item) => item.itemId));
  const existingCatalogTakeover = previewResult.existingCatalogTakeover
    ? {
        ...previewResult.existingCatalogTakeover,
        rows: previewResult.existingCatalogTakeover.rows.filter((row) =>
          windowedItemIds.has(row.itemId),
        ),
      }
    : undefined;

  return {
    ...previewResult,
    existingCatalogTakeover,
    items: windowedItems,
    window: {
      currentEnd: pagination.currentEnd,
      currentStart: pagination.currentStart,
      filter: input.filter,
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalPages: pagination.totalPages,
      totalRows: pagination.totalRows,
    },
  };
}

function filterPreviewItems<Item extends WindowablePreviewItem>(
  items: Item[],
  filter: ImportPreviewWindowFilter,
) {
  if (filter === "ready") {
    return items.filter((item) => item.status === "importable");
  }
  if (filter === "error") {
    return items.filter((item) => item.status === "error");
  }
  if (filter === "all") return items;

  return [];
}

function getPageWindow(input: {
  page: number;
  pageSize: number;
  totalRows: number;
}) {
  const pageSize =
    Number.isInteger(input.pageSize) && input.pageSize > 0
      ? input.pageSize
      : 25;
  const totalRows = Math.max(0, input.totalRows);
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const page = Math.min(Math.max(1, input.page), totalPages);
  const offset = (page - 1) * pageSize;
  const currentStart = totalRows === 0 ? 0 : offset + 1;
  const currentEnd = Math.min(offset + pageSize, totalRows);

  return {
    currentEnd,
    currentStart,
    offset,
    page,
    pageSize,
    totalPages,
    totalRows,
  };
}
