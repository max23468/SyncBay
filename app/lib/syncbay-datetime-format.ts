const itDateTimeFormatter = new Intl.DateTimeFormat("it-IT", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Rome",
});

const itNumberFormatter = new Intl.NumberFormat("it-IT");

export function formatItDateTime(
  value: Date | string | null | undefined,
  fallback = "non disponibile",
) {
  if (!value) return fallback;

  return itDateTimeFormatter.format(
    value instanceof Date ? value : new Date(value),
  );
}

export function formatItNumber(value: number) {
  return itNumberFormatter.format(value);
}
