/**
 * Rilevamento della deriva tra le due fonti di una mapping prodotto.
 *
 * eBay è la sorgente di verità del catalogo (AGENTS.md). Nel tempo le due fonti
 * possono divergere in modi che vanno resi visibili e azionabili invece che
 * lasciati silenziosi:
 *
 * - `orphan_shopify_missing`: il prodotto Shopify mappato non esiste più (per
 *   esempio cancellato a mano), quindi la vetrina ha un buco;
 * - `delisted_not_marked`: il listing eBay non è più attivo ma la mapping non è
 *   ancora stata portata a esaurito secondo ADR 0011 (scorta 0, non archiviata
 *   né cancellata) per preservarne la SEO;
 * - `errored`: la mapping è in stato di errore e resta da recuperare.
 *
 * È conservativo come `buildCatalogReconcilePlan`: segnala una deriva solo
 * quando la relativa scansione è completa, per non generare falsi positivi su
 * letture parziali.
 */

export type MappingDriftReason =
  | "delisted_not_marked"
  | "errored"
  | "orphan_shopify_missing";

export interface MappingDriftRecord {
  ebayItemId: string;
  shopifyProductGid: string | null;
  status: string;
}

export interface MappingDriftItem {
  ebayItemId: string;
  reason: MappingDriftReason;
  shopifyProductGid: string | null;
  status: string;
}

export interface MappingDriftReport {
  items: MappingDriftItem[];
  summary: Record<MappingDriftReason, number> & { total: number };
}

// Stati per cui un prodotto Shopify mancante è una deriva (la vetrina dovrebbe
// avere il prodotto). `ARCHIVED` esclude: l'assenza è attesa.
const EXPECTED_PRESENT_STATUSES = new Set([
  "ACTIVE",
  "ERROR",
  "OUT_OF_STOCK",
  "PAUSED",
]);

// Stati che indicano che la mapping è già stata portata a esaurito o archiviata
// secondo ADR 0011: un listing eBay sparito non è più una deriva.
const ALREADY_DELISTED_STATUSES = new Set(["ARCHIVED", "OUT_OF_STOCK"]);

export function classifyMappingDrift(input: {
  activeEbayItemIds: string[];
  activeScanComplete: boolean;
  existingShopifyProductGids: string[];
  mappings: MappingDriftRecord[];
  shopifyScanComplete: boolean;
}): MappingDriftReport {
  const activeEbaySet = new Set(normalizeStrings(input.activeEbayItemIds));
  const existingShopifySet = new Set(
    normalizeStrings(input.existingShopifyProductGids),
  );

  const items: MappingDriftItem[] = [];

  for (const mapping of input.mappings) {
    const reason = classifyOne({
      activeEbaySet,
      activeScanComplete: input.activeScanComplete,
      existingShopifySet,
      mapping,
      shopifyScanComplete: input.shopifyScanComplete,
    });

    if (reason) {
      items.push({
        ebayItemId: mapping.ebayItemId,
        reason,
        shopifyProductGid: mapping.shopifyProductGid,
        status: mapping.status,
      });
    }
  }

  return { items, summary: summarize(items) };
}

function classifyOne(input: {
  activeEbaySet: Set<string>;
  activeScanComplete: boolean;
  existingShopifySet: Set<string>;
  mapping: MappingDriftRecord;
  shopifyScanComplete: boolean;
}): MappingDriftReason | null {
  const status = input.mapping.status?.trim().toUpperCase() ?? "";
  const gid = input.mapping.shopifyProductGid?.trim() || null;

  if (
    input.shopifyScanComplete &&
    gid !== null &&
    EXPECTED_PRESENT_STATUSES.has(status) &&
    !input.existingShopifySet.has(gid)
  ) {
    return "orphan_shopify_missing";
  }

  if (status === "ERROR") {
    return "errored";
  }

  if (
    input.activeScanComplete &&
    !ALREADY_DELISTED_STATUSES.has(status) &&
    input.mapping.ebayItemId.trim() !== "" &&
    !input.activeEbaySet.has(input.mapping.ebayItemId.trim())
  ) {
    return "delisted_not_marked";
  }

  return null;
}

function summarize(items: MappingDriftItem[]) {
  return items.reduce(
    (summary, item) => {
      summary[item.reason] += 1;
      summary.total += 1;
      return summary;
    },
    {
      delisted_not_marked: 0,
      errored: 0,
      orphan_shopify_missing: 0,
      total: 0,
    },
  );
}

function normalizeStrings(values: string[]) {
  return values.flatMap((value) => {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  });
}
