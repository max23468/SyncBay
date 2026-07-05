import {
  buildProductFacetSyncPlan,
  type CurrentProductFacetMetafield,
} from "../lib/syncbay-product-facet-sync-plan";
import type { SyncBayProductFacet } from "../lib/syncbay-product-facets";

interface ShopifyAdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

interface ShopifyMetafieldsResponse {
  data?: {
    product?: {
      metafields?: {
        nodes?: CurrentProductFacetMetafield[];
      };
    } | null;
  };
  errors?: Array<{ message: string }>;
}

interface ShopifyMetafieldsSetResponse {
  data?: {
    metafieldsSet?: {
      userErrors?: Array<{ field?: string[] | null; message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
}

interface ShopifyMetafieldsDeleteResponse {
  data?: {
    metafieldsDelete?: {
      userErrors?: Array<{ field?: string[] | null; message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
}

export async function syncShopifyProductFacets(input: {
  admin: ShopifyAdminGraphqlClient;
  ownerId: string;
  previousSyncBayFacets: SyncBayProductFacet[];
  proposedFacets: SyncBayProductFacet[];
}) {
  const currentMetafields = await loadCurrentFacetMetafields(
    input.admin,
    input.ownerId,
  );
  if (!currentMetafields) {
    return {
      baselineFacets: input.previousSyncBayFacets,
      conflicts: [],
      deleted: [],
      skipped: input.proposedFacets.map((facet) => ({
        key: facet.key,
        reason: "shopify_product_missing" as const,
      })),
      status: "missing_owner" as const,
      written: [],
    };
  }

  const plan = buildProductFacetSyncPlan({
    currentMetafields,
    previousSyncBayFacets: input.previousSyncBayFacets,
    proposedFacets: input.proposedFacets,
  });
  const baselineFacets = buildWriterOwnedFacetBaseline({
    conflicts: plan.conflicts,
    proposedFacets: input.proposedFacets,
  });

  if (plan.writes.length === 0 && plan.deletes.length === 0) {
    return {
      baselineFacets,
      conflicts: plan.conflicts,
      deleted: [],
      skipped: plan.skipped,
      status: "synced" as const,
      written: [],
    };
  }

  if (plan.writes.length > 0) {
    await writeFacetMetafields(input.admin, {
      metafields: plan.writes.map((metafield) => ({
        ...metafield,
        ownerId: input.ownerId,
      })),
    });
  }
  if (plan.deletes.length > 0) {
    await deleteFacetMetafields(input.admin, {
      metafields: plan.deletes.map((metafield) => ({
        ...metafield,
        ownerId: input.ownerId,
      })),
    });
  }

  return {
    baselineFacets,
    conflicts: plan.conflicts,
    deleted: plan.deletes,
    skipped: plan.skipped,
    status: "synced" as const,
    written: plan.writes,
  };
}

function buildWriterOwnedFacetBaseline(input: {
  conflicts: Array<{ key: string; namespace: string }>;
  proposedFacets: SyncBayProductFacet[];
}) {
  const conflictKeys = new Set(
    input.conflicts.map((facet) => `${facet.namespace}:${facet.key}`),
  );
  return input.proposedFacets.filter(
    (facet) => !conflictKeys.has(`${facet.namespace}:${facet.key}`),
  );
}

async function loadCurrentFacetMetafields(
  admin: ShopifyAdminGraphqlClient,
  productGid: string,
) {
  const response = await admin.graphql(
    `#graphql
    query SyncBayProductFacetMetafields($id: ID!) {
      product(id: $id) {
        metafields(first: 20, namespace: "syncbay_facets") {
          nodes {
            key
            namespace
            type
            value
          }
        }
      }
    }`,
    { variables: { id: productGid } },
  );
  const json = (await response.json()) as ShopifyMetafieldsResponse;
  if (!response.ok) {
    throw new Error(
      `Shopify lettura metafield faccette ha risposto con stato HTTP ${response.status}.`,
    );
  }
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }
  if (json.data?.product === null) return null;

  return json.data?.product?.metafields?.nodes ?? [];
}

async function writeFacetMetafields(
  admin: ShopifyAdminGraphqlClient,
  input: {
    metafields: Array<{
      key: string;
      namespace: "syncbay_facets";
      ownerId: string;
      type: string;
      value: string;
    }>;
  },
) {
  const response = await admin.graphql(
    `#graphql
    mutation SyncBayWriteProductFacetMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors {
          field
          message
        }
      }
    }`,
    { variables: { metafields: input.metafields } },
  );
  const json = (await response.json()) as ShopifyMetafieldsSetResponse;
  if (!response.ok) {
    throw new Error(
      `Shopify scrittura metafield faccette ha risposto con stato HTTP ${response.status}.`,
    );
  }
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }

  const userErrors = json.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(
      userErrors
        .map((error) =>
          error.field?.length
            ? `${error.field.join(".")}: ${error.message}`
            : error.message,
        )
        .join("; "),
    );
  }
}

async function deleteFacetMetafields(
  admin: ShopifyAdminGraphqlClient,
  input: {
    metafields: Array<{
      key: string;
      namespace: string;
      ownerId: string;
    }>;
  },
) {
  const response = await admin.graphql(
    `#graphql
    mutation SyncBayDeleteProductFacetMetafields($metafields: [MetafieldIdentifierInput!]!) {
      metafieldsDelete(metafields: $metafields) {
        userErrors {
          field
          message
        }
      }
    }`,
    { variables: { metafields: input.metafields } },
  );
  const json = (await response.json()) as ShopifyMetafieldsDeleteResponse;
  if (!response.ok) {
    throw new Error(
      `Shopify cancellazione metafield faccette ha risposto con stato HTTP ${response.status}.`,
    );
  }
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }

  const userErrors = json.data?.metafieldsDelete?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(
      userErrors
        .map((error) =>
          error.field?.length
            ? `${error.field.join(".")}: ${error.message}`
            : error.message,
        )
        .join("; "),
    );
  }
}
