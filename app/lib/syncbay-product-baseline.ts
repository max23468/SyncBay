export type ProductBaselineValue = string | number | null | string[] | Record<string, string[]>;

export type ProductBaselineState = Record<string, ProductBaselineValue>;
export type ProductBaselinePatch = Record<string, ProductBaselineValue | undefined>;

export function mergeProductBaseline<T extends ProductBaselineState>(
  current: T,
  patch: ProductBaselinePatch,
): T & ProductBaselineState {
  const merged: ProductBaselineState = { ...current };

  for (const [field, value] of Object.entries(patch)) {
    if (value !== undefined) merged[field] = value;
  }

  return merged as T & ProductBaselineState;
}

export function getUtcWeekStart(input: Date) {
  const date = new Date(Date.UTC(
    input.getUTCFullYear(),
    input.getUTCMonth(),
    input.getUTCDate(),
  ));
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return date;
}
