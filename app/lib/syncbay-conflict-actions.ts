export type ConflictResolution =
  | "REALIGN_FROM_EBAY"
  | "KEEP_SHOPIFY"
  | "IGNORE_FIELD";

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
  if (mode === "batch_safe") return "Batch sicuro";
  if (mode === "guarded") return "Da rivedere";

  return "Manuale";
}

export function getConflictDecisionModeDetail(
  field: string,
  mode = getConflictFieldDecisionMode(field),
) {
  if (mode === "batch_safe") {
    return "Può entrare in azioni batch solo per mantenere la descrizione Shopify come nuova baseline.";
  }
  if (mode === "guarded") {
    return "Azione possibile, ma richiede revisione visiva perché cambia contenuto o immagini del prodotto.";
  }

  return "Richiede decisione manuale: può impattare disponibilità, prezzo, pubblicazione o mapping.";
}

export function getSafeBatchConflictResolutions(
  field: string,
): ConflictResolution[] {
  if (field === "description") return ["KEEP_SHOPIFY"];

  return [];
}

export function getConflictResolutionSafety(
  field: string,
  resolution: ConflictResolution,
): ConflictResolutionSafety {
  if (getSafeBatchConflictResolutions(field).includes(resolution)) {
    return {
      detail:
        "Mantiene la descrizione Shopify e aggiorna la baseline SyncBay senza chiamare provider esterni.",
      label: "Batch sicuro",
      mode: "batch_safe",
    };
  }

  if (resolution === "IGNORE_FIELD") {
    return {
      detail:
        "Ignora solo questo conflitto: usare manualmente quando il campo non va più gestito in questo ciclo.",
      label: "Manuale",
      mode: "manual_only",
    };
  }

  const fieldMode = getConflictFieldDecisionMode(field);

  if (fieldMode === "guarded" || fieldMode === "batch_safe") {
    return {
      detail:
        "Rivedi il prodotto prima di applicarla in serie: contenuto e immagini sono visibili al cliente.",
      label: "Da rivedere",
      mode: "guarded",
    };
  }

  return {
    detail:
      "Decisione manuale obbligatoria: non è una correzione batch sicura per questo campo.",
    label: "Manuale",
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
