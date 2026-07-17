type ShopifyAdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type ShopifyPublicationNode = {
  catalog?: {
    title?: string | null;
  } | null;
  id?: string | null;
  name?: string | null;
};

export type ShopifyProductPublication = {
  id: string;
  title: string;
};

type ShopifyProductPublicationTarget = {
  id: string;
  status?: string | null;
};

type ShopifyProductPublicationSyncOptions = {
  disabled?: boolean;
  publicationIds?: string[];
};

type ShopifyGraphqlError = {
  message: string;
};

type ShopifyUserError = {
  field?: string[] | null;
  message: string;
};

type ShopifyPublicationsResponse = {
  data?: {
    publications?: {
      nodes?: ShopifyPublicationNode[] | null;
      pageInfo?: {
        endCursor?: string | null;
        hasNextPage?: boolean | null;
      } | null;
    } | null;
  };
  errors?: ShopifyGraphqlError[];
};

type ShopifyPublishablePublishResponse = {
  data?: {
    publishablePublish?: {
      publishable?: {
        id?: string | null;
      } | null;
      userErrors?: ShopifyUserError[];
    } | null;
  };
  errors?: ShopifyGraphqlError[];
};

export type ShopifyProductPublicationSyncResult =
  | {
      publicationCount: number;
      publicationIds: string[];
      status: "synced";
    }
  | {
      message: string;
      publicationCount: number;
      reason: "no_publications" | "product_not_active" | "publication_disabled";
      status: "skipped";
    }
  | {
      errorMessage: string;
      publicationCount: number;
      publicationIds: string[];
      status: "failed";
    };

const SHOPIFY_PUBLICATION_PAGE_SIZE = 100;
const SHOPIFY_PUBLICATION_MAX_PAGES = 20;

export async function syncShopifyProductPublications(
  admin: ShopifyAdminGraphqlClient,
  product: ShopifyProductPublicationTarget,
  options: ShopifyProductPublicationSyncOptions = {},
): Promise<ShopifyProductPublicationSyncResult> {
  if (options.disabled) {
    return {
      message:
        "Pubblicazione automatica sui canali Shopify disattivata nelle impostazioni SyncBay.",
      publicationCount: 0,
      reason: "publication_disabled",
      status: "skipped",
    };
  }

  if (!shouldPublishProductToSalesChannels(product.status)) {
    return {
      message:
        "SyncBay non pubblica prodotti Shopify non attivi sui canali di vendita.",
      publicationCount: 0,
      reason: "product_not_active",
      status: "skipped",
    };
  }

  const publicationIds =
    options.publicationIds ?? (await loadShopifyProductPublicationIds(admin));

  if ("errorMessage" in publicationIds) {
    return {
      errorMessage: publicationIds.errorMessage,
      publicationCount: 0,
      publicationIds: [],
      status: "failed",
    };
  }

  if (publicationIds.length === 0) {
    return {
      message:
        "Shopify non ha restituito publication/canali su cui pubblicare.",
      publicationCount: 0,
      reason: "no_publications",
      status: "skipped",
    };
  }

  const response = await admin.graphql(
    `#graphql
    mutation SyncBayPublishProduct($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        publishable {
          ... on Product {
            id
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        id: product.id,
        input: publicationIds.map((publicationId) => ({ publicationId })),
      },
    },
  );
  const json = (await response.json()) as ShopifyPublishablePublishResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify publishablePublish ha risposto con stato HTTP ${response.status}.`,
      publicationCount: publicationIds.length,
      publicationIds,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyErrors(json.errors),
      publicationCount: publicationIds.length,
      publicationIds,
      status: "failed",
    };
  }

  const userErrors = json.data?.publishablePublish?.userErrors ?? [];

  if (userErrors.length > 0) {
    return {
      errorMessage: formatShopifyUserErrors(userErrors),
      publicationCount: publicationIds.length,
      publicationIds,
      status: "failed",
    };
  }

  return {
    publicationCount: publicationIds.length,
    publicationIds,
    status: "synced",
  };
}

export async function loadShopifyProductPublicationIds(
  admin: ShopifyAdminGraphqlClient,
) {
  const publications = await loadShopifyProductPublications(admin);

  if ("errorMessage" in publications) {
    return publications;
  }

  return getUniquePublicationIds(publications);
}

export async function loadShopifyProductPublications(
  admin: ShopifyAdminGraphqlClient,
) {
  const publications = await fetchShopifyPublications(admin);

  if ("errorMessage" in publications) {
    return publications;
  }

  return publications.flatMap((publication) =>
    publication.id
      ? [
          {
            id: publication.id,
            title: getPublicationTitle(publication),
          },
        ]
      : [],
  );
}

function shouldPublishProductToSalesChannels(
  status: string | null | undefined,
) {
  return status === "ACTIVE";
}

async function fetchShopifyPublications(admin: ShopifyAdminGraphqlClient) {
  const publications: ShopifyPublicationNode[] = [];
  let after: string | null = null;

  for (let page = 0; page < SHOPIFY_PUBLICATION_MAX_PAGES; page += 1) {
    const response = await admin.graphql(
      `#graphql
      query SyncBayProductPublications($after: String, $first: Int!) {
        publications(after: $after, first: $first) {
          nodes {
            catalog {
              title
            }
            id
            name
          }
          pageInfo {
            endCursor
            hasNextPage
          }
        }
      }`,
      {
        variables: {
          after,
          first: SHOPIFY_PUBLICATION_PAGE_SIZE,
        },
      },
    );
    const json = (await response.json()) as ShopifyPublicationsResponse;

    if (!response.ok) {
      return {
        errorMessage: `Shopify publications ha risposto con stato HTTP ${response.status}.`,
      };
    }

    if (json.errors?.length) {
      return {
        errorMessage: formatShopifyErrors(json.errors),
      };
    }

    publications.push(...(json.data?.publications?.nodes ?? []));

    const pageInfo = json.data?.publications?.pageInfo;

    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;

    after = pageInfo.endCursor;
  }

  return publications;
}

function getUniquePublicationIds(publications: ShopifyProductPublication[]) {
  return [
    ...new Set(
      publications.flatMap((publication) =>
        publication.id ? [publication.id] : [],
      ),
    ),
  ];
}

function getPublicationTitle(publication: ShopifyPublicationNode) {
  // Preferisci il titolo catalogo leggibile (custom, market, B2B), che
  // distingue meglio la pubblicazione, e ripiega sul nome solo quando il
  // titolo catalogo manca o è l'etichetta tecnica `Channel Catalog ...`.
  const catalogTitle = publication.catalog?.title?.trim();

  if (catalogTitle && !isTechnicalChannelCatalogTitle(catalogTitle)) {
    return catalogTitle;
  }

  const publicationName = publication.name?.trim();

  if (publicationName) return publicationName;

  return getFallbackPublicationTitle(publication.id);
}

function isTechnicalChannelCatalogTitle(title: string) {
  return /^Channel Catalog\b/i.test(title);
}

function getFallbackPublicationTitle(publicationId: string | null | undefined) {
  const shortId = publicationId?.match(/\/Publication\/([^/?]+)/)?.[1];

  return shortId ? `Canale Shopify ${shortId}` : "Canale Shopify";
}

function formatShopifyErrors(errors: ShopifyGraphqlError[]) {
  return errors.map((error) => error.message).join("; ");
}

function formatShopifyUserErrors(errors: ShopifyUserError[]) {
  return errors.map((error) => error.message).join("; ");
}
