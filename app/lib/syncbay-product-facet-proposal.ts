// @ts-expect-error Node --experimental-strip-types resolves this pure module import.
import * as snapshotPayload from "./syncbay-product-snapshot-payload.ts";
// @ts-expect-error Node --experimental-strip-types resolves this pure module import.
import * as productFacets from "./syncbay-product-facets.ts";
import type { SyncBayProductFacet } from "./syncbay-product-facets";

const { getProductFacetsFromSnapshotPayload } = snapshotPayload;
const { buildSyncBayProductFacets } = productFacets;

export interface SyncBayProductFacetProposalInput {
  ebayPrimaryCategoryName?: string | null;
  payload?: unknown;
  storeCategoryName?: string | null;
  title?: string | null;
}

export function buildSyncBayProductFacetProposalFromSnapshot(
  input: SyncBayProductFacetProposalInput,
): SyncBayProductFacet[] {
  const snapshotFacets = getProductFacetsFromSnapshotPayload(input.payload);
  if (snapshotFacets.length > 0) return snapshotFacets;

  return buildSyncBayProductFacets({
    ebayPrimaryCategoryName: input.ebayPrimaryCategoryName,
    itemSpecifics: [],
    storeCategoryName: input.storeCategoryName,
    title: input.title,
  });
}
