/**
 * Opzioni e validazione dell'intervallo target di aggiornamento catalogo.
 *
 * Il target guida la cadenza del sync incrementale (vedi
 * `getNextIncrementalEnqueueAt`) e la soglia "in ritardo". Resta vincolato a
 * "entro massimo 5 minuti" (ADR 0012): valori ammessi 60-300 secondi.
 */

export const SYNC_TARGET_OPTIONS = [
  { label: "1 minuto", value: 60 },
  { label: "2 minuti", value: 120 },
  { label: "3 minuti", value: 180 },
  { label: "5 minuti", value: 300 },
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
