// Converte una CollectionConditionsSource del modello Shopify Admin 2026-07
// (`sources / conditions` tipizzate) nella forma legacy `ruleSet`
// (`appliedDisjunctively` + `rules[{ column, relation, condition }]`) usata dal
// motore proposte del doctor. Serve a leggere le condizioni collezione senza
// dipendere dal campo deprecato `Collection.ruleSet`. Modulo puro.

export interface SourcesConditionRead {
  __typename: string;
  id?: string;
  relation?: string | null;
  value?: number | null;
  values?: string[] | null;
}

export interface ConditionsSourceRead {
  id?: string;
  inclusion: {
    conditions: SourcesConditionRead[];
    matchType: string;
  } | null;
}

export interface LegacyRuleSet {
  appliedDisjunctively: boolean;
  rules: { column: string; condition: string; relation: string }[];
}

// Mappa i typename delle condizioni tipizzate sulle colonne legacy note al
// motore proposte. I typename non mappati restano come colonna esplicita: così
// una condizione non riconosciuta resta visibile nel confronto e non viene
// silenziosamente scartata (evitando proposte distruttive).
const TYPENAME_TO_COLUMN: Record<string, string> = {
  CollectionSourceInclusionConditionProductType: "TYPE",
  CollectionSourceInclusionConditionProductTitle: "TITLE",
  CollectionSourceInclusionConditionProductVendor: "VENDOR",
  CollectionSourceInclusionConditionProductTag: "TAG",
  CollectionSourceInclusionConditionProductCategory: "CATEGORY",
  CollectionSourceInclusionConditionProductStatus: "PRODUCT_STATUS",
  CollectionSourceInclusionConditionVariantInventory: "VARIANT_INVENTORY",
  CollectionSourceInclusionConditionVariantPrice: "VARIANT_PRICE",
  CollectionSourceInclusionConditionVariantCompareAtPrice:
    "VARIANT_COMPARE_AT_PRICE",
  CollectionSourceInclusionConditionVariantWeight: "VARIANT_WEIGHT",
  CollectionSourceInclusionConditionVariantTitle: "VARIANT_TITLE",
};

export function conditionsSourceToRuleSet(
  source: ConditionsSourceRead | null | undefined,
): LegacyRuleSet | null {
  if (!source?.inclusion) return null;

  const appliedDisjunctively = source.inclusion.matchType === "ANY";
  const rules: LegacyRuleSet["rules"] = [];

  for (const condition of source.inclusion.conditions) {
    const column =
      TYPENAME_TO_COLUMN[condition.__typename] ?? condition.__typename;
    const relation = condition.relation ?? "";

    if (Array.isArray(condition.values)) {
      for (const value of condition.values) {
        rules.push({ column, condition: value, relation });
      }
    } else if (condition.value !== null && condition.value !== undefined) {
      rules.push({ column, condition: String(condition.value), relation });
    } else {
      rules.push({ column, condition: "", relation });
    }
  }

  return { appliedDisjunctively, rules };
}
