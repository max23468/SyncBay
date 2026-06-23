export type SyncBayEgressBudgetStatus =
  | "near_budget"
  | "over_budget"
  | "unestimated"
  | "within_budget";

export interface SyncBayEgressBudgetReport {
  budgetUsageRatio: number | null;
  dailyBudgetMb: number;
  estimatedWindowEgressMb: number | null;
  maxAverageBytesPerRowForBudget: number | null;
  monthlyBudgetGb: number;
  monthlyBudgetMb: number;
  rowsPerDay: number;
  status: SyncBayEgressBudgetStatus;
  totalRows: number;
  windowBudgetMb: number;
  windowMinutes: number;
}

export interface SyncBayEgressBudgetInput {
  estimatedAverageBytesPerRow?: number | null;
  monthlyBudgetGb?: number;
  totalRows: number;
  windowMinutes: number;
}

export interface SyncBayEgressBudgetReadRowsInput {
  selectRows?: number | null;
  totalRows: number;
}

export const SYNCBAY_EGRESS_READ_QUERY_SQL_PATTERN =
  "^[[:space:]]*(select([^[:alnum:]_]|$)|with([^[:alnum:]_]|$).*\\)[[:space:]]*select([^[:alnum:]_]|$))";

const DEFAULT_MONTHLY_BUDGET_GB = 5;
const DAYS_PER_BUDGET_MONTH = 30;
const MB_BYTES = 1_000_000;
const MINUTES_PER_DAY = 24 * 60;
const READ_QUERY_JS_PATTERN = /^\s*(select\b|with\b.*\)\s*select\b)/i;

export function buildEgressBudgetReport(
  input: SyncBayEgressBudgetInput,
): SyncBayEgressBudgetReport {
  const monthlyBudgetGb = normalizePositiveNumber(
    input.monthlyBudgetGb,
    DEFAULT_MONTHLY_BUDGET_GB,
  );
  const totalRows = Math.max(0, Math.trunc(input.totalRows));
  const windowMinutes = normalizePositiveNumber(input.windowMinutes, 1);
  const monthlyBudgetMbRaw = monthlyBudgetGb * 1_000;
  const dailyBudgetMbRaw = monthlyBudgetMbRaw / DAYS_PER_BUDGET_MONTH;
  const windowBudgetMbRaw = (dailyBudgetMbRaw / MINUTES_PER_DAY) * windowMinutes;
  const monthlyBudgetMb = round2(monthlyBudgetMbRaw);
  const dailyBudgetMb = round2(dailyBudgetMbRaw);
  const windowBudgetMb = round2(windowBudgetMbRaw);
  const rowsPerDay = Math.round((totalRows / windowMinutes) * MINUTES_PER_DAY);
  const maxAverageBytesPerRowForBudget =
    totalRows > 0
      ? Math.round((windowBudgetMbRaw * MB_BYTES) / totalRows)
      : null;
  const estimatedAverageBytesPerRow = normalizeOptionalPositiveNumber(
    input.estimatedAverageBytesPerRow,
  );

  if (estimatedAverageBytesPerRow === null) {
    return {
      budgetUsageRatio: null,
      dailyBudgetMb,
      estimatedWindowEgressMb: null,
      maxAverageBytesPerRowForBudget,
      monthlyBudgetGb,
      monthlyBudgetMb,
      rowsPerDay,
      status: "unestimated",
      totalRows,
      windowBudgetMb,
      windowMinutes,
    };
  }

  const estimatedWindowEgressMbRaw =
    (totalRows * estimatedAverageBytesPerRow) / MB_BYTES;
  const estimatedWindowEgressMb = round2(estimatedWindowEgressMbRaw);
  const budgetUsageRatio =
    windowBudgetMbRaw > 0
      ? round2(estimatedWindowEgressMbRaw / windowBudgetMbRaw)
      : null;

  return {
    budgetUsageRatio,
    dailyBudgetMb,
    estimatedWindowEgressMb,
    maxAverageBytesPerRowForBudget,
    monthlyBudgetGb,
    monthlyBudgetMb,
    rowsPerDay,
    status: classifyBudgetUsageRatio(budgetUsageRatio),
    totalRows,
    windowBudgetMb,
    windowMinutes,
  };
}

export function getEgressBudgetReadRows(input: SyncBayEgressBudgetReadRowsInput) {
  const selectRows = normalizeOptionalNonNegativeInteger(input.selectRows);

  if (selectRows !== null) return selectRows;

  return normalizeNonNegativeInteger(input.totalRows);
}

export function isEgressReadStatementQuery(query: string) {
  return READ_QUERY_JS_PATTERN.test(normalizeSqlWhitespace(query));
}

function classifyBudgetUsageRatio(
  budgetUsageRatio: number | null,
): SyncBayEgressBudgetStatus {
  if (budgetUsageRatio === null) return "unestimated";
  if (budgetUsageRatio >= 1) return "over_budget";
  if (budgetUsageRatio >= 0.8) return "near_budget";

  return "within_budget";
}

function normalizePositiveNumber(value: number | null | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function normalizeNonNegativeInteger(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

function normalizeOptionalNonNegativeInteger(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

function normalizeOptionalPositiveNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function normalizeSqlWhitespace(query: string) {
  return query.replaceAll(/\s+/g, " ").trim();
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
