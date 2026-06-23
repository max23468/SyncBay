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

const DEFAULT_MONTHLY_BUDGET_GB = 5;
const DAYS_PER_BUDGET_MONTH = 30;
const MB_BYTES = 1_000_000;
const MINUTES_PER_DAY = 24 * 60;

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
  const sql = query.trim();
  const firstKeyword = readKeyword(sql, 0);

  if (firstKeyword?.keyword === "select" || firstKeyword?.keyword === "values") {
    return true;
  }
  if (firstKeyword?.keyword !== "with") return false;

  return isReadOnlyWithSelectStatement(sql);
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

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function isReadOnlyWithSelectStatement(sql: string) {
  const withKeyword = readKeyword(sql, 0);
  if (withKeyword?.keyword !== "with") return false;

  let index = skipWhitespace(sql, withKeyword.end);
  const recursiveKeyword = readKeyword(sql, index);
  if (recursiveKeyword?.keyword === "recursive") {
    index = skipWhitespace(sql, recursiveKeyword.end);
  }

  while (index < sql.length) {
    const nameEnd = skipSqlIdentifier(sql, index);
    if (nameEnd === null) return false;

    index = skipWhitespace(sql, nameEnd);
    if (sql[index] === "(") {
      const columnListEnd = findMatchingParen(sql, index);
      if (columnListEnd === null) return false;
      index = skipWhitespace(sql, columnListEnd + 1);
    }

    const asKeyword = readKeyword(sql, index);
    if (asKeyword?.keyword !== "as") return false;

    index = skipWhitespace(sql, asKeyword.end);
    if (sql[index] !== "(") return false;

    const bodyStart = index + 1;
    const bodyEnd = findMatchingParen(sql, index);
    if (bodyEnd === null) return false;

    if (!isEgressReadStatementQuery(sql.slice(bodyStart, bodyEnd))) {
      return false;
    }

    index = skipWhitespace(sql, bodyEnd + 1);
    if (sql[index] === ",") {
      index = skipWhitespace(sql, index + 1);
      continue;
    }

    return readKeyword(sql, index)?.keyword === "select";
  }

  return false;
}

function readKeyword(sql: string, index: number) {
  const start = skipWhitespace(sql, index);
  const match = /^[a-z_][a-z0-9_]*/i.exec(sql.slice(start));

  if (!match) return null;

  return {
    end: start + match[0].length,
    keyword: match[0].toLowerCase(),
  };
}

function skipWhitespace(sql: string, index: number) {
  let cursor = index;

  while (cursor < sql.length && /\s/.test(sql[cursor] ?? "")) {
    cursor += 1;
  }

  return cursor;
}

function skipSqlIdentifier(sql: string, index: number) {
  const start = skipWhitespace(sql, index);

  if (sql[start] === '"') {
    const end = skipDoubleQuotedIdentifier(sql, start);
    return end === null ? null : end + 1;
  }

  const match = /^[a-z_][a-z0-9_$]*/i.exec(sql.slice(start));
  return match ? start + match[0].length : null;
}

function skipDoubleQuotedIdentifier(sql: string, index: number) {
  let cursor = index + 1;

  while (cursor < sql.length) {
    if (sql[cursor] === '"' && sql[cursor + 1] === '"') {
      cursor += 2;
      continue;
    }

    if (sql[cursor] === '"') return cursor;

    cursor += 1;
  }

  return null;
}

function findMatchingParen(sql: string, openIndex: number) {
  let depth = 0;
  let cursor = openIndex;

  while (cursor < sql.length) {
    const char = sql[cursor];

    if (char === "'") {
      cursor = skipSingleQuotedString(sql, cursor);
      continue;
    }

    if (char === '"') {
      const end = skipDoubleQuotedIdentifier(sql, cursor);
      if (end === null) return null;
      cursor = end + 1;
      continue;
    }

    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return cursor;
    }

    cursor += 1;
  }

  return null;
}

function skipSingleQuotedString(sql: string, index: number) {
  let cursor = index + 1;

  while (cursor < sql.length) {
    if (sql[cursor] === "'" && sql[cursor + 1] === "'") {
      cursor += 2;
      continue;
    }

    if (sql[cursor] === "'") return cursor + 1;

    cursor += 1;
  }

  return sql.length;
}
