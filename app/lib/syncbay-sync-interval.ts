/**
 * Opzioni e validazione dell'intervallo target di aggiornamento catalogo.
 *
 * Il target guida la cadenza del sync incrementale (vedi
 * `getNextIncrementalEnqueueAt`) e la soglia "in ritardo". La finestra è
 * conservativa per la 1.0 privata: valori ammessi 300-1800 secondi.
 */

export const SYNC_TARGET_OPTIONS = [
  { label: "5 minuti", value: 300 },
  { label: "10 minuti", value: 600 },
  { label: "15 minuti", value: 900 },
  { label: "20 minuti", value: 1200 },
  { label: "30 minuti", value: 1800 },
] as const;

export function normalizeSyncTargetSeconds(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value ?? "").trim(), 10);

  if (!Number.isInteger(parsed)) return null;

  return SYNC_TARGET_OPTIONS.some((option) => option.value === parsed)
    ? parsed
    : null;
}

export function getSyncTargetLabel(seconds: number): string {
  const match = SYNC_TARGET_OPTIONS.find((option) => option.value === seconds);

  if (match) return match.label;

  // Fallback per valori impostati via env fuori dalle opzioni standard.
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;

    return `${minutes} ${minutes === 1 ? "minuto" : "minuti"}`;
  }

  return `${seconds} s`;
}
