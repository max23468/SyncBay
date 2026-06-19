import type { ShopifyCategoryProposal } from "./syncbay-shopify-category-mapping";
import type {
  SyncBayProductFacet,
  SyncBayProductFacetKey,
} from "./syncbay-product-facets";

type SnapshotPayloadValue =
  | boolean
  | number
  | string
  | null
  | SnapshotPayloadValue[]
  | { [key: string]: SnapshotPayloadValue };

export type EbayProductSnapshotPayload = {
  [key: string]: SnapshotPayloadValue;
};

export function buildEbayProductSnapshotPayload(input: {
  categoryProposal?: ShopifyCategoryProposal | null;
  descriptionMode: string;
  ebayPrimaryCategoryId?: string | null;
  ebayPrimaryCategoryName?: string | null;
  ebayPrimaryCategoryPath?: string | null;
  imageUrls?: string[];
  issueCodes: string[];
  productFacets?: SyncBayProductFacet[];
  skuGenerated: boolean;
  status: string;
  storeCategoryId?: string | null;
  storeCategoryName?: string | null;
}): EbayProductSnapshotPayload {
  return {
    descriptionMode: input.descriptionMode,
    imageUrls: normalizeImageUrls(input.imageUrls ?? []),
    issueCodes: input.issueCodes,
    skuGenerated: input.skuGenerated,
    status: input.status,
    ...(input.productFacets?.length
      ? { productFacets: input.productFacets.map(serializeProductFacet) }
      : {}),
    ...(input.ebayPrimaryCategoryId
      ? { ebayPrimaryCategoryId: input.ebayPrimaryCategoryId }
      : {}),
    ...(input.ebayPrimaryCategoryName
      ? { ebayPrimaryCategoryName: input.ebayPrimaryCategoryName }
      : {}),
    ...(input.ebayPrimaryCategoryPath
      ? { ebayPrimaryCategoryPath: input.ebayPrimaryCategoryPath }
      : {}),
    ...(input.storeCategoryId
      ? { storeCategoryId: input.storeCategoryId }
      : {}),
    ...(input.storeCategoryName
      ? { storeCategoryName: input.storeCategoryName }
      : {}),
    ...(input.categoryProposal
      ? { categoryProposal: serializeCategoryProposal(input.categoryProposal) }
      : {}),
  };
}

function serializeProductFacet(
  facet: SyncBayProductFacet,
): EbayProductSnapshotPayload {
  return {
    key: facet.key,
    label: facet.label,
    namespace: facet.namespace,
    type: facet.type,
    value: facet.value,
  };
}

function serializeCategoryProposal(
  proposal: ShopifyCategoryProposal,
): EbayProductSnapshotPayload {
  return {
    applied: proposal.applied,
    confidence: proposal.confidence,
    productType: proposal.productType,
    reason: proposal.reason,
    shopifyCategoryGid: proposal.shopifyCategoryGid,
    shopifyCategoryName: proposal.shopifyCategoryName,
    source: proposal.source,
  };
}

export function getProductSnapshotThumbnailUrl(value: unknown) {
  const payload = getObject(value);
  const mediaSync = getObject(payload?.mediaSync);
  const imageUrls = [
    ...getStringArray(payload?.imageUrls),
    ...getStringArray(mediaSync?.sourceImageUrls),
  ];
  const firstImageUrl = imageUrls.find(isSafeImageUrl);
  const directImageUrl = [
    payload?.imageUrl,
    payload?.thumbnailUrl,
    payload?.galleryUrl,
    payload?.GalleryURL,
  ]
    .map(getString)
    .find((url): url is string => Boolean(url && isSafeImageUrl(url)));

  return firstImageUrl ?? directImageUrl ?? null;
}

export function getProductSnapshotThumbnailUrlFromPayloads(values: unknown[]) {
  for (const value of values) {
    const thumbnailUrl = getProductSnapshotThumbnailUrl(value);

    if (thumbnailUrl) return thumbnailUrl;
  }

  return null;
}

export function getProductFacetsFromSnapshotPayload(
  value: unknown,
): SyncBayProductFacet[] {
  const payload = getObject(value);
  const facets = payload?.productFacets;
  if (!Array.isArray(facets)) return [];

  return facets.flatMap((facet) => {
    const candidate = getObject(facet);
    const key = getProductFacetKey(candidate?.key);
    const label = getString(candidate?.label);
    const namespace = getString(candidate?.namespace);
    const type = getProductFacetType(candidate?.type);
    const facetValue = getString(candidate?.value);

    if (!key || !label || namespace !== "syncbay_facets" || !type || !facetValue) {
      return [];
    }

    return [
      {
        key,
        label,
        namespace,
        type,
        value: facetValue,
      },
    ];
  });
}

function normalizeImageUrls(imageUrls: string[]) {
  return [...new Set(imageUrls.map((imageUrl) => imageUrl.trim()))].filter(
    Boolean,
  );
}

function getObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  return value as Record<string, unknown>;
}

function getStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is string => typeof item === "string");
}

function getString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function getProductFacetKey(value: unknown): SyncBayProductFacetKey | null {
  if (
    value === "categoria" ||
    value === "area_stato" ||
    value === "materiale" ||
    value === "conservazione" ||
    value === "perizia"
  ) {
    return value;
  }

  return null;
}

function getProductFacetType(
  value: unknown,
): SyncBayProductFacet["type"] | null {
  if (
    value === "single_line_text_field" ||
    value === "list.single_line_text_field"
  ) {
    return value;
  }

  return null;
}

function isSafeImageUrl(value: string) {
  try {
    const url = new URL(value);

    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
