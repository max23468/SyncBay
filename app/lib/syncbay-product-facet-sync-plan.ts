import type {
  ShopifyProductFacetMetafield,
  SyncBayProductFacet,
} from "./syncbay-product-facets";

export interface CurrentProductFacetMetafield {
  key: string;
  namespace: string;
  type: string;
  value: string;
}

export interface ProductFacetSyncPlan {
  conflicts: ShopifyProductFacetMetafield[];
  deletes: Array<{
    key: string;
    namespace: string;
  }>;
  skipped: Array<{
    key: string;
    reason: "evidence_missing" | "manual_conflict" | "not_high_confidence";
  }>;
  writes: ShopifyProductFacetMetafield[];
}

export function buildProductFacetSyncPlan(input: {
  currentMetafields: CurrentProductFacetMetafield[];
  previousSyncBayFacets: SyncBayProductFacet[];
  proposedFacets: SyncBayProductFacet[];
}): ProductFacetSyncPlan {
  const currentByKey = new Map(
    input.currentMetafields.map((metafield) => [
      `${metafield.namespace}:${metafield.key}`,
      metafield,
    ]),
  );
  const previousByKey = new Map(
    input.previousSyncBayFacets.map((facet) => [
      `${facet.namespace}:${facet.key}`,
      facet,
    ]),
  );
  const proposedByKey = new Map(
    input.proposedFacets.map((facet) => [
      `${facet.namespace}:${facet.key}`,
      facet,
    ]),
  );
  const writes: ShopifyProductFacetMetafield[] = [];
  const deletes: ProductFacetSyncPlan["deletes"] = [];
  const conflicts: ShopifyProductFacetMetafield[] = [];
  const skipped: ProductFacetSyncPlan["skipped"] = [];

  const candidateKeys = new Set([
    ...proposedByKey.keys(),
    ...previousByKey.keys(),
  ]);

  for (const key of candidateKeys) {
    const facet = proposedByKey.get(key);
    const current = currentByKey.get(key);
    const previous = previousByKey.get(key);

    if (!facet) {
      if (
        current &&
        previous &&
        current.type === previous.type &&
        current.value === previous.value
      ) {
        deletes.push({ key: previous.key, namespace: previous.namespace });
        skipped.push({ key: previous.key, reason: "evidence_missing" });
      }
      continue;
    }

    if (!current) {
      writes.push(toMetafield(facet));
      continue;
    }

    if (current.type === facet.type && current.value === facet.value) {
      continue;
    }

    if (
      previous &&
      current.type === previous.type &&
      current.value === previous.value
    ) {
      writes.push(toMetafield(facet));
      continue;
    }

    conflicts.push(toMetafield(facet));
    skipped.push({ key: facet.key, reason: "manual_conflict" });
  }

  return { conflicts, deletes, skipped, writes };
}

function toMetafield(facet: SyncBayProductFacet): ShopifyProductFacetMetafield {
  return {
    key: facet.key,
    namespace: facet.namespace,
    type: facet.type,
    value: facet.value,
  };
}
