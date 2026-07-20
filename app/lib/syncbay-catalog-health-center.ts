export type CatalogHealthCenterTone = "critical" | "info" | "success" | "warning";

export interface CatalogHealthCause {
  code:
    | "errored_mappings"
    | "failed_jobs"
    | "incremental_running"
    | "needs_check"
    | "open_conflicts"
    | "stale_sync"
    | "unknown_availability";
  count: number;
  detail: string;
  label: string;
  tone: Exclude<CatalogHealthCenterTone, "success">;
}

export interface CatalogHealthCenter {
  causes: CatalogHealthCause[];
  status: CatalogHealthCenterTone;
  summary: string;
}

export function buildCatalogHealthCenter(input: {
  activeIncrementalJobCount: number;
  erroredMappingCount: number;
  failedJobCount: number;
  needsCheckCount: number;
  openConflictCount: number;
  staleActiveCount: number;
  unknownAvailabilityCount: number;
}): CatalogHealthCenter {
  const causes: CatalogHealthCause[] = [];

  pushCause(causes, input.staleActiveCount, {
    code: "stale_sync",
    detail: "Il watermark catalogo è più vecchio della finestra target.",
    label: "Prodotti attivi non verificati",
    tone: "warning",
  });
  pushCause(causes, input.needsCheckCount, {
    code: "needs_check",
    detail: "Alcuni mapping richiedono una verifica prima di considerarli allineati.",
    label: "Righe da verificare",
    tone: "warning",
  });
  pushCause(causes, input.unknownAvailabilityCount, {
    code: "unknown_availability",
    detail: "SyncBay non ha una disponibilità affidabile per questi prodotti.",
    label: "Disponibilità da chiarire",
    tone: "warning",
  });
  pushCause(causes, input.openConflictCount, {
    code: "open_conflicts",
    detail: "Decisioni Shopify aperte bloccano l'allineamento automatico.",
    label: "Conflitti aperti",
    tone: "warning",
  });
  pushCause(causes, input.erroredMappingCount, {
    code: "errored_mappings",
    detail: "Alcuni prodotti collegati sono in errore e non si allineano: vanno recuperati.",
    label: "Prodotti in errore",
    tone: "critical",
  });
  pushCause(causes, input.failedJobCount, {
    code: "failed_jobs",
    detail: "Almeno un job recente richiede diagnosi o retry.",
    label: "Errori recenti",
    tone: "critical",
  });
  pushCause(causes, input.activeIncrementalJobCount, {
    code: "incremental_running",
    detail: "Il runner sta ancora lavorando sul catalogo.",
    label: "Aggiornamenti in corso",
    tone: "info",
  });

  const status: CatalogHealthCenterTone = causes.some((cause) => cause.tone === "critical")
    ? "critical"
    : causes.some((cause) => cause.tone === "warning")
      ? "warning"
      : causes.some((cause) => cause.tone === "info")
        ? "info"
        : "success";
  const health = {
    causes,
    status,
  };

  return {
    ...health,
    summary: getCatalogHealthCenterSummary(health),
  };
}

export function getCatalogHealthCenterSummary(health: { causes: CatalogHealthCause[] }) {
  if (health.causes.length === 0) return "Catalogo allineato";

  return health.causes.map((cause) => `${cause.count} ${cause.label.toLowerCase()}`).join("; ");
}

function pushCause(
  causes: CatalogHealthCause[],
  count: number,
  cause: Omit<CatalogHealthCause, "count">,
) {
  if (count <= 0) return;
  causes.push({ ...cause, count });
}
