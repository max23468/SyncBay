import type { SyncConflictResolution } from "@prisma/client";

export type ConflictResolution = SyncConflictResolution;

export type ConflictDecisionMode =
  | "batch_safe"
  | "guarded"
  | "manual_only";

export interface ConflictResolutionSafety {
  detail: string;
  label: string;
  mode: ConflictDecisionMode;
}

export interface ConflictDecisionModeSummaryInput {
  count: number;
  field: string;
}

export function getConflictFieldDecisionMode(
  field: string,
): ConflictDecisionMode {
  if (field === "description") return "batch_safe";
  if (field === "title" || field === "images") return "guarded";

  return "manual_only";
}

export function getConflictDecisionModeLabel(mode: ConflictDecisionMode) {
  if (mode === "batch_safe") return "Sicuro";
  if (mode === "guarded") return "Da rivedere";

  return "Da decidere";
}

export function getConflictDecisionModeDetail(
  field: string,
  mode = getConflictFieldDecisionMode(field),
) {
  if (mode === "batch_safe") {
    return "Puoi tenere la descrizione di Shopify: diventa la versione di riferimento, senza rischi.";
  }
  if (mode === "guarded") {
    return "Puoi sistemarlo, ma guarda prima il prodotto: cambia testo o immagini che vede il cliente.";
  }

  return "Meglio decidere a mano: può toccare disponibilità, prezzo o pubblicazione del prodotto.";
}

export function getSafeBatchConflictResolutions(
  field: string,
): ConflictResolution[] {
  if (field === "description") return ["KEEP_SHOPIFY"];

  return [];
}

export function isStaleConflictResolutionError(error: unknown) {
  return error instanceof Response && error.status === 404;
}

export function getConflictResolutionSafety(
  field: string,
  resolution: ConflictResolution,
): ConflictResolutionSafety {
  if (getSafeBatchConflictResolutions(field).includes(resolution)) {
    return {
      detail:
        "Tiene la descrizione di Shopify come riferimento, senza toccare eBay.",
      label: "Sicuro",
      mode: "batch_safe",
    };
  }

  if (resolution === "IGNORE_FIELD") {
    return {
      detail:
        "Salta questo conflitto per ora: non cambia nulla e lo ritrovi se ricompare.",
      label: "Da decidere",
      mode: "manual_only",
    };
  }

  const fieldMode = getConflictFieldDecisionMode(field);

  if (fieldMode === "guarded" || fieldMode === "batch_safe") {
    return {
      detail:
        "Guarda il prodotto prima di applicarla a tutti: testo e immagini li vede il cliente.",
      label: "Da rivedere",
      mode: "guarded",
    };
  }

  return {
    detail:
      "Scelta manuale: per questo campo non è una sistemazione sicura da applicare a tutti.",
    label: "Da decidere",
    mode: "manual_only",
  };
}

export function summarizeConflictDecisionModes(
  groups: ConflictDecisionModeSummaryInput[],
) {
  return groups.reduce(
    (summary, group) => {
      const mode = getConflictFieldDecisionMode(group.field);

      if (mode === "batch_safe") {
        summary.batchSafeCount += group.count;
      } else if (mode === "guarded") {
        summary.guardedCount += group.count;
      } else {
        summary.manualOnlyCount += group.count;
      }

      return summary;
    },
    {
      batchSafeCount: 0,
      guardedCount: 0,
      manualOnlyCount: 0,
    },
  );
}
