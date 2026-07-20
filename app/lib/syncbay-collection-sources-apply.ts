// Traduce una proposta di regole (modello legacy `ruleSet` column/relation/condition)
// nel modello Shopify Admin 2026-07 "collection sources / conditions".
//
// Nel 2026-07 `collectionUpdate(collection: CollectionUpdateInput!)` non accetta
// più `ruleSet`: le condizioni automatiche vivono in una CollectionConditionsSource
// con condizioni tipizzate (productType, variantInventory, ...). Questo modulo è
// puro: legge la source corrente e produce l'entry `sourcesToUpdate` minimale,
// aggiornando in place le condizioni esistenti invece di ricrearle.

export interface SourcesConditionRead {
  __typename: string;
  id: string;
  relation?: string | null;
  value?: number | null;
  values?: string[] | null;
}

export interface ConditionsSourceRead {
  id: string;
  inclusion: {
    conditions: SourcesConditionRead[];
    matchType: string;
  };
}

export interface LegacyRuleSet {
  appliedDisjunctively: boolean;
  rules: { column: string; condition: string; relation: string }[];
}

export interface SourcesUpdateEntry {
  condition: {
    id: string;
    inclusion: {
      conditionsToCreate?: unknown[];
      conditionsToUpdate?: { condition: unknown; id: string }[];
      matchType: string;
    };
  };
}

const PRODUCT_TYPE_TYPENAME = "CollectionSourceInclusionConditionProductType";
const PRODUCT_TITLE_TYPENAME = "CollectionSourceInclusionConditionProductTitle";
const VARIANT_INVENTORY_TYPENAME = "CollectionSourceInclusionConditionVariantInventory";

const TEXT_RELATIONS = new Set([
  "EQUALS",
  "NOT_EQUALS",
  "STARTS_WITH",
  "ENDS_WITH",
  "CONTAINS",
  "DOES_NOT_CONTAIN",
]);
const INVENTORY_RELATIONS = new Set(["EQUALS", "GREATER_THAN", "LESS_THAN"]);

// Costruisce l'entry `sourcesToUpdate` per una singola collezione automatica.
// Supporta solo colonne TYPE e VARIANT_INVENTORY: qualsiasi altra colonna
// (es. TITLE) fa fallire in modo esplicito per non scrivere regole ambigue.
export function buildSourcesUpdate(input: {
  currentSource: ConditionsSourceRead;
  proposedRuleSet: LegacyRuleSet;
}): SourcesUpdateEntry {
  const { currentSource, proposedRuleSet } = input;
  const matchType = proposedRuleSet.appliedDisjunctively ? "ANY" : "ALL";

  const typeRules = proposedRuleSet.rules.filter((rule) => rule.column === "TYPE");
  const titleRules = proposedRuleSet.rules.filter((rule) => rule.column === "TITLE");
  const inventoryRules = proposedRuleSet.rules.filter(
    (rule) => rule.column === "VARIANT_INVENTORY",
  );
  const unsupported = proposedRuleSet.rules.filter(
    (rule) =>
      rule.column !== "TYPE" && rule.column !== "TITLE" && rule.column !== "VARIANT_INVENTORY",
  );
  if (unsupported.length > 0) {
    throw new Error(
      `Colonna regola non supportata dal modello sources: ${unsupported
        .map((rule) => rule.column)
        .join(", ")}`,
    );
  }

  const conditionsToCreate: unknown[] = [];
  const conditionsToUpdate: { condition: unknown; id: string }[] = [];

  if (typeRules.length > 0) {
    const relation = requireSharedTextRelation(typeRules, "productType");
    const values = typeRules.map((rule) => rule.condition);
    const condition = { productType: { matchType, relation, values } };
    const existing = currentSource.inclusion.conditions.find(
      (item) => item.__typename === PRODUCT_TYPE_TYPENAME,
    );
    if (existing) {
      conditionsToUpdate.push({ condition, id: existing.id });
    } else {
      conditionsToCreate.push(condition);
    }
  }

  if (titleRules.length > 0) {
    const relation = requireSharedTextRelation(titleRules, "productTitle");
    const values = titleRules.map((rule) => rule.condition);
    // I valori titolo sono alternative (OR): la condizione ProductTitle usa
    // sempre matchType ANY, mentre l'AND con l'inventario resta a livello di
    // inclusione. Così si preserva la logica titolo senza flatten OR -> AND.
    const condition = { productTitle: { matchType: "ANY", relation, values } };
    const existing = currentSource.inclusion.conditions.find(
      (item) => item.__typename === PRODUCT_TITLE_TYPENAME,
    );
    if (existing) {
      conditionsToUpdate.push({ condition, id: existing.id });
    } else {
      conditionsToCreate.push(condition);
    }
  }

  if (inventoryRules.length > 0) {
    if (inventoryRules.length > 1) {
      throw new Error("Più regole inventario non supportate nel modello sources.");
    }
    const [rule] = inventoryRules;
    if (!INVENTORY_RELATIONS.has(rule.relation)) {
      throw new Error(`Relazione inventario non supportata: ${rule.relation}`);
    }
    const value = Number(rule.condition);
    if (!Number.isFinite(value)) {
      throw new Error(`Valore inventario non numerico: ${rule.condition}`);
    }
    const condition = { variantInventory: { relation: rule.relation, value } };
    const existing = currentSource.inclusion.conditions.find(
      (item) => item.__typename === VARIANT_INVENTORY_TYPENAME,
    );
    if (!existing) {
      conditionsToCreate.push(condition);
    } else if (existing.relation !== rule.relation || existing.value !== value) {
      conditionsToUpdate.push({ condition, id: existing.id });
    }
  }

  const inclusion: SourcesUpdateEntry["condition"]["inclusion"] = { matchType };
  if (conditionsToCreate.length > 0) inclusion.conditionsToCreate = conditionsToCreate;
  if (conditionsToUpdate.length > 0) inclusion.conditionsToUpdate = conditionsToUpdate;

  return { condition: { id: currentSource.id, inclusion } };
}

function requireSharedTextRelation(rules: { relation: string }[], label: string): string {
  const relation = rules[0].relation;
  if (!TEXT_RELATIONS.has(relation)) {
    throw new Error(`Relazione ${label} non supportata: ${relation}`);
  }
  if (rules.some((rule) => rule.relation !== relation)) {
    throw new Error(`Relazioni ${label} miste non supportate nel modello sources.`);
  }
  return relation;
}
