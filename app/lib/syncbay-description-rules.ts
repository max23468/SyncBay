export const DESCRIPTION_RULE_MODES = [
  "CLEAN_HTML",
  "FULL_HTML",
  "TEXT_ONLY",
] as const;

export type DescriptionRuleMode = (typeof DESCRIPTION_RULE_MODES)[number];

export interface SyncBayDescriptionRule {
  mode: DescriptionRuleMode;
}

export const DEFAULT_DESCRIPTION_RULE: SyncBayDescriptionRule = {
  mode: "CLEAN_HTML",
};

export function normalizeDescriptionRuleMode(
  value: string | null | undefined,
): DescriptionRuleMode {
  const normalized = value?.trim().toUpperCase();

  return DESCRIPTION_RULE_MODES.includes(normalized as DescriptionRuleMode)
    ? (normalized as DescriptionRuleMode)
    : DEFAULT_DESCRIPTION_RULE.mode;
}

export function normalizeDescriptionRule(input: {
  mode?: string | null;
}): SyncBayDescriptionRule {
  return { mode: normalizeDescriptionRuleMode(input.mode) };
}

export function normalizeDescriptionRuleFormInput(input: {
  mode: string | null | undefined;
}):
  | { mode: DescriptionRuleMode; status: "valid" }
  | { message: string; status: "invalid" } {
  const normalized = input.mode?.trim().toUpperCase();

  if (DESCRIPTION_RULE_MODES.includes(normalized as DescriptionRuleMode)) {
    return { mode: normalized as DescriptionRuleMode, status: "valid" };
  }

  return {
    message:
      "Modalità descrizione non valida. Scegli HTML pulito, HTML eBay completo o solo testo.",
    status: "invalid",
  };
}

export function getDescriptionRuleSummary(mode: DescriptionRuleMode) {
  if (mode === "FULL_HTML") return "HTML eBay completo";
  if (mode === "TEXT_ONLY") return "Solo testo";

  return "HTML pulito";
}

export function getDescriptionRuleDetail(mode: DescriptionRuleMode) {
  if (mode === "FULL_HTML") {
    return "SyncBay conserva l'HTML letto da eBay senza pulizia dei template.";
  }
  if (mode === "TEXT_ONLY") {
    return "SyncBay rimuove il markup e salva solo testo leggibile su Shopify.";
  }

  return "SyncBay rimuove template, colori e markup non essenziale prima di scrivere su Shopify.";
}
