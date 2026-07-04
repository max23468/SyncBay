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

interface ShopifyExistingVariantMatchResponse {
  data?: {
    productVariants?: {
      nodes?: ExistingVariantNode[];
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
  media?: {
    nodes?: Array<{
      id?: string | null;
      mediaContentType?: string | null;
    }> | null;
  } | null;
  tags?: string[] | null;
  title?: string | null;
  variants?: {
    nodes?: Array<{
      barcode?: string | null;
      id?: string | null;
      sku?: string | null;
    }> | null;
    pageInfo?: {
      hasNextPage?: boolean | null;
    } | null;
  } | null;
}

interface ExistingVariantNode {
  barcode?: string | null;
  id?: string | null;
  product?: {
    handle?: string | null;
    id?: string | null;
    media?: {
      nodes?: Array<{
        id?: string | null;
        mediaContentType?: string | null;
      }> | null;
    } | null;
    metafields?: {
      nodes?: ShopifyMatchMetafieldCandidate[] | null;
    } | null;
    tags?: string[] | null;
    title?: string | null;
  } | null;
  sku?: string | null;
}

const DEFAULT_EXISTING_PRODUCT_LIMIT = 10000;
const SHOPIFY_PRODUCTS_PAGE_SIZE = 250;
const SHOPIFY_TARGETED_PRODUCTS_PAGE_SIZE = 250;
const SHOPIFY_TARGETED_SKU_BATCH_SIZE = 25;
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
        media(first: 1, query: "media_type:IMAGE") {
          nodes {
            id
            mediaContentType
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
          pageInfo {
            hasNextPage
          }
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }`;

const TARGETED_VARIANTS_QUERY = `#graphql
  query SyncBayExistingVariantsBySku($first: Int!, $after: String, $query: String!) {
    productVariants(first: $first, after: $after, query: $query) {
      nodes {
        id
        sku
        barcode
        product {
          id
          handle
          tags
          title
          media(first: 1, query: "media_type:IMAGE") {
            nodes {
              id
              mediaContentType
            }
          }
          metafields(first: 20, namespace: "syncbay") {
            nodes {
              key
              namespace
              value
            }
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
  options: { limit?: number; skuHints?: string[] } = {},
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

  const targetedProducts = await loadTargetedShopifyProductsForMatching(admin, {
    existingProducts: products,
    skuHints: options.skuHints ?? [],
  });
  products.push(...targetedProducts);

  return products;
}

async function loadTargetedShopifyProductsForMatching(
  admin: ShopifyAdminGraphqlClient,
  input: {
    existingProducts: ShopifyMatchCandidate[];
    skuHints: string[];
  },
): Promise<ShopifyMatchCandidate[]> {
  const existingKeys = new Set(input.existingProducts.map(getCandidateKey));
  const existingSkus = new Set(
    input.existingProducts.flatMap((product) => {
      const normalized = normalizeSkuHint(product.sku);
      return normalized ? [normalized] : [];
    }),
  );
  const skuHints = getUniqueSkuHints(input.skuHints).filter(
    (sku) => !existingSkus.has(sku),
  );
  const targetedProducts: ShopifyMatchCandidate[] = [];

  for (const batch of chunkArray(skuHints, SHOPIFY_TARGETED_SKU_BATCH_SIZE)) {
    let cursor: string | null = null;
    const query = buildSkuSearchQuery(batch);

    while (query) {
      const page = await fetchTargetedProductsPage(admin, {
        cursor,
        query,
      });

      for (const product of page.products) {
        const key = getCandidateKey(product);
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        targetedProducts.push(product);
      }

      if (!page.hasNextPage || !page.endCursor) break;
      cursor = page.endCursor;
    }
  }

  return targetedProducts;
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

async function fetchTargetedProductsPage(
  admin: ShopifyAdminGraphqlClient,
  input: { cursor: string | null; query: string },
) {
  const response = await admin.graphql(TARGETED_VARIANTS_QUERY, {
    variables: {
      after: input.cursor,
      first: SHOPIFY_TARGETED_PRODUCTS_PAGE_SIZE,
      query: input.query,
    },
  });

  if (!response.ok) return getEmptyTargetedProductsPage();

  const json = (await response.json()) as ShopifyExistingVariantMatchResponse;
  if (json.errors?.length) return getEmptyTargetedProductsPage();

  const variants = json.data?.productVariants;
  const variantNodes = variants?.nodes ?? [];

  return {
    endCursor: variants?.pageInfo?.endCursor ?? null,
    hasNextPage: Boolean(variants?.pageInfo?.hasNextPage),
    products: variantNodes.flatMap(toVariantMatchCandidate),
  };
}

function toMatchCandidates(
  product: ExistingProductNode,
): ShopifyMatchCandidate[] {
  if (!product.id) return [];

  const variants = product.variants?.nodes?.length
    ? product.variants.nodes
    : [null];
  const variantsTruncated = Boolean(product.variants?.pageInfo?.hasNextPage);

  return variants.map((variant) => ({
    barcode: normalizeNullableString(variant?.barcode),
    handle: normalizeNullableString(product.handle),
    metafields: product.metafields?.nodes ?? [],
    productGid: product.id as string,
    shopifyImageCount: countShopifyImageMedia(product),
    sku: normalizeNullableString(variant?.sku),
    tags: product.tags ?? [],
    title: normalizeNullableString(product.title),
    variantGid: variant?.id ?? null,
    variantsTruncated,
  }));
}

function countShopifyImageMedia(product: ExistingProductNode) {
  return (
    product.media?.nodes?.filter(
      (media) => media?.mediaContentType === "IMAGE",
    ).length ?? 0
  );
}

function toVariantMatchCandidate(
  variant: ExistingVariantNode,
): ShopifyMatchCandidate[] {
  const product = variant.product;
  if (!product?.id) return [];

  return [
    {
      barcode: normalizeNullableString(variant.barcode),
      handle: normalizeNullableString(product.handle),
      metafields: product.metafields?.nodes ?? [],
      productGid: product.id,
      shopifyImageCount: countShopifyImageMedia(product),
      sku: normalizeNullableString(variant.sku),
      tags: product.tags ?? [],
      title: normalizeNullableString(product.title),
      variantGid: variant.id ?? null,
      variantsTruncated: false,
    },
  ];
}

function getEmptyExistingProductsPage() {
  return {
    endCursor: null,
    hasNextPage: false,
    productCount: 0,
    products: [] as ShopifyMatchCandidate[],
  };
}

function getEmptyTargetedProductsPage() {
  return {
    endCursor: null,
    hasNextPage: false,
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

function getUniqueSkuHints(values: string[]) {
  return Array.from(
    new Set(
      values
        .map(normalizeSkuHint)
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function normalizeSkuHint(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.toUpperCase() : null;
}

function buildSkuSearchQuery(skuHints: string[]) {
  return skuHints.map((sku) => `sku:${escapeSearchValue(sku)}`).join(" OR ");
}

function escapeSearchValue(value: string) {
  if (/^[A-Z0-9_-]+$/u.test(value)) return value;

  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}

function getCandidateKey(product: ShopifyMatchCandidate) {
  return `${product.productGid}:${product.variantGid ?? product.sku ?? ""}`;
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}
