type StockJobResult = {
  planned?: unknown;
  updated?: unknown;
};

export function hasProcessedStockLineInJobResults(input: {
  ebayItemId: string;
  includeDryRunPlans?: boolean;
  lineItemKey: string | null;
  results: StockJobResult[];
}) {
  if (!input.lineItemKey) return false;

  return input.results.some((result) =>
    [
      ...getStockResultRows(result.updated),
      ...(input.includeDryRunPlans ? getStockResultRows(result.planned) : []),
    ].some(
      (row) =>
        getStringField(row, "lineItemKey") === input.lineItemKey &&
        getStringField(row, "ebayItemId") === input.ebayItemId,
    ),
  );
}

function getStockResultRows(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getStringField(record: Record<string, unknown>, key: string) {
  const value = record[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}
