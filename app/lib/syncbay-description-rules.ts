import type { DescriptionRuleMode as PrismaDescriptionRuleMode } from "@prisma/client";

export const DESCRIPTION_RULE_MODES = [
  "CLEAN_HTML",
  "FULL_HTML",
  "TEXT_ONLY",
] as const satisfies readonly PrismaDescriptionRuleMode[];

export type DescriptionRuleMode = PrismaDescriptionRuleMode;

type MissingPrismaDescriptionRuleMode = Exclude<
  PrismaDescriptionRuleMode,
  (typeof DESCRIPTION_RULE_MODES)[number]
>;
type AssertNoMissingDescriptionRuleMode<T extends never> = T;
export type DescriptionRuleModesCoverPrisma =
  AssertNoMissingDescriptionRuleMode<MissingPrismaDescriptionRuleMode>;

const DESCRIPTION_RULE_MODE_SET: ReadonlySet<string> = new Set(
  DESCRIPTION_RULE_MODES,
);

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

  return isDescriptionRuleMode(normalized)
    ? normalized
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

  if (isDescriptionRuleMode(normalized)) {
    return { mode: normalized, status: "valid" };
  }

  return {
    message:
      "Modalità descrizione non valida. Scegli HTML pulito, HTML eBay completo o solo testo.",
    status: "invalid",
  };
}

function isDescriptionRuleMode(
  value: string | null | undefined,
): value is DescriptionRuleMode {
  return typeof value === "string" && DESCRIPTION_RULE_MODE_SET.has(value);
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

export function applyDescriptionRuleToHtml(input: {
  cleanedHtml: string | null;
  html: string | null | undefined;
  mode: DescriptionRuleMode;
}) {
  const html = input.html ?? null;
  const selectedHtml =
    input.mode === "FULL_HTML"
      ? html
      : input.mode === "TEXT_ONLY"
        ? html
          ? htmlToPlainText(html)
          : null
        : input.cleanedHtml;

  return {
    html: selectedHtml,
    mode: input.mode,
    removedPercent: getRemovedPercent(html, selectedHtml),
    wasChanged: selectedHtml !== html,
  };
}

function htmlToPlainText(html: string) {
  return normalizePlainText(
    decodeBasicHtmlEntities(
      html
        // Apertura e chiusura devono entrambe terminare su un confine reale del
        // nome tag. Senza il confine sulla chiusura un token come
        // `</scriptual>` verrebbe accettato da `[^>]*` e la rimozione si
        // fermerebbe prima, lasciando il corpo dello script nella descrizione.
        // Senza il confine sull'apertura un elemento come `<scripture>`
        // aprirebbe il blocco e la rimozione correrebbe fino al `</script>`
        // successivo, cancellando il testo del negoziante nel mezzo.
        // Il confine ammette comunque spazi e attributi, come `</script\t\n bar>`.
        .replace(/<script(?=[\s/>])[\s\S]*?<\/script(?=[\s/>])[^>]*>/giu, " ")
        .replace(/<style(?=[\s/>])[\s\S]*?<\/style(?=[\s/>])[^>]*>/giu, " ")
        .replace(/<[^>]+>/gu, " ")
        .replace(/\s+/gu, " ")
        .trim(),
    ),
  );
}

function normalizePlainText(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function decodeBasicHtmlEntities(value: string) {
  // `&amp;` va decodificato per ultimo: farlo prima trasformerebbe un input
  // gia' escapato come `&amp;lt;` in `&lt;` e poi in `<`, un doppio unescape.
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&amp;/giu, "&");
}

function getRemovedPercent(
  originalHtml: string | null,
  selectedHtml: string | null,
) {
  const originalLength = originalHtml?.length ?? 0;
  const selectedLength = selectedHtml?.length ?? 0;

  return originalLength
    ? Math.max(
        0,
        Math.round(((originalLength - selectedLength) / originalLength) * 100),
      )
    : 0;
}
