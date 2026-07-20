export interface ShopifyCollectionRule {
  column: string;
  condition: string;
  relation: string;
}

export interface ShopifyCollectionRuleSet {
  appliedDisjunctively: boolean;
  rules: ShopifyCollectionRule[];
}

export interface ShopifyCollectionForRuleProposal {
  handle: string;
  id: string;
  ruleSet: ShopifyCollectionRuleSet | null;
  title: string;
}

export interface CollectionRuleIntent {
  generic?: boolean;
  handle: string;
  productTypeContains?: string[];
  requirePositiveInventory: boolean;
  title: string;
  titleContains?: string[];
}

export interface CollectionRuleProposal {
  collectionId: string;
  currentRuleSet: ShopifyCollectionRuleSet | null;
  handle: string;
  proposedRuleSet: ShopifyCollectionRuleSet;
  reason:
    | "configured_product_type_alignment"
    | "configured_title_alignment"
    | "missing_inventory_guard";
  title: string;
}

export interface CollectionRuleWarning {
  handle: string;
  message: string;
  reason: "unsafe_disjunctive_title_rules" | "missing_collection_intent";
  title: string;
}

export interface CollectionRuleReview {
  proposals: CollectionRuleProposal[];
  warnings: CollectionRuleWarning[];
}

const INVENTORY_RULE: ShopifyCollectionRule = {
  column: "VARIANT_INVENTORY",
  condition: "0",
  relation: "GREATER_THAN",
};

export function buildCollectionRuleReview(input: {
  collectionIntents: CollectionRuleIntent[];
  collections: ShopifyCollectionForRuleProposal[];
}): CollectionRuleReview {
  const intentByHandle = new Map(input.collectionIntents.map((intent) => [intent.handle, intent]));
  const proposals: CollectionRuleProposal[] = [];
  const warnings: CollectionRuleWarning[] = [];

  for (const collection of input.collections) {
    const intent = intentByHandle.get(collection.handle);
    if (!intent || intent.generic) continue;

    const reviewItem = buildProposedRuleSet(collection, intent);
    if (!reviewItem) continue;
    if ("warning" in reviewItem) {
      warnings.push(reviewItem.warning);
      continue;
    }

    if (areRuleSetsEqual(collection.ruleSet, reviewItem.ruleSet)) {
      continue;
    }

    proposals.push({
      collectionId: collection.id,
      currentRuleSet: collection.ruleSet,
      handle: collection.handle,
      proposedRuleSet: reviewItem.ruleSet,
      reason: reviewItem.reason,
      title: collection.title,
    });
  }

  return { proposals, warnings };
}

function buildProposedRuleSet(
  collection: ShopifyCollectionForRuleProposal,
  intent: CollectionRuleIntent,
):
  | {
      reason: CollectionRuleProposal["reason"];
      ruleSet: ShopifyCollectionRuleSet;
    }
  | { warning: CollectionRuleWarning }
  | null {
  const productTypeRules = (intent.productTypeContains ?? []).map((condition) => ({
    column: "TYPE",
    condition,
    relation: "CONTAINS",
  }));

  if (productTypeRules.length > 0) {
    return {
      reason: "configured_product_type_alignment",
      ruleSet: {
        appliedDisjunctively: false,
        rules: [...productTypeRules, ...(intent.requirePositiveInventory ? [INVENTORY_RULE] : [])],
      },
    };
  }

  const titleRules = (intent.titleContains ?? []).map((condition) => ({
    column: "TITLE",
    condition,
    relation: "CONTAINS",
  }));

  if (titleRules.length > 0) {
    // Le condizioni titolo restano in OR fra loro (matchType ANY della condizione
    // ProductTitle nel modello sources) mentre l'inventario è in AND a livello di
    // inclusione: `appliedDisjunctively: false` rappresenta l'inclusione ALL.
    return {
      reason: "configured_title_alignment",
      ruleSet: {
        appliedDisjunctively: false,
        rules: [...titleRules, ...(intent.requirePositiveInventory ? [INVENTORY_RULE] : [])],
      },
    };
  }

  if (isUnsafeDisjunctiveRuleSet(collection.ruleSet)) {
    return {
      warning: {
        handle: collection.handle,
        message:
          "Regola titolo OR non modificata automaticamente: aggiungere inventario la trasformerebbe in AND. Decidere un productType affidabile o usare modello Shopify sources se serve mantenere gruppi OR.",
        reason: "unsafe_disjunctive_title_rules",
        title: collection.title,
      },
    };
  }

  if (
    intent.requirePositiveInventory &&
    collection.ruleSet &&
    !hasInventoryRule(collection.ruleSet)
  ) {
    return {
      reason: "missing_inventory_guard",
      ruleSet: {
        appliedDisjunctively: false,
        rules: [...collection.ruleSet.rules, INVENTORY_RULE],
      },
    };
  }

  return null;
}

function isUnsafeDisjunctiveRuleSet(ruleSet: ShopifyCollectionRuleSet | null) {
  return Boolean(
    ruleSet?.appliedDisjunctively &&
    ruleSet.rules.filter((rule) => !isInventoryRule(rule)).length > 1,
  );
}

function hasInventoryRule(ruleSet: ShopifyCollectionRuleSet) {
  return ruleSet.rules.some((rule) => isInventoryRule(rule));
}

function isInventoryRule(rule: ShopifyCollectionRule) {
  return (
    rule.column === INVENTORY_RULE.column &&
    rule.relation === INVENTORY_RULE.relation &&
    rule.condition === INVENTORY_RULE.condition
  );
}

function areRuleSetsEqual(left: ShopifyCollectionRuleSet | null, right: ShopifyCollectionRuleSet) {
  if (!left) return false;
  return JSON.stringify(normalizeRuleSet(left)) === JSON.stringify(normalizeRuleSet(right));
}

function normalizeRuleSet(ruleSet: ShopifyCollectionRuleSet) {
  return {
    appliedDisjunctively: ruleSet.appliedDisjunctively,
    rules: ruleSet.rules
      .map((rule) => ({
        column: rule.column,
        condition: rule.condition,
        relation: rule.relation,
      }))
      .sort((left, right) =>
        `${left.column}:${left.relation}:${left.condition}`.localeCompare(
          `${right.column}:${right.relation}:${right.condition}`,
        ),
      ),
  };
}
