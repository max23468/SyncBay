import type { SyncBayProductFacet } from "./syncbay-product-facets";

export function hasSyncBayProductFacetBaselineChanged(
  previousFacets: SyncBayProductFacet[],
  nextFacets: SyncBayProductFacet[],
) {
  return serializeBaseline(previousFacets) !== serializeBaseline(nextFacets);
}

function serializeBaseline(facets: SyncBayProductFacet[]) {
  return JSON.stringify(
    facets
      .map((facet) => ({
        key: facet.key,
        label: facet.label,
        namespace: facet.namespace,
        type: facet.type,
        value: facet.value,
      }))
      .sort((left, right) =>
        `${left.namespace}:${left.key}`.localeCompare(
          `${right.namespace}:${right.key}`,
        ),
      ),
  );
}
