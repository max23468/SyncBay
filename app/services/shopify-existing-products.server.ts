import type {
  ShopifyMatchCandidate,
  ShopifyMatchMetafieldCandidate,
} from "../lib/syncbay-product-matching";

interface ShopifyAdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

interface ShopifyExistingProductMatchResponse {
  data?: {
    products?: {
      nodes?: ExistingProductNode[];
      pageInfo?: {
        endCursor?: string | null;
        hasNextPage?: boolean | null;
      } | null;
    } | null;
  };
  errors?: unknown[];
}

interface ExistingProductNode {
  handle?: string | null;
  id?: string | null;
  metafields?: {
    nodes?: ShopifyMatchMetafieldCandidate[] | null;
  } | null;
  tags?: string[] | null;
  title?: string | null;
  variants?: {
    nodes?: Array<{
      barcode?: string | null;
      id?: string | null;
      sku?: string | null;
    }> | null;
  } | null;
}

const DEFAULT_EXISTING_PRODUCT_LIMIT = 2000;
const SHOPIFY_PRODUCTS_PAGE_SIZE = 250;
const SHOPIFY_VARIANT_MATCH_CANDIDATE_LIMIT = 10;

const EXISTING_PRODUCTS_QUERY = `#graphql
  query SyncBayExistingProductsForMatching($first: Int!, $after: String, $variantFirst: Int!) {
    products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        handle
        productType
        status
        tags
        title
        metafields(first: 20, namespace: "syncbay") {
          nodes {
            key
            namespace
            value
          }
        }
        seo {
          description
          title
        }
        variants(first: $variantFirst) {
          nodes {
            barcode
            id
            sku
          }
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }`;

export async function loadExistingShopifyProductsForMatching(
  admin: ShopifyAdminGraphqlClient,
  options: { limit?: number } = {},
): Promise<ShopifyMatchCandidate[]> {
  const limit = normalizeLimit(options.limit);
  const products: ShopifyMatchCandidate[] = [];
  let productReadCount = 0;
  let cursor: string | null = null;

  while (productReadCount < limit) {
    const page = await fetchExistingProductsPage(admin, {
      cursor,
      first: Math.min(SHOPIFY_PRODUCTS_PAGE_SIZE, limit - productReadCount),
    });
    productReadCount += page.productCount;
    products.push(...page.products);

    if (!page.hasNextPage || !page.endCursor) break;
    cursor = page.endCursor;
  }

  return products;
}

async function fetchExistingProductsPage(
  admin: ShopifyAdminGraphqlClient,
  input: { cursor: string | null; first: number },
) {
  const response = await admin.graphql(EXISTING_PRODUCTS_QUERY, {
    variables: {
      after: input.cursor,
      first: input.first,
      variantFirst: SHOPIFY_VARIANT_MATCH_CANDIDATE_LIMIT,
    },
  });

  if (!response.ok) return getEmptyExistingProductsPage();

  const json = (await response.json()) as ShopifyExistingProductMatchResponse;
  if (json.errors?.length) return getEmptyExistingProductsPage();

  const products = json.data?.products;
  const productNodes = products?.nodes ?? [];

  return {
    endCursor: products?.pageInfo?.endCursor ?? null,
    hasNextPage: Boolean(products?.pageInfo?.hasNextPage),
    productCount: productNodes.length,
    products: productNodes.flatMap(toMatchCandidates),
  };
}

function toMatchCandidates(
  product: ExistingProductNode,
): ShopifyMatchCandidate[] {
  if (!product.id) return [];

  const variants = product.variants?.nodes?.length
    ? product.variants.nodes
    : [null];

  return variants.map((variant) => ({
    barcode: normalizeNullableString(variant?.barcode),
    handle: normalizeNullableString(product.handle),
    metafields: product.metafields?.nodes ?? [],
    productGid: product.id as string,
    sku: normalizeNullableString(variant?.sku),
    tags: product.tags ?? [],
    title: normalizeNullableString(product.title),
    variantGid: variant?.id ?? null,
  }));
}

function getEmptyExistingProductsPage() {
  return {
    endCursor: null,
    hasNextPage: false,
    productCount: 0,
    products: [] as ShopifyMatchCandidate[],
  };
}

function normalizeLimit(value: number | undefined) {
  if (!Number.isInteger(value)) return DEFAULT_EXISTING_PRODUCT_LIMIT;

  return Math.min(
    Math.max(value ?? DEFAULT_EXISTING_PRODUCT_LIMIT, 1),
    DEFAULT_EXISTING_PRODUCT_LIMIT,
  );
}

function normalizeNullableString(value: string | null | undefined) {
  const normalized = value?.trim();

  return normalized ? normalized : null;
}
