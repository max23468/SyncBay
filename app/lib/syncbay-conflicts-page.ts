export const CONFLICT_PAGE_SIZE = 25;

export type ConflictFilter = "all" | "open" | "resolved";

export function normalizeConflictFilter(value: string | null | undefined): ConflictFilter {
  if (value === "all" || value === "resolved") return value;

  return "open";
}

export function getConflictStatusFilter(filter: ConflictFilter) {
  if (filter === "resolved") return ["RESOLVED", "IGNORED"] as const;
  if (filter === "all") return ["OPEN", "RESOLVED", "IGNORED"] as const;

  return ["OPEN"] as const;
}
